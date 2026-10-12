import express, {type Express,type NextFunction,type Request,type Response} from 'express';
import {fromNodeHeaders} from 'better-auth/node';
import sharp from 'sharp';
import type {VisionCompletion} from './ocr';
import {MysqlVisionQuotaStore,VisionQuotaError,visionLimits,type VisionQuotaStore} from './visionQuota';

export type DescriptionMode='brief'|'detailed'|'read_text'|'ask';
const modes=new Set<DescriptionMode>(['brief','detailed','read_text','ask']);
const maxBytes=8*1024*1024;
const system=`You are Basira's visual description assistant for a blind Arabic speaker. Describe only what is visible in the supplied still image. Respond in clear Arabic. Identify the apparent setting only when supported by the image. Include relevant objects and relative positions, furniture, doors, windows, visible activities of people without identifying them, colors, shapes, readable signs and text, visible ground features, and relationships. If the image is blurred, dark, cropped, or ambiguous, explicitly say which details cannot be determined instead of guessing. Never infer what lies outside the frame. Never claim the path is safe, give movement commands, or infer metric distance or collision risk from the image.`;

export async function prepareDescriptionImage(value:unknown):Promise<string>{
  if(typeof value!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value))throw new DescriptionFailure('invalid_image',400);
  const encoded=value.slice(value.indexOf(',')+1);
  if(encoded.length>maxBytes*1.38)throw new DescriptionFailure('invalid_image',413);
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length<128||bytes.length>maxBytes)throw new DescriptionFailure('invalid_image',400);
  try{
    const source=sharp(bytes,{failOn:'error',limitInputPixels:16_000_000});
    const metadata=await source.metadata();
    if(!['jpeg','png','webp'].includes(metadata.format??'')||!metadata.width||!metadata.height)throw new DescriptionFailure('invalid_image',400);
    const image=await source.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
    return `data:image/jpeg;base64,${image.toString('base64')}`;
  }catch(error){if(error instanceof DescriptionFailure)throw error;throw new DescriptionFailure('invalid_image',422);}
}

export class DescriptionFailure extends Error{constructor(readonly code:'invalid_image'|'invalid_request'|'rate_limited'|'unavailable'|'timeout'|'sign_in_required'|'access_denied'|'forbidden',readonly status:number){super(code);}}

export function descriptionPrompt(mode:DescriptionMode,question=''){
  if(mode==='brief')return 'Give a concise two or three sentence overview of the most important visible details and their positions.';
  if(mode==='detailed')return 'Give a structured, detailed description of as many reliably visible details as possible. Mention uncertainty for ambiguous details.';
  if(mode==='read_text')return 'Transcribe all readable text exactly as seen, preserving its original language and reading order. Say in Arabic which parts are unclear; do not complete missing words.';
  return `Answer this question about this image only: ${question}`;
}

export type VisionRouteOptions={
  resolveUser?:(req:Request)=>Promise<string|null>;
  quotaStore?:VisionQuotaStore;
  providerAvailable?:()=>boolean;
};
async function sessionUser(req:Request):Promise<string|null>{
  const {auth}=await import('./auth');
  const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
  return session?.user?.id??null;
}
function sameOriginRequest(req:Request){
  const origin=req.get('origin'),host=req.get('host'),site=req.get('sec-fetch-site');
  if(site&&site!=='same-origin')return false;
  if(!origin)return site==='same-origin';
  if(!host)return false;
  try{const parsed=new URL(origin);return parsed.host===host&&(parsed.protocol==='https:'||parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1');}
  catch{return false;}
}

export function registerVisionDescribeRoute(app:Express,invoke:VisionCompletion,options:VisionRouteOptions={}){
  const quota=options.quotaStore??new MysqlVisionQuotaStore();
  const path='/api/vision/describe-frame';
  app.post(path,async(req:Request,res:Response,next:NextFunction)=>{
    res.set('Cache-Control','no-store');
    if(!sameOriginRequest(req))return res.status(403).json({code:'forbidden'});
    try{
      const userId=await (options.resolveUser??sessionUser)(req);
      if(!userId)return res.status(401).json({code:'sign_in_required'});
      res.locals.visionUserId=userId;
      next();
    }catch{return res.status(503).json({code:'unavailable'});}
  },express.json({limit:'12mb'}),async(req:Request,res:Response)=>{
    res.set('Cache-Control','no-store');
    try{
      if(!req.is('application/json')||req.body?.consent!==true)throw new DescriptionFailure('invalid_request',400);
      const mode=req.body?.mode;
      if(!modes.has(mode))throw new DescriptionFailure('invalid_request',400);
      const question=req.body?.question;
      if(mode==='ask'&&(typeof question!=='string'||!question.trim()||question.length>500))throw new DescriptionFailure('invalid_request',400);
      if(!(options.providerAvailable?.()??Boolean(process.env.MANUS_API_KEY||process.env.BUILT_IN_FORGE_API_KEY)))throw new DescriptionFailure('unavailable',503);
      const release=await quota.reserve(res.locals.visionUserId as string,visionLimits());
      const disconnected=new AbortController();
      const onClose=()=>{if(!res.writableEnded)disconnected.abort();};
      res.once('close',onClose);
      try{
        const image=await prepareDescriptionImage(req.body?.imageBase64);
        if(disconnected.signal.aborted||res.destroyed)return;
        const result=await invoke([
          {role:'system',content:system},
          {role:'user',content:[{type:'text',text:descriptionPrompt(mode,typeof question==='string'?question.trim():'')},{type:'image_url',image_url:{url:image,detail:'high'}}]},
        ],{model:process.env.BASIRA_VISION_DESCRIPTION_MODEL||'gemini-3.1-pro-preview',max_tokens:1200,signal:disconnected.signal});
        const content=result?.choices?.[0]?.message?.content;
        const description=(Array.isArray(content)?content.filter(part=>part?.type==='text').map(part=>part.text).join(' '):content)?.trim();
        if(typeof description!=='string'||!description)throw new DescriptionFailure('unavailable',502);
        if(disconnected.signal.aborted||res.destroyed)return;
        return res.json({description:description.slice(0,7000),mode});
      }finally{res.off('close',onClose);await release();}
    }catch(error){
      const failure=error instanceof DescriptionFailure?error:error instanceof VisionQuotaError?new DescriptionFailure(error.code,error.code==='access_denied'?403:429):
        error instanceof Error&&(/timeout|abort/i.test(error.name+' '+error.message))?new DescriptionFailure('timeout',504):new DescriptionFailure('unavailable',503);
      if(res.headersSent||res.destroyed)return;
      return res.status(failure.status).json({code:failure.code});
    }
  });
  app.use(path,(_error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    if(res.headersSent||res.destroyed)return;
    res.set('Cache-Control','no-store').status(400).json({code:'invalid_request'});
  });
}
