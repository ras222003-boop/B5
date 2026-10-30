/** Image-content preflight, separate from metadata/licence checks.
 * Uses real decodes and detects suspect cross-split near duplicates.
 * Strictly local: no screenshots, pixels, EXIF or image paths are exported.
 */
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { extname } from 'node:path';
import { safeFile } from './intake.mjs';

const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const maximumBytes = 25 * 1024 * 1024;
const maximumPixels = 50_000_000;

function distance(a, b) {
  let x = a ^ b, count = 0;
  while (x > 0n) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

export async function inspectV4Images(manifest, dataRoot) {
  const errors = [];
  const images = [];
  if (!Array.isArray(manifest?.records) || manifest.records.length > 10_000) {
    return {
      imageContentVerified: false,
      inspected: 0,
      nearDuplicateCandidates: 0,
      trainingStarted: false,
      errors: ['invalid_or_oversized_manifest']
    };
  }
  for (const [index, record] of manifest.records.entries()) {
    const prefix = 'record_' + (index + 1) + '_';
    try {
      const file = safeFile(dataRoot, record?.imagePath);
      if (!allowedExtensions.has(extname(file).toLowerCase()) ||
          statSync(file).size > maximumBytes) {
        errors.push(prefix + 'unsupported_image_format_or_size');
        continue;
      }
      const reader = sharp(file, {failOn: 'error', limitInputPixels: maximumPixels, animated: false});
      const metadata = await reader.metadata();
      if (metadata.width !== record.width || metadata.height !== record.height ||
          metadata.pages > 1 || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
        errors.push(prefix + 'decoded_dimensions_or_format_mismatch');
        continue;
      }
      if (metadata.exif?.length || metadata.xmp?.length || metadata.iptc?.length) {
        errors.push(prefix + 'unstripped_private_metadata');
        continue;
      }
      // Decode the image; reading its header alone does not prove valid pixels.
      const {data, info} = await sharp(file, {failOn: 'error', limitInputPixels: maximumPixels})
        .resize(9, 8, {fit: 'fill', kernel: 'nearest'})
        .greyscale().raw().toBuffer({resolveWithObject: true});
      if (info.width !== 9 || info.height !== 8 || info.channels !== 1 || data.length !== 72)
        throw Error('unexpected decoded shape');
      let hash = 0n, total = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          hash = (hash << 1n) | BigInt(data[y * 9 + x] > data[y * 9 + x + 1] ? 1 : 0);
        }
      }
      for (const value of data) total += value;
      const sample = {split: record.split, hash, mean: total / data.length};
      // dHash is a high-recall triage heuristic, NOT proof that these are the
      // same photo. Conservative failures need human/source-scene review.
      for (const old of images) {
        if (old.split !== sample.split && distance(old.hash, sample.hash) <= 2 &&
            Math.abs(old.mean - sample.mean) <= 10) {
          errors.push(prefix + 'cross_split_visual_near_duplicate_review_required');
          break;
        }
      }
      images.push(sample);
    } catch {
      errors.push(prefix + 'unreadable_or_invalid_image');
    }
  }
  return {
    schemaVersion: 1,
    imageContentVerified: errors.length === 0,
    inspected: images.length,
    nearDuplicateCandidates: errors.filter(x => x.endsWith('cross_split_visual_near_duplicate_review_required')).length,
    trainingStarted: false,
    errors
  };
}
