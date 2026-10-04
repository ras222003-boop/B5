import type { Request, Response, Router } from 'express';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks=vi.hoisted(()=>({execute:vi.fn(),getSession:vi.fn(),getConnection:vi.fn()}));
vi.mock('./auth',()=>({auth:{api:{getSession:mocks.getSession}},pool:{execute:mocks.execute,getConnection:mocks.getConnection}}));
vi.mock('better-auth/node',()=>({fromNodeHeaders:vi.fn(()=>({}))}));
import { canManageMapping, registerLocalizationRoutes } from './localization';

function handler(path:string){
  const post=vi.fn(),get=vi.fn();registerLocalizationRoutes({post,get} as unknown as Router);
  const result=post.mock.calls.find(([route])=>route===path);
  if(!result)throw new Error(`missing ${path}`);
  return result[1] as (req:Request,res:Response)=>void;
}
function response(){
  const json=vi.fn(),status=vi.fn().mockReturnThis();
  const res={status,json,headersSent:false} as unknown as Response;
  return {res,status,json};
}

describe('mapping authorization',()=>{
  beforeEach(()=>{mocks.execute.mockReset();mocks.getSession.mockReset();mocks.getConnection.mockReset();});
  it('reserves official sessions and review for mapper or admin roles',()=>{
    expect(canManageMapping(null)).toBe(false);
    expect(canManageMapping('user')).toBe(false);
    expect(canManageMapping('mapper')).toBe(true);
    expect(canManageMapping('admin')).toBe(true);
  });
  it('returns 403 before a regular user can create a session or approve a suggestion',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'user-1'}});
    const building='11111111-1111-4111-8111-111111111111';
    mocks.execute.mockImplementation(async(sql:string)=>{
      if(sql.startsWith('SELECT role FROM basira_navigation_roles'))return [[{role:null}]];
      if(sql.includes("status='ACTIVE'"))return [[{id:building}]];
      if(sql.startsWith('SELECT organization_id FROM basira_buildings'))return [[{organization_id:null}]];
      throw new Error(`unexpected ${sql}`);
    });
    const {res,status,json}=response();
    handler('/mapping-sessions')({headers:{},params:{},body:{buildingId:building,startAnchor:null,deviceCapabilities:{},confidence:.8}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:'mapper_role_required'}));
    expect(status).toHaveBeenCalledWith(403);
  });
  it('allows an organization mapper on their building and denies a global mapper without membership',async()=>{
    const building='11111111-1111-4111-8111-111111111111',organization='22222222-2222-4222-8222-222222222222';
    mocks.getSession.mockResolvedValue({user:{id:'mapper-1'}});
    let memberRole:string|null='mapper';
    mocks.execute.mockImplementation(async(sql:string)=>{
      if(sql.startsWith('SELECT role FROM basira_navigation_roles'))return [[{role:'mapper'}]];
      if(sql.includes("status='ACTIVE'"))return [[{id:building}]];
      if(sql.startsWith('SELECT organization_id FROM basira_buildings'))return [[{organization_id:organization}]];
      if(sql.startsWith('SELECT role FROM basira_organization_memberships'))return [memberRole?[{role:memberRole}]:[]];
      if(sql.startsWith('INSERT INTO basira_mapping_sessions'))return [{affectedRows:1}];
      if(sql.startsWith('SELECT * FROM basira_mapping_sessions'))return [[{id:'session-1',building_id:building}]];
      throw new Error(`unexpected ${sql}`);
    });
    const body={buildingId:building,startAnchor:null,deviceCapabilities:{},confidence:.8};
    const allowed=response();handler('/mapping-sessions')({headers:{},params:{},body} as unknown as Request,allowed.res);
    await vi.waitFor(()=>expect(allowed.status).toHaveBeenCalledWith(201));
    memberRole=null;
    const denied=response();handler('/mapping-sessions')({headers:{},params:{},body} as unknown as Request,denied.res);
    await vi.waitFor(()=>expect(denied.json).toHaveBeenCalledWith({error:'organization_mapper_required'}));
    expect(denied.status).toHaveBeenCalledWith(403);
  });
  it('finalizes a mapping session and deletes precise track and anchor data',async()=>{
    const sessionId='33333333-3333-4333-8333-333333333333',building='11111111-1111-4111-8111-111111111111';
    mocks.getSession.mockResolvedValue({user:{id:'mapper-1'}});
    mocks.execute.mockImplementation(async(sql:string)=>{
      if(sql.startsWith('SELECT role FROM basira_navigation_roles'))return [[{role:'mapper'}]];
      if(sql.startsWith('SELECT * FROM basira_mapping_sessions'))return [[{id:sessionId,building_id:building,started_by:'mapper-1',status:'ACTIVE'}]];
      if(sql.startsWith('SELECT organization_id FROM basira_buildings'))return [[{organization_id:null}]];
      if(sql.startsWith('SELECT COUNT(*) AS count FROM basira_map_suggestions'))return [[{count:1}]];
      if(sql.startsWith('DELETE FROM basira_mapping_track')||sql.startsWith('DELETE FROM basira_mapping_anchors')||sql.startsWith('DELETE FROM basira_mapping_floor_events')||sql.startsWith('UPDATE basira_mapping_sessions'))return [{affectedRows:1}];
      throw new Error(`unexpected ${sql}`);
    });
    const {res,json}=response();handler('/mapping-sessions/:sessionId/finalize')({headers:{},params:{sessionId},body:{cancel:false}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({status:'REVIEW_REQUIRED'}));
    const sql=mocks.execute.mock.calls.map(([query])=>String(query)).join('\n');
    for(const table of ['basira_mapping_track','basira_mapping_anchors','basira_mapping_floor_events'])expect(sql).toContain(`DELETE FROM ${table}`);
  });
  it('records an approved B3 node in the B5 building version and change log',async()=>{
    const building='11111111-1111-4111-8111-111111111111',floor='22222222-2222-4222-8222-222222222222',suggestionId='33333333-3333-4333-8333-333333333333';
    mocks.getSession.mockResolvedValue({user:{id:'mapper-1'}});mocks.execute.mockResolvedValue([[{role:'mapper'}]]);
    const nodes=new Map<string,Record<string,unknown>>(),writes:string[]=[];
    const connection={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),query:vi.fn(async(sql:string,params:any[]=[])=>{
      if(sql.startsWith('SELECT * FROM basira_map_suggestions'))return [[{id:suggestionId,status:'PENDING',session_id:'session',building_id:building,floor_id:floor,type:'NEW_NODE',x:4,y:5,place_id:null,name:null}]];
      if(sql.startsWith('SELECT organization_id,verification_status FROM basira_buildings'))return [[{organization_id:null,verification_status:'DISCOVERED'}]];
      if(sql.startsWith('SELECT status FROM basira_mapping_sessions'))return [[{status:'COMPLETED'}]];
      if(sql.startsWith('SELECT id FROM basira_floors'))return [[{id:floor}]];
      if(sql.startsWith('SELECT id FROM basira_map_nodes'))return [[]];
      if(sql.startsWith('SELECT * FROM basira_map_nodes'))return [[nodes.get(params[0])].filter(Boolean)];
      if(sql.startsWith('SELECT current_version'))return [[{current_version:1}]];
      throw new Error(`unexpected ${sql}`);
    }),execute:vi.fn(async(sql:string,params:any[]=[])=>{writes.push(sql);if(sql.startsWith('INSERT INTO basira_map_nodes'))nodes.set(params[0],{id:params[0],building_id:building,floor_id:floor,x:4,y:5,node_type:'POINT'});return [{affectedRows:1}];})};
    mocks.getConnection.mockResolvedValue(connection);
    const {res,json}=response();handler('/map-suggestions/:id/review')({headers:{},params:{id:suggestionId},body:{decision:'ACCEPTED'}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({status:'ACCEPTED',version:2}));
    expect(nodes.size).toBe(1);expect(writes.some(sql=>sql.includes('basira_map_change_log'))).toBe(true);expect(connection.commit).toHaveBeenCalled();
  });
});
