/** Actual Basira route + actual V3; all camera/file inputs are synthetic software tests. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
const origin=process.argv[2]??'http://127.0.0.1:4340',output=resolve(process.argv[3]??'../.vision-test-fixtures/basira-experimental-bridge-001');
const image=resolve('../.vision-test-fixtures/synthetic-stairs-v3-002/images/v3-research3b-20261025-validation-stairs-concrete-indoor-0-up-0.png');
const video=resolve('../.vision-test-fixtures/synthetic-stairs-v2-attempt-004/videos/motion-v2-train-up-concrete-0.webm');
await mkdir(output,{recursive:true});const photo=`data:image/png;base64,${(await readFile(image)).toString('base64')}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const external=[],uploads=[],pageErrors=[],consoleErrors=[];let page;
try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block',acceptDownloads:true});
  await context.route('**/*',route=>{const r=route.request();if(r.url().startsWith(`${origin}/`)){if(r.method()==='POST'&&!r.url().includes('/__manus__/logs'))uploads.push(r.url());return route.continue();}external.push(r.url());return route.abort();});
  await context.addInitScript(({photo})=>{
    localStorage.setItem('basira-auto-meter-enabled-v1','false');localStorage.setItem('basira-auto-meter-speech-v1','false');localStorage.setItem('basira-lang','ar');
    window.__spoken=[];window.__vibrations=[];window.__tracks=[];
    speechSynthesis.speak=u=>{window.__spoken.push(u.text);queueMicrotask(()=>u.onend?.(new Event('end')));};navigator.vibrate=value=>{window.__vibrations.push(value);return true;};
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if(constraints.audio)throw new Error('Microphone must never be requested');
      const image=new Image();image.src=photo;await image.decode();const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const draw=()=>canvas.getContext('2d').drawImage(image,0,0,640,480);draw();const timer=setInterval(draw,50),stream=canvas.captureStream(20);
      const tracks=stream.getTracks();window.__tracks.push(...tracks);tracks[0].addEventListener('ended',()=>clearInterval(timer),{once:true});return stream;
    };
  },{photo});
  page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});await page.goto(`${origin}/navigation/vision`,{waitUntil:'domcontentloaded'});
  const select=page.locator('#basira-vision-model');await select.waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelectorAll('#basira-vision-model option').length>=2,{},{timeout:30000});
  assert.equal(await select.inputValue(),'original');
  const modelId=await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(modelId);const panel=page.getByTestId('basira-experimental-vision');await panel.waitFor();
  assert.equal(await page.getByRole('button',{name:'تشغيل كاميرا بصيرة بالنموذج التجريبي'}).isDisabled(),true);
  await panel.getByRole('checkbox').check();await panel.locator('input[type=file]').setInputFiles(image);
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid=basira-experimental-vision]')?.getAttribute('data-processed'))>=1||document.querySelector('[data-testid=basira-experimental-vision]')?.textContent.includes('تعذر'),{},{timeout:60000});
  assert.ok(Number(await panel.getAttribute('data-processed'))>=1,await panel.innerText());
  const imageText=await page.getByTestId('experimental-result').innerText();assert.match(imageText,/درج صاعد/);
  const readyDownload=page.waitForEvent('download');await page.getByRole('button',{name:'تنزيل نتائج الاستدلال دون الوسائط'}).click();const download=await readyDownload;await download.saveAs(resolve(output,'image-results.json'));
  const imageReport=JSON.parse(await readFile(resolve(output,'image-results.json'),'utf8'));assert.equal(imageReport.modelSha256,'a16132720922738e2cc3d248b84af5c1d92c6c9d97bc757d07867b3861ef0061');assert.equal(imageReport.trainingEnrollmentPerformed,false);assert.equal(imageReport.predictionsAreGroundTruth,false);assert.equal(imageReport.records[0].classId,2301);
  await page.screenshot({path:resolve(output,'basira-image.png'),fullPage:true});
  await panel.locator('input[type=file]').setInputFiles(video);await page.waitForFunction(()=>Number(document.querySelector('[data-testid=basira-experimental-vision]')?.getAttribute('data-processed'))>=2,{},{timeout:30000});
  await page.evaluate(()=>{window.__spoken=[];window.__vibrations=[];});await page.getByRole('button',{name:'تشغيل كاميرا بصيرة بالنموذج التجريبي'}).click();
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid=basira-experimental-vision]')?.getAttribute('data-processed'))>=3,{},{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__spoken.length),0);assert.equal(await page.evaluate(()=>window.__vibrations.length),0);
  await page.screenshot({path:resolve(output,'basira-fake-camera.png'),fullPage:true});
  await page.getByRole('button',{name:'الرجوع فورًا إلى النموذج الأصلي'}).click();await page.getByRole('button',{name:'تشغيل رؤية بصيرة',exact:true}).waitFor();
  assert.equal(await select.inputValue(),'original');assert.equal(await page.evaluate(()=>window.__tracks.every(t=>t.readyState==='ended')),true);
  // Prove the original provider still starts after rollback, rather than checking only a label.
  await page.getByRole('button',{name:'تشغيل رؤية بصيرة',exact:true}).click();
  await page.waitForFunction(()=>['WORKING','ANALYZING'].includes(document.querySelector('[data-testid=basira-original-engine]')?.getAttribute('data-state')),{},{timeout:60000});
  await page.waitForTimeout(500);await page.getByRole('button',{name:'إيقاف الرؤية',exact:true}).click();
  // Model bytes modified in transit must fail closed with the original option available.
  await page.route(`${origin}/api/vision/experimental-models/${modelId}/model.onnx`,route=>route.fulfill({status:200,contentType:'application/octet-stream',body:'invalid model bytes'}));
  await select.selectOption(modelId);await page.getByTestId('basira-experimental-vision').getByRole('checkbox').check();await page.getByTestId('basira-experimental-vision').locator('input[type=file]').setInputFiles(image);
  await page.getByText(/experimental_model_hash_mismatch/).waitFor({timeout:30000});assert.equal(await page.evaluate(()=>window.__tracks.every(t=>t.readyState==='ended')),true);
  await page.getByRole('button',{name:'الرجوع فورًا إلى النموذج الأصلي'}).click();
  await page.reload();await page.locator('#basira-vision-model').waitFor();assert.equal(await page.locator('#basira-vision-model').inputValue(),'original');
  assert.deepEqual(pageErrors,[]);assert.deepEqual(uploads,[]);
  const report={scope:'actual_basira_route_with_synthetic_media_only',route:'/navigation/vision',modelSha256:imageReport.modelSha256,imageText,
    imageInference:true,videoInference:true,fakeCameraInference:true,noResearchSpeechOrHaptics:true,rollbackStopsTracks:true,originalProviderRestarted:true,
    corruptedModelRejected:true,reloadDefaultsOriginal:true,mediaUploads:uploads,externalRequestsBlocked:external,pageErrors,trainingEnrollmentPerformed:false,realAccuracyMeasured:false,iphoneTestPerformed:false};
  await writeFile(resolve(output,'browser-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page){await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.message,body:await page.locator('main').innerText(),pageErrors,consoleErrors},null,2));await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});}throw error;}finally{await browser.close();}
