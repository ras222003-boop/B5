/** Generates colored rectangles only. Never valid for training. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { writeJson, readJson, fileHash, taxonomyPath, requireValue as check } from './common.mjs';
import { assignSplits } from './data.mjs';
const root = resolve(process.argv[2] ?? '.vision-ai/browser-smoke-fixture');
await mkdir(root); await writeFile(resolve(root, 'rights.txt'), 'SYNTHETIC SOFTWARE TEST FIXTURE ONLY. NO TRAINING OR ACCURACY EVIDENCE.');
const taxonomy = await readJson(taxonomyPath), samples = [];
for (let i = 0; i < 6; i++) {
  const path = `generated-${i}.png`;
  await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: i * 35, g: 64, b: 128 } } }).png().toFile(resolve(root, path));
  samples.push({ id: `synthetic-${i}`, path, sha256: await fileHash(resolve(root, path)), width: 640, height: 480,
    sourceId: 'synthetic-test', leakageGroup: `synthetic-group-${Math.floor(i / 2)}`, split: null, media: { kind: 'image' },
    conditions: { lighting: 'indoor', scene: 'indoor', motion: 'static' }, hardNegatives: [],
    privacy: { status: 'approved', reviewer: 'synthetic-generator', at: '2026-10-14', metadataStripped: true, faces: 'absent', plates: 'absent', personalText: 'absent' },
    annotation: { status: 'reviewed', annotator: 'synthetic-generator', reviewer: 'synthetic-test-harness', exhaustive: true, objects: [], surfaces: [] } });
}
const data = assignSplits({ schemaVersion: 1, id: 'synthetic-browser-harness-only', annotationRevision: 'fixture-1', contentKind: 'synthetic',
  taxonomyVersion: taxonomy.version, samples, sources: [{ id: 'synthetic-test', kind: 'basira_team', origin: 'generated solid color software fixtures',
    license: 'test fixtures only', trainingAllowed: true, containsUserData: false,
    rightsReview: { status: 'approved', reviewer: 'synthetic-test-harness', at: '2026-10-14', evidence: { path: 'rights.txt', sha256: await fileHash(resolve(root, 'rights.txt')) } } }] });
check(data.contentKind === 'synthetic', 'fixture must remain synthetic');
await writeJson(resolve(root, 'dataset.json'), data); console.log(root);
