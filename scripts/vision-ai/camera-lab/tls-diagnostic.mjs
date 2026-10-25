/** Strict TLS only: pin the expected lab leaf in addition to CA + hostname checks. */
import tls from 'node:tls';
import {X509Certificate,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
import {execFileSync,execFile} from 'node:child_process';
import {createCameraLab} from './server.mjs';
import {isPrivateIPv4} from './network-policy.mjs';

export function validateCertificate({leaf,ca,host,now=new Date()}){
  const expected=new X509Certificate(leaf),root=new X509Certificate(ca),validFrom=new Date(expected.validFrom),validTo=new Date(expected.validTo);
  if(!root.ca||!expected.verify(root.publicKey))throw new Error('Leaf is not signed by supplied local CA');
  if(now<validFrom||now>validTo||now<new Date(root.validFrom)||now>new Date(root.validTo))throw new Error('Local certificate or root is not currently valid');
  if(!expected.checkIP(host))throw new Error('Server IP is missing from certificate SAN');
  return expected;
}
export async function diagnose({entryPath,folder,output,host='127.0.0.1',openssl}){
  if(host!=='127.0.0.1'&&(!isPrivateIPv4(host)||!Object.values(networkInterfaces()).flat().some(x=>x?.address===host)))throw new Error('Probe host must be loopback or an assigned private IP');
  const ca=await readFile(resolve(folder,'root-ca.pem')),leaf=await readFile(resolve(folder,'server-cert.pem'));
  const expected=validateCertificate({leaf,ca,host});
  const report={scope:'strict-local-certificate-and-peer-probe',certificateValid:true,expectedLeafFingerprint256:expected.fingerprint256,
    expectedRootFingerprint256:new X509Certificate(ca).fingerprint256,expectedIssuer:expected.issuer,validTo:expected.validTo,host,
    certificateVerificationDisabled:false,trustInstalled:false,firewallChanged:false,protectionChanged:false,httpOrMediaSent:false,realIphoneTestPerformed:false,
    privateLanListenerOpened:host!=='127.0.0.1'};
  if(openssl){try{report.openSSLChainVerified=execFileSync(openssl,['verify','-CAfile',resolve(folder,'root-ca.pem'),'-verify_ip',host,resolve(folder,'server-cert.pem')],{windowsHide:true,encoding:'utf8'}).includes(': OK');}catch(error){report.openSSLChainVerified=false;report.openSSLError=error.message;}}
  let lab;
  try{
    lab=await createCameraLab({entryPath,host,lan:host!=='127.0.0.1',certPath:resolve(folder,'server-chain.pem'),keyPath:resolve(folder,'server-key.pem'),accessToken:randomBytes(32).toString('hex')});
    await new Promise(done=>{
      const socket=tls.connect({host,port:lab.server.address().port,ca,rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_name,cert)=>tls.checkServerIdentity(host,cert)});
      const peer=()=>{const p=socket.getPeerCertificate();if(p?.fingerprint256){report.observedLeafFingerprint256=p.fingerprint256;report.observedIssuer=p.issuer;}};
      socket.setTimeout(8000,()=>socket.destroy(new Error('Strict TLS handshake timed out')));
      socket.once('secureConnect',()=>{peer();report.strictHandshakeAccepted=socket.authorized;
        report.expectedLeafMatched=report.observedLeafFingerprint256===expected.fingerprint256;report.status=report.expectedLeafMatched?'verified_expected_leaf':'unexpected_leaf';socket.end();});
      socket.once('error',error=>{peer();report.strictHandshakeAccepted=false;report.status='blocked';report.error=error.message;report.errorCode=error.code;});
      socket.once('close',done);
    });
    if(openssl){
      const probe=await new Promise(done=>{
        const child=execFile(openssl,['s_client','-connect',`${host}:${lab.server.address().port}`,'-CAfile',resolve(folder,'root-ca.pem'),'-verify_ip',host,'-verify_return_error','-showcerts'],{windowsHide:true,timeout:10000},(error,stdout,stderr)=>done({accepted:!error,stdout,stderr,errorCode:error?.code}));child.stdin.end();
      });
      const cert=probe.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
      report.openSSLStrictHandshakeAccepted=probe.accepted;report.openSSLHandshakeErrorCode=probe.errorCode;
      report.openSSLHandshakeDiagnostic=probe.stderr.slice(0,3000);
      if(cert){const observed=new X509Certificate(cert[0]);report.observedLeafFingerprint256=observed.fingerprint256;report.observedIssuer=observed.issuer;report.openSSLPeerMatchesExpected=observed.fingerprint256===expected.fingerprint256;}
    }
  }finally{await lab?.close();}
  report.interceptionObserved=report.observedLeafFingerprint256?report.observedLeafFingerprint256!==expected.fingerprint256:null;
  if(report.strictHandshakeAccepted!==true||report.expectedLeafMatched!==true||(openssl&&(report.openSSLStrictHandshakeAccepted!==true||report.openSSLPeerMatchesExpected!==true)))report.status='blocked';
  await writeFile(output,JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=process.argv.slice(2),v=n=>{const i=a.indexOf(n);return i<0?undefined:a[i+1];};
  if(!v('--entry')||!v('--cert-dir')||!v('--output'))throw new Error('--entry, --cert-dir and --output required');
  const report=await diagnose({entryPath:resolve(v('--entry')),folder:resolve(v('--cert-dir')),output:resolve(v('--output')),host:v('--host')??'127.0.0.1',openssl:v('--openssl')});console.log(JSON.stringify(report));
}
