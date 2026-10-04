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
    mocks.execute.mockResolvedValue([[{role:null}]]);
    for(const [path,params] of [['/mapping-sessions',{}],['/map-suggestions/:id/review',{id:'33333333-3333-4333-8333-333333333333'}]] as const){
      const {res,status,json}=response();
      handler(path)({headers:{},params,body:{decision:'ACCEPTED'}} as unknown as Request,res);
      await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:'mapper_role_required'}));
      expect(status).toHaveBeenCalledWith(403);
    }
    expect(mocks.execute.mock.calls.every(([sql])=>String(sql).startsWith('SELECT role'))).toBe(true);
  });
  it('records an approved B3 node in the B5 building version and change log',async()=>{
    const building='11111111-1111-4111-8111-111111111111',floor='22222222-2222-4222-8222-222222222222',suggestionId='33333333-3333-4333-8333-333333333333';
    mocks.getSession.mockResolvedValue({user:{id:'mapper-1'}});mocks.execute.mockResolvedValue([[{role:'mapper'}]]);
    const nodes=new Map<string,Record<string,unknown>>(),writes:string[]=[];
    const connection={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),query:vi.fn(async(sql:string,params:any[]=[])=>{
      if(sql.startsWith('SELECT * FROM basira_map_suggestions'))return [[{id:suggestionId,status:'PENDING',session_id:'session',building_id:building,floor_id:floor,type:'NEW_NODE',x:4,y:5,place_id:null,name:null}]];
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
