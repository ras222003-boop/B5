/** Validation-only small-object probe. No training, final pixels, uploads or product default changes. */
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const source=resolve('../.vision-test-fixtures/object-finetune-v3-001'),out=resolve(process.argv[2]??'../.vision-test-fixtures/vision-readiness-001'),origin=process.argv[3]??'http://127.0.0.1:4350';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Loopback only');
await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),raw=await readFile(resolve(source,'manifest.json')),manifest=JSON.parse(raw),lock=JSON.parse(await readFile(resolve(source,'cohort-lock.json')));
if(sha(raw)!==lock.manifestSha256)throw Error('Frozen cohort changed');
const rows=manifest.samples.filter(r=>r.split==='validation'),bytes=await readFile(resolve(source,'../object-quality-002/assets/yolox/yolox_tiny.onnx'));
if(sha(bytes)!=='427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7')throw Error('Original Tiny changed');
const target=resolve(out,'detector-validation-ablation.json');
try{await readFile(target);throw Error('Preserve previous run');}catch(e){if(e.code!=='ENOENT')throw e;}
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{for(const line of (await readFile(resolve(out,'detector-ablation-progress.jsonl'),'utf8')).trim().split('\n'))if(line)results.push(JSON.parse(line));}catch(e){if(e.code!=='ENOENT')throw e;}
const resumedImages=results.length,done=new Set(results.map(r=>r.id));
if(done.size!==results.length||results.some(r=>!rows.some(x=>x.id===r.id&&x.sha256===r.sha256)||!r.variants.baseline||!r.variants.tiles_065||!r.variants.tiles_080))throw Error('Progress binding changed');
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage();await page.goto(origin+'/navigation/vision',{waitUntil:'domcontentloaded',timeout:60000});
 const open=()=>page.evaluate(async base64=>{
  const {YoloXProvider}=await import('/src/lib/vision/qualityProviders.ts');
  window.__probe=await YoloXProvider.open(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),.01);
  await window.__probe.detect(new OffscreenCanvas(416,416),performance.now());
 },bytes.toString('base64'));
 await open();
 for(const row of rows){
  if(done.has(row.id))continue;
  const image=await readFile(resolve(source,row.path));if(sha(image)!==row.sha256)throw Error('Image changed');
  let result;
  for(let attempt=0;attempt<3;attempt++)try{result=await page.evaluate(async({base64,id})=>{
   const {mergeDetections}=await import('/src/lib/vision/qualityProviders.ts');
   const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
   const full=new OffscreenCanvas(image.width,image.height);full.getContext('2d').drawImage(image,0,0);
   const at=performance.now(),baseline=await window.__probe.detect(full,at),baselineMs=performance.now()-at,tiles=[];
   const started=performance.now();
   for(const [tx,ty] of [[0,0],[.4,0],[0,.4],[.4,.4]]){
    const x=Math.floor(tx*full.width),y=Math.floor(ty*full.height),w=full.width-x<.6*full.width?full.width-x:Math.ceil(.6*full.width),h=full.height-y<.6*full.height?full.height-y:Math.ceil(.6*full.height);
    const tile=new OffscreenCanvas(w,h);tile.getContext('2d').drawImage(full,x,y,w,h,0,0,w,h);
    const ds=await window.__probe.detect(tile,at);
    for(const d of ds){const b=d.boundingBox;
     // Reject a crop-edge fragment at an internal seam; never call a partial piece a whole object.
     if((x>0&&b.x<.02)||(y>0&&b.y<.02)||(x+w<full.width&&b.x+b.width>.98)||(y+h<full.height&&b.y+b.height>.98))continue;
     tiles.push({...d,id:id+'-tile-'+tiles.length,boundingBox:{x:(x+b.x*w)/full.width,y:(y+b.y*h)/full.height,width:b.width*w/full.width,height:b.height*h/full.height}});
    }
    tile.width=tile.height=0;
   }
   const variants={baseline,tiles_065:mergeDetections([...baseline,...tiles.filter(d=>d.confidence>=.65)]),tiles_080:mergeDetections([...baseline,...tiles.filter(d=>d.confidence>=.8)])};
   full.width=full.height=0;
   return {variants,baselineMs,withTilesMs:baselineMs+performance.now()-started};
  },{base64:image.toString('base64'),id:row.id});break;
  }catch(error){if(!/context was destroyed|__probe|Target.*closed|Cannot read properties of undefined/.test(error.message)||attempt===2)throw error;await page.goto(origin+'/navigation/vision',{waitUntil:'domcontentloaded',timeout:60000});await open();}
  results.push({id:row.id,sha256:row.sha256,...result});
  await appendFile(resolve(out,'detector-ablation-progress.jsonl'),JSON.stringify(results.at(-1))+'\n');
  console.log(JSON.stringify({images:results.length,total:rows.length,baselineMs:Math.round(result.baselineMs),withTilesMs:Math.round(result.withTilesMs)}));
 }
 await page.evaluate(()=>window.__probe.close());
 await writeFile(target,JSON.stringify({scope:'VALIDATION_ONLY',cohortSha256:sha(raw),modelSha256:sha(bytes),protectedFinalPixelsRead:0,trainingExecuted:false,operatingThreshold:.5,resumedImages,timingCaveat:'Development reloads and concurrent TypeScript/decoder verification affected timing; paired comparison only, not an isolated camera benchmark',variants:['baseline','tiles_065','tiles_080'],results},null,2),{flag:'wx'});
}finally{await browser.close();}
