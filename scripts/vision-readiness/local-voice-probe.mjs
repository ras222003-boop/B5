/** Actual local browser/OS speech API events, never a claim that a human heard intelligible speech. */
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
const root=resolve(process.argv[2]),origin='http://127.0.0.1:4350',headless=!process.argv.includes('--headful');
const browser=await chromium.launch({channel:'chrome',headless});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),blocked=[];
 await context.route('**/*',r=>{if(!r.request().url().startsWith(origin+'/')||!['GET','HEAD'].includes(r.request().method())){blocked.push(r.request().method()+' '+r.request().url());return r.abort();}return r.continue();});
 const page=await context.newPage();await page.goto(origin+'/navigation/vision',{waitUntil:'domcontentloaded'});
 const welcome=page.getByRole('dialog',{name:/بصيرة|أهلًا|مرحبا|مرحبًا/});
 if(await page.getByRole('dialog').count()){await page.getByRole('dialog').getByRole('button').click();await page.getByRole('dialog').waitFor({state:'hidden',timeout:20000});}
 await page.evaluate(async()=>{
  const {speechEngine,speechInput,saveSpeechPreferences,getSpeechPreferences}=await import('/src/lib/speechEngine.ts');
  saveSpeechPreferences({...getSpeechPreferences(),screenReaderMode:false});
  speechSynthesis.getVoices();await new Promise(r=>setTimeout(r,1500));
  window.__voiceEvidence={voices:speechSynthesis.getVoices().map(v=>({name:v.name,lang:v.lang,local:v.localService})),events:[],status:'WAITING_GESTURE'};
  const button=document.createElement('button');button.id='local-voice-probe';button.textContent='اختبار صوت عربي محلي';button.style.cssText='position:fixed;bottom:30px;left:30px;z-index:999;background:white;color:black;padding:20px';document.body.append(button);
  button.onclick=()=>{
   const start=performance.now();window.__voiceEvidence.status='RUNNING';
   const off=speechEngine.subscribe(s=>window.__voiceEvidence.events.push({atMs:performance.now()-start,...s}));
   speechEngine.enqueueLocal(speechInput('هذا اختبار صوت عربي محلي لبصيرة.','ar','ENVIRONMENT'),undefined,true).then(()=>{
    window.__voiceEvidence.status=speechEngine.status.error??'API_COMPLETED';window.__voiceEvidence.elapsedMs=performance.now()-start;off();
   });
  };
 });
 await page.locator('#local-voice-probe').click();await page.waitForFunction(()=>!['WAITING_GESTURE','RUNNING'].includes(window.__voiceEvidence.status),{},{timeout:30000});
 const evidence=await page.evaluate(()=>window.__voiceEvidence);
 const report={...evidence,headless,scope:'ACTUAL_LOCAL_SPEECH_API_EVENTS_NOT_HUMAN_LISTENING_OR_IPHONE',
  localArabicVoices:evidence.voices.filter(v=>v.local&&v.lang.toLowerCase().startsWith('ar')).length,
  audibleIntelligibilityVerified:false,microphoneUsed:false,audioSaved:false,paidSynthesisRequested:false,blockedRequests:blocked,iphoneTested:false};
 await writeFile(resolve(root,headless?'local-voice-headless.json':'local-voice-headful.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
 await page.evaluate(async()=>{const {speechEngine}=await import('/src/lib/speechEngine.ts');speechEngine.stop();});
}finally{await browser.close();}
