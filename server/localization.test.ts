import type { Request, Response, Router } from 'express';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks=vi.hoisted(()=>({execute:vi.fn(),getSession:vi.fn()}));
vi.mock('./auth',()=>({auth:{api:{getSession:mocks.getSession}},pool:{execute:mocks.execute}}));
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
  beforeEach(()=>{mocks.execute.mockReset();mocks.getSession.mockReset();});
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
});
