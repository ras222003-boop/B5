/** Same decoded frame/model, main versus worker timing; no freshness-limit relaxation. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
const root=resolve(process.argv[2]),origin='http://127.0.0.1:4350',bytes=await readFile('../.vision-test-fixtures/object-colors-development-001/images/de8a8b01519aea3d.png');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage();await page.goto(origin+'/navigation/vision',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async base64=>{
  const {ObjectQualityProvider}=await import('/src/lib/vision/objectQuality.ts'),{openObjectProvider}=await import('/src/lib/vision/workerObjectProvider.ts'),{DEFAULT_VISION_CONFIG}=await import('/src/lib/vision/config.ts');
  const {sampleColorFrame,analyzeObjectColor}=await import('/src/lib/vision/objectColors.ts');
  const manifest=await fetch('/api/vision/object-quality/manifest').then(r=>r.json()),profile=manifest.profiles.find(p=>p.id==='objects-basira-v3');
  const im=new Image();im.src='data:image/png;base64,'+base64;await im.decode();const scale=Math.min(640/im.width,480/im.height),frame=document.createElement('canvas');frame.width=Math.round(im.width*scale);frame.height=Math.round(im.height*scale);frame.getContext('2d').drawImage(im,0,0,frame.width,frame.height);
  const result=[];
  for(const mode of ['MAIN_THREAD','WORKER']){
   const provider=mode==='MAIN_THREAD'?await ObjectQualityProvider.open(profile): (await openObjectProvider(DEFAULT_VISION_CONFIG,undefined,profile)).provider;
   const runs=[];
   for(let i=0;i<4;i++){
    const at=performance.now(),ds=await provider.detect(frame,at),detectorMs=performance.now()-at,c=performance.now(),pixels=sampleColorFrame(frame,at,'probe');
    const colours=ds.map(d=>analyzeObjectColor(pixels,d,ds));runs.push({detectorMs,colourMs:performance.now()-c,objects:ds.length,colours:colours.map(c=>c.name)});
   }
   await provider.close();result.push({mode,runs});
  }
  return {modelId:profile.id,modelSha256:profile.modelSha256,frame:{width:frame.width,height:frame.height},result,phoneTested:false};
 },bytes.toString('base64'));
 await writeFile(resolve(root,'execution-probe.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}finally{await browser.close();}
