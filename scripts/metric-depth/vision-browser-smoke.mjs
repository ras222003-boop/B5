import {chromium} from '@playwright/test';

const origin=process.argv[2]??'http://127.0.0.1:4174';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({permissions:['camera'],locale:'ar-SA'});
  await context.addInitScript(()=>{
    localStorage.setItem('basira-auto-meter-enabled-v1','true');
    localStorage.setItem('basira-auto-meter-speech-v1','false');
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async constraints=>{
      if(!constraints.video)return original(constraints);
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const draw=()=>{
        const ctx=canvas.getContext('2d');if(!ctx)return;
        ctx.fillStyle='#a6a6a6';ctx.fillRect(0,0,640,480);
        ctx.fillStyle='#7d5b42';ctx.fillRect(210,120,220,260);
      };
      draw();const timer=setInterval(draw,200);
      const stream=canvas.captureStream(5);
      stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer),{once:true});
      return stream;
    }});
  });
  const page=await context.newPage();
  await page.goto(`${origin}/navigation/vision`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'تشغيل رؤية بصيرة'}).click();
  await page.getByRole('button',{name:'قياس الآن ونطق النتيجة'}).waitFor({timeout:60_000});
  await page.waitForFunction(()=>{
    const video=document.querySelector('video');
    const text=document.body.innerText;
    return (video?.videoWidth??0)>=300&&!text.includes('جارٍ تحميل نموذج العمق المتري.');
  },undefined,{timeout:120_000});
  await page.getByRole('button',{name:'قياس الآن ونطق النتيجة'}).click();
  await page.waitForFunction(()=>{
    const status=document.querySelector('[data-testid="fresh-meter-result"]')?.textContent?.trim();
    return Boolean(status)&&!status?.includes('جارٍ تحميل النموذج المتري أو تحليل إطار الكاميرا');
  },undefined,{timeout:120_000});
  const result=await page.evaluate(()=>({
    videoWidth:document.querySelector('video')?.videoWidth??0,
    overlayBoxes:document.querySelectorAll('section[aria-label="معاينة الكاميرا، اختيارية"] svg rect').length,
    meterText:document.querySelector('[data-testid="fresh-meter-result"]')?.textContent?.trim()??'',
    timing:document.querySelector('[data-testid="metric-timing"]')?.textContent?.trim()??'',
  }));
  if(result.videoWidth<=0)throw new Error(`Camera did not produce a frame: ${JSON.stringify(result)}`);
  if(!result.meterText)
    throw new Error(`No meter result or diagnostic appeared: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
}finally{await browser.close();}
