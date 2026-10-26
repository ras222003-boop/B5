/** Exact local Canvas development tensors, parameterized by tested input size. */
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { developmentRows } from '../vision-object-finetune-v2/preprocess.mjs';
const root=resolve(process.argv[2]),origin=new URL(process.argv[3]??'http://127.0.0.1:4350').origin,
  size=Number(process.argv[4]??640),hash=b=>createHash('sha256').update(b).digest('hex');
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname)||![416,512,640].includes(size))throw Error('Local approved contract required');
const raw=await readFile(resolve(root,'manifest.json')),manifest=JSON.parse(raw),lock=JSON.parse(await readFile(resolve(root,'cohort-lock.json')));
if(hash(raw)!==lock.manifestSha256)throw Error('Corpus changed');
const rows=developmentRows(manifest),out=resolve(root,`preprocessed-${size}`);
await mkdir(out,{recursive:true});
const binding={manifestSha256:hash(raw),inputSize:size,detectorSourceSha256:hash(await readFile('client/src/lib/vision/qualityProviders.ts')),preprocessorSourceSha256:hash(await readFile(new URL(import.meta.url)))};
async function immutable(path,bytes){try{const old=await readFile(path);if(!old.equals(bytes))throw Error('Frozen output differs');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(path,bytes,{flag:'wx'});}}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage();await page.goto(origin+'/navigation/vision');
 const entries=[];
 for(const row of rows){
  if(!/^[a-zA-Z0-9_-]+$/.test(row.id)||!row.path.startsWith('images/'))throw Error('Unsafe manifest');
  const image=await readFile(resolve(root,row.path));if(hash(image)!==row.sha256)throw Error('Image changed');
  const rendered=await page.evaluate(async({base64,width,height,size})=>{
   const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
   if(image.naturalWidth!==width||image.naturalHeight!==height)throw Error('Reference dimensions');
   const source=new OffscreenCanvas(width,height);source.getContext('2d').drawImage(image,0,0);
   const c=new OffscreenCanvas(size,size),ctx=c.getContext('2d',{willReadFrequently:true});
   ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,size,size);
   const ratio=Math.min(size/width,size/height);ctx.drawImage(source,0,0,Math.floor(width*ratio),Math.floor(height*ratio));
   const rgba=ctx.getImageData(0,0,size,size).data;let binary='';
   for(let i=0;i<rgba.length;i+=16384)binary+=String.fromCharCode(...rgba.subarray(i,i+16384));
   return {base64:btoa(binary),ratio};
  },{base64:image.toString('base64'),width:row.width,height:row.height,size});
  const bytes=Buffer.from(rendered.base64,'base64');if(bytes.length!==size*size*4)throw Error('Tensor length');
  const path=`preprocessed-${size}/${row.id}.rgba`;await immutable(resolve(root,path),bytes);
  entries.push({id:row.id,path,sha256:hash(bytes),sourceImageSha256:row.sha256,split:row.split,ratio:rendered.ratio,...binding});
  if(entries.length%25===0)console.log(JSON.stringify({size,images:entries.length,total:rows.length}));
 }
 await immutable(resolve(out,'index.json'),Buffer.from(JSON.stringify({entries,...binding,protectedFinalPixelsRead:0,format:'RGBA8 HWC; convert BGR CHW float32 0..255'},null,2)));
 console.log(JSON.stringify({size,images:entries.length,protectedFinalPixelsRead:0}));
}finally{await browser.close();}
