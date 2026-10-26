import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fixture } from './fixture.mjs';
import { StudioWorkspace } from './workspace.mjs';
import { SelfTraining, assertResearchRights } from './self-training.mjs';

const item = () => ({ conflict: false, contentKind: 'real',
  sample: { media: { kind: 'image' }, split: null,
    privacy: { status: 'approved', metadataStripped: true } },
  sources: [{ trainingAllowed: true, containsUserData: false, license: 'test-permission',
    rightsReview: { status: 'approved', reviewer: 'test-reviewer', evidence: { sha256: 'a'.repeat(64) } } }] });

test('research rights gate excludes reserved tests, unlicensed and private images', () => {
  assert.doesNotThrow(() => assertResearchRights(item()));
  for (const edit of [
    i => { i.sample.intendedUse = 'independent_test_candidate'; },
    i => { i.sample.split = 'test'; },
    i => { i.sources[0].trainingAllowed = false; },
    i => { i.sources[0].containsUserData = true; },
    i => { i.sample.privacy.status = 'pending'; },
    i => { i.sample.privacy.metadataStripped = false; },
    i => { i.contentKind = 'synthetic'; },
  ]) {
    const candidate = item(); edit(candidate);
    assert.throws(() => assertResearchRights(candidate));
  }
});

test('one click records a stopped report when the only image lacks training rights', async t => {
  const temp = await mkdtemp(resolve(tmpdir(), 'basira-self-training-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = resolve(temp, 'data');
  await fixture(root, { images: 1, classes: [23] });
  const w = await new StudioWorkspace(root).init();
  const key = (await w.catalog()).items[0].key;
  const run = await new SelfTraining(w).init();
  const report = await run.start({ authorization: true, device: 'cpu', mode: 'single',
    provider: 'studio-local', key, maxMinutes: 1, threads: 1 },
  { id: 'editor', roles: ['annotator'] }, { objectDetector: { status: 'available', sha256: 'b'.repeat(64) } });
  assert.equal(report.status, 'stopped');
  assert.equal(report.trainingPerformed, false);
  assert.equal(report.excluded.length, 1);
  assert.equal(report.humanApproval, false);
  const reloaded = await new SelfTraining(w).init();
  assert.equal(reloaded.public().id, report.id);
});
