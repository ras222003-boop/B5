import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inspectV4Images } from './image-preflight.mjs';

const width = 48, height = 32;

function pixels(seed) {
  const bytes = Buffer.alloc(width * height * 3);
  let state = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

async function makePng(seed, compressionLevel = 6) {
  return sharp(pixels(seed), {raw:{width, height, channels:3}})
    .png({compressionLevel}).toBuffer();
}
async function runCase(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'basira-v4-image-'));
  try { await fn(dir); } finally { rmSync(dir, {recursive:true, force:true}); }
}
const record = (imagePath, split, more = {}) =>
  ({imagePath, split, width, height, ...more});

test('real decoded and dimension-matched photos from distinct scenes pass the content preflight', async () => {
  await runCase(async dir => {
    writeFileSync(join(dir, 'a.png'), await makePng(11));
    writeFileSync(join(dir, 'b.png'), await makePng(99999));
    const result = await inspectV4Images(
      {records: [record('a.png', 'train'), record('b.png', 'test')]}, dir);
    assert.equal(result.inspected, 2);
    assert.equal(result.imageContentVerified, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.trainingStarted, false);
  });
});
test('a header-shaped file without decoded image pixels is rejected', async () => {
  await runCase(async dir => {
    writeFileSync(join(dir, 'bad.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const result = await inspectV4Images({records:[record('bad.png', 'train')]}, dir);
    assert(result.errors.includes('record_1_unreadable_or_invalid_image'));
    assert.equal(result.imageContentVerified, false);
  });
});
test('the actual decoded dimensions must match independently recorded dimensions', async () => {
  await runCase(async dir => {
    writeFileSync(join(dir, 'a.png'), await makePng(2));
    const result = await inspectV4Images(
      {records:[record('a.png', 'validation', {width:width+1})]}, dir);
    assert(result.errors.includes('record_1_decoded_dimensions_or_format_mismatch'));
  });
});
test('near-identical pixels encoded with different PNG compression are flagged across train/test', async () => {
  await runCase(async dir => {
    const a = await makePng(41, 0);
    const b = await makePng(41, 9);
    assert.notDeepEqual(a, b);
    writeFileSync(join(dir, 'a.png'), a);
    writeFileSync(join(dir, 'b.png'), b);
    const result = await inspectV4Images(
      {records:[record('a.png','train'),record('b.png','test')]}, dir);
    assert.equal(result.nearDuplicateCandidates, 1);
    assert(result.errors.includes('record_2_cross_split_visual_near_duplicate_review_required'));
  });
});
test('metadata-bearing photos are not accepted as stripped', async () => {
  await runCase(async dir => {
    const jpeg = await sharp(pixels(52), {raw:{width,height,channels:3}})
      .jpeg().withExif({IFD0:{Copyright:'fixture'}}).toBuffer();
    writeFileSync(join(dir, 'photo.jpg'), jpeg);
    const result = await inspectV4Images({records:[record('photo.jpg','train')]}, dir);
    assert(result.errors.includes('record_1_unstripped_private_metadata'));
  });
});
test('unsafe outside-root paths fail closed without exposing paths', async () => {
  await runCase(async dir => {
    const result = await inspectV4Images(
      {records:[record('../private.png','test')]}, dir);
    assert(result.errors.includes('record_1_unreadable_or_invalid_image'));
  });
});
test('absent or oversized manifest cannot qualify image content', async () => {
  await runCase(async dir => {
    const a = await inspectV4Images({}, dir);
    assert.equal(a.imageContentVerified, false);
    const b = await inspectV4Images({records:Array.from({length:10001},()=>({}))}, dir);
    assert(b.errors.includes('invalid_or_oversized_manifest'));
  });
});
