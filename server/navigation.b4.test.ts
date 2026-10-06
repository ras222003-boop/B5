import type { Express, Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({execute:vi.fn(),getSession:vi.fn()}));
vi.mock('./auth',()=>({auth:{api:{getSession:mocks.getSession}},pool:{execute:mocks.execute}}));
vi.mock('better-auth/node',()=>({fromNodeHeaders:vi.fn(()=>({}))}));
vi.mock('./localization',()=>({registerLocalizationRoutes:vi.fn()}));
import { registerNavigationRoutes } from './navigation';

const uuid='33333333-3333-4333-8333-333333333333';
function route(path:string,method:'get'|'patch'|'delete'='get'){
  const use=vi.fn();registerNavigationRoutes({use} as unknown as Express);
  const router=use.mock.calls[0][1] as Router;
  const layer=(router as unknown as {stack:{route?:{path:string;methods:Record<string,boolean>;stack:{handle:(req:Request,res:Response)=>void}[]}}[]}).stack.find(item=>item.route?.path===path&&item.route.methods[method]);
  if(!layer?.route)throw new Error(`missing ${path}`);
  return layer.route.stack[0].handle;
}
function response(){const set=vi.fn().mockReturnThis(),status=vi.fn().mockReturnThis(),json=vi.fn(),end=vi.fn();return {res:{set,status,json,end,headersSent:false} as unknown as Response,set,status,json,end};}
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
  it('prevents user B from reading, editing or deleting user A’s private saved place',async()=>{
    mocks.getSession.mockResolvedValue({user:{id:'user-b'}});
    mocks.execute.mockImplementation(async(sql:string,params:any[]=[])=>{
      if(sql.startsWith('SELECT role'))return [[]];
      if(sql.includes('FROM basira_saved_places')&&sql.startsWith('SELECT'))return [params[1]==='user-a'?[{id:uuid,user_id:'user-a',name:'Private'}]:[]];
      if(sql.startsWith('DELETE FROM basira_saved_places'))return [{affectedRows:params[1]==='user-a'?1:0}];
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const read=response();route('/saved-places/:id')({headers:{},params:{id:uuid}} as unknown as Request,read.res);
    await vi.waitFor(()=>expect(read.status).toHaveBeenCalledWith(404));
    const edit=response();route('/saved-places/:id','patch')({headers:{},params:{id:uuid},body:{name:'Stolen'}} as unknown as Request,edit.res);
    await vi.waitFor(()=>expect(edit.status).toHaveBeenCalledWith(404));
    const deletion=response();
    route('/saved-places/:id','delete')({headers:{},params:{id:uuid}} as unknown as Request,deletion.res);
    await vi.waitFor(()=>expect(deletion.status).toHaveBeenCalledWith(404));
    expect(mocks.execute.mock.calls.filter(([sql])=>String(sql).includes('basira_saved_places')).every(([,params])=>params.includes('user-b'))).toBe(true);
  });
  it('includes building verification metadata with the B1 graph',async()=>{
    mocks.execute.mockResolvedValueOnce([[{id:uuid,name:'كلية التربية',map_status:'MAPPED',verification_status:'OFFICIAL'}]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    const {res,json}=response();
    route('/buildings/:id/graph')({headers:{},params:{id:uuid}} as unknown as Request,res);
    await vi.waitFor(()=>expect(json).toHaveBeenCalled());
    expect(json.mock.calls[0][0].building).toMatchObject({mapStatus:'MAPPED',verificationStatus:'OFFICIAL'});
    expect(json.mock.calls[0][0].zones).toEqual([]);
  });
});
