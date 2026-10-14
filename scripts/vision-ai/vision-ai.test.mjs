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
