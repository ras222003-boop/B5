import type { Express, Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({execute:vi.fn(),getSession:vi.fn()}));
vi.mock('./auth',()=>({auth:{api:{getSession:mocks.getSession}},pool:{execute:mocks.execute}}));
vi.mock('better-auth/node',()=>({fromNodeHeaders:vi.fn(()=>({}))}));
vi.mock('./localization',()=>({registerLocalizationRoutes:vi.fn()}));
import { registerNavigationRoutes } from './navigation';

const uuid='33333333-3333-4333-8333-333333333333';
function route(path:string){
  const use=vi.fn();registerNavigationRoutes({use} as unknown as Express);
  const router=use.mock.calls[0][1] as Router;
  const layer=(router as unknown as {stack:{route?:{path:string;stack:{handle:(req:Request,res:Response)=>void}[]}}[]}).stack.find(item=>item.route?.path===path);
  if(!layer?.route)throw new Error(`missing ${path}`);
  return layer.route.stack[0].handle;
}
function response(){const set=vi.fn().mockReturnThis(),status=vi.fn().mockReturnThis(),json=vi.fn();return {res:{set,status,json,headersSent:false} as unknown as Response,set,status,json};}
describe('B4 private destination endpoint',()=>{
  beforeEach(()=>{mocks.execute.mockReset();mocks.getSession.mockReset();});
  it('denies unauthenticated saved-place reads',async()=>{
    mocks.getSession.mockResolvedValue(null);const {res,status,json}=response();
    route('/saved-places/:id')({headers:{},params:{id:uuid}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:'sign_in_required'}));
    expect(status).toHaveBeenCalledWith(401);expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('filters by both saved ID and signed-in owner',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'owner-1'}});
    mocks.execute.mockResolvedValueOnce([[{role:null}]]).mockResolvedValueOnce([[]]);
    const {res,status,json}=response();
    route('/saved-places/:id')({headers:{},params:{id:uuid}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalledWith({error:'not_found'}));
    expect(status).toHaveBeenCalledWith(404);
    expect(String(mocks.execute.mock.calls[1][0])).toContain('s.id=? AND s.user_id=?');
    expect(mocks.execute.mock.calls[1][1]).toEqual([uuid,'owner-1']);
  });
  it('includes building verification metadata with the B1 graph',async()=>{
    mocks.execute.mockResolvedValueOnce([[{id:uuid,name:'كلية التربية',map_status:'MAPPED',verification_status:'OFFICIAL'}]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    const {res,json}=response();
    route('/buildings/:id/graph')({headers:{},params:{id:uuid}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalled());
    expect(json.mock.calls[0][0].building).toMatchObject({mapStatus:'MAPPED',verificationStatus:'OFFICIAL'});
  });
});
