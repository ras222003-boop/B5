/** Verify TLS trust and access control on loopback; never opens the LAN listener. */
import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createCameraLab} from './server.mjs';
const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const directory=value('--cert-dir');if(!directory)throw new Error('--cert-dir required');
const folder=resolve(directory),entryPath=resolve(value('--entry')??'../.vision-test-fixtures/synthetic-stairs-v2-attempt-004/model-v2-research/entry.json');
const ca=await readFile(resolve(folder,'root-ca.pem')),token=randomBytes(32).toString('hex');
const agent=new https.Agent({ca,rejectUnauthorized:true,servername:'localhost'});
const lab=await createCameraLab({entryPath,certPath:resolve(folder,'server-chain.pem'),keyPath:resolve(folder,'server-key.pem'),accessToken:token});
const request=(path,options={})=>new Promise((done,reject)=>{const req=https.request(`${lab.url}${path}`,{agent,method:options.method??'GET',headers:options.headers??{}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),protocol:res.socket?.getProtocol?.()}));});req.on('error',error=>reject(new Error(`${path}: ${error.message}; peer issuer=${req.socket?.getPeerCertificate?.()?.issuer?.CN??'unavailable'}`)));if(options.body)req.write(options.body);req.end();});
try{
  assert.equal((await request('/model.onnx')).status,401);
  assert.equal((await request('/session',{method:'POST',headers:{authorization:'Bearer invalid'}})).status,401);
  const session=await request('/session',{method:'POST',headers:{authorization:`Bearer ${token}`}});assert.equal(session.status,200);
  const cookie=session.headers['set-cookie'][0];assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);
  const auth={cookie:cookie.split(';')[0]},contract=await request('/contract.json',{headers:auth});assert.equal(contract.status,200);
  const model=await request('/model.onnx',{headers:auth});assert.equal(model.status,200);assert.equal(createHash('sha256').update(model.body).digest('hex'),lab.contract.sha256);
  assert.equal((await request('/contract.json',{headers:{...auth,origin:'https://example.invalid'}})).status,403);
  assert.equal((await request('/session',{method:'POST',headers:{...auth,authorization:`Bearer ${token}`,'content-length':'11'},body:'unsupported'})).status,403);
  const report={scope:'trusted-local-TLS-and-auth-on-loopback',certificateChainVerified:true,hostSANVerified:true,anonymousModelRejected:true,invalidTokenRejected:true,authenticatedModelHashVerified:true,secureHttpOnlyStrictCookie:true,crossOriginRejected:true,payloadRejected:true,lanListenerOpened:false,trustInstalled:false,firewallChanged:false,iphoneTestPerformed:false};
  await writeFile(resolve(value('--output')??resolve(folder,'../https-validation.json')),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  const report={scope:'trusted-local-TLS-and-auth-on-loopback',status:'blocked',strictCertificateVerificationPassed:false,error:error.message,certificateValidationDisabled:false,lanListenerOpened:false,trustInstalled:false,firewallChanged:false,iphoneTestPerformed:false};
  await writeFile(resolve(value('--output')??resolve(folder,'../https-validation.json')),JSON.stringify(report,null,2));
  throw error;
}finally{agent.destroy();await lab.close();}
