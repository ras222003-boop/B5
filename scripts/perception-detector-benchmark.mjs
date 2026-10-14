import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const variant=process.argv[2]??'before';
await mkdir('.basira-evidence',{recursive:true});
if(variant==='before')await writeFile('.basira-evidence/baseline-provider.ts',execFileSync('git',['show','c52b755:client/src/lib/vision/providers.ts'],{encoding:'utf8'}).replace("from './safety'","from '@/lib/vision/safety'"));
const origin='http://127.0.0.1:4186';
const source=variant==='before'?'/@fs/'+process.cwd().replaceAll('\\','/')+'/.basira-evidence/baseline-provider.ts':'/src/lib/vision/providers.ts';
const photo='data:image/png;base64,'+(await readFile('scripts/metric-depth/fixtures/chair.png')).toString('base64');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(origin,{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async({source,photo,variant})=>{
   const {MediaPipeVisionProvider}=await import(source);
   const {DEFAULT_VISION_CONFIG}=await import('/src/lib/vision/config.ts');
   const image=new Image();image.src=photo;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d').drawImage(image,0,0,640,480);
   const start=performance.now();const opened=variant==='worker'?await (await import('/src/lib/vision/workerObjectProvider.ts')).openObjectProvider(DEFAULT_VISION_CONFIG):{provider:await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG),execution:'MAIN_THREAD'};
   const {provider,execution}=opened;const loadMs=performance.now()-start;
   const times=[],timerGaps=[];let detections=[],lastPulse=performance.now();
   const timer=setInterval(()=>{const now=performance.now();timerGaps.push(now-lastPulse);lastPulse=now;},10);
   for(let i=0;i<25;i++){
     await new Promise(resolve=>setTimeout(resolve,25));
     if(i===5){timerGaps.length=0;lastPulse=performance.now();}
     const before=performance.now();detections=await provider.detect(canvas,before);const ms=performance.now()-before;if(i>=5)times.push(ms);
   }
   await new Promise(resolve=>setTimeout(resolve,25));clearInterval(timer);
   await provider.close();times.sort((a,b)=>a-b);
   return {scope:'Desktop Chrome, one existing chair still repeated; 5 warmup + 20 timed iterations, 25ms yielding between calls, 10ms UI timer probe. Not accuracy, camera, motion, or mobile validation.',execution,userAgent:navigator.userAgent,loadMs,medianMs:times[9],p95Ms:times[18],samples:times.length,maxMainThreadTimerGapMs:Math.max(...timerGaps),detections:detections.map(({type,confidence,boundingBox})=>({type,confidence,boundingBox})),accuracy:null,mobile:null};
 },{source,photo,variant});
 await writeFile(`.basira-evidence/detector-${variant}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
