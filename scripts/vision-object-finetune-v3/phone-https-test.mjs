/** Real TLS/auth to the existing page on loopback; never a physical phone claim. */
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,X509Certificate} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {validateCertificate} from '../vision-ai/camera-lab/tls-diagnostic.mjs';
import {createPhoneBridge} from './phone-bridge.mjs';
const origin=process.argv[2]??'http://127.0.0.1:4350',root=resolve(process.argv[3]),cert=resolve(root,process.argv[5]??'phone-tls-001');
const ca=await readFile(resolve(cert,'root-ca.pem')),leaf=await readFile(resolve(cert,'server-cert.pem')),
 expected=validateCertificate({leaf,ca,host:'127.0.0.1'}),token=randomBytes(32).toString('hex'),
 agent=new https.Agent({ca,rejectUnauthorized:true});
const bridge=await createPhoneBridge({origin,certPath:resolve(cert,'server-chain.pem'),keyPath:resolve(cert,'server-key.pem'),token,durationSeconds:120});
const request=(path,headers={},method='GET')=>new Promise((done,reject)=>{
 const r=https.request(bridge.url+path,{agent,headers,method},res=>{
  const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>done({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),issuer:res.socket?.getPeerCertificate?.()?.issuer?.CN}));
 });r.on('error',reject);r.end();
});
let result={scope:'actual_existing_Basira_page_over_local_TLS_auth_not_phone',iphoneTested:false,lanListenerOpened:false,
 trustInstalled:false,firewallChanged:false,protectionChanged:false,certificateVerificationBypassed:false,mediaUploadsEnabled:false};
try{
 assert.equal((await request('/navigation/vision')).status,401);
 assert.equal((await request('/navigation/vision?phone_token=invalid')).status,401);
 const pair=await request('/navigation/vision?phone_token='+token);assert.equal(pair.status,303);
 const cookie=pair.headers['set-cookie'][0];assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const auth={cookie:cookie.split(';')[0]};
 const page=await request('/navigation/vision',auth);assert.equal(page.status,200);assert.match(page.body.toString(),/root/);
 assert.equal((await request('/api/trpc/auth.me',auth)).status,403);
 assert.equal((await request('/src/pages/Vision.tsx',auth,'POST')).status,405);
 assert.equal((await request('/navigation/vision',{...auth,origin:'https://other.invalid'})).status,403);
 const manifest=await request('/api/vision/object-quality/manifest',auth);assert.equal(manifest.status,200);
 const profiles=JSON.parse(manifest.body).profiles;assert.ok(profiles.every(p=>['objects-yolox-tiny','objects-basira-v3'].includes(p.id)));
 result={...result,status:'LOOPBACK_TLS_AUTH_PASSED',strictCertificateChainVerified:true,existingPageServed:true,secureCookieVerified:true,
  privateApiRejected:true,payloadRejected:true,crossOriginRejected:true,restrictedV2NotExposed:true,
  publicRootFingerprint:new X509Certificate(ca).fingerprint256,peerIssuer:page.issuer};
}catch(error){
 result={...result,status:'BLOCKED',code:error.code,message:error.message,localCertificateChainAndSANValid:true,expectedLeafFingerprint:expected.fingerprint256};
 const probe=await new Promise(done=>{
  const p=execFile('C:/Program Files/Git/usr/bin/openssl.exe',['s_client','-connect',new URL(bridge.url).host,'-CAfile',resolve(cert,'root-ca.pem'),'-verify_ip','127.0.0.1','-verify_return_error','-showcerts'],{windowsHide:true,timeout:10000},(e,stdout,stderr)=>done({accepted:!e,stdout,stderr}));p.stdin.end();
 });
 const pem=probe.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
 if(pem){const observed=new X509Certificate(pem[0]);result.observedIssuer=observed.issuer;result.observedLeafFingerprint=observed.fingerprint256;result.interceptionObserved=observed.fingerprint256!==expected.fingerprint256;}
 result.openSSLStrictHandshakeAccepted=probe.accepted;result.strictDiagnostic=probe.stderr.slice(0,1500);
 process.exitCode=2;
}finally{await bridge.close();agent.destroy();await writeFile(resolve(root,process.argv[4]??'phone-https-validation.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));}
