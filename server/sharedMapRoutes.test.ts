import type { Request,Response,Router } from 'express';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks=vi.hoisted(()=>({query:vi.fn(),getSession:vi.fn(),getConnection:vi.fn(),connection:{query:vi.fn(),execute:vi.fn(),beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()}}));
vi.mock('./auth',()=>({auth:{api:{getSession:mocks.getSession}},pool:{query:mocks.query,getConnection:mocks.getConnection}}));
vi.mock('better-auth/node',()=>({fromNodeHeaders:vi.fn(()=>({}))}));
import { registerSharedMapRoutes } from './sharedMap';

function handler(path:string){const post=vi.fn(),get=vi.fn();registerSharedMapRoutes({post,get} as unknown as Router);const found=post.mock.calls.find(([route])=>route===path);if(!found)throw new Error(`missing ${path}`);return found[1] as (req:Request,res:Response)=>void;}
function response(){const json=vi.fn(),status=vi.fn().mockReturnThis();return {res:{status,json,headersSent:false} as unknown as Response,json,status};}
describe('B5 role boundary',()=>{
  beforeEach(()=>{mocks.query.mockReset();mocks.getSession.mockReset();mocks.getConnection.mockReset();for(const item of Object.values(mocks.connection))item.mockReset();});
  it('rejects unauthenticated contribution submissions before any map write',async()=>{
    mocks.getSession.mockResolvedValue(null);const {res,json,status}=response();handler('/shared-map/contributions')({headers:{},body:{}} as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:'sign_in_required'}));expect(status).toHaveBeenCalledWith(401);expect(mocks.query).not.toHaveBeenCalled();
  });
  it('rejects ordinary users who try to approve or roll back a map version',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'ordinary'}});mocks.query.mockResolvedValue([[{role:null}]]);
    for(const path of ['/shared-map/contributions/:id/review','/shared-map/buildings/:id/rollback']){
      const {res,json,status}=response();handler(path)({headers:{},params:{id:'33333333-3333-4333-8333-333333333333'},body:{decision:'APPROVE',action:'CREATE',version:2}} as unknown as Request,res);
      await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:path.includes('rollback')?'admin_role_required':'mapper_role_required'}));expect(status).toHaveBeenCalledWith(403);
    }
    expect(mocks.query.mock.calls.every(([sql])=>String(sql).startsWith('SELECT role'))).toBe(true);
  });
  it('requires an admin for rollback even when the caller is a mapper',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'mapper'}});mocks.query.mockResolvedValue([[{role:'mapper'}]]);
    const {res,json,status}=response();handler('/shared-map/buildings/:id/rollback')({headers:{},params:{id:'33333333-3333-4333-8333-333333333333'},body:{version:2}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:'admin_role_required'}));expect(status).toHaveBeenCalledWith(403);
  });
  it('keeps an obvious personal SavedPlace outside public submissions',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'ordinary'}});mocks.query.mockResolvedValue([[{role:null}]]);
    const floor='22222222-2222-4222-8222-222222222222';
    const body={buildingId:'11111111-1111-4111-8111-111111111111',type:'PLACE',source:'USER_MANUAL',proposal:{name:'منزلي',roomNumber:null,aliases:[],placeType:'ROOM',floorId:floor,x:1,y:2,targetPlaceId:null,targetNodeId:null,targetEdgeId:null,geometry:null,fromNodeId:null,toNodeId:null,transitionToFloorId:null,pathType:null,distanceMeters:null,accessibilityInformation:null,visuallyImpairedFriendly:null,temporarilyClosed:null},evidence:{observedAt:Date.now(),localizationConfidence:.8,ocrConfidence:null,visualAnchorConfidence:null,sourceSessionKey:null,sourceDeviceKey:null,observedFloorId:floor,observedX:1,observedY:2,floorConsistent:true,placeConsistent:true},idempotencyKey:'33333333-3333-4333-8333-333333333333',consent:true};
    const {res,json,status}=response();handler('/shared-map/contributions')({headers:{},body} as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:'private_place_not_shareable'}));expect(status).toHaveBeenCalledWith(400);expect(mocks.getConnection).not.toHaveBeenCalled();
  });
  it('records temporary and persistent reports separately without writing to B1',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'ordinary'}});mocks.query.mockResolvedValue([[{role:null}]]);mocks.getConnection.mockResolvedValue(mocks.connection);
    mocks.connection.query.mockImplementation(async(sql:string)=>[[sql.startsWith('SELECT COUNT')?{count:0}:sql.startsWith('SELECT id FROM basira_buildings')?{id:'building'}:undefined].filter(Boolean)]);
    mocks.connection.execute.mockResolvedValue([{affectedRows:1}]);
    for(const duration of ['TEMPORARY','PERSISTENT']){
      const body={buildingId:'11111111-1111-4111-8111-111111111111',floorId:null,type:'ROAD_CLOSED',duration,description:duration==='TEMPORARY'?'كرسي يسد الممر':'جدار دائم يسد الممر',targetPlaceId:null,targetEdgeId:null,idempotencyKey:duration==='TEMPORARY'?'33333333-3333-4333-8333-333333333333':'44444444-4444-4444-8444-444444444444',consent:true};
      const {res,json,status}=response();handler('/shared-map/issues')({headers:{},body} as Request,res);
      await vi.waitFor(()=>expect(status).toHaveBeenCalledWith(201));expect(json.mock.calls[0][0].issue.duration).toBe(duration);
    }
    expect(mocks.connection.execute.mock.calls.every(([sql])=>String(sql).includes('basira_map_issue_reports'))).toBe(true);
  });
});
