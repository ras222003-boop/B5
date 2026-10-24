/** Actual local ORT Web inference tests, using synthetic files and a fake webcam only. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {createCameraLab} from './server.mjs';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const root=resolve('..','.vision-test-fixtures','synthetic-stairs-v2-attempt-004');
const entryPath=resolve(value('--entry')??resolve(root,'model-v2-research/entry.json'));
const imagePath=resolve(value('--image')??resolve(root,'images/v2-validation-down-concrete-0-000.png'));
const videoPath=resolve(value('--video')??resolve(root,'videos/motion-v2-train-up-concrete-0.webm'));
const output=resolve(value('--output')??resolve('..','.vision-test-fixtures','camera-lab-evidence'));
await mkdir(output,{recursive:true});
const fakeCapture=resolve(output,'synthetic-camera.y4m');
const rgb=await sharp(imagePath).resize(320,240).removeAlpha().raw().toBuffer();
const y=Buffer.alloc(320*240),u=Buffer.alloc(160*120),v=Buffer.alloc(160*120);
for(let row=0;row<240;row++)for(let col=0;col<320;col++){const i=(row*320+col)*3;y[row*320+col]=Math.max(0,Math.min(255,Math.round(.299*rgb[i]+.587*rgb[i+1]+.114*rgb[i+2])));}
for(let row=0;row<120;row++)for(let col=0;col<160;col++){let uv=0,vv=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=((row*2+dy)*320+col*2+dx)*3;uv+=-.168736*rgb[i]-.331264*rgb[i+1]+.5*rgb[i+2]+128;vv+=.5*rgb[i]-.418688*rgb[i+1]-.081312*rgb[i+2]+128;}u[row*160+col]=Math.max(0,Math.min(255,Math.round(uv/4)));v[row*160+col]=Math.max(0,Math.min(255,Math.round(vv/4)));}
await writeFile(fakeCapture,Buffer.concat([Buffer.from('YUV4MPEG2 W320 H240 F10:1 Ip A1:1 C420jpeg\n'),...Array.from({length:30},()=>Buffer.concat([Buffer.from('FRAME\n'),y,u,v]))]));
const lab=await createCameraLab({entryPath});let browser;
const blocked=[],requests=[],errors=[];
try{
  browser=await chromium.launch({channel:process.env.BASIRA_BROWSER_CHANNEL??'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${fakeCapture}`]});
  const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'});
  await context.grantPermissions(['camera'],{origin:lab.url});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(`${lab.url}/`)){requests.push({method:route.request().method(),path:new URL(url).pathname});return route.continue();}blocked.push(url);return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(lab.url);await page.waitForFunction(()=>document.body.dataset.modelReady==='true',{},{timeout:60000});
  assert.match(await page.locator('#confidenceNote').textContent(),/غير معايرة/);
  assert.equal(await page.locator('#cameraButton').isDisabled(),true);
  await page.locator('#rightsConsent').check();await page.locator('#fileInput').setInputFiles(imagePath);
  await page.waitForFunction(()=>Number(document.body.dataset.processed)>=1);
  const imageResult=await page.locator('#lastResult').textContent();
  await page.screenshot({path:resolve(output,'desktop-image.png'),fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportButton').click();const download=await downloadPromise;const imageMetricsPath=resolve(output,'image-results.json');await download.saveAs(imageMetricsPath);
  const imageMetrics=JSON.parse(await readFile(imageMetricsPath,'utf8'));assert.equal(imageMetrics.mediaIncluded,false);assert.equal(imageMetrics.productionUsed,false);assert.equal(imageMetrics.metrics.sourceKind,'image');assert.equal(imageMetrics.predictions.length,1);
  await page.locator('#fileInput').setInputFiles(videoPath);
  await page.waitForFunction(()=>document.getElementById('sessionStatus').textContent.includes('تشغيل الفيديو'));
  await page.waitForFunction(()=>Number(document.body.dataset.processed)>=1);
  await page.waitForTimeout(600);
  const videoProcessed=Number(await page.locator('#processed').textContent());assert.ok(videoProcessed>=1);
  const videoDownloadPromise=page.waitForEvent('download');await page.locator('#exportButton').click();const videoDownload=await videoDownloadPromise;const videoMetricsPath=resolve(output,'video-results.json');await videoDownload.saveAs(videoMetricsPath);
  const videoMetrics=JSON.parse(await readFile(videoMetricsPath,'utf8'));assert.equal(videoMetrics.metrics.sourceKind,'video');assert.ok(videoMetrics.metrics.processedFrames>=1);
  await page.locator('#cameraButton').click();
  await page.waitForFunction(()=>document.getElementById('sessionStatus').textContent.includes('الكاميرا تعمل'));
  await page.waitForFunction(()=>Number(document.body.dataset.processed)>=3,{},{timeout:15000}).catch(async error=>{throw new Error(`${error.message}; camera state: ${JSON.stringify(await page.evaluate(()=>({status:document.getElementById('sessionStatus').textContent,processed:document.getElementById('processed').textContent,errors:document.getElementById('errors').textContent,log:document.getElementById('eventLog').textContent,video:{width:document.getElementById('sourceVideo').videoWidth,height:document.getElementById('sourceVideo').videoHeight,paused:document.getElementById('sourceVideo').paused,time:document.getElementById('sourceVideo').currentTime}})))}`);});
  const cameraTracks=await page.evaluate(()=>{const stream=document.getElementById('sourceVideo').srcObject;window.__testTracks=stream.getTracks();return{video:stream.getVideoTracks().length,audio:stream.getAudioTracks().length};});
  assert.equal(cameraTracks.video,1);assert.equal(cameraTracks.audio,0);
  await page.screenshot({path:resolve(output,'desktop-fake-camera.png'),fullPage:true});
  await page.locator('#stopButton').click();
  const stopped=await page.evaluate(()=>window.__testTracks.every(track=>track.readyState==='ended')&&document.getElementById('sourceVideo').srcObject===null);assert.equal(stopped,true);
  await page.evaluate(()=>{window.__originalPlay=HTMLMediaElement.prototype.play;window.__originalGetUserMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async function(constraints){const stream=await window.__originalGetUserMedia.call(navigator.mediaDevices,constraints);window.__failureTracks=stream.getTracks();return stream;};HTMLMediaElement.prototype.play=function(){return Promise.reject(new Error('synthetic playback failure'));};});
  await page.locator('#cameraButton').click();await page.waitForFunction(()=>document.getElementById('sessionStatus').textContent.includes('synthetic playback failure'));
  const playbackFailureReleased=await page.evaluate(()=>window.__failureTracks.every(track=>track.readyState==='ended')&&document.getElementById('sourceVideo').srcObject===null);assert.equal(playbackFailureReleased,true);
  await page.evaluate(()=>{HTMLMediaElement.prototype.play=window.__originalPlay;navigator.mediaDevices.getUserMedia=window.__originalGetUserMedia;});
  const cameraDownloadPromise=page.waitForEvent('download');await page.locator('#exportButton').click();const cameraDownload=await cameraDownloadPromise;const cameraMetricsPath=resolve(output,'camera-results.json');await cameraDownload.saveAs(cameraMetricsPath);
  const cameraMetrics=JSON.parse(await readFile(cameraMetricsPath,'utf8'));assert.equal(cameraMetrics.metrics.sourceKind,'camera');assert.ok(cameraMetrics.metrics.processedFrames>=3);
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,serviceWorkers:'block'});
  await mobileContext.route('**/*',route=>route.request().url().startsWith(`${lab.url}/`)?route.continue():route.abort());
  const mobile=await mobileContext.newPage();mobile.on('pageerror',error=>errors.push(error.message));await mobile.goto(lab.url);await mobile.waitForFunction(()=>document.body.dataset.modelReady==='true',{},{timeout:60000});await mobile.locator('#rightsConsent').check();await mobile.locator('#fileInput').setInputFiles(imagePath);await mobile.waitForFunction(()=>Number(document.body.dataset.processed)>=1);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.screenshot({path:resolve(output,'mobile-viewport-image.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.equal(requests.some(request=>request.method!=='GET'),false);
  const report={schemaVersion:1,scope:'desktop_chrome_actual_onnx_web_synthetic_and_fake_camera',
    modelSha256:lab.contract.sha256,adapter:lab.contract.adapter,imageResult,
    image:imageMetrics.metrics,video:videoMetrics.metrics,camera:cameraMetrics.metrics,
    audioTracksRequested:false,cameraTracksStopped:stopped,cameraPlaybackFailureReleased:playbackFailureReleased,pageErrors:errors,externalRequests:blocked,
    requestMethods:[...new Set(requests.map(request=>request.method))],requestedPaths:[...new Set(requests.map(request=>request.path))],
    desktopBrowser:await page.evaluate(()=>navigator.userAgent),mobileViewportChecked:true,
    realIphoneTestPerformed:false,realCameraAccuracyMeasured:false,privateMediaUploaded:false};
  await writeFile(resolve(output,'browser-validation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({output,modelSha256:lab.contract.sha256,imageFrames:report.image.processedFrames,videoFrames:report.video.processedFrames,fakeCameraFrames:report.camera.processedFrames,externalRequests:blocked.length,realIphoneTestPerformed:false}));
}finally{if(browser)await browser.close();await lab.close();}
