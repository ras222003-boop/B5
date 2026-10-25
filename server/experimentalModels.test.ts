import {describe,it,expect} from 'vitest';
import express from 'express';
import {experimentalModelsHandler} from './experimentalModels';
import type {AddressInfo} from 'node:net';
async function withServer(enabled:boolean,action:(url:string)=>Promise<void>){
  const app=express();app.use(experimentalModelsHandler({enabled,root:'.vision-ai/missing-test-registry'}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try{await action(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
describe('experimental model HTTP availability is local, read only and default-disabled',()=>{
  it('does not enable experimental models by deploying the application',async()=>withServer(false,async url=>{
    expect(await(await fetch(`${url}/api/vision/experimental-models`)).json()).toEqual({enabled:false,models:[]});
  }));
  it('offers no registration, upload, arbitrary file or cross-origin API',async()=>withServer(true,async url=>{
    const base=`${url}/api/vision/experimental-models`;
    expect(await(await fetch(base)).json()).toEqual({enabled:true,models:[]});
    expect((await fetch(base,{method:'POST',body:'private media must not be accepted'})).status).toBe(405);
    for(const origin of ['https://example.invalid','invalid'])expect((await fetch(base,{headers:{origin}})).status).toBe(403);
    expect((await fetch(`${base}/test/weights.pt`)).status).toBe(404);
    expect((await fetch(`${base}/runtime/package.json`)).status).toBe(404);
    expect((await fetch(`${base}/runtime/ort-wasm-simd-threaded.mjs?import`)).status).toBe(200);
    expect((await fetch(`${base}/test/model.onnx?import`)).status).toBe(400);
  }));
});
