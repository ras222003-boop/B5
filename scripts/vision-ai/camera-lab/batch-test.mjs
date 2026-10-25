/** Two generated software fixtures, no rights approvals or reference labels. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import sharp from 'sharp';
const a=process.argv.slice(2),v=n=>a[a.indexOf(n)+1];assert.ok(a.includes('--entry')&&a.includes('--output'));
const root=resolve(v('--output')),entry=resolve(v('--entry')),hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(root,{recursive:true});await mkdir(resolve(root,'frames'),{recursive:true});
const samples=[];
for(let i=0;i<2;i++){
  const bytes=await sharp({create:{width:i?123:81,height:i?87:119,channels:3,background:i?'#808080':'#223344'}}).png().toBuffer();
  const name=`frames/software-only-${i}.png`;await writeFile(resolve(root,name),bytes);
  samples.push({sampleId:`software-${i}`,siteId:'software-site',captureSessionId:'software-session',sceneId:`software-scene-${i}`,path:name,sha256:hash(bytes)});
}
const entryBytes=await readFile(entry),modelSha256=JSON.parse(entryBytes).sha256;
const manifest=Buffer.from(JSON.stringify({contentKind:'software_test_fixture',synthetic:true,excludedFromTraining:true,samples}));
await writeFile(resolve(root,'manifest.json'),manifest);
await writeFile(resolve(root,'test-freeze.json'),JSON.stringify({manifestSha256:hash(manifest),entrySha256:hash(entryBytes),modelSha256,referencesFrozenBeforeInference:false,testConsumed:false}));
await new Promise((done,reject)=>{const p=spawn(process.execPath,['scripts/vision-ai/camera-lab/evaluate-browser.mjs','--dataset',root,'--entry',entry,'--output',resolve(root,'software-predictions.json'),'--software-fixture'],{stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',code=>code===0?done():reject(new Error(`Batch integration exit ${code}`)));});
const result=JSON.parse(await readFile(resolve(root,'software-predictions.json'),'utf8'));
assert.equal(result.scope,'software-test-browser-inference');assert.equal(result.predictions.length,2);assert.deepEqual(result.externalRequests,[]);assert.equal(result.referenceLabelsUsedForInference,false);
await writeFile(resolve(root,'software-validation.json'),JSON.stringify({scope:'software_only_batch_runner_test',actualV3Onnx:true,modelSha256,samples:2,realSamples:0,noRightsApprovalsCreated:true,realAccuracyMeasured:false,mediaUploaded:false,passed:true},null,2));
