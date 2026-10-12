import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

// Browser integration fixture: real MediaPipe chair detection and the real
// Vision page/pipeline. Only the depth provider is replaced with a uniform,
// explicitly test-only 1.50 m map to exercise a valid same-frame UI path.
const origin=process.argv[2]??'http://127.0.0.1:4174';
const imagePath=process.argv[3]??fileURLToPath(new URL('./fixtures/chair.png',import.meta.url));
const photo=`data:image/png;base64,${(await readFile(imagePath)).toString('base64')}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({permissions:['camera'],locale:'ar-SA'});
  await context.addInitScript(({photo})=>{
    localStorage.setItem('basira-auto-meter-enabled-v1','false');
    localStorage.setItem('basira-auto-meter-speech-v1','false');
    window.__spoken=[];
    window.speechSynthesis.speak=utterance=>{
      window.__spoken.push({text:utterance.text,lang:utterance.lang});
      queueMicrotask(()=>utterance.onend?.(new Event('end')));
    };
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async constraints=>{
      if(!constraints.video)return original(constraints);
      const image=new Image();image.src=photo;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const draw=()=>canvas.getContext('2d')?.drawImage(image,0,0,640,480);
      draw();const timer=setInterval(draw,200);
      const stream=canvas.captureStream(5);
      stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer),{once:true});
      return stream;
    }});
  },{photo});
  const page=await context.newPage();
  await page.route('**/metricModel.ts*',route=>route.fulfill({status:200,contentType:'text/javascript',body:`
    export class MonocularMetricDepthProvider {
      static async open() { await new Promise(resolve => setTimeout(resolve, 3000)); return new MonocularMetricDepthProvider(); }
      async estimate(frame, timestamp) {
        window.__metricRuns=(window.__metricRuns??0)+1;
        const reject=window.__rejectMetric===true;
        if(window.__metricRuns===2){
          window.__secondMetricStarted=true;
          await new Promise(resolve=>{window.__releaseSecondMetric=resolve;});
        }else{
          // Several detector frames complete before this slower depth frame.
          await new Promise(resolve => setTimeout(resolve, 2200));
        }
        if(reject)window.__invalidMetricCompleted=(window.__invalidMetricCompleted??0)+1;
        return {width:64,height:48,values:new Float32Array(64*48).fill(reject?NaN:1.5),source:'MONOCULAR_METRIC',timestamp};
      }
      async close() {}
    }
  `}));
  await page.goto(`${origin}/navigation/vision`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'تشغيل رؤية بصيرة'}).click();
  await page.getByRole('button',{name:'تشغيل القياس التلقائي'}).click();
  const measure=page.getByRole('button',{name:'قياس الآن ونطق النتيجة'});
  await measure.waitFor({timeout:60_000});
  await page.evaluate(()=>{
    window.__meterBusySeen=false;
    window.__seenFrameIds=new Set();
    new MutationObserver(()=>{
      if(document.querySelector('button[aria-busy="true"]'))window.__meterBusySeen=true;
      document.querySelectorAll('svg[data-frame-id]').forEach(node=>window.__seenFrameIds.add(node.getAttribute('data-frame-id')));
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-busy','data-frame-id']});
  });
  await measure.click();
  await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0,undefined,{timeout:20_000});
  const pinned=page.getByTestId('pinned-metric-image');
  await pinned.waitFor({timeout:30_000}).catch(async error=>{
    const status=await page.evaluate(()=>({body:document.body.innerText.slice(0,2000),spoken:window.__spoken}));
    throw new Error(`${error.message}: ${JSON.stringify(status)}`);
  });
  const result=await page.evaluate(()=>{
    const image=document.querySelector('[data-testid="pinned-metric-image"]');
    const section=image?.closest('section');
    const overlay=section?.querySelector('svg');
    const label=overlay?.querySelector('text')?.textContent??'';
    const box=overlay?.querySelector('rect[stroke]');
    return {imageFrameId:image?.getAttribute('data-frame-id'),overlayFrameId:overlay?.getAttribute('data-frame-id'),
      stillLabel:section?.querySelector('p[role="status"]')?.textContent?.trim(),label,
      box:box?{x:box.getAttribute('x'),y:box.getAttribute('y'),width:box.getAttribute('width'),height:box.getAttribute('height')}:null,
      videoHidden:section?.querySelector('video')?.classList.contains('hidden'),
      status:document.querySelector('[data-testid="fresh-meter-result"]')?.textContent?.trim(),
      spoken:window.__spoken,busySeen:window.__meterBusySeen,seenFrameIds:[...window.__seenFrameIds]};
  });
  if(!result.imageFrameId||result.imageFrameId!==result.overlayFrameId)throw new Error(`Frame mismatch: ${JSON.stringify(result)}`);
  if(result.seenFrameIds.length<2||!result.seenFrameIds.includes(result.imageFrameId))
    throw new Error(`Detector/depth cadence was not exercised: ${JSON.stringify(result)}`);
  if(!result.label.includes('كرسي')||!result.label.includes('1.50')||!result.box||!result.videoHidden)
    throw new Error(`Object/box/metres missing on captured frame: ${JSON.stringify(result)}`);
  if(!result.stillLabel?.includes('لقطة قياس ثابتة'))throw new Error(`Still-frame disclosure missing: ${JSON.stringify(result)}`);
  if(!result.busySeen||!result.status?.includes('كرسي')||!result.status.includes('متر وخمسين')||
    !result.spoken.some(item=>item.lang.startsWith('ar')&&item.text.includes('كرسي')&&item.text.includes('متر وخمسين')))
    throw new Error(`Arabic on-demand speech missing: ${JSON.stringify(result)}`);
  const firstFrameId=result.imageFrameId;
  await page.waitForFunction(()=>window.__secondMetricStarted===true,undefined,{timeout:8000});
  await page.waitForTimeout(300);
  const retained=await pinned.getAttribute('data-frame-id');
  if(retained!==firstFrameId)throw new Error(`Measured still disappeared when the next inference started: ${JSON.stringify({firstFrameId,retained})}`);
  await page.evaluate(()=>{window.__rejectMetric=true;window.__releaseSecondMetric();});
  await page.waitForFunction(first=>{
    const next=document.querySelector('[data-testid="pinned-metric-image"]')?.getAttribute('data-frame-id');
    return Boolean(next&&next!==first);
  },firstFrameId,{timeout:8000});
  const replacement=await pinned.getAttribute('data-frame-id');
  await page.waitForFunction(()=>window.__invalidMetricCompleted>0,undefined,{timeout:12_000});
  await pinned.waitFor({state:'detached',timeout:3000});
  const rejected=await page.evaluate(()=>({videoLive:!document.querySelector('video')?.classList.contains('hidden'),
    hasOldNumber:[...document.querySelectorAll('section[aria-label="معاينة الكاميرا، اختيارية"] svg text')]
      .some(node=>node.textContent?.includes('1.50'))}));
  if(!rejected.videoLive||rejected.hasOldNumber)throw new Error(`Rejected depth left a number on live video: ${JSON.stringify(rejected)}`);
  console.log(JSON.stringify({...result,seenFrameCount:result.seenFrameIds.length,seenFrameIds:undefined,
    retainedDuringNextInference:retained,replacedBy:replacement,rejectedThenReturnedToLive:rejected.videoLive}));
}finally{await browser.close();}
