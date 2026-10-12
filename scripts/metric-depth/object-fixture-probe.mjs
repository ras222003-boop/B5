import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const fixture=process.argv[2]??fileURLToPath(new URL('./fixtures/chair.png',import.meta.url));
const origin=process.argv[3]??'http://127.0.0.1:4174';
const base64=(await readFile(fixture)).toString('base64');
const mime=fixture.toLowerCase().endsWith('.png')?'image/png':'image/jpeg';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async({imageBase64,mime})=>{
    const {MediaPipeVisionProvider}=await import('/src/lib/vision/providers.ts');
    const {MonocularMetricDepthProvider}=await import('/src/lib/vision/metricModel.ts');
    const {DEFAULT_VISION_CONFIG}=await import('/src/lib/vision/config.ts');
    const {measureEstimatedObjects}=await import('/src/lib/vision/autoMeter.ts');
    const image=new Image();image.src=`data:${mime};base64,${imageBase64}`;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    canvas.getContext('2d').drawImage(image,0,0,640,480);
    const detector=await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
    const metric=await MonocularMetricDepthProvider.open();
    try{
      const timestamp=performance.now();
      const detections=await detector.detect(canvas,timestamp);
      const map=await metric.estimate(canvas,timestamp);
      const snapshot=measureEstimatedObjects(detections,map,'fixture',Date.now());
      const surfaceStats=detections.map(d=>{
        const samples=[];const b=d.boundingBox;
        for(let y=0;y<5;y++)for(let x=0;x<5;x++){
          const px=Math.min(map.width-1,Math.floor((b.x+(.26+x*.12)*b.width)*map.width));
          const py=Math.min(map.height-1,Math.floor((b.y+(.26+y*.12)*b.height)*map.height));
          samples.push(map.values[py*map.width+px]);
        }
        samples.sort((a,b)=>a-b);
        return {type:d.type,p10:samples[2],median:samples[12],p90:samples[22],min:samples[0],max:samples[24]};
      });
      return {detections:detections.map(d=>({type:d.type,confidence:d.confidence,box:d.boundingBox})),
        measurements:snapshot.measurements.map(m=>({type:m.type,distanceMeters:m.distanceMeters,
          rejectionReason:m.rejectionReason,rawMeters:m.rawMeters})),surfaceStats,centerSurface:snapshot.centerSurface};
    }finally{await detector.close();await metric.close();canvas.width=canvas.height=0;}
  },{imageBase64:base64,mime});
  console.log(JSON.stringify(result));
}finally{await browser.close();}
