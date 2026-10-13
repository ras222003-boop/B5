import {describe,expect,it,vi} from 'vitest';
import express from 'express';
import type {AddressInfo} from 'node:net';
import sharp from 'sharp';
import {registerVisionDescribeRoute} from './visionDescribe';

vi.mock('./auth',()=>({auth:{api:{getSession:vi.fn(async({headers}:{headers:Headers})=>
  headers.get('cookie')==='basira.session_token=valid'?{user:{id:'verified-account'}}:null)}}}));

describe('Better Auth vision session',()=>{
  it('requires a real session lookup before any quota or provider call',async()=>{
    const app=express(),reserve=vi.fn(async()=>async()=>{}),invoke=vi.fn(async()=>({choices:[{message:{content:'طاولة أمامك.'}}]}));
    registerVisionDescribeRoute(app,invoke,{quotaStore:{reserve},providerAvailable:()=>true});
    const server=app.listen(0);
    try{
      const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const image=`data:image/png;base64,${(await sharp({create:{width:160,height:160,channels:3,background:'#777'}}).png().toBuffer()).toString('base64')}`;
      const send=(cookie?:string)=>fetch(`${base}/api/vision/describe-frame`,{method:'POST',headers:{Origin:base,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({imageBase64:image,mode:'brief',consent:true})});
      expect((await send()).status).toBe(401);
      expect(reserve).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect((await send('basira.session_token=valid')).status).toBe(200);
      expect(reserve.mock.calls[0][0]).toBe('verified-account');
      expect(invoke).toHaveBeenCalledOnce();
    }finally{server.close();}
  });
});
