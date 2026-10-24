import http from 'node:http';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {normalizeEntry} from './adapter.mjs';
import {isPrivateIPv4} from './network-policy.mjs';

const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../../..');
const check=(value,message)=>{if(!value)throw new Error(message);};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function createCameraLab({entryPath,host='127.0.0.1',port=0,lan=false,certPath,keyPath,accessToken}={}) {
  check(entryPath,'--entry path is required');
  const loopback=host==='127.0.0.1';
  if(!loopback){
    check(lan&&isPrivateIPv4(host),'Non-loopback requires an explicit private IPv4 --host and --lan');
    check(Object.values(networkInterfaces()).flat().some(item=>item?.address===host),'LAN host must be assigned to this computer');
    check(certPath&&keyPath&&typeof accessToken==='string'&&accessToken.length>=32,'LAN requires TLS certificate/key and an access token of at least 32 characters');
  }
  check(Boolean(certPath)===Boolean(keyPath),'Both certificate and key are required');
  const entry=JSON.parse(await readFile(resolve(entryPath),'utf8')),contract=normalizeEntry(entry);
  const modelPath=resolve(dirname(resolve(entryPath)),entry.model),model=await readFile(modelPath);
  check(createHash('sha256').update(model).digest('hex')===contract.sha256,'Model does not match entry SHA-256');
  const secure=Boolean(certPath),requireAuth=!loopback||Boolean(accessToken),session=randomBytes(32).toString('hex'),attempts=new Map();
  if(requireAuth)check(typeof accessToken==='string'&&accessToken.length>=32,'Access token must have at least 32 characters');
  const assets=new Map([['/','index.html'],['/app.mjs','app.mjs'],['/adapter.mjs','adapter.mjs'],['/styles.css','styles.css']]);
  const runtime=new Set(['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']);
  let server;
  const handler=async(req,res)=>{
    const send=(status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(req.method==='HEAD'?undefined:body);};
    try {
      const origin=`${secure?'https':'http'}://${host}:${server.address().port}`;
      check(req.headers.host===`${host}:${server.address().port}`,'Host rejected');
      check(!req.headers.origin||req.headers.origin===origin,'Cross-origin request rejected');
      const url=new URL(req.url??'/',origin);
      check(url.origin===origin&&!url.search,'Request URL rejected');
      check(!['cross-site','same-site'].includes(req.headers['sec-fetch-site']),'Cross-site request rejected');
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
      res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=(), speaker-selection=()');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      if(req.method==='POST'&&url.pathname==='/session') {
        check(Number(req.headers['content-length']??0)===0&&!req.headers['transfer-encoding'],'No request payloads are accepted');
        const key=req.socket.remoteAddress,now=Date.now(),record=attempts.get(key)??{count:0,at:now};
        if(now-record.at>60000){record.count=0;record.at=now;}record.count++;attempts.set(key,record);
        if(record.count>10){send(429,'Too many attempts');return;}
        if(requireAuth&&!equal(req.headers.authorization,`Bearer ${accessToken}`)){send(401,'Access token rejected');return;}
        res.setHeader('Set-Cookie',`basira-camera-lab=${session}; HttpOnly; SameSite=Strict; Path=/${secure?'; Secure':''}`);
        send(200,JSON.stringify({ok:true}),'application/json');return;
      }
      if(!['GET','HEAD'].includes(req.method)){send(405,'Uploads and writes are disabled');return;}
      if(assets.has(url.pathname)){const path=assets.get(url.pathname);send(200,await readFile(resolve(here,path)),path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');return;}
      const authenticated=!requireAuth||(req.headers.cookie??'').split(';').some(value=>equal(value.trim(),`basira-camera-lab=${session}`));
      if(!authenticated){send(401,'Local lab access token required');return;}
      if(url.pathname==='/contract.json'){send(200,JSON.stringify({...contract,modelUrl:'/model.onnx',requiresAccessToken:requireAuth}),'application/json');return;}
      if(url.pathname==='/model.onnx'){send(200,model,'application/octet-stream');return;}
      if(url.pathname.startsWith('/ort/')){const name=url.pathname.slice(5);if(runtime.has(name)){send(200,await readFile(resolve(repo,'node_modules/onnxruntime-web/dist',name)),name.endsWith('.wasm')?'application/wasm':'text/javascript');return;}}
      send(404,'Unknown lab resource');
    } catch(error){send(403,error.message);}
  };
  server=secure?https.createServer({cert:await readFile(certPath),key:await readFile(keyPath),minVersion:'TLSv1.2'},handler):http.createServer(handler);
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,host,done);});
  return{server,url:`${secure?'https':'http'}://${host}:${server.address().port}`,contract,
    close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
  const known=new Set(['--entry','--host','--port','--lan','--cert','--key','--token-env']);
  for(let i=0;i<args.length;i++){check(known.has(args[i]),`Unknown option: ${args[i]}`);if(args[i]!=='--lan')i++;}
  const lab=await createCameraLab({entryPath:value('--entry'),host:value('--host')??'127.0.0.1',port:Number(value('--port')??4329),lan:args.includes('--lan'),certPath:value('--cert'),keyPath:value('--key'),accessToken:process.env[value('--token-env')??'BASIRA_LAB_ACCESS_TOKEN']});
  console.log(JSON.stringify({url:lab.url,model:lab.contract.name,scope:'local-research-camera-lab',confidenceCalibrated:lab.contract.confidenceCalibrated}));
  const stop=async()=>{await lab.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
