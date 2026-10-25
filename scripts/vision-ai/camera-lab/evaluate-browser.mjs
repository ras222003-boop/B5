/** Run unchanged V3 on frozen real frames through the actual lab. Never uploads media. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createCameraLab} from './server.mjs';
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const softwareFixture=args.includes('--software-fixture');
assert.ok(value('--dataset')&&value('--entry')&&value('--output'),'--dataset, --entry and --output required');
const root=resolve(value('--dataset')),entryPath=resolve(value('--entry')),output=resolve(value('--output'));
const repo=resolve('scripts/vision-ai/camera-lab/../../..'),outRelative=relative(repo,output);
assert.ok(outRelative.startsWith('..')||isAbsolute(outRelative),'Private results must remain outside repository');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await readFile(resolve(root,'manifest.json')),manifest=JSON.parse(manifestBytes),lock=JSON.parse(await readFile(resolve(root,'test-freeze.json'),'utf8'));
assert.equal(manifest.contentKind,softwareFixture?'software_test_fixture':'real_independent_test');assert.equal(manifest.excludedFromTraining,true);assert.equal(manifest.synthetic,softwareFixture);
assert.equal(lock.manifestSha256,digest(manifestBytes));assert.equal(lock.referencesFrozenBeforeInference,!softwareFixture);assert.equal(lock.testConsumed,false,'Final test was already consumed');
assert.equal(lock.modelSha256,'a16132720922738e2cc3d248b84af5c1d92c6c9d97bc757d07867b3861ef0061');
assert.equal(digest(await readFile(entryPath)),lock.entrySha256,'Entry/threshold contract changed after freeze');
assert.ok(manifest.samples.length>0&&manifest.samples.length<=1000,'Nonempty bounded sample cohort required');
// Project only source identity and frame hashes; reference categories/boxes never reach the page.
const samples=manifest.samples.map(row=>({sampleId:row.sampleId,siteId:row.siteId,captureSessionId:row.captureSessionId,sceneId:row.sceneId,path:row.path,sha256:row.sha256}));
for(const row of samples){const path=resolve(root,row.path),rel=relative(root,path);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Frame escaped frozen root');assert.equal(digest(await readFile(path)),row.sha256);}
await mkdir(dirname(output),{recursive:true});const lab=await createCameraLab({entryPath});let browser;
try{
  assert.equal(lab.contract.sha256,lock.modelSha256);assert.equal(lab.contract.adapter,'separated-v3');
  browser=await chromium.launch({channel:process.env.BASIRA_BROWSER_CHANNEL??'chrome',headless:true});
  const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'}),external=[],pageErrors=[],requests=[];
  await context.route('**/*',route=>{const request=route.request();if(request.url().startsWith(`${lab.url}/`)){requests.push(request.method());return route.continue();}external.push(request.url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(lab.url);
  await page.waitForFunction(()=>document.body.dataset.modelReady==='true',{},{timeout:60000});await page.locator('#rightsConsent').check();
  const predictions=[];
  for(const row of samples){
    for(const key of ['siteId','captureSessionId','sceneId','sampleId'])await page.locator(`#${key}`).fill(row[key]);
    await page.locator('#fileInput').setInputFiles(resolve(root,row.path));
    await page.waitForFunction(({id})=>document.body.dataset.resultSampleId===id&&Number(document.body.dataset.processed)===1&&document.getElementById('sessionStatus').textContent.includes('صورة'),{id:row.sampleId},{timeout:30000});
    const downloadReady=page.waitForEvent('download');await page.locator('#exportButton').click();const download=await downloadReady;
    const stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);
    const record=JSON.parse(Buffer.concat(parts).toString('utf8'));assert.equal(record.identity.sampleId,row.sampleId);assert.equal(record.source.sha256,row.sha256);
    assert.equal(record.model.sha256,lock.modelSha256);assert.equal(record.predictionsAreGroundTruth,false);assert.equal(record.predictions.length,1);
    predictions.push({sampleId:row.sampleId,imageSha256:row.sha256,...record.predictions[0]});
  }
  assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);assert.ok(requests.every(method=>method==='GET'));
  await writeFile(output,JSON.stringify({schemaVersion:1,scope:softwareFixture?'software-test-browser-inference':'frozen-real-test-browser-inference',manifestSha256:lock.manifestSha256,entrySha256:lock.entrySha256,
    modelSha256:lock.modelSha256,thresholds:lab.contract.thresholds,predictions,referenceLabelsUsedForInference:false,externalRequests:external,pageErrors,
    mediaUploaded:false,productionUsed:false,confidenceCalibrated:false,browser:await page.evaluate(()=>navigator.userAgent)},null,2),{flag:'wx'});
  console.log(JSON.stringify({status:softwareFixture?'software_fixture_inferred_no_accuracy_claim':'inferred_not_scored',samples:predictions.length,output,mediaUploaded:false}));
}finally{await browser?.close();await lab.close();}
