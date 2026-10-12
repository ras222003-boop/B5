import {chromium} from '@playwright/test';

const origin=process.argv[2]??'http://127.0.0.1:4174';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {MonocularMetricDepthProvider}=await import('/src/lib/vision/metricModel.ts');
    const {measureEstimatedObjects}=await import('/src/lib/vision/autoMeter.ts');
    const provider=await MonocularMetricDepthProvider.open();
    try{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const context=canvas.getContext('2d');
      if(!context)throw new Error('canvas unavailable');
      context.fillStyle='#a6a6a6';context.fillRect(0,0,640,480);
      context.fillStyle='#7d5b42';context.fillRect(210,120,220,260);
      const map=await provider.estimate(canvas,performance.now());
      const finite=Array.from(map.values).filter(Number.isFinite);
      const snapshot=measureEstimatedObjects([],map,'smoke',Date.now());
      return {source:map.source,pixels:map.values.length,finite:finite.length,
        minimum:Math.min(...finite),maximum:Math.max(...finite),center:snapshot.centerSurface};
    }finally{await provider.close();}
  },undefined,{timeoutMs:120000});
  if(result.source!=='MONOCULAR_METRIC'||result.finite<1000||!Number.isFinite(result.minimum))
    throw new Error(`Invalid browser metric inference: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
}finally{await browser.close();}
