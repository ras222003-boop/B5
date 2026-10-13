import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('.basira-evidence',{recursive:true});
const origin=process.argv[2]??'http://127.0.0.1:4186';
const photo=`data:image/png;base64,${(await readFile('scripts/metric-depth/fixtures/chair.png')).toString('base64')}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const reports=[];
try{
 for(const screenReaderMode of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],locale:'ar-SA'});
  await context.addInitScript(({photo,screenReaderMode})=>{
   localStorage.setItem('basira-auto-meter-enabled-v1','false');localStorage.setItem('basira-auto-meter-speech-v1','false');
   localStorage.setItem('basira-speech-preferences-v1',JSON.stringify({screenReaderMode}));
   window.__spoken=[];
   window.speechSynthesis.speak=utterance=>{window.__spoken.push({text:utterance.text,lang:utterance.lang});queueMicrotask(()=>{utterance.onstart?.(new Event('start'));utterance.onend?.(new Event('end'));});};
   const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async constraints=>{
    if(!constraints.video)return original(constraints);
    const image=new Image();image.src=photo;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    const draw=()=>canvas.getContext('2d').drawImage(image,0,0,640,480);draw();
    const timer=setInterval(draw,50),stream=canvas.captureStream(20);
    stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer),{once:true});return stream;
   }});
  },{photo,screenReaderMode});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/vision/describe-frame'))requests.push(request.url());});
  await page.goto(`${origin}/navigation/vision`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'تشغيل رؤية بصيرة',exact:true}).click();
  await page.getByTestId('perception-objects').getByText(/كرسي/).waitFor({timeout:60_000});
  await page.getByTestId('tracking-status').getByText(/التتبع يعمل/).waitFor({timeout:20_000});
  await page.getByRole('button',{name:'إخفاء الخريطة المرئية',exact:true}).click();
  if(await page.getByTestId('visual-radar').count())throw new Error('Radar did not hide');
  if(!(await page.getByTestId('perception-objects').innerText()).includes('كرسي'))throw new Error('Hiding radar hid accessible observations');
  await page.getByRole('button',{name:'إظهار الخريطة المرئية',exact:true}).click();
  const question=page.getByRole('textbox',{name:/سؤال/});
  await question.fill('أين الكرسي؟');await page.getByRole('button',{name:'اسأل عن الصورة',exact:true}).click();
  await page.getByText('إجابة من الملاحظات المحلية؛ لم تُرسل صورة إلى السحابة.',{exact:true}).waitFor();
  if(requests.length)throw new Error('Local question uploaded image');
  await question.fill('ما لون السيارة؟');await page.getByRole('button',{name:'اسأل عن الصورة',exact:true}).click();
  await page.getByText(/وافق.*إرسال|الموافقة.*إرسال|وافق أولًا/).first().waitFor({timeout:5000});
  if(requests.length)throw new Error('Cloud question uploaded without consent');
  await page.getByRole('button',{name:'تفاصيل جودة التحليل',exact:true}).click();
  const telemetry=await page.getByTestId('perception-telemetry').innerText();
  await page.getByRole('button',{name:'تشغيل مؤشرات الاقتراب التجريبية',exact:true}).click();
  await page.getByRole('button',{name:'إيقاف مؤشرات الاقتراب التجريبية',exact:true}).waitFor();
  await page.getByRole('button',{name:'إيقاف مؤشرات الاقتراب التجريبية',exact:true}).click();
  const accessible=await new AxeBuilder({page}).include('section[aria-label="خريطة مجال رؤية الكاميرا"]').analyze();
  const serious=accessible.violations.filter(item=>['serious','critical'].includes(item.impact));
  if(serious.length)throw new Error(`New perception panel accessibility failures: ${serious.map(item=>item.id).join(',')}`);
  const speech=await page.evaluate(()=>window.__spoken);
  if(screenReaderMode&&speech.some(item=>item.text.includes('كرسي')))throw new Error('Screen reader mode produced duplicate TTS');
  if(!screenReaderMode&&!speech.some(item=>item.text.includes('كرسي')))throw new Error('No Arabic object speech submitted');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`.basira-evidence/perception-${screenReaderMode?'screen-reader':'speech'}.png`,fullPage:true});
  await page.evaluate(()=>document.querySelector('video').pause());
  await page.getByTestId('perception-empty').waitFor({timeout:4000});
  if(await page.getByTestId('perception-objects').count())throw new Error('Paused camera retained live objects');
  await page.getByRole('button',{name:'إيقاف الرؤية',exact:true}).click();
  await page.getByRole('button',{name:'تشغيل رؤية بصيرة',exact:true}).waitFor();
  if(errors.length)throw new Error(`Page errors: ${errors.join('; ')}`);
  reports.push({screenReaderMode,telemetry,speechSubmitted:speech.filter(item=>item.text.includes('كرسي')),cloudUploads:requests.length,newPanelAxeViolations:accessible.violations.map(item=>item.id),errors});
  await context.close();
 }
 await writeFile('.basira-evidence/browser-e2e.json',JSON.stringify({scope:'Desktop Chrome with real local EfficientDet on a canvas stream of one chair photograph; speech submitted to browser stub, no phone/physical camera/auditory/SR user validation.',reports},null,2));
 console.log(JSON.stringify(reports,null,2));
}finally{await browser.close();}

