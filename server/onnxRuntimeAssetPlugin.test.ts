import {afterEach, describe, expect, it} from 'vitest';
import {createServer, type ViteDevServer} from 'vite';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {vitePluginOnnxRuntimeRawAssets} from './onnxRuntimeAssetPlugin';

let instance:ViteDevServer|null=null;
const priorUser=process.env.BASIRA_PREVIEW_ACCESS_USERNAME;
const priorPass=process.env.BASIRA_PREVIEW_ACCESS_PASSWORD;

async function serverUrl():Promise<string>{
  instance=await createServer({
    root:path.resolve(import.meta.dirname,'../client'),
    configFile:false,
    plugins:[vitePluginOnnxRuntimeRawAssets()],
    server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false},
    publicDir:false,
    logLevel:'silent',
  });
  await instance.listen();
  const info=instance.httpServer?.address();
  if(!info||typeof info==='string')throw new Error('no Vite server port');
  return `http://127.0.0.1:${info.port}`;
}

afterEach(async()=>{
  await instance?.close();instance=null;
  if(priorUser===undefined)delete process.env.BASIRA_PREVIEW_ACCESS_USERNAME;
  else process.env.BASIRA_PREVIEW_ACCESS_USERNAME=priorUser;
  if(priorPass===undefined)delete process.env.BASIRA_PREVIEW_ACCESS_PASSWORD;
  else process.env.BASIRA_PREVIEW_ACCESS_PASSWORD=priorPass;
});

describe('raw ONNX Runtime module serving in Vite private preview',()=>{
  it('serves the untransformed local .mjs instead of Vite failing to import from public',async()=>{
    delete process.env.BASIRA_PREVIEW_ACCESS_USERNAME;
    delete process.env.BASIRA_PREVIEW_ACCESS_PASSWORD;
    const url=await serverUrl();
    const asset='ort-wasm-simd-threaded.jsep.mjs';
    const response=await fetch(`${url}/vision/onnx/${asset}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
    const actual=Buffer.from(await response.arrayBuffer());
    expect(actual).toEqual(readFileSync(path.resolve(import.meta.dirname,`../client/public/vision/onnx/${asset}`)));
    expect(actual.subarray(0,40).toString()).toContain('ortWasmThreaded');
    const wasm=await fetch(`${url}/vision/onnx/ort-wasm-simd-threaded.jsep.wasm`,{method:'HEAD'});
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
  });
  it('does not bypass HTTP Basic for ORT modules in the private Manus preview',async()=>{
    process.env.BASIRA_PREVIEW_ACCESS_USERNAME='basira-protected-ci';
    process.env.BASIRA_PREVIEW_ACCESS_PASSWORD='not-a-real-secret-for-test-only';
    const url=await serverUrl();
    const asset=`${url}/vision/onnx/ort-wasm-simd-threaded.jsep.mjs`;
    const unauthorized=await fetch(asset);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('www-authenticate')).toContain('Basic');
    const invalid=await fetch(asset,{headers:{Authorization:'Basic '+Buffer.from('basira-protected-ci:wrong').toString('base64')}});
    expect(invalid.status).toBe(401);
    const valid=await fetch(asset,{headers:{Authorization:'Basic '+Buffer.from('basira-protected-ci:not-a-real-secret-for-test-only').toString('base64')}});
    expect(valid.status).toBe(200);
    expect(valid.headers.get('content-type')).toContain('text/javascript');
  });
});
