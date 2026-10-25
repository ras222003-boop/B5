import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {createCameraLab} from './server.mjs';
import {isPrivateIPv4,certificateOutputAllowed} from './network-policy.mjs';

test('loopback lab serves only allowlisted local assets and refuses uploads/cross-origin access',async()=>{
  const folder=await mkdtemp(resolve('scripts/vision-ai/camera-lab/test-fixture-'));
  const bytes=Buffer.from('not an inference fixture; HTTP transport test only');
  const entry={researchOnly:true,productionEnabled:false,model:'model.onnx',sha256:createHash('sha256').update(bytes).digest('hex'),input:{name:'image',shape:[1,3,128,128],range:[0,1],color:'RGB'},outputs:['class_logits','box_xywh'],classIds:[null,2301,2302,2303,2304]};
  let lab;
  try{
    await writeFile(resolve(folder,'model.onnx'),bytes);await writeFile(resolve(folder,'entry.json'),JSON.stringify(entry));
    lab=await createCameraLab({entryPath:resolve(folder,'entry.json')});
    const home=await fetch(lab.url);assert.equal(home.status,200);assert.match(await home.text(),/مختبر كاميرا السلالم/);
    assert.match(home.headers.get('content-security-policy'),/connect-src 'self'/);assert.match(home.headers.get('permissions-policy'),/microphone=\(\)/);
    assert.equal((await fetch(`${lab.url}/contract.json`)).status,200);
    assert.equal((await fetch(`${lab.url}/model.onnx`)).status,200);
    assert.equal((await fetch(`${lab.url}/api/upload`,{method:'POST',body:'private frame'})).status,405);
    assert.equal((await fetch(`${lab.url}/contract.json`,{headers:{origin:'https://example.invalid'}})).status,403);
    const forgedHost=await new Promise((done,reject)=>{const request=http.get(`${lab.url}/contract.json`,{headers:{host:'attacker.invalid'}},response=>{response.resume();done(response.statusCode);});request.on('error',reject);});
    assert.equal(forgedHost,403);
    assert.equal((await fetch(`${lab.url}/entry.json`)).status,404);
    assert.equal((await fetch(`${lab.url}/ort/../../package.json`)).status,404);
    const contract=await (await fetch(`${lab.url}/contract.json`)).json();assert.equal(JSON.stringify(contract).includes(folder),false);
    await lab.close();lab=await createCameraLab({entryPath:resolve(folder,'entry.json'),accessToken:'t'.repeat(32)});
    assert.equal((await fetch(`${lab.url}/model.onnx`)).status,401);
    assert.equal((await fetch(`${lab.url}/session`,{method:'POST',headers:{authorization:'Bearer wrong'}})).status,401);
    const login=await fetch(`${lab.url}/session`,{method:'POST',headers:{authorization:`Bearer ${'t'.repeat(32)}`}});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    assert.equal((await fetch(`${lab.url}/model.onnx`,{headers:{cookie:cookie.split(';')[0]}})).status,200);
  }finally{if(lab)await lab.close();await rm(folder,{recursive:true,force:true});}
});
test('LAN exposure requires explicit private assigned host, TLS and token',async()=>{
  await assert.rejects(()=>createCameraLab({entryPath:'unused',host:'0.0.0.0',lan:true}),/private IPv4/);
  await assert.rejects(()=>createCameraLab({entryPath:'unused',host:'8.8.8.8',lan:true}),/private IPv4/);
});

test('access token gates model data and session endpoint accepts no payload',async()=>{
  const folder=await mkdtemp(resolve('scripts/vision-ai/camera-lab/test-fixture-'));
  const bytes=Buffer.from('transport-only fixture'),token='a'.repeat(64);
  const entry={researchOnly:true,productionEnabled:false,model:'model.onnx',sha256:createHash('sha256').update(bytes).digest('hex'),input:{name:'image',shape:[1,3,128,128],range:[0,1],color:'RGB'},outputs:['class_logits','box_xywh'],classIds:[null,2301,2302,2303,2304]};
  let lab;
  try{
    await writeFile(resolve(folder,'model.onnx'),bytes);await writeFile(resolve(folder,'entry.json'),JSON.stringify(entry));
    lab=await createCameraLab({entryPath:resolve(folder,'entry.json'),accessToken:token});
    assert.equal((await fetch(`${lab.url}/model.onnx`)).status,401);
    assert.equal((await fetch(`${lab.url}/session`,{method:'POST',headers:{authorization:'Bearer invalid'}})).status,401);
    const session=await fetch(`${lab.url}/session`,{method:'POST',headers:{authorization:`Bearer ${token}`}});
    assert.equal(session.status,200);const cookie=session.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    assert.equal((await fetch(`${lab.url}/model.onnx`,{headers:{cookie:cookie.split(';')[0]}})).status,200);
    assert.equal((await fetch(`${lab.url}/session`,{method:'POST',headers:{authorization:`Bearer ${token}`},body:'media is forbidden'})).status,403);
  }finally{if(lab)await lab.close();await rm(folder,{recursive:true,force:true});}
});
test('private IPv4 policy rejects malformed octets and public addresses',()=>{
  for(const host of ['192.168.1.5','10.2.3.4','172.16.0.2','172.31.255.1'])assert.equal(isPrivateIPv4(host),true);
  for(const host of ['192.168.999.1','10.1.2','10.1.2.3.4','192.168.1.5\nsubjectAltName=bad','172.32.0.1','127.0.0.1','8.8.8.8','example.test','::1'])assert.equal(isPrivateIPv4(host),false);
});
test('certificate keys cannot be created in Git or protected dataset paths',()=>{
  const repo=resolve('.');
  assert.equal(certificateOutputAllowed(repo,repo),false);
  assert.equal(certificateOutputAllowed(resolve(repo,'scripts/local-keys'),repo),false);
  assert.equal(certificateOutputAllowed(resolve(repo,'../.git/keys'),repo),false);
  assert.equal(certificateOutputAllowed(resolve(repo,'../Basira-Vision-Datasets/keys'),repo),false);
  assert.equal(certificateOutputAllowed(resolve(repo,'../.vision-test-fixtures/new-private-tls'),repo),true);
});
