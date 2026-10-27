import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { prepareV4Captures } from './prepare-captures.mjs';
import { assessV4Intake } from './intake.mjs';
import { inspectV4Images } from './image-preflight.mjs';

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'basira-v4-private-'));
  const input = join(root,'input'), output = join(root,'review');
  mkdirSync(input);
  try {await fn({root,input,output});} finally {rmSync(root,{recursive:true,force:true});}
}
const options = (input,output,more={}) => ({
  inputDir:input,outputDir:output,sourceDatasetId:'basira-first-party',
  captureGroupId:'session_2026_A',selectedTargets:['chair','book'], ...more
});
async function photo() {
  return sharp({create:{width:48,height:32,channels:3,background:'#91795c'}})
    .jpeg().withExif({IFD0:{Copyright:'private fixture'}}).toBuffer();
}
test('real image import strips EXIF and starts with all human approval gates closed', async () => {
  await fixture(async ({input,output}) => {
    writeFileSync(join(input,'photo.jpg'), await photo());
    writeFileSync(join(input,'broken.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const summary=await prepareV4Captures(options(input,output));
    assert.equal(summary.acceptedDraftPhotos,1);
    assert.equal(summary.rejected.invalid,1);
    assert.equal(summary.readyToTrain,false);
    const manifest=JSON.parse(readFileSync(join(output,'manifest.draft.json'),'utf8'));
    const row=manifest.records[0];
    assert.equal(row.split,null);
    assert.equal(row.rights.commercialTrainingAllowed,false);
    assert.equal(row.privacy.metadataStripped,true);
    assert.equal(row.privacy.facesPlatesHandled,false);
    assert.equal(row.review.independentApproved,false);
    assert.equal(row.annotationProvenance,'unreviewed');
    assert.deepEqual(row.objects,[]);
    const check=await inspectV4Images(manifest,output);
    assert.equal(check.imageContentVerified,true);
    const policy=JSON.parse(readFileSync(new URL('../../ml/vision/objects-v4-targets.v1.json',import.meta.url),'utf8'));
    const metadata=assessV4Intake(manifest,{},policy,output);
    assert.equal(metadata.intakeReady,false);
  });
});
test('restricted source cannot be imported even if the photos exist', async () => {
  await fixture(async ({input,output}) => {
    writeFileSync(join(input,'photo.jpg'),await photo());
    await assert.rejects(prepareV4Captures(options(input,output,{sourceDatasetId:'bdd100k'})));
    assert.equal(existsSync(output),false);
  });
});
test('mixing COCO80 labels and new classes must be treated as a separate training task', async () => {
  await fixture(async ({input,output}) => {
    writeFileSync(join(input,'photo.jpg'),await photo());
    await assert.rejects(prepareV4Captures(options(input,output,{selectedTargets:['chair','tree']})));
    assert.equal(existsSync(output),false);
  });
});
test('never overwrites an existing private training directory', async () => {
  await fixture(async ({input,output}) => {
    writeFileSync(join(input,'photo.jpg'),await photo());
    mkdirSync(output);
    await assert.rejects(prepareV4Captures(options(input,output)));
  });
});
test('all-broken media is not silently promoted to a valid dataset', async () => {
  await fixture(async ({input,output}) => {
    writeFileSync(join(input,'broken.jpg'),Buffer.from('not-a-jpeg'));
    const result=await prepareV4Captures(options(input,output));
    assert.equal(result.acceptedDraftPhotos,0);
    assert.equal(result.rejected.invalid,1);
    assert.equal(result.readyToTrain,false);
  });
});
