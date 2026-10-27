/** Offline V4 dataset intake gate. This NEVER trains or publishes models.
 * Input media, licence evidence and private review records MUST remain outside Git.
 */
import { readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const HEX = /^[a-f0-9]{64}$/i;
const splits = ['train', 'validation', 'test'];
const str = value => typeof value === 'string' && value.trim().length > 0;
const bounded = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const unique = items => [...new Set(items)];
const err = (errors, code) => { errors.push(code); };

export function safeFile(root, relativePath) {
  if (!str(relativePath) || isAbsolute(relativePath) || relativePath.includes('\\')) throw Error('unsafe relative path');
  const parts = relativePath.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw Error('unsafe path segment');
  const rootReal = realpathSync(root);
  const real = realpathSync(resolve(rootReal, relativePath));
  const diff = relative(rootReal, real);
  if (!diff || diff.startsWith('..') || isAbsolute(diff)) throw Error('file outside protected data root');
  return real;
}

function verifyFile(root, relativePath, expectedSha, isImage) {
  if (!HEX.test(expectedSha ?? '')) return false;
  try {
    const file = safeFile(root, relativePath);
    const bytes = readFileSync(file);
    if (sha(bytes) !== expectedSha.toLowerCase()) return false;
    if (isImage) {
      const extension = extname(file).toLowerCase();
      const png = extension === '.png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
      const jpeg = ['.jpg', '.jpeg'].includes(extension) && bytes.length > 4 &&
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
      const webp = extension === '.webp' && bytes.subarray(0, 4).toString() === 'RIFF' &&
        bytes.subarray(8, 12).toString() === 'WEBP';
      return png || jpeg || webp;
    }
    return bytes.length > 0;
  } catch { return false; }
}

export function assessV4Intake(manifest, protectedIndex, policy, dataRoot) {
  const errors = [];
  const warnings = [];
  const targets = new Map((policy?.targets || []).map(t => [t.key, t]));
  const selected = manifest?.selectedTargets;
  const records = manifest?.records;
  const totals = Object.fromEntries(splits.map(s => [s, { images: 0, groups: 0, objects: 0 }]));
  const groupSets = Object.fromEntries(splits.map(s => [s, new Set()]));
  const classCounts = Object.fromEntries(splits.map(s => [s, {}]));
  const classGroups = Object.fromEntries(splits.map(s => [s, {}]));
  const seenImages = new Set();
  const groupSplits = new Map();
  const usedIds = new Set();
  if (manifest?.schemaVersion !== 1 || !Array.isArray(records)) err(errors, 'invalid_manifest');
  if (!Array.isArray(selected) || !selected.length || unique(selected).length !== selected.length ||
      selected.some(key => !targets.has(key))) err(errors, 'invalid_target_selection');
  if (!['coco80', 'new-class', 'segmentation-required'].includes(manifest?.experimentKind) ||
      (Array.isArray(selected) && selected.some(key => targets.get(key)?.kind !== manifest.experimentKind)))
    err(errors, 'mixed_or_unsupported_training_heads');
  if (manifest?.modelInitialization?.kind !== policy?.modelStart?.kind ||
      manifest?.modelInitialization?.sha256 !== policy?.modelStart?.sha256)
    err(errors, 'initial_weights_not_approved');
  if (protectedIndex?.schemaVersion !== 1 || protectedIndex?.coverageConfirmed !== true ||
      !str(protectedIndex.reviewedBy) || !Array.isArray(protectedIndex.consumedSha256) ||
      !Array.isArray(protectedIndex.consumedCaptureGroups) ||
      !protectedIndex.consumedSha256.length || !protectedIndex.consumedCaptureGroups.length)
    err(errors, 'missing_historical_final_exclusion_index');
  const oldHashes = new Set(protectedIndex?.consumedSha256 || []);
  const oldGroups = new Set(protectedIndex?.consumedCaptureGroups || []);
  if (!Array.isArray(records)) return { metadataReady: false, intakeReady: false, imageContentVerified: false, trainingStarted: false, promotionEligible: false, errors: unique(errors), warnings, totals, selectedTargetCounts: {} };
  for (const [index, record] of records.entries()) {
    const prefix = 'record_' + (index + 1) + '_';
    const split = record?.split;
    if (!splits.includes(split)) { err(errors, prefix + 'invalid_split'); continue; }
    totals[split].images += 1;
    if (!str(record.id) || usedIds.has(record.id)) err(errors, prefix + 'duplicate_or_empty_id');
    else usedIds.add(record.id);
    if (!str(record.sourceDatasetId) ||
        policy.deniedDatasetIds.includes(String(record.sourceDatasetId).toLowerCase()))
      err(errors, prefix + 'restricted_or_unknown_dataset');
    if (!HEX.test(record.sha256 ?? '') || seenImages.has(record.sha256))
      err(errors, prefix + 'invalid_or_reused_image_hash');
    seenImages.add(record.sha256);
    if (oldHashes.has(record.sha256)) err(errors, prefix + 'consumed_final_image');
    if (!str(record.captureGroupId) || oldGroups.has(record.captureGroupId))
      err(errors, prefix + 'missing_or_consumed_capture_group');
    else {
      if (groupSplits.has(record.captureGroupId) && groupSplits.get(record.captureGroupId) !== split)
        err(errors, prefix + 'capture_group_crosses_splits');
      groupSplits.set(record.captureGroupId, split);
      groupSets[split].add(record.captureGroupId);
    }
    if (!Number.isInteger(record.width) || record.width <= 0 ||
        !Number.isInteger(record.height) || record.height <= 0)
      err(errors, prefix + 'image_dimensions_invalid');
    if (!verifyFile(dataRoot, record.imagePath, record.sha256, true))
      err(errors, prefix + 'image_not_verified');
    const rights = record.rights || {};
    if (!policy.allowedLicenses.includes(rights.licenseId) ||
        rights.commercialTrainingAllowed !== true || !str(rights.sourceOrOwner) ||
        !str(rights.attribution) || !verifyFile(dataRoot, rights.evidencePath, rights.evidenceSha256, false))
      err(errors, prefix + 'licence_evidence_or_rights_unverified');
    if (record.privacy?.metadataStripped !== true ||
        record.privacy?.facesPlatesHandled !== true)
      err(errors, prefix + 'privacy_not_reviewed');
    const review = record.review || {};
    if (![review.rightsBy, review.privacyBy, review.labelsBy, review.independentLabelsBy].every(str) ||
        review.labelsBy === review.independentLabelsBy ||
        [review.rightsApproved, review.privacyApproved, review.labelsApproved, review.independentApproved].some(v => v !== true))
      err(errors, prefix + 'independent_human_review_missing');
    if (record.annotationProvenance !== 'human-reviewed')
      err(errors, prefix + 'model_predictions_not_ground_truth');
    const scope = record.verifiedExhaustiveClasses;
    if (!Array.isArray(scope) || scope.length === 0 ||
        scope.some(key => !targets.has(key)) || unique(scope).length !== scope.length ||
        (Array.isArray(selected) && selected.some(key => !scope.includes(key))))
      err(errors, prefix + 'partial_or_ambiguous_annotation_scope');
    if (!Array.isArray(record.objects)) { err(errors, prefix + 'missing_object_annotations'); continue; }
    for (const object of record.objects) {
      const target = targets.get(object?.classKey);
      if (!target || !scope?.includes(object.classKey)) {
        err(errors, prefix + 'unverified_class_annotation'); continue;
      }
      if (!str(object.shape) || !policy.shapeAttributes.includes(object.shape))
        err(errors, prefix + 'shape_annotation_missing_or_invalid');
      if (target.region === 'bbox') {
        if (!Array.isArray(object.bbox) || object.bbox.length !== 4 || !object.bbox.every(bounded) ||
            object.bbox[2] <= 0 || object.bbox[3] <= 0 ||
            object.bbox[0] + object.bbox[2] > 1.000001 || object.bbox[1] + object.bbox[3] > 1.000001)
          err(errors, prefix + 'invalid_bounding_box');
      } else {
        if (!Array.isArray(object.polygon) || object.polygon.length < 3 ||
            object.polygon.length > 150 || object.polygon.some(point =>
              !Array.isArray(point) || point.length !== 2 || !point.every(bounded)))
          err(errors, prefix + 'boundary_needs_reviewed_polygon');
      }
      totals[split].objects += 1;
      classCounts[split][object.classKey] = (classCounts[split][object.classKey] || 0) + 1;
      if (!classGroups[split][object.classKey]) classGroups[split][object.classKey] = new Set();
      classGroups[split][object.classKey].add(record.captureGroupId);
    }
  }
  const min = policy.splitPolicy.minimumReviewedImagesPerSplit;
  for (const split of splits) {
    totals[split].groups = groupSets[split].size;
    if (totals[split].images < min[split] || totals[split].groups < policy.splitPolicy.minimumSourceGroupsPerSplit)
      err(errors, 'insufficient_independent_' + split);
  }
  const selectedTargetCounts = {};
  for (const key of Array.isArray(selected) ? selected : []) {
    if (!targets.has(key)) continue;
    selectedTargetCounts[key] = {};
    for (const split of splits) {
      const objects = classCounts[split][key] || 0;
      const groups = classGroups[split][key]?.size || 0;
      selectedTargetCounts[key][split] = { objects, captureGroups: groups };
      const minimum = split === 'train' ? 8 : 4;
      if (objects < minimum || groups < 2) err(errors, 'insufficient_' + split + '_target_' + key.replace(/[^a-z0-9]+/gi, '_'));
    }
  }
  if (manifest.experimentKind !== 'coco80')
    warnings.push('New categories or boundaries need their own trained architecture and evaluation; not a COCO80 label remap.');
  warnings.push('Passing an intake preflight does not initiate training, qualify distances, prove walking safety, or authorize release.');
  return { schemaVersion: 1, metadataReady: errors.length === 0, intakeReady: false,
    imageContentVerified: false, trainingStarted: false,
    promotionEligible: false, errors: unique(errors), warnings, totals, selectedTargetCounts };
}

function flag(argv, name) {
  const idx = argv.indexOf('--' + name);
  return idx < 0 || !argv[idx + 1] ? null : argv[idx + 1];
}
async function main() {
  const argv = process.argv.slice(2);
  const manifestPath = flag(argv, 'manifest');
  const dataRoot = flag(argv, 'data-root');
  const historyPath = flag(argv, 'protected-index');
  const reportPath = flag(argv, 'report');
  if (!manifestPath || !dataRoot || !historyPath) {
    process.stderr.write('Usage: node scripts/vision-object-finetune-v4/intake.mjs --manifest PRIVATE/manifest.json --data-root PRIVATE --protected-index PRIVATE/protected-index.json [--report PRIVATE/readiness.json]\n');
    process.exitCode = 2; return;
  }
  const policyPath = resolve('ml/vision/objects-v4-targets.v1.json');
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const metadataReport = assessV4Intake(
      manifest,
      JSON.parse(readFileSync(historyPath, 'utf8')),
      JSON.parse(readFileSync(policyPath, 'utf8')),
      dataRoot
    );
    const { inspectV4Images } = await import('./image-preflight.mjs');
    const imageReport = await inspectV4Images(manifest, dataRoot);
    const report = {
      ...metadataReport,
      imageContentVerified: imageReport.imageContentVerified,
      inspectedDecodedImages: imageReport.inspected,
      crossSplitVisualReviewCandidates: imageReport.nearDuplicateCandidates,
      intakeReady: metadataReport.metadataReady && imageReport.imageContentVerified,
      errors: [...metadataReport.errors, ...imageReport.errors],
    };
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.intakeReady) process.exitCode = 1;
  } catch (error) {
    process.stderr.write('Offline intake preflight failed: ' + error.message + '\n');
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
