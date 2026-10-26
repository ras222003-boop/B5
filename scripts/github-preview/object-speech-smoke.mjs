/** Real V3 detections on a licensed development still, software canvas stream and gesture-gated speech mock.
 * Not a hardware camera, audible voice, colour-accuracy or iPhone test. Private fixture never uploaded. */
import {chromium} from '@playwright/test';
import express from 'express';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [folder,photo,output]=process.argv.slice(2,5).map(x=>resolve(x));
const receipt=JSON.parse(await readFile(resolve(folder,'static-build-receipt.json'))),base=receipt.base;
const hosted=process.argv[5]?new URL(process.argv[5]):null;
if(hosted&&(hosted.protocol!=='https:'||hosted.hostname!=='ras222003-boop.github.io'||hosted.pathname!==base))throw Error('Independent preview only');
const app=express();app.use(base,express.static(resolve(folder,'site')));
const server=hosted?null:app.listen(4379,'127.0.0.1');
if(server)await new Promise(r=>server.once('listening',r));
const origin=hosted?hosted.origin:'http://127.0.0.1:4379',writes=[],escaped=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({locale:'ar-SA',serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.origin!==origin||!u.pathname.startsWith(base)){escaped.push(u.pathname);return route.abort();}
  if(!['GET','HEAD'].includes(r.method())){writes.push(u.pathname);return route.abort();}
  if(u.pathname===base+'__private-development-still.png')return route.fulfill({path:photo,contentType:'image/png'});
  return route.continue();
 });
 await context.addInitScript(({base})=>{
  localStorage.setItem('basira-vision-object-speech-v1','true');
  localStorage.setItem('basira-speech-preferences-v1',JSON.stringify({screenReaderMode:false}));
  window.__speechProbe={events:[],tracks:[],source:'LOCAL_DEVELOPMENT_STILL_SOFTWARE_CANVAS'};
  const probe=window.__speechProbe;let unlocked=false,epoch=0;
  class Utterance {constructor(text){this.text=text;}lang='';rate=1;voice=null;}
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:Utterance});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
   getVoices:()=>[{lang:'ar-SA',localService:true}],resume:()=>{},
   cancel:()=>{epoch++;probe.events.push({event:'cancel'});},
   speak:u=>{
    const gesture=navigator.userActivation.isActive;if(gesture)unlocked=true;
    probe.events.push({event:'requested',text:u.text,gesture,unlocked,local:u.voice?.localService===true});
    if(!unlocked)return;
    const run=epoch;setTimeout(()=>{if(run!==epoch)return;probe.events.push({event:'start',text:u.text});u.onstart?.();
     setTimeout(()=>{if(run!==epoch)return;probe.events.push({event:'end',text:u.text});u.onend?.();},80);
    },20);
   }
  }});
  const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   if(!constraints.video)return native(constraints);
   const img=new Image();img.src=base+'__private-development-still.png';await img.decode();
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=Math.round(img.height*640/img.width);
   const ctx=canvas.getContext('2d');let n=0;
   const draw=()=>{ctx.drawImage(img,0,0,canvas.width,canvas.height);ctx.fillStyle=n++%2?'#fff':'#000';ctx.fillRect(0,0,2,2);};draw();
   const stream=canvas.captureStream(6),timer=setInterval(draw,166);
   for(const track of stream.getTracks()){
    probe.tracks.push(track);const stop=track.stop.bind(track);
    track.stop=()=>{clearInterval(timer);stop();canvas.width=canvas.height=0;};
   }
   return stream;
  };
 },{base});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+base+'#/navigation/vision');
 const select=page.locator('#basira-vision-model');
 await page.waitForFunction(()=>Array.from(document.querySelector('#basira-vision-model')?.options??[]).some(o=>o.value==='objects-basira-v3'));
 await select.selectOption('objects-basira-v3');
 await page.getByRole('button',{name:'تشغيل رؤية بصيرة',exact:true}).click();
 await page.waitForFunction(()=>window.__speechProbe.events.some(e=>e.event==='start'&&e.text==='بدأ وصف الأشياء.'),null,{timeout:10000});
 await page.waitForFunction(()=>window.__speechProbe.events.some(e=>e.event==='start'&&e.text!=='بدأ وصف الأشياء.'),null,{timeout:120000});
 const count=await page.evaluate(()=>window.__speechProbe.events.filter(e=>e.event==='start'&&e.text!=='بدأ وصف الأشياء.').length);
 await page.waitForTimeout(3500);
 assert.equal(await page.evaluate(()=>window.__speechProbe.events.filter(e=>e.event==='start'&&e.text!=='بدأ وصف الأشياء.').length),count,'stable objects should not chatter');
 await page.getByRole('button',{name:'إيقاف الرؤية',exact:true}).click();
 const afterStop=await page.evaluate(()=>window.__speechProbe.events.filter(e=>e.event==='start').length);
 await page.waitForTimeout(1600);
 const probe=await page.evaluate(()=>({events:window.__speechProbe.events,allTracksEnded:window.__speechProbe.tracks.every(t=>t.readyState==='ended'),videoDetached:document.querySelector('video')?.srcObject===null,state:document.querySelector('[data-testid=vision-page]')?.getAttribute('data-state')}));
 assert.equal(probe.events.filter(e=>e.event==='start').length,afterStop);assert.equal(probe.allTracksEnded,true);assert.equal(probe.videoDetached,true);assert.equal(probe.state,'STOPPED');
 const starts=probe.events.filter(e=>e.event==='start'),objectStarts=starts.filter(e=>e.text!=='بدأ وصف الأشياء.');
 assert.ok(objectStarts.length>0);assert.ok(objectStarts.every(e=>!/(اللون غير واضح|أسود|سوداء|أحمر|حمراء|أزرق|زرقاء)/.test(e.text)));
 assert.ok(probe.events.filter(e=>e.event==='requested').every(e=>e.local));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(escaped,[]);
 await writeFile(output,JSON.stringify({status:'PASSED',sourceCommit:receipt.sourceCommit,scope:'ACTUAL_ONNX_DETECTIONS_SOFTWARE_CANVAS_GESTURE_SPEECH_MOCK_NOT_IPHONE_OR_AUDIBLE_AUDIO',objectStarts,firstRequest:probe.events.find(e=>e.event==='requested'),allTracksEnded:probe.allTracksEnded,videoDetached:probe.videoDetached,noSpeechAfterStop:true,noUnqualifiedColourSpeech:true,stableSceneNoRepeatMs:3500,privateMediaUploaded:false,networkWrites:writes,outsidePreviewRequests:escaped,pageErrors:errors},null,2)+'\n');
 console.log(JSON.stringify({status:'PASSED',objectStarts:objectStarts.length,allTracksEnded:probe.allTracksEnded}));
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
