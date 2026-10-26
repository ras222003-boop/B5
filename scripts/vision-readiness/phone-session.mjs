/** Prepare an evidence-bound local phone session; never install trust or claim a physical trial. */
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {X509Certificate} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createPhoneBridge} from '../vision-object-finetune-v3/phone-bridge.mjs';
import {validateCertificate} from '../vision-ai/camera-lab/tls-diagnostic.mjs';
import {startPublicCertificate} from './public-ca-bootstrap.mjs';
const root=resolve(process.argv[2]??'../.vision-test-fixtures/vision-readiness-001'),cert=resolve(root,'phone-tls-002'),host=process.argv[3];
if(!host)throw Error('Provide the currently assigned private IPv4 address explicitly');
if(!root.startsWith(resolve('../.vision-test-fixtures')+sep))throw Error('Keep private session files outside Git');
const ca=await readFile(resolve(cert,'root-ca.pem')),leaf=await readFile(resolve(cert,'server-cert.pem'));
const verified=validateCertificate({leaf,ca,host}),report={host,port:4361,rootCertificate:resolve(cert,'basira-local-root.cer'),
 rootFingerprint:new X509Certificate(ca).fingerprint256,leafFingerprint:verified.fingerprint256,validTo:new X509Certificate(leaf).validTo,
 certificateChainAndSANVerified:true,ownerPhoneTrustConfirmed:false,networkHandshakeVerified:false,iphoneTested:false,trustInstalled:false,firewallChanged:false,
 status:'AWAITING_OWNER_DEVICE_SETUP_AND_STRICT_TLS',navigationEligible:false};
if(!process.argv.includes('--start')){await writeFile(resolve(root,'phone-readiness.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
else{
 const index=process.argv.indexOf('--phone-ip'),phoneIp=index>=0?process.argv[index+1]:undefined;
 if(!phoneIp)throw Error('Use --phone-ip with the owner-confirmed iPhone private address');
 const started=Date.now(),events=resolve(root,'phone-events-'+started+'.private.jsonl');
 const onRead=event=>{void appendFile(events,JSON.stringify(event)+'\n');};
 const bridge=await createPhoneBridge({origin:'http://127.0.0.1:4350',host,port:4361,lan:true,
  certPath:resolve(cert,'server-chain.pem'),keyPath:resolve(cert,'server-key.pem'),durationSeconds:900,allowedClientIp:phoneIp,onRead});
 const access=resolve(root,'phone-access-'+Date.now()+'.private.json');
 await writeFile(access,JSON.stringify({pairingUrl:bridge.pairingUrl,expiresInSeconds:900}),{flag:'wx'});
 const bootstrap=await startPublicCertificate({bytes:await readFile(resolve(cert,'basira-local-root.cer')),host,onRead});
 const qr=async(payload,path)=>new Promise((done,reject)=>{
  const child=spawn(resolve('.metric-venv/Scripts/python.exe'),['scripts/vision-readiness/private-qr.py',path],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  child.stdin.end(payload);child.once('error',reject);child.once('exit',code=>code===0?done():reject(Error('Private QR generation failed')));
 });
 const pairingQr=access.replace('.json','.png'),caQr=access.replace('.private.json','.public-ca.png');
 await qr(bridge.pairingUrl,pairingQr);await qr(bootstrap.url,caQr);
 const receipt={url:bridge.url,privatePairingFile:access,privatePairingQr:pairingQr,publicCertificateUrl:bootstrap.url,publicCertificateQr:caQr,
  rootFingerprint:report.rootFingerprint,expiresInSeconds:900,expiresAtUtc:new Date(started+900000).toISOString(),privateEventsFile:events,allowedPhoneIp:phoneIp,iphoneTested:false};
 await writeFile(resolve(root,'active-phone-session.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 const stop=async()=>{await bridge.close();await bootstrap.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);setTimeout(stop,900000).unref();
}
