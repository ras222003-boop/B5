import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, {type Request,type Response,type Router} from 'express';
const mocks=vi.hoisted(()=>({execute:vi.fn(),getSession:vi.fn()}));
vi.mock('./auth',()=>({auth:{api:{getSession:mocks.getSession}},pool:{execute:mocks.execute}}));
vi.mock('better-auth/node',()=>({fromNodeHeaders:vi.fn(()=>({}))}));
import { registerSavedRouteRoutes } from './savedRoutes';

const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
function handler(path:string,method:'get'|'post'|'delete'){
  const router=express.Router();registerSavedRouteRoutes(router);
  const layer=(router as Router & {stack:{route?:{path:string;methods:Record<string,boolean>;stack:{handle:(req:Request,res:Response)=>void}[]}}[]}).stack.find(item=>item.route?.path===path&&item.route.methods[method]);
  if(!layer?.route)throw new Error('missing route');return layer.route.stack[0].handle;
}
const response=()=>{const set=vi.fn().mockReturnThis(),status=vi.fn().mockReturnThis(),json=vi.fn(),end=vi.fn();return {res:{set,status,json,end,headersSent:false} as unknown as Response,set,status,json,end};};
describe('private saved-route API',()=>{
  beforeEach(()=>{mocks.execute.mockReset();mocks.getSession.mockReset();});
  it('requires an authenticated owner before listing route templates',async()=>{
    mocks.getSession.mockResolvedValue(null);const result=response();handler('/saved-routes','get')({headers:{}} as Request,result.res);
    await vi.waitFor(()=>expect(result.status).toHaveBeenCalledWith(401));expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('reads and deletes only the signed-in user’s routes',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'owner-a'}});mocks.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{affectedRows:0}]);
    const list=response();handler('/saved-routes','get')({headers:{}} as Request,list.res);
    await vi.waitFor(()=>expect(list.json).toHaveBeenCalledWith({savedRoutes:[]}));
    expect(mocks.execute.mock.calls[0][1]).toEqual(['owner-a']);
    const deletion=response();handler('/saved-routes/:id','delete')({headers:{},params:{id:ids[3]}} as unknown as Request,deletion.res);
    await vi.waitFor(()=>expect(deletion.status).toHaveBeenCalledWith(404));
    expect(mocks.execute.mock.calls[1][1]).toEqual([ids[3],'owner-a']);
  });
  it('rejects raw traces and disconnected graph templates',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'owner-a'}});
    const body={name:'Test journey',buildingId:ids[0],nodeIds:[ids[1],ids[2]],edgeIds:[ids[3]],rawTrack:[{latitude:1,longitude:1}]};
    const invalid=response();handler('/saved-routes','post')({headers:{},body} as Request,invalid.res);
    await vi.waitFor(()=>expect(invalid.status).toHaveBeenCalledWith(400));expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockResolvedValueOnce([[{id:ids[0],map_status:'MAPPED'}]]).mockResolvedValueOnce([[{id:ids[1],floor_id:'f',place_id:null,x:0,y:0},{id:ids[2],floor_id:'f',place_id:null,x:5,y:0}]]).mockResolvedValueOnce([[{id:ids[3],from_node_id:ids[1],to_node_id:'foreign',temporarily_closed:0,risk_level:'LOW',path_type:'CORRIDOR'}]]);
    const disconnected=response();handler('/saved-routes','post')({headers:{},body:{name:body.name,buildingId:body.buildingId,nodeIds:body.nodeIds,edgeIds:body.edgeIds}} as Request,disconnected.res);
    await vi.waitFor(()=>expect(disconnected.json).toHaveBeenCalledWith({error:'invalid_or_closed_route'}));
    expect(mocks.execute.mock.calls.some(([sql])=>String(sql).startsWith('INSERT INTO basira_saved_routes'))).toBe(false);
  });
});
