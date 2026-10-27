import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cocoModelClasses, buildScopedV4Package, freezeReviewedV4 } from './freeze-reviewed.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const policy = JSON.parse(readFileSync(join(project,'ml/vision/objects-v4-targets.v1.json'),'utf8'));
const names = cocoModelClasses(readFileSync(join(project,'client/src/lib/vision/cocoLabels.ts'),'utf8'));

const target = (id,split,key) => ({
  id, split, imagePath:'images/'+id+'.png', sha256:id.repeat(64).slice(0,64),
  sourceDatasetId:'basira-first-party', captureGroupId:split+'_session_1',
  width:1000,height:600, verifiedExhaustiveClasses:['chair','book'],
  objects:[{classKey:key,bbox:[0.2,0.1,0.3,0.4],shape:'rectangular'}]
});
test('canonical COCO80 output classes retain chair, book and person indices', () => {
  assert.equal(names.length,80);
  assert.equal(names[0],'person');
  assert.equal(names[9],'traffic light');
  assert.equal(names[56],'chair');
  assert.equal(names[73],'book');
});
test('reviewed scoped dataset contains only train/validation objects; final labels never enter trainer exports', () => {
  const manifest={experimentKind:'coco80',selectedTargets:['chair','book'],
    records:[target('a','train','chair'),target('b','validation','book'),target('c','test','chair')]};
  const pkg=buildScopedV4Package(manifest,policy,names);
  assert.equal(pkg.training[0].objects[0].cocoOutputIndex,56);
  assert.equal(pkg.validation[0].objects[0].cocoOutputIndex,73);
  assert.deepEqual(pkg.training[0].verifiedExhaustiveClasses,['chair','book']);
  assert.equal(pkg.training[0].partialLabelScope,true);
  assert.equal(pkg.withheldFinalIndex[0].imageSha256,manifest.records[2].sha256);
  assert(!JSON.stringify(pkg.withheldFinalIndex).includes('objects'));
  assert.equal(pkg.initialModel.sha256,policy.modelStart.sha256);
});
test('new classes cannot be silently relabelled as existing COCO outputs', () => {
  const manifest={experimentKind:'new-class',selectedTargets:['tree'],
    records:[{...target('a','train','chair'),objects:[{classKey:'tree',bbox:[0.1,0.1,0.5,0.5],shape:'irregular'}]}]};
  assert.throws(()=>buildScopedV4Package(manifest,policy,names),/only existing/);
});
test('missing actual reviews and original model weights block freeze before writing any export', async () => {
  const dir=mkdtempSync(join(tmpdir(),'basira-v4-freeze-test-'));
  try {
    await assert.rejects(freezeReviewedV4({
      manifestPath:join(project,'scripts/vision-object-finetune-v4/manifest.example.json'),
      protectedIndexPath:join(project,'scripts/vision-object-finetune-v4/protected-index.example.json'),
      dataRoot:dir,outputDir:join(dir,'out'),originalTinyCheckpoint:join(dir,'missing.pth')
    }),/private output|intake gate|checkpoint/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('a modified label ordering is rejected instead of damaging the trained model', () => {
  assert.throws(()=>cocoModelClasses('  ["chair","كرسي",false],\n'),/COCO80 order/);
});
