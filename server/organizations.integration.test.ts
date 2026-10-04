import type { Request,Response,Router } from 'express';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),getConnection:vi.fn(),getSession:vi.fn(),connection:{query:vi.fn(),execute:vi.fn(),beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()}}));
vi.mock('./auth',()=>({auth:{api:{getSession:mocks.getSession}},pool:{query:mocks.query,execute:mocks.execute,getConnection:mocks.getConnection}}));
vi.mock('better-auth/node',()=>({fromNodeHeaders:vi.fn(()=>({}))}));
import { registerOrganizationRoutes } from './organizations';
import { MapImportValidator } from './mapImportValidator';

const org='11111111-1111-4111-8111-111111111111',building='22222222-2222-4222-8222-222222222222',importId='33333333-3333-4333-8333-333333333333';
function post(path:string){const registry=vi.fn();registerOrganizationRoutes({post:registry,get:vi.fn(),patch:vi.fn()} as unknown as Router);const call=registry.mock.calls.find(([name])=>name===path);if(!call)throw new Error(`missing ${path}`);return call[1] as (req:Request,res:Response)=>void;}
function response(){const json=vi.fn(),status=vi.fn().mockReturnThis(),set=vi.fn().mockReturnThis();return {res:{json,status,set,headersSent:false} as unknown as Response,json,status};}
const request=(body:unknown={},id=importId)=>({headers:{},body,params:{orgId:org,buildingId:building,importId:id}} as unknown as Request);
describe('B6 organization route authorization and import boundary (simulated HTTP integration)',()=>{
  beforeEach(()=>{for(const fn of [mocks.query,mocks.execute,mocks.getConnection,mocks.getSession,...Object.values(mocks.connection)])fn.mockReset();mocks.getConnection.mockResolvedValue(mocks.connection);});
  it('requires sign-in to create an organization',async()=>{mocks.getSession.mockResolvedValue(null);const {res,json,status}=response();post('/organizations')(request({name:'Test',type:'UNIVERSITY'}),res);await vi.waitFor(()=>expect(status).toHaveBeenCalledWith(401));expect(json).toHaveBeenCalledWith({error:'sign_in_required'});expect(mocks.execute).not.toHaveBeenCalled();});
  it('rejects an ordinary user from organization creation and official import',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'ordinary'}});
    mocks.query.mockImplementation(async(sql:string)=>[[sql.includes('basira_organizations')?{id:org}:undefined].filter(Boolean)]);
    const create=response();post('/organizations')(request({name:'Test',type:'UNIVERSITY'}),create.res);await vi.waitFor(()=>expect(create.status).toHaveBeenCalledWith(403));
    const draft=response();post('/organizations/:orgId/buildings/:buildingId/imports')(request({}),draft.res);await vi.waitFor(()=>expect(draft.status).toHaveBeenCalledWith(403));
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects an invalid import preview without writing B1 or a draft',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'admin'}});
    mocks.query.mockImplementation(async(sql:string)=>[[sql.includes('basira_navigation_roles')?{role:'admin'}:sql.includes('basira_organizations')?{id:org}:sql.includes('basira_buildings')?{id:building}:undefined].filter(Boolean)]);
    const {res,json,status}=response();post('/organizations/:orgId/buildings/:buildingId/imports')(request({format:'BASIRA_JSON',version:1,floors:[],places:[],nodes:[],edges:[]}),res);
    await vi.waitFor(()=>expect(status).toHaveBeenCalledWith(422));expect(json.mock.calls[0][0].report.valid).toBe(false);expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('revalidates a stored draft inside approval transaction and rolls back tampering',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'admin'}});
    mocks.query.mockImplementation(async(sql:string)=>[[sql.includes('basira_navigation_roles')?{role:'admin'}:sql.includes('basira_organizations')?{id:org}:undefined].filter(Boolean)]);
    mocks.connection.query.mockImplementation(async(sql:string)=>[[sql.includes('basira_official_map_imports')?{id:importId,payload:JSON.stringify({format:'BASIRA_JSON',version:1,floors:[],places:[],nodes:[],edges:[]}),payload_sha256:'bad'}:sql.includes('basira_buildings')?{id:building}:undefined].filter(Boolean)]);
    const {res,json,status}=response();post('/organizations/:orgId/buildings/:buildingId/imports/:importId/approve')(request(),res);
    await vi.waitFor(()=>expect(status).toHaveBeenCalledWith(409));expect(json).toHaveBeenCalledWith({error:'import_changed_or_invalid'});expect(mocks.connection.rollback).toHaveBeenCalled();expect(mocks.connection.execute).not.toHaveBeenCalled();
  });
  it.each([false,true])('approves a valid draft with pre-existing matching floor: %s',async(existingFloor)=>{
    const floor='44444444-4444-4444-8444-444444444444',place='55555555-5555-4555-8555-555555555555',from='66666666-6666-4666-8666-666666666666',to='77777777-7777-4777-8777-777777777777',edge='88888888-8888-4888-8888-888888888888';
    const raw={format:'BASIRA_JSON',version:1,floors:[{id:floor,floorNumber:0,name:'Ground'}],places:[{id:place,floorId:floor,name:'Room 121',roomNumber:'121',placeType:'CLASSROOM',x:5,y:0}],nodes:[{id:from,floorId:floor,x:0,y:0,nodeType:'ENTRANCE'},{id:to,floorId:floor,placeId:place,x:5,y:0,nodeType:'ROOM'}],edges:[{id:edge,fromNodeId:from,toNodeId:to,distanceMeters:5,pathType:'CORRIDOR'}]};
    const checked=new MapImportValidator().validate(raw),payload=JSON.stringify(checked.document),hash=createHash('sha256').update(payload).digest('hex');
    mocks.getSession.mockResolvedValue({user:{id:'admin'}});
    mocks.query.mockImplementation(async(sql:string)=>[[sql.includes('basira_navigation_roles')?{role:'admin'}:sql.includes('basira_organizations')?{id:org}:undefined].filter(Boolean)]);
    mocks.connection.query.mockImplementation(async(sql:string,params:any[]=[])=>{
      if(sql.includes('FROM basira_official_map_imports'))return [[{id:importId,payload,payload_sha256:hash,status:'PENDING'}]];
      if(sql.includes('FROM basira_buildings'))return [[{id:building,organization_id:org}]];
      if(sql.startsWith('SELECT id,floor_number,name FROM basira_floors'))return [existingFloor?[{id:floor,floor_number:0,name:'Ground'}]:[]];
      if(sql.startsWith('SELECT (SELECT COUNT(*) FROM basira_places'))return [[{places:0,nodes:0,edges:0}]];
      if(sql.includes('FROM basira_floors'))return [[{id:params[0]}]];
      if(sql.includes('FROM basira_places')||sql.includes('FROM basira_map_nodes')||sql.includes('FROM basira_map_edges'))return [[{id:params[0]}]];
      if(sql.includes('FROM basira_map_versions'))return [[{current_version:1}]];
      throw new Error(`unexpected ${sql}`);
    });
    mocks.connection.execute.mockResolvedValue([{affectedRows:1}]);
    const {res,json}=response();post('/organizations/:orgId/buildings/:buildingId/imports/:importId/approve')(request(),res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({status:'APPROVED',version:2,summary:checked.report.summary}));
    const writes=mocks.connection.execute.mock.calls.map(([sql])=>String(sql)).join('\n');
    for(const table of ['basira_places','basira_map_nodes','basira_map_edges','basira_map_versions','basira_map_change_log','basira_organization_map_audit_log'])expect(writes).toContain(table);
    expect(writes.includes('INSERT INTO basira_floors')).toBe(!existingFloor);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();expect(mocks.connection.rollback).not.toHaveBeenCalled();
  });
});
