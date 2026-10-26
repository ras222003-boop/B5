/** Authenticated TLS bridge to the existing Basira page. No media uploads or new UI. */
import https from 'node:https';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {isPrivateIPv4} from '../vision-ai/camera-lab/network-policy.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function permittedPath(path){
 try{path=decodeURIComponent(path);}catch{return false;}
 if(path.includes('..')||path.includes('\\')||/%2e|%5c/i.test(path))return false;
 if(['/navigation/vision','/','/@vite/client','/@react-refresh','/favicon.ico'].includes(path))return true;
 if(['/src/','/assets/','/vision/','/node_modules/.vite/'].some(p=>path.startsWith(p)))return true;
 const shared='/@fs/'+resolve(repo,'shared').split(sep).join('/')+'/';
 if(path.startsWith(shared)&&path.endsWith('.ts'))return true;
 const cache='/@fs/'+resolve(repo,'.vision-ai/vite-readiness-cache/deps').split(sep).join('/')+'/';
 if(path.startsWith(cache)&&/^[a-zA-Z0-9_@.-]+\.js(?:\.map)?$/.test(path.slice(cache.length)))return true;
 return /^\/api\/vision\/object-quality\/(manifest|knowledge|(?:models\/objects-basira-v3\/)?(?:assets\/yolox\/[a-zA-Z0-9_.-]+|knowledge))$/.test(path);
}
export function createPhoneHandler({origin='http://127.0.0.1:4350',host='127.0.0.1',getPort,token,durationSeconds=900,allowedClientIp,onRead=()=>{}}={}){
 const upstream=new URL(origin);
 if(upstream.protocol!=='http:'||!['127.0.0.1','localhost'].includes(upstream.hostname)||upstream.pathname!=='/'||upstream.search||upstream.hash||upstream.username||upstream.password)throw Error('Fixed loopback source required');
 if(typeof token!=='string'||token.length<32)throw Error('Strong token required');
 const started=Date.now(),counts={authenticatedReads:0,rejectedRequests:0,mediaUploads:0};
 const handler=async(req,res)=>{
  const reject=(code,message)=>{counts.rejectedRequests++;res.writeHead(code,{'Content-Type':'text/plain'});res.end(message);};
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  try{
   const expected=`${host}:${getPort()}`,base=`https://${expected}`;
   const remote=req.socket?.remoteAddress?.replace('::ffff:','');
   if(allowedClientIp&&![allowedClientIp,'127.0.0.1',host].includes(remote))return reject(403,'Phone address rejected');
   if(req.headers.host!==expected||req.headers.origin&&req.headers.origin!==base||['cross-site','same-site'].includes(req.headers['sec-fetch-site']))return reject(403,'Origin rejected');
   if(Date.now()-started>durationSeconds*1000)return reject(410,'Phone test session expired');
   if(!['GET','HEAD'].includes(req.method)||Number(req.headers['content-length']??0)>0||req.headers['transfer-encoding'])return reject(405,'Uploads and writes disabled');
   const url=new URL(req.url,base);
   if(url.origin!==base||!permittedPath(url.pathname))return reject(403,'Resource not permitted');
   if(url.searchParams.has('phone_token')){
    if(url.pathname!=='/navigation/vision'||[...url.searchParams].length!==1||!equal(url.searchParams.get('phone_token'),token))return reject(401,'Pairing rejected');
    res.setHeader('Set-Cookie',`basira_phone_v3=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${durationSeconds}`);
    res.writeHead(303,{Location:'/navigation/vision'});res.end();return;
   }
   if(!(req.headers.cookie??'').split(';').some(c=>equal(c.trim(),`basira_phone_v3=${token}`)))return reject(401,'Pairing required');
   counts.authenticatedReads++;
   onRead({type:'AUTHENTICATED_PHONE_READ',path:url.pathname,atUtc:new Date().toISOString(),remoteAddress:remote??null,userAgent:req.headers['user-agent']?.slice(0,300)??null});
   const result=await fetch(new URL(url.pathname+url.search,upstream),{method:req.method,redirect:'error',headers:{host:upstream.host},signal:AbortSignal.timeout(30000)});
   if(url.pathname==='/api/vision/object-quality/manifest'&&result.ok){
    const data=await result.json();data.profiles=(data.profiles??[data.profile]).filter(p=>p&&['objects-yolox-tiny','objects-basira-v3'].includes(p.id));
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
   }
   res.statusCode=result.status;
   for(const header of ['content-type','cross-origin-resource-policy'])if(result.headers.has(header))res.setHeader(header,result.headers.get(header));
   if(req.method==='HEAD'){res.end();return;}
   for await(const chunk of result.body??[])res.write(chunk);res.end();
  }catch{if(!res.headersSent)reject(502,'Local source unavailable');else res.destroy();}
 };
 return {handler,counts};
}
export async function createPhoneBridge({origin='http://127.0.0.1:4350',host='127.0.0.1',port=0,lan=false,certPath,keyPath,token=randomBytes(32).toString('hex'),durationSeconds=900,allowedClientIp,onRead}={}){
 if(host!=='127.0.0.1'&&(!lan||!isPrivateIPv4(host)||!Object.values(networkInterfaces()).flat().some(i=>i?.address===host)))throw Error('Explicit assigned private LAN address required');
 if(!certPath||!keyPath||token.length<32||durationSeconds<1||durationSeconds>1800)throw Error('TLS, strong access token and bounded duration required');
 let server;
 if(allowedClientIp&&!isPrivateIPv4(allowedClientIp))throw Error('Explicit private phone address required');
 const {handler,counts}=createPhoneHandler({origin,host,getPort:()=>server.address().port,token,durationSeconds,allowedClientIp,onRead});
 server=https.createServer({cert:await readFile(certPath),key:await readFile(keyPath),minVersion:'TLSv1.2'},handler);
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,host,done);});
 const url=`https://${host}:${server.address().port}`;
 const timer=setTimeout(()=>server.close(),durationSeconds*1000);timer.unref();
 return {url,pairingUrl:url+'/navigation/vision?phone_token='+token,counts,
  close:()=>{clearTimeout(timer);server.closeAllConnections();return new Promise(done=>server.close(done));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
 const access=resolve(get('--access-file')??'../.vision-test-fixtures/object-finetune-v3-001/phone-access.private.json');
 if(!access.startsWith(resolve('../.vision-test-fixtures')+sep))throw Error('Pairing secret must remain in private local evidence');
 const bridge=await createPhoneBridge({origin:get('--origin'),host:get('--host')??'127.0.0.1',port:Number(get('--port')??4361),lan:args.includes('--lan'),certPath:get('--cert'),keyPath:get('--key')});
 await mkdir(dirname(access),{recursive:true});await writeFile(access,JSON.stringify({pairingUrl:bridge.pairingUrl,expiresInSeconds:900}),{flag:'wx'});
 console.log(JSON.stringify({url:bridge.url,privatePairingFile:access,uploadsEnabled:false,trustInstalled:false,firewallChanged:false,iphoneTested:false}));
 const stop=async()=>{await bridge.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
