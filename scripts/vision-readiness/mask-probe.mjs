/** Exact local model + native-box adapter, actual predicted boxes. Reference masks never enter inference. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const root=resolve(process.argv[2]),stage=process.argv[3]??'development',mode=process.argv[4]??'native-box',origin=process.argv[5]??'http://127.0.0.1:4350';
if(!['development','test','colour-diagnostic'].includes(stage)||!['points','native-box'].includes(mode)||!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Local bounded probe only');
if(stage!=='development'&&mode!=='native-box')throw Error('No post-final adapter comparison tuning');
const planName=stage==='colour-diagnostic'?'colour-diagnostic-plan.json':'mask-plan.json';
const raw=await readFile(resolve(root,planName)),plan=JSON.parse(raw),rows=plan.rows.filter(r=>r.split===stage),sha=b=>createHash('sha256').update(b).digest('hex');
const path=resolve(root,`masks-${stage}-${mode}.json`);
try{await readFile(path);throw Error('Preserve previous evidence');}catch(e){if(e.code!=='ENOENT')throw e;}
const allowed=new Set(['config.json','preprocessor_config.json','onnx/vision_encoder_quantized.onnx',mode==='native-box'?'onnx/prompt_encoder_mask_decoder.onnx':'onnx/prompt_encoder_mask_decoder_quantized.onnx']);
const assets=mode==='native-box'?resolve(root,'slimsam-box'):resolve('.vision-ai/object-quality/slimsam');
const assetHashes={};for(const file of allowed)assetHashes[file]=sha(await readFile(resolve(assets,file)));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),prefix='/api/vision/object-quality/assets/adapter-probe/';
 await context.route('**/*',async r=>{
  const url=new URL(r.request().url());if(url.origin!==origin)return r.abort();
  if(url.pathname.startsWith(prefix)){const file=url.pathname.slice(prefix.length);if(!allowed.has(file))return r.fulfill({status:404,body:'Unregistered optional file'});
   return r.fulfill({status:200,contentType:file.endsWith('.json')?'application/json':'application/octet-stream',body:await readFile(resolve(assets,file))});}
  return r.continue();
 });
 const page=await context.newPage();await page.goto(origin+'/navigation/vision',{waitUntil:'domcontentloaded',timeout:60000});
 const loadMs=await page.evaluate(async({mode,prefix})=>{const {SlimSamObjectMasks}=await import('/src/lib/vision/objectMasks.ts');const at=performance.now();window.__sam=await SlimSamObjectMasks.open({promptMode:mode,modelPath:prefix});return performance.now()-at;},{mode,prefix});
 const results=[];
 for(const row of rows){
  const bytes=await readFile(row.image);if(sha(bytes)!==row.sha256)throw Error('Original image changed');
  const value=await page.evaluate(async({base64,detections,id})=>{
   const {sampleColorFrame,analyzeObjectColor}=await import('/src/lib/vision/objectColors.ts');
   const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
   const c=new OffscreenCanvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);const at=performance.now(),frame=sampleColorFrame(c,at,id),ds=detections.map(d=>({...d,timestamp:at}));
   const masks=await window.__sam.segment(frame,ds);c.width=c.height=0;
   return {maskMs:performance.now()-at,width:frame.width,height:frame.height,objects:ds.map(d=>{
    const mask=masks.find(m=>m.objectId===(d.trackId??d.id));
    const before=analyzeObjectColor(frame,d,ds),after=mask?.accepted?analyzeObjectColor(frame,d,ds,mask.mask):{name:null,status:'UNCLEAR',reason:'MIXED_OR_OCCLUDED',calibrated:false};
    const rle=[];let bit=0,n=0;for(const v of mask?.data??[]){if(v===bit)n++;else{rle.push(n);n=1;bit=v;}}if(mask)rle.push(n);
    return {detection:d,before,after,mask:mask?{score:mask.score,accepted:mask.accepted,rle}:null};
   })};
  },{base64:bytes.toString('base64'),detections:row.detections,id:row.id});
  results.push({id:row.id,sha256:row.sha256,...value});console.log(JSON.stringify({image:row.id,ms:Math.round(value.maskMs),attempted:value.objects.filter(o=>o.mask).length,accepted:value.objects.filter(o=>o.mask?.accepted).length}));
  await mkdir(resolve(root,'mask-progress'),{recursive:true});await writeFile(resolve(root,'mask-progress',`${stage}-${mode}-${row.id}.json`),JSON.stringify(results.at(-1)),{flag:'wx'});
 }
 await page.evaluate(()=>window.__sam.close());
 await writeFile(path,JSON.stringify({scope:plan.scope,inputBoxesFromReference:plan.inputBoxesFromReference===true,stage,mode,cohortSha256:sha(raw),assetHashes,loadMs,results,mediaUploads:0,productMasksEnabled:false},null,2),{flag:'wx'});
}finally{await browser.close();}
