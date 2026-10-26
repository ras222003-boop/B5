import test from 'node:test';
import assert from 'node:assert/strict';
import {permittedPath,createPhoneHandler} from './phone-bridge.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
test('phone bridge exposes existing vision/client assets, never arbitrary API or restricted models',()=>{
 const repo=fileURLToPath(new URL('../..',import.meta.url));
 const cache='/@fs/'+resolve(repo,'.vision-ai/vite-readiness-cache/deps').replaceAll('\\','/')+'/';
 assert.equal(permittedPath(cache+'@huggingface_transformers.js'),true);
 assert.equal(permittedPath(cache+'../private-model.onnx'),false);
 for(const p of ['/navigation/vision','/src/pages/Vision.tsx','/vision/onnx/ort-wasm-simd-threaded.wasm','/api/vision/object-quality/models/objects-basira-v3/assets/yolox/yolox_tiny.onnx'])assert.equal(permittedPath(p),true);
 for(const p of ['/api/trpc/auth.me','/api/vision/object-quality/models/objects-basira-v2/assets/yolox/yolox_tiny.onnx','/.env','/src/../../.env','/src/%252e%252e/.env','/@fs/C:/Users/Asus/.aws/credentials'])assert.equal(permittedPath(p),false);
});
test('authentication, secure cookie, origin and upload policy are enforced without claiming a TLS device trial',async()=>{
 const token='unit-only-not-a-real-secret-'.repeat(2),{handler}=createPhoneHandler({getPort:()=>4361,token});
 const request=async(url,{method='GET',headers={}}={})=>{
  const output={status:200,headers:{},body:''},response={setHeader:(k,v)=>output.headers[k]=v,
   writeHead:(s,h={})=>{output.status=s;Object.assign(output.headers,h);},end:b=>output.body=b??'',destroy:()=>{output.destroyed=true;}};
  await handler({url,method,headers:{host:'127.0.0.1:4361',...headers}},response);return output;
 };
 assert.equal((await request('/navigation/vision')).status,401);
 assert.equal((await request('/navigation/vision?phone_token=wrong')).status,401);
 const pair=await request('/navigation/vision?phone_token='+token);assert.equal(pair.status,303);
 assert.match(pair.headers['Set-Cookie'],/Secure; HttpOnly; SameSite=Strict/);
 assert.equal(pair.headers.Location,'/navigation/vision');
 const auth={cookie:pair.headers['Set-Cookie'].split(';')[0]};
 assert.equal((await request('/navigation/vision',{method:'POST',headers:auth})).status,405);
 assert.equal((await request('/navigation/vision',{headers:{...auth,origin:'https://other.invalid'}})).status,403);
 assert.equal((await request('/navigation/vision',{headers:{...auth,host:'evil.invalid'}})).status,403);
 assert.equal((await request('/api/trpc/auth.me',{headers:auth})).status,403);
});
test('upstream cannot point at the cloud or include embedded credentials',()=>{
 for(const origin of ['https://example.com','http://127.0.0.1:4350/private','http://:password@127.0.0.1:4350'])
  assert.throws(()=>createPhoneHandler({origin,getPort:()=>1,token:'x'.repeat(64)}));
});
