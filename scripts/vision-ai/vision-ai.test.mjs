import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { readJson, writeJson, hash, jsonHash, fileHash, checkedFile, taxonomyPath, repo } from './common.mjs';
import { validateDataset, assignSplits, exportCoco, importCoco, prepareDraft } from './data.mjs';
import { evaluateRun, compareReports, phoneGate } from './evaluation.mjs';
import { registerRelease, verifyRelease, selectRelease } from './registry.mjs';
import { extractFrames } from './extract-frames.mjs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { copyFile } from 'node:fs/promises';
import { proximityClass, proximityPolicy, unknownSpatial, spatialDraft, validateSpatial, rankAlerts, estimatedProximity } from './spatial.mjs';
import { initStorage, importBundle, transferPlan, outsideGit, bundleDraft } from './storage.mjs';
import { evaluateProximity } from './proximity-evaluation.mjs';
import { dataNeeds } from './data-needs.mjs';

const taxonomy = await readJson(taxonomyPath), taxonomySha256 = await fileHash(taxonomyPath);
// Generated images and attestation strings below are ONLY test fixtures. Never training evidence.
async function fixture(t) {
  const tempBase = resolve(repo, '.vision-ai/test-tmp'); await mkdir(tempBase, { recursive: true });
  const root = await mkdtemp(resolve(tempBase, 'basira-vision-ai-'));
  t.after(() => { assert.ok(root.startsWith(resolve(tempBase, 'basira-vision-ai-'))); return rm(root, { recursive: true, force: true }); });
  await mkdir(resolve(root, 'media')); await writeFile(resolve(root, 'rights.txt'), 'TEST FIXTURE ONLY, NOT A LICENSE');
  const source = { id: 'team-test', kind: 'basira_team', origin: 'unit-test-fixture', license: 'test-only',
    trainingAllowed: true, containsUserData: false, rightsReview: { status: 'approved', reviewer: 'test-reviewer', at: '2026-10-14',
      evidence: { path: 'rights.txt', sha256: await fileHash(resolve(root, 'rights.txt')) } } };
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const path = `media/${i}.png`;
    await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 20 * i, g: 30, b: 90 } } }).png().toFile(resolve(root, path));
    samples.push({ id: `sample-${i}`, path, sha256: await fileHash(resolve(root, path)), width: 100, height: 80, sourceId: source.id,
      leakageGroup: `location-session-${Math.floor(i / 2)}`, split: null, media: { kind: 'image' },
      conditions: { lighting: 'indoor', scene: 'indoor', motion: 'static' }, hardNegatives: i % 2 ? ['shadow'] : [],
      privacy: { status: 'approved', reviewer: 'privacy-test', at: '2026-10-14', metadataStripped: true, faces: 'absent', plates: 'absent', personalText: 'absent' },
      annotation: { status: 'reviewed', annotator: 'annotator-test', reviewer: 'reviewer-test', exhaustive: true, surfaces: [],
        objects: i % 2 ? [] : [{ id: 'chair-1', classId: 2, box: [.1, .2, .3, .4], trackId: null, occluded: false, truncated: false, groundContact: 'unknown' }] } });
  }
  return { root, data: { schemaVersion: 1, id: 'synthetic-unit-tests-only', annotationRevision: 'test-1', contentKind: 'real', taxonomyVersion: taxonomy.version, sources: [source], samples } };
}
const frozen = data => assignSplits(data);
const measurement = (meters = 1.5, uncertaintyMeters = .05) => ({ status: 'measured', meters, uncertaintyMeters,
  method: 'laser', reference: proximityPolicy.reference, operator: 'test-operator', instrumentId: 'test-instrument',
  measuredAt: '2026-10-14T08:00:00Z', capturedAt: '2026-10-14T08:00:00Z', validForMs: 100, validity: 'valid_at_capture',
  evidence: { path: 'rights.txt', sha256: hash('TEST FIXTURE ONLY, NOT A LICENSE') } });
const estimate = () => ({ status: 'valid', source: 'depth_sensor', meters: 1.5, uncertaintyMeters: .05,
  calibrationRangeMeters: [.3, 10],
  capturedAtMs: 100, validForMs: 200, calibrationSha256: hash('calibration-test'), errorValidationSha256: hash('error-test') });
const reviewedSpatial = data => {
  const result = spatialDraft(data);
  result.samples.forEach((s, i) => { s.annotation = { ...s.annotation, ...data.samples[i].annotation,
    objects: s.annotation.objects }; }); return result;
};

test('five proximity boundaries and uncertainty overlap never infer meters from pixels', () => {
  assert.deepEqual([.9, 1, 2, 3.5, 5].map(v => proximityClass(measurement(v, 0))), proximityPolicy.classes);
  for (const b of [1, 2, 3.5, 5]) assert.equal(proximityClass(measurement(b, .1)), 'distance_uncertain');
  for (const d of [null, { status: 'uncertain' }, { status: 'measured', meters: '1', uncertaintyMeters: 0 }, measurement(NaN), measurement(1, 2)])
    assert.equal(proximityClass(d), 'distance_uncertain');
});
test('metric adapter abstains for missing calibration, stale/future and uncalibrated detector estimates', () => {
  assert.equal(estimatedProximity(estimate(), 200), 'near');
  for (const change of [{ calibrationSha256: '' }, { errorValidationSha256: '' }, { source: 'box_size' }, { status: 'expired' }, { validForMs: 801 },
    { calibrationRangeMeters: [2, 10] }, { calibrationRangeMeters: [1, 1] }, { meters: 11 }])
    assert.equal(estimatedProximity({ ...estimate(), ...change }, 200), 'distance_uncertain');
  assert.equal(estimatedProximity(estimate(), 301), 'distance_uncertain');
  assert.equal(estimatedProximity(estimate(), 99), 'distance_uncertain');
});
test('spatial draft preserves frozen groups, marks unknown distance and revokes review', async t => {
  const { data } = await fixture(t), prior = frozen(data), output = spatialDraft(prior);
  assert.deepEqual(output.samples.map(s => s.split), prior.samples.map(s => s.split));
  assert.equal(output.samples[0].annotation.status, 'pending');
  assert.equal(output.samples[0].annotation.objects[0].spatial.proximity, 'distance_uncertain');
});
test('phase-two validates independent spatial review and rejects mismatched numeric claims', async t => {
  const { root, data } = await fixture(t), output = reviewedSpatial(frozen(data));
  await validateDataset(output, root);
  const spatial = output.samples[0].annotation.objects[0].spatial;
  spatial.distance = measurement(); spatial.proximity = 'near'; await validateDataset(output, root);
  spatial.proximity = 'far'; await assert.rejects(validateDataset(output, root), /proximity/);
  spatial.proximity = 'near'; spatial.distance.evidence.sha256 = hash('changed');
  await assert.rejects(validateDataset(output, root), /SHA-256/);
});
test('video measurement needs synchronized time and calibrated sensor evidence', async () => {
  const spatial = { ...unknownSpatial(), distance: measurement(), proximity: 'near' };
  const s = { media: { kind: 'video_frame', timestampMs: 100 } };
  await assert.rejects(validateSpatial(spatial, s, repo, false), /synchronized/);
  Object.assign(spatial.distance, { videoTimestampMs: 110, syncErrorMs: 10 }); await validateSpatial(spatial, s, repo, false);
  spatial.distance.method = 'calibrated_depth'; await assert.rejects(validateSpatial(spatial, s, repo, false), /evidence/);
  spatial.distance.calibrationEvidence = { path: 'calibration.json', sha256: hash('fixture') };
  await validateSpatial(spatial, s, repo, false);
});
test('unknown distances cannot contain numeric claims; spatial fields require version', async t => {
  const { root, data } = await fixture(t), output = frozen(data);
  output.samples[0].annotation.objects[0].spatial = unknownSpatial();
  await assert.rejects(validateDataset(output, root), /spatialPolicyVersion/);
  const spatial = unknownSpatial(); spatial.distance.meters = 1;
  await assert.rejects(validateSpatial(spatial, output.samples[0], root), /numeric claim/);
});
test('motion endpoints require measured approach/recede and same video/track; zoom cannot manufacture approach', async t => {
  const { root, data } = await fixture(t), output = reviewedSpatial(frozen(data));
  await writeFile(resolve(root, 'clip.mp4'), 'TEST VIDEO IDENTITY ONLY');
  const v = { id: 'clip', path: 'clip.mp4', sha256: await fileHash(resolve(root, 'clip.mp4')),
    privacy: { ...output.samples[0].privacy, voices: 'absent' } };
  const a = output.samples[0], b = output.samples[1];
  b.annotation.objects = structuredClone(a.annotation.objects);
  [a, b].forEach((s, i) => {
    s.media = { kind: 'video_frame', video: v, timestampMs: i * 100 };
    const o = s.annotation.objects[0]; o.trackId = 'track-1';
    o.spatial.distance = { ...measurement(2.5 - i), videoTimestampMs: i * 100, syncErrorMs: 0 };
    o.spatial.proximity = proximityClass(o.spatial.distance);
  });
  output.motionSegments = [{ id: 'motion-1', videoSha256: v.sha256, trackId: 'track-1', startMs: 0, endMs: 100,
    relativeMotion: 'approaching', cameraMotion: 'zoom', objectRotation: 'none', evidence: measurement().evidence,
    review: { status: 'reviewed', annotator: 'test-a', reviewer: 'test-b', at: '2026-10-14' } }];
  await validateDataset(output, root);
  output.motionSegments[0].relativeMotion = 'receding'; await assert.rejects(validateDataset(output, root), /conflicts/);
  output.motionSegments[0].relativeMotion = 'approaching'; b.annotation.objects[0].spatial = unknownSpatial();
  await assert.rejects(validateDataset(output, root), /endpoint measurements/);
  output.motionSegments[0].relativeMotion = 'uncertain'; await validateDataset(output, root);
  output.motionSegments[0].trackId = 'missing'; await assert.rejects(validateDataset(output, root), /endpoints/);
});
test('priority includes hazard, camera sector, motion and freshness; stale evidence and safety claims rejected', () => {
  const item = (id, classId) => ({ id, classId, confidence: .8, observedAtMs: 100,
    spatial: { direction: { sector: 'center' } }, metricEstimate: estimate() });
  const normal = item('chair', 2), hazard = item('hole', 26);
  const result = rankAlerts([normal, hazard, { ...item('stale', 2), observedAtMs: -1000 }], taxonomy, 200);
  assert.equal(result.ranked[0].id, 'hole'); assert.equal(result.rejected[0].reason, 'stale');
  assert.equal(result.ranked[0].safePathClaimAllowed, false); assert.equal(result.ranked[0].userTravelDirection, 'unknown');
  const moving = rankAlerts([{ ...normal, relativeMotion: 'approaching', motionEvidenceVerified: true }], taxonomy, 200);
  assert.equal(moving.ranked[0].components.motion, 25);
  const uncertain = rankAlerts([{ ...hazard, metricEstimate: null, confidence: .1 }], taxonomy, 200);
  assert.equal(uncertain.ranked[0].proximity, 'distance_uncertain'); assert.equal(uncertain.ranked[0].reviewRequired, true);
  assert.throws(() => rankAlerts([normal, normal], taxonomy, 200), /invalid priority/);
});
test('proximity evaluation includes abstentions, binds calibration and cannot calibrate on test data', async t => {
  const { root, data } = await fixture(t), output = reviewedSpatial(frozen(data));
  const sample = output.samples.find(s => s.split === 'test' && s.annotation.objects.length);
  sample.annotation.objects[0].spatial = { ...unknownSpatial(), distance: measurement(), proximity: 'near' };
  await writeFile(resolve(root, 'calibration.json'), 'calibration-test'); await writeFile(resolve(root, 'error.json'), 'error-test');
  const run = { datasetSha256: jsonHash(output), policyVersion: proximityPolicy.version, split: 'test', modelVersion: 'test-only',
    calibration: { reviewStatus: 'approved', reviewer: 'test-reviewer', datasetSha256: hash('other-calibration-dataset'), rangeMeters: [.3, 10],
      calibrationPath: 'calibration.json', calibrationSha256: estimate().calibrationSha256, errorValidationPath: 'error.json', errorValidationSha256: estimate().errorValidationSha256 },
    observations: [{ sampleId: sample.id, objectId: sample.annotation.objects[0].id, evaluatedAtMs: 200, estimate: null }] };
  let report = await evaluateProximity(output, root, run); assert.equal(report.coverage, 0); assert.equal(report.accuracyIncludingAbstentions, 0);
  run.observations[0].estimate = estimate(); report = await evaluateProximity(output, root, run); assert.equal(report.meanAbsoluteErrorMetersOnCertainComparable, 0);
  run.calibration.datasetSha256 = run.datasetSha256; await assert.rejects(evaluateProximity(output, root, run), /independent calibration/);
});

async function storageFixture(t) {
  const f = await fixture(t), base = await mkdtemp(resolve(tmpdir(), 'basira-storage-test-'));
  t.after(() => { assert.ok(base.startsWith(resolve(tmpdir(), 'basira-storage-test-'))); return rm(base, { recursive: true, force: true }); });
  const storage = resolve(base, 'Basira-Vision-Datasets'); await initStorage(storage);
  await mkdir(resolve(f.root, 'images')); await mkdir(resolve(f.root, 'rights'));
  await copyFile(resolve(f.root, 'rights.txt'), resolve(f.root, 'rights/license.txt'));
  const source = structuredClone(f.data.sources[0]); source.rightsReview.evidence.path = 'rights/license.txt';
  const bundle = { schemaVersion: 1, id: 'test-bundle', contentKind: 'real', containsUserData: false, sources: [source], samples: [], files: [] };
  for (const s of f.data.samples) {
    const path = s.path.replace('media/', 'images/'); await copyFile(resolve(f.root, s.path), resolve(f.root, path));
    bundle.samples.push({ ...s, path });
    bundle.files.push({ path, sha256: s.sha256, sourceId: source.id, kind: 'image', origin: 'unit-test-only', originalId: s.id });
  }
  bundle.files.push({ path: source.rightsReview.evidence.path, sha256: source.rightsReview.evidence.sha256,
    sourceId: source.id, kind: 'rights', origin: 'unit-test-only', originalId: 'rights-test' });
  return { ...f, storage, bundle };
}
test('storage refuses any Git checkout and does not overwrite existing workspace', async t => {
  await assert.rejects(outsideGit(resolve(repo, 'dataset')), /outside every Git/);
  const { storage } = await storageFixture(t); await assert.rejects(initStorage(storage), /EEXIST/);
});
test('bundle import copies verified bytes, carries provenance and resets approval; duplicate media blocked across imports', async t => {
  const { storage, root, bundle } = await storageFixture(t);
  const result = await importBundle(bundle, root, storage);
  const draft = await readJson(resolve(result.root, 'dataset.draft.json'));
  assert.equal(draft.samples[0].privacy.status, 'pending'); assert.equal(draft.samples[0].annotation.status, 'pending');
  assert.equal(draft.samples[0].provenance.originalId, bundle.samples[0].id);
  assert.equal(await fileHash(resolve(result.root, bundle.samples[0].path)), bundle.samples[0].sha256);
  await assert.rejects(importBundle({ ...bundle, id: 'another-bundle' }, root, storage), /already imported/);
  const plan = await transferPlan(storage, 'r2', 'basira-private-test');
  assert.equal(plan.status, 'PLAN_ONLY_NO_UPLOAD'); assert.ok(plan.files.length > 6);
});
test('bundle rejects modified content, path traversal, missing rights, and user data before import', async t => {
  const { storage, root, bundle } = await storageFixture(t);
  for (const [mutate, expected] of [
    [b => { b.files[0].sha256 = hash('changed'); }, /SHA-256/],
    [b => { b.files[0].path = '../secret'; }, /invalid relative/],
    [b => { b.sources[0].rightsReview.status = 'pending'; }, /rights review/],
    [b => { b.containsUserData = true; }, /non-user/],
    [b => { b.samples[0].split = 'test'; }, /frozen splits/]]) {
    const value = structuredClone(bundle); mutate(value); await assert.rejects(importBundle(value, root, storage), expected);
  }
});
test('data needs enumerate all classes and never report synthetic planning targets as progress', async () => {
  const needs = await dataNeeds(); assert.equal(needs.classes.length, taxonomy.classes.length);
  assert.ok(needs.classes.every(c => c.examples && c.missingAnnotations.test > 0));
  assert.equal(needs.noDataAvailable, true); assert.equal(needs.trainingPerformed, false);
});
test('bundle drafting hashes only inventoried files and always revokes source approval', async t => {
  const { root, bundle } = await storageFixture(t);
  const output = await bundleDraft(bundle, root);
  assert.equal(output.sources[0].rightsReview.status, 'pending');
  assert.equal(output.files[0].sha256, bundle.files[0].sha256);
  assert.equal(output.samples[0].sha256, bundle.samples[0].sha256);
  assert.equal(output.samples[0].split, null);
});
test('COCO export/import preserves spatial labels while revoking annotation approval', async t => {
  const { root, data } = await fixture(t), output = reviewedSpatial(frozen(data));
  const exportRoot = resolve(root, 'spatial-export'); await exportCoco(output, root, exportRoot);
  const coco = await readJson(resolve(exportRoot, 'train.json'));
  assert.ok(coco.annotations.every(a => a.basira_spatial.proximity === 'distance_uncertain'));
  const trainOnly = { ...output, samples: output.samples.filter(s => s.split === 'train') };
  const imported = importCoco(trainOnly, coco, taxonomy);
  assert.equal(imported.samples[0].annotation.status, 'pending');
  assert.deepEqual(imported.samples.flatMap(s => s.annotation.objects.map(o => o.spatial)),
    trainOnly.samples.flatMap(s => s.annotation.objects.map(o => o.spatial)));
});
test('transfer planning refuses credential filenames and unsupported destinations', async t => {
  const { storage } = await storageFixture(t);
  await assert.rejects(transferPlan(storage, 'public-http', 'test'), /gcs\/r2/);
  await writeFile(resolve(storage, '.env'), 'TEST_PLACEHOLDER=not-a-secret');
  await assert.rejects(transferPlan(storage, 'gcs', 'test-private-bucket'), /credentials/);
});
const reject = async (t, mutation, match) => { const f = await fixture(t); f.data = frozen(f.data); mutation(f.data); await assert.rejects(validateDataset(f.data, f.root), match); };

test('taxonomy has stable unique IDs/keys and explicit unsupported runtime classes', () => {
  assert.equal(new Set(taxonomy.classes.map(c => c.id)).size, taxonomy.classes.length);
  assert.equal(new Set(taxonomy.classes.map(c => c.key)).size, taxonomy.classes.length);
  assert.equal(taxonomy.classes.filter(c => c.baselineLabels.length).length, 17);
  assert.equal(taxonomy.classes.find(c => c.key === 'pothole_visible').runtimeType, null);
});
test('group split is deterministic, order-independent, disjoint and all splits nonempty', async t => {
  const { root, data } = await fixture(t), output = frozen(data);
  const reversed = frozen({ ...data, samples: [...data.samples].reverse() });
  assert.deepEqual(Object.fromEntries(output.samples.map(s => [s.id, s.split])), Object.fromEntries(reversed.samples.map(s => [s.id, s.split])));
  const report = await validateDataset(output, root); assert.deepEqual(report.counts, { train: 2, validation: 2, test: 2 });
  assert.throws(() => frozen(output), /cannot re-split/);
});
test('too few independent groups is rejected', async t => {
  const { data } = await fixture(t); data.samples.forEach(s => { s.leakageGroup = 'same-site'; }); assert.throws(() => frozen(data), /three independent/);
});
test('user-origin data forbidden even with rights attestation', t => reject(t, d => { d.sources[0].kind = 'user_upload'; }, /only Basira/));
test('user data inside nominal licensed source forbidden', t => reject(t, d => { d.sources[0].containsUserData = true; }, /user data forbidden/));
test('pending rights rejected', t => reject(t, d => { d.sources[0].rightsReview.status = 'pending'; }, /rights review/));
test('privacy review cannot be skipped', t => reject(t, d => { d.samples[0].privacy.faces = 'unreviewed'; }, /privacy/));
test('self-reviewed annotations rejected', t => reject(t, d => { d.samples[0].annotation.reviewer = 'annotator-test'; }, /independent/));
test('unreviewed negative images cannot silently become background', t => reject(t, d => { d.samples[1].annotation.exhaustive = false; }, /exhaustive/));
test('invalid boxes, classes and numeric strings rejected', async t => {
  const { root, data } = await fixture(t), output = frozen(data);
  for (const box of [[-.1, .2, .3, .4], [0, 0, 0, .2], [.9, .2, .2, .2], ['0', .2, .2, .2]]) {
    const d = structuredClone(output); d.samples[0].annotation.objects[0].box = box; await assert.rejects(validateDataset(d, root), /class\/box/);
  }
  output.samples[0].annotation.objects[0].classId = 101; await assert.rejects(validateDataset(output, root), /class\/box/);
});
test('exact image duplicates rejected even with different names/groups', t => reject(t, d => { d.samples[1].sha256 = d.samples[0].sha256; }, /duplicate/));
test('duplicate same-class annotation geometry rejected', t => reject(t, d => {
  d.samples[0].annotation.objects.push({ ...d.samples[0].annotation.objects[0], id: 'different-id' });
}, /duplicate annotation geometry/));
test('location/session leakage rejected', t => reject(t, d => { d.samples[1].split = d.samples[0].split === 'train' ? 'test' : 'train'; }, /split leakage/));
test('video SHA links different session names into one split component', async t => {
  const { root, data } = await fixture(t);
  await writeFile(resolve(root, 'clip.mp4'), 'video identity fixture');
  const video = { id: 'clip', path: 'clip.mp4', sha256: await fileHash(resolve(root, 'clip.mp4')) };
  data.samples.forEach((s, i) => { s.leakageGroup = `group-${i}`; });
  for (let i = 0; i < 2; i++) { data.samples[i].media = { kind: 'video_frame', video, timestampMs: i * 100 }; data.samples[i].annotation.objects.forEach(o => { o.trackId = 'track-1'; }); }
  const output = frozen(data); assert.equal(output.samples[0].split, output.samples[1].split); await validateDataset(output, root);
  output.samples[1].split = output.samples[0].split === 'train' ? 'test' : 'train'; await assert.rejects(validateDataset(output, root), /split leakage/);
});
test('frame extraction preserves variable presentation times and calls local tools without a shell', async t => {
  const { root, data } = await fixture(t); await writeFile(resolve(root, 'clip.mp4'), 'VIDEO TEST STUB');
  const record = { source: data.sources[0], leakageGroup: 'site-1', conditions: data.samples[0].conditions, stride: 2,
    video: { id: 'clip', path: 'clip.mp4', sha256: await fileHash(resolve(root, 'clip.mp4')) } };
  const called = [];
  const fake = (binary, args) => {
    called.push(binary);
    if (binary === 'ffprobe') return JSON.stringify({ frames: [0, .04, .105, .13, .21].map(t => ({ best_effort_timestamp_time: String(t) })) });
    assert.equal(binary, 'ffmpeg'); assert.equal(args[args.indexOf('-vf') + 1], 'select=not(mod(n\\,2))');
    for (let i = 0; i < 3; i++) writeFileSync(args.at(-1).replace('%06d', String(i).padStart(6, '0')), 'FRAME TEST STUB');
    return '';
  };
  const inventory = await extractFrames(record, root, 'media/clip', fake);
  assert.deepEqual(called, ['ffprobe', 'ffmpeg']); assert.deepEqual(inventory.samples.map(s => s.media.timestampMs), [0, 105, 210]);
  assert.equal(inventory.samples[0].media.video.sha256, record.video.sha256);
  record.source.kind = 'user_upload';
  await assert.rejects(extractFrames(record, root, 'media/forbidden', () => assert.fail('must not run ffmpeg')), /only Basira/);
});
test('frame extraction rejects missing timestamps and partial output', async t => {
  const { root, data } = await fixture(t); await writeFile(resolve(root, 'clip.mp4'), 'VIDEO TEST STUB');
  const record = { source: data.sources[0], leakageGroup: 'site-1', stride: 1,
    video: { id: 'clip', path: 'clip.mp4', sha256: await fileHash(resolve(root, 'clip.mp4')) } };
  await assert.rejects(extractFrames(record, root, 'media/bad', () => JSON.stringify({ frames: [{}] })), /timestamps/);
  await assert.rejects(extractFrames(record, root, 'media/partial', binary => binary === 'ffprobe' ?
    JSON.stringify({ frames: [{ best_effort_timestamp_time: '0' }] }) : ''), /count mismatch/);
});
test('image hash and dimensions verified against actual bytes', async t => {
  const { root, data } = await fixture(t), output = frozen(data);
  output.samples[0].width = 200; await assert.rejects(validateDataset(output, root), /decoded dimensions/);
  output.samples[0].width = 100; await writeFile(resolve(root, output.samples[0].path), 'tampered');
  await assert.rejects(validateDataset(output, root), /SHA-256 mismatch/);
});
test('metadata is checked, not merely trusted', async t => {
  const { root, data } = await fixture(t), output = frozen(data), s = output.samples[0];
  await sharp({ create: { width: 100, height: 80, channels: 3, background: '#abc' } }).withMetadata().png().toFile(resolve(root, 'metadata.png'));
  s.path = 'metadata.png'; s.sha256 = await fileHash(resolve(root, s.path));
  await assert.rejects(validateDataset(output, root), /strip metadata/);
});
test('path traversal and absolute paths rejected', async t => {
  const { root } = await fixture(t);
  for (const path of ['../outside', 'C:/secret', '/etc/passwd', 'a\\b']) await assert.rejects(checkedFile(root, path, hash('x')), /path/);
});
test('synthetic data never exports for training', async t => {
  const { root, data } = await fixture(t), output = frozen(data); output.contentKind = 'synthetic';
  await assert.rejects(exportCoco(output, root, resolve(root, 'export')), /synthetic/);
});
test('COCO export contains negatives and immutable locked splits', async t => {
  const { root, data } = await fixture(t), output = frozen(data), destination = resolve(root, 'export');
  await exportCoco(output, root, destination);
  const lock = await readJson(resolve(destination, 'dataset.lock.json'));
  for (const key of ['train', 'validation', 'test']) {
    const coco = await readJson(resolve(destination, `${key}.json`));
    assert.equal(coco.images.length, 2); assert.equal(coco.annotations.length, 1);
    assert.deepEqual(coco.annotations[0].bbox, [10, 16, 30, 32]);
    assert.equal(await fileHash(resolve(destination, `${key}.json`)), lock.files[`${key}.json`]);
  }
  await assert.rejects(exportCoco(output, root, destination), /EEXIST/);
});
test('annotation preparation and import always require renewed review', async t => {
  const { root, data } = await fixture(t), draft = await prepareDraft(data, root);
  assert.equal(draft.samples[0].annotation.status, 'pending');
  const coco = { images: data.samples.map((s, i) => ({ id: i, file_name: s.path, width: s.width, height: s.height })),
    categories: [{ id: 99, name: 'chair' }], annotations: [{ id: 1, image_id: 0, category_id: 99, bbox: [10, 16, 30, 32], iscrowd: 0 }] };
  const imported = importCoco(draft, coco, taxonomy);
  assert.equal(imported.samples[0].annotation.objects[0].classId, 2); assert.equal(imported.samples[0].annotation.exhaustive, false);
  coco.annotations[0].iscrowd = 1; assert.throws(() => importCoco(draft, coco, taxonomy), /crowd/);
});

function predictions(data) {
  return { schemaVersion: 1, datasetSha256: jsonHash(data), taxonomySha256, modelSha256: hash('test model'),
    modelVersion: 'test-model', sourceCommit: 'fixture', device: 'synthetic', browser: 'synthetic', backend: 'stub',
    protocol: 'fixture-v1', split: 'test', scoreThreshold: .45, maxDetections: 12, nmsIoU: .6, measurementDurationMs: 1000,
    samples: data.samples.filter(s => s.split === 'test').map(s => ({ id: s.id, imageSha256: s.sha256, inferenceMs: 10,
      predictions: s.annotation.objects.map(o => ({ classId: o.classId, box: o.box, score: .9 })) })) };
}
test('evaluation reuses existing AP arithmetic and labels synthetic results explicitly', async t => {
  const { root, data } = await fixture(t), output = frozen(data); output.contentKind = 'synthetic';
  const run = predictions(output), report = await evaluateRun(output, root, run, { allowSynthetic: true });
  assert.equal(report.detection.microRecall, 1); assert.equal(report.detection.mAP50, 1); assert.equal(report.scope, 'synthetic-arithmetic-only');
  assert.equal(report.mobile, null); assert.equal(report.negativeFrames.count, 1);
  const miss = structuredClone(run); miss.samples.forEach(s => { s.predictions = []; });
  const bad = await evaluateRun(output, root, miss, { allowSynthetic: true }); assert.equal(bad.detection.microRecall, 0);
  assert.equal(compareReports(report, bad).deltaCandidateMinusBaseline.recall, -1);
});
test('missing frames, modified data and changed comparison device rejected', async t => {
  const { root, data } = await fixture(t), output = frozen(data), run = predictions(output);
  const missing = structuredClone(run); missing.samples.pop(); await assert.rejects(evaluateRun(output, root, missing), /every held-out/);
  const changed = structuredClone(run); changed.datasetSha256 = hash('different'); await assert.rejects(evaluateRun(output, root, changed), /hash mismatch/);
  const report = await evaluateRun(output, root, run), other = structuredClone(report); other.run.device = 'different';
  assert.throws(() => compareReports(report, other), /device/);
});

test('stairs evaluation uses three reviewed directions, presence and image position without mixing global classes', async t => {
  const {root,data}=await fixture(t),output=frozen(data);
  output.contentKind='synthetic';
  for(const s of output.samples)for(const o of s.annotation.objects){o.classId=23;o.stairsDirection={label:'stairs_up',evidence:'synthetic fixture: visible fictional ascent'};}
  for(const s of output.samples)s.conditions.motion='unknown_stairs_still';
  const run=predictions(output);
  run.task='basira-stairs-v1';run.taskPolicySha256=await fileHash(resolve(repo,'ml/vision/stairs-task.v1.json'));
  for(const s of run.samples)for(const p of s.predictions)p.classId=2301;
  const report=await evaluateRun(output,root,run,{allowSynthetic:true});
  await assert.rejects(evaluateRun(output,root,{...run,task:null},{allowSynthetic:true}),/restricted to the stairs/);
  assert.equal(report.detection.microRecall,1);assert.equal(report.stairs.position.horizontalCorrect,report.stairs.position.matchedBoxes);
  assert.equal(report.stairs.position.metricDistance,null);assert.equal(report.scope,'synthetic-arithmetic-only');
  const incompatible=structuredClone(report);incompatible.task=null;
  assert.throws(()=>compareReports(report,incompatible),/task mismatch/);
  await assert.rejects(evaluateRun(output,root,{...run,taskPolicySha256:hash('changed')},{allowSynthetic:true}),/policy hash/);
  for(const s of output.samples)for(const o of s.annotation.objects)delete o.stairsDirection;
  const stale={...run,datasetSha256:jsonHash(output)};
  await assert.rejects(evaluateRun(output,root,stale,{allowSynthetic:true}),/Generic stairs/);
});
test('false positives on negative frames and unsupported model classes are counted', async t => {
  const { root, data } = await fixture(t), output = frozen(data), run = predictions(output);
  run.samples.find(s => !s.predictions.length).predictions.push({ classId: -1, score: .9, box: [.1, .1, .2, .2] });
  const report = await evaluateRun(output, root, run); assert.equal(report.detection.falsePositives, 1); assert.equal(report.negativeFrames.falsePositiveFrames, 1);
});
test('phone gate rejects low FPS, duplicate frames and desktop claims', () => {
  const trace = { schemaVersion: 1, physicalDevice: true, device: 'test-phone', browser: 'test-browser', modelSha256: hash('model'), durationMs: 600000,
    frames: Array.from({ length: 2400 }, (_, i) => ({ id: `f-${i}`, capturedAtMs: i * 250, completedAtMs: i * 250 + 100 })),
    tracking: { idSwitches: 0, labeledMinutes: 10, groundTruthSha256: hash('tracks') }, thermalStable: true, batteryMeasured: true,
    zoomRotationOcclusionTestsPassed: true, falseApproachReviewPassed: true };
  assert.equal(phoneGate(trace).engineeringGate, 'PASS_PENDING_FIELD_REVIEW'); assert.equal(phoneGate(trace).enableApproach, false);
  const slow = structuredClone(trace); slow.frames = slow.frames.filter((_, i) => i % 2 === 0); assert.equal(phoneGate(slow).engineeringGate, 'FAIL');
  const repeated = structuredClone(trace); repeated.frames[1].id = repeated.frames[0].id; assert.throws(() => phoneGate(repeated), /repeated/);
  assert.throws(() => phoneGate({ ...trace, physicalDevice: false }), /physical phone/);
});
test('model registration is immutable; selection and rollback verify bytes and keep history', async t => {
  const { root } = await fixture(t), registry = resolve(root, 'registry');
  await writeFile(resolve(root, 'model.onnx'), 'TEST MODEL BYTES');
  const modelSha256 = await fileHash(resolve(root, 'model.onnx'));
  await writeJson(resolve(root, 'metrics.json'), { schemaVersion: 1, scope: 'synthetic-test-only', modelSha256, accuracy: null });
  const descriptor = { version: '0.1.0', format: 'onnx', sourceCommit: 'f'.repeat(40), modelPath: 'model.onnx', modelSha256,
    taxonomySha256, status: 'experimental-candidate', licenseEvidence: 'rights.txt', licenseSha256: await fileHash(resolve(root, 'rights.txt')),
    metricsPath: 'metrics.json', metricsSha256: await fileHash(resolve(root, 'metrics.json')),
    compatibility: { input: 'test', output: 'test', runtime: 'test' } };
  await registerRelease(registry, descriptor, root); await verifyRelease(registry, '0.1.0');
  await assert.rejects(registerRelease(registry, descriptor, root), /EEXIST/);
  await registerRelease(registry, { ...descriptor, version: '0.2.0' }, root);
  await selectRelease(registry, '0.1.0', 'test baseline'); await selectRelease(registry, '0.2.0', 'test candidate');
  const rolled = await selectRelease(registry, null, 'test rollback', true);
  assert.equal(rolled.active, '0.1.0'); assert.equal(rolled.history.length, 3); assert.equal(rolled.scope, 'offline-lab-only');
  await writeFile(resolve(registry, '0.2.0/model.onnx'), 'TAMPERED');
  await assert.rejects(selectRelease(registry, '0.2.0', 'must refuse'), /SHA-256 mismatch/);
  assert.equal((await readJson(resolve(registry, 'lab-state.json'))).active, '0.1.0');
  const manifestPath = resolve(registry, '0.1.0/release.json'), manifest = await readJson(manifestPath);
  manifest.files[0] = { ...manifest.files[1] }; await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifyRelease(registry, '0.1.0'), /incomplete release/);
});
