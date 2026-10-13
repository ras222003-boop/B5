import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import type {AddressInfo} from 'node:net';
import sharp from 'sharp';
import {descriptionPrompt,descriptionSystem,descriptionTokenLimit,prepareDescriptionImage,registerVisionDescribeRoute} from './visionDescribe';
import {VisionQuotaError,type VisionQuotaStore} from './visionQuota';

const image=async()=>`data:image/png;base64,${(await sharp({create:{width:320,height:240,channels:3,background:'#777777'}}).png().toBuffer()).toString('base64')}`;
const response=()=>({choices:[{message:{content:'كرسي أمامك وشخص على اليسار.'}}]});
beforeEach(()=>vi.stubEnv('BASIRA_VISION_DETAILED_MAX_TOKENS',''));
afterEach(()=>vi.unstubAllEnvs());

async function serverFor(options:{user?:string|null;quota?:VisionQuotaStore;available?:boolean}={}){
  const app=express();
  const invoke=vi.fn(async()=>response());
  const reserve=vi.fn(async()=>async()=>{});
  registerVisionDescribeRoute(app,invoke,{
    resolveUser:async()=>options.user===undefined?'user-one':options.user,
    quotaStore:options.quota??{reserve},providerAvailable:()=>options.available??true,
  });
  const server=app.listen(0);
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post=async(body:unknown,headers:Record<string,string>={})=>fetch(`${base}/api/vision/describe-frame`,{
    method:'POST',headers:{Origin:base,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...headers},
    body:typeof body==='string'?body:JSON.stringify(body),
  });
  return {server,base,post,invoke,reserve};
}

describe('single-frame description API',()=>{
  it('validates pixels and orientation while limiting the transmitted still',async()=>{
    const prepared=await prepareDescriptionImage(await image());
    expect(prepared.startsWith('data:image/jpeg;base64,')).toBe(true);
    const meta=await sharp(Buffer.from(prepared.split(',')[1],'base64')).metadata();
    expect([meta.width,meta.height]).toEqual([320,240]);
    await expect(prepareDescriptionImage('data:text/plain;base64,YWJj')).rejects.toMatchObject({code:'invalid_image'});
  });
  it('rejects cross-origin and missing-session requests before parsing their body or charging Forge',async()=>{
    const test=await serverFor({user:null});
    try{
      const cross=await test.post('not-json',{Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site'});
      expect(cross.status).toBe(403);
      const missingOrigin=await test.post('not-json',{Origin:'','Sec-Fetch-Site':''});
      expect(missingOrigin.status).toBe(403);
      const unauthenticated=await test.post('not-json');
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toEqual({code:'sign_in_required'});
      expect(test.invoke).not.toHaveBeenCalled();
      expect(test.reserve).not.toHaveBeenCalled();
    }finally{test.server.close();}
  });
  it('requires consent and passes one validated still to Forge only after account admission',async()=>{
    const test=await serverFor();
    try{
      const frame=await image();
      const denied=await test.post({imageBase64:frame,mode:'brief'});
      expect(denied.status).toBe(400);
      expect(test.reserve).not.toHaveBeenCalled();
      const result=await test.post({imageBase64:frame,mode:'detailed',consent:true});
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({description:'كرسي أمامك وشخص على اليسار.',mode:'detailed',diagnostics:{requestedModel:'gemini-3.1-pro-preview',providerModel:null,promptTokens:null,completionTokens:null}});
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(test.reserve).toHaveBeenCalledOnce();
      expect(test.reserve.mock.calls[0][0]).toBe('user-one');
      expect(test.invoke).toHaveBeenCalledTimes(1);
      expect(test.invoke.mock.calls[0][0][1].content[1].type).toBe('image_url');
      expect(test.invoke.mock.calls[0][1].model).toBeTruthy();
      expect(test.invoke.mock.calls[0][1].max_tokens).toBe(1200);
    }finally{test.server.close();}
  });
  it('accepts one explicit inspection call and bounds its output without a second model request',async()=>{
    const test=await serverFor();
    try{
      const result=await test.post({imageBase64:await image(),mode:'inspect',consent:true});
      expect(result.status).toBe(200);
      expect(test.invoke).toHaveBeenCalledTimes(1);
      expect(test.invoke.mock.calls[0][1].max_tokens).toBe(1200);
      expect(test.reserve).toHaveBeenCalledOnce();
    }finally{test.server.close();}
  });
  it('gives the comprehensive and inspection modes distinct grounded instructions and bounded token budgets',()=>{
    expect(descriptionSystem).toContain('لا تعطِ أوامر مشي');
    expect(descriptionSystem).toContain('ميّز الملاحظة المباشرة عن الاحتمال');
    expect(descriptionPrompt('detailed')).toContain('علاقاتها');
    expect(descriptionPrompt('inspect')).toContain('مقتطعة');
    expect(descriptionTokenLimit('brief')).toBeLessThan(descriptionTokenLimit('detailed'));
    expect(descriptionTokenLimit('detailed')).toBe(1200);
    vi.stubEnv('BASIRA_VISION_DETAILED_MAX_TOKENS','1800');
    expect(descriptionTokenLimit('detailed')).toBe(1800);
  });
  it('does not invoke Forge when the provider is unconfigured or an account is disabled',async()=>{
    const missing=await serverFor({available:false});
    try{expect((await missing.post({imageBase64:await image(),mode:'brief',consent:true})).status).toBe(503);expect(missing.reserve).not.toHaveBeenCalled();}
    finally{missing.server.close();}
    const quota:VisionQuotaStore={reserve:async()=>{throw new VisionQuotaError('access_denied');}};
    const disabled=await serverFor({quota});
    try{expect((await disabled.post({imageBase64:await image(),mode:'brief',consent:true})).status).toBe(403);expect(disabled.invoke).not.toHaveBeenCalled();}
    finally{disabled.server.close();}
  });
  it('enforces shared account quota across two route instances',async()=>{
    let used=0;
    const quota:VisionQuotaStore={reserve:async()=>{if(used>=1)throw new VisionQuotaError('rate_limited');used++;return async()=>{};}};
    const first=await serverFor({quota}),second=await serverFor({quota});
    try{
      const frame=await image(),body={imageBase64:frame,mode:'brief',consent:true};
      expect((await first.post(body)).status).toBe(200);
      const denied=await second.post(body);
      expect(denied.status).toBe(429);
      expect(await denied.json()).toEqual({code:'rate_limited'});
      expect(second.invoke).not.toHaveBeenCalled();
    }finally{first.server.close();second.server.close();}
  });
});
