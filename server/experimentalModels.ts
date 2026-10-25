import type {Express,Request,Response,NextFunction} from 'express';
import type {Plugin} from 'vite';
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {listRegistered,verifyRegistered,validModelId} from '../scripts/vision-ai/experimental-models/registry.mjs';

const prefix='/api/vision/experimental-models';
const runtime=new Set(['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']);
const loopback=(ip:string|undefined)=>ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';
function previewAuthorized(header:string|undefined){
  const user=process.env.BASIRA_PREVIEW_ACCESS_USERNAME,password=process.env.BASIRA_PREVIEW_ACCESS_PASSWORD;
  if(!user&&!password)return true;if(!user||!password||!header?.startsWith('Basic '))return false;
  const actual=Buffer.from(header.slice(6),'base64'),expected=Buffer.from(`${user}:${password}`);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export function experimentalModelsHandler({enabled=false,root=process.env.BASIRA_EXPERIMENTAL_MODELS_ROOT??resolve(process.cwd(),'.vision-ai/experimental-models')}={}){
  for(const publicPath of ['client/public','dist']){const rel=relative(resolve(process.cwd(),publicPath),resolve(root));if(!rel.startsWith('..')&&!isAbsolute(rel))throw new Error('Experimental registry must remain outside published assets');}
  return async(req:Request,res:Response,next:NextFunction)=>{
    if(!req.url?.startsWith(prefix))return next();
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    const send=(status:number,value:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    // Local models are not a public model-download API. No registration/upload endpoint exists.
    if(!enabled){send(200,{enabled:false,models:[]});return;}
    if(!loopback(req.socket.remoteAddress)){send(403,{error:'local_experimental_access_only'});return;}
    if(!previewAuthorized(req.headers.authorization)){send(401,{error:'preview_authorization_required'});return;}
    const host=req.headers.host??'';
    if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)){send(403,{error:'host_rejected'});return;}
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==host){send(403,{error:'origin_rejected'});return;}}catch{send(403,{error:'origin_rejected'});return;}
    if(!['GET','HEAD'].includes(req.method??'')){send(405,{error:'read_only_registry'});return;}
    try{
      const url=new URL(req.url,'http://localhost');
      const path=url.pathname.slice(prefix.length);
      if(url.search&&!(path.startsWith('/runtime/')&&url.search==='?import')){send(400,{error:'query_not_supported'});return;}
      if(path===''||path==='/'){send(200,{enabled:true,models:await listRegistered(root)});return;}
      if(path.startsWith('/runtime/')){
        const name=path.slice('/runtime/'.length);if(!runtime.has(name)){send(404,{error:'runtime_not_found'});return;}
        const data=await readFile(resolve(import.meta.dirname,'../node_modules/onnxruntime-web/dist',name));res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(req.method==='HEAD'?undefined:data);return;
      }
      const match=/^\/([a-z0-9-]+)\/(entry\.json|model\.onnx)$/.exec(path);
      if(!match||!validModelId(match[1])){send(404,{error:'model_not_found'});return;}
      const release=await verifyRegistered(root,match[1]);
      if(match[2]==='entry.json'){send(200,release.contract);return;}
      res.setHeader('Content-Type','application/octet-stream');res.end(req.method==='HEAD'?undefined:release.model.bytes);
    }catch{send(503,{error:'experimental_model_unavailable'});}
  };
}
export function registerExperimentalModelRoutes(app:Express){app.use(experimentalModelsHandler({enabled:process.env.BASIRA_ENABLE_EXPERIMENTAL_MODELS==='1'}));}
export function vitePluginExperimentalModels():Plugin{return{name:'basira-local-experimental-models',enforce:'pre',configureServer(server){server.middlewares.use(experimentalModelsHandler({enabled:true}) as never);}};}
