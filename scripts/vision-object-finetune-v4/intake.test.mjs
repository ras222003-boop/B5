import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assessV4Intake, safeFile } from './intake.mjs';

const policy = JSON.parse(readFileSync(fileURLToPath(new URL('../../ml/vision/objects-v4-targets.v1.json', import.meta.url)), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function sampleData(selectedTargets = ['chair']) {
  const dir = mkdtempSync(join(tmpdir(), 'basira-v4-intake-'));
  const evidence = Buffer.from('Original publisher licence/rights evidence; fixture only');
  writeFileSync(join(dir, 'rights.txt'), evidence);
  const records = [];
  let index = 0;
  for (const [split, size] of [['train', 40], ['validation', 15], ['test', 20]]) {
    for (let j = 0; j < size; j++) {
      const id = ++index;
      const image = Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fixture-' + String(id))
      ]);
      const imagePath = 'img' + id + '.png';
      writeFileSync(join(dir, imagePath), image);
      const objects = selectedTargets.map(key => ({
        classKey: key,
        shape: 'rectangular',
        ...(policy.targets.find(t => t.key === key).region === 'polygon'
          ? { polygon: [[0.1, 0.2], [0.3, 0.2], [0.2, 0.3]] }
          : { bbox: [0.1, 0.2, 0.3, 0.4] })
      }));
      records.push({
        id: 'sample-' + id, split, captureGroupId: split + '-session-' + (j % 2),
        imagePath, sha256: sha(image), width: 640, height: 480,
        rights: {
          licenseId: 'OWNED-WITH-RELEASE', commercialTrainingAllowed: true,
          evidencePath: 'rights.txt', evidenceSha256: sha(evidence),
          sourceOrOwner: 'Test fixture author', attribution: 'Fixture only'
        },
        privacy: { metadataStripped: true, facesPlatesHandled: true },
        review: {
          rightsBy: 'reviewer-a', privacyBy: 'reviewer-b',
          labelsBy: 'annotator-c', independentLabelsBy: 'reviewer-d',
          rightsApproved: true, privacyApproved: true,
          labelsApproved: true, independentApproved: true
        },
        annotationProvenance: 'human-reviewed',
        verifiedExhaustiveClasses: [...selectedTargets],
        objects
      });
    }
  }
  const manifest = { schemaVersion: 1, experimentKind: policy.targets.find(t => t.key === selectedTargets[0]).kind,
    selectedTargets, modelInitialization: structuredClone(policy.modelStart), records };
  const historical = { schemaVersion: 1, coverageConfirmed: true, reviewedBy: 'historical-reviewer',
    consumedSha256: ['a'.repeat(64)], consumedCaptureGroups: ['legacy-final-scene'] };
  return { dir, manifest, historical };
}

function withSamples(selectedTargets, fn) {
  const data = sampleData(selectedTargets);
  try { fn(data); } finally { rmSync(data.dir, { recursive: true, force: true }); }
}

test('clean independent chair intake meets minimum metadata readiness but never trains or publishes', () => {
  withSamples(['chair'], ({dir, manifest, historical}) => {
    const report = assessV4Intake(manifest, historical, policy, dir);
    assert.deepEqual(report.errors, []);
    assert.equal(report.intakeReady, true);
    assert.equal(report.trainingStarted, false);
    assert.equal(report.promotionEligible, false);
    assert.equal(report.totals.test.images, 20);
    assert.equal(report.selectedTargetCounts.chair.test.objects, 20);
  });
});
test('actual image bytes, not filenames, are mandatory', () => {
  withSamples(['chair'], ({dir, manifest, historical}) => {
    writeFileSync(join(dir, manifest.records[0].imagePath), 'changed');
    assert(assessV4Intake(manifest, historical, policy, dir).errors.some(e => e.endsWith('image_not_verified')));
  });
});
test('reused final hashes and source groups are forbidden', () => {
  withSamples(['chair'], ({dir, manifest, historical}) => {
    historical.consumedSha256.push(manifest.records[0].sha256);
    historical.consumedCaptureGroups.push(manifest.records[1].captureGroupId);
    const errors = assessV4Intake(manifest, historical, policy, dir).errors;
    assert(errors.some(e => e.endsWith('consumed_final_image')));
    assert(errors.some(e => e.endsWith('missing_or_consumed_capture_group')));
  });
});
test('capture sessions cannot be split between train and test', () => {
  withSamples(['chair'], ({dir, manifest, historical}) => {
    manifest.records.at(-1).captureGroupId = manifest.records[0].captureGroupId;
    assert(assessV4Intake(manifest, historical, policy, dir).errors.some(e => e.endsWith('capture_group_crosses_splits')));
  });
});
test('non-commercial rights, missing independent reviewers and AI labels all block intake', () => {
  withSamples(['chair'], ({dir, manifest, historical}) => {
    const first = manifest.records[0];
    first.rights.commercialTrainingAllowed = false;
    first.review.independentLabelsBy = first.review.labelsBy;
    first.annotationProvenance = 'model-generated';
    const errors = assessV4Intake(manifest, historical, policy, dir).errors;
    assert(errors.some(e => e.endsWith('licence_evidence_or_rights_unverified')));
    assert(errors.some(e => e.endsWith('independent_human_review_missing')));
    assert(errors.some(e => e.endsWith('model_predictions_not_ground_truth')));
  });
});
test('partially labelled samples and impossible geometry are rejected', () => {
  withSamples(['chair', 'book'], ({dir, manifest, historical}) => {
    const first = manifest.records[0];
    first.verifiedExhaustiveClasses = ['chair'];
    first.objects[0].bbox = [0.9, 0.9, 0.3, 0.2];
    const errors = assessV4Intake(manifest, historical, policy, dir).errors;
    assert(errors.some(e => e.endsWith('partial_or_ambiguous_annotation_scope')));
    assert(errors.some(e => e.endsWith('invalid_bounding_box')));
    assert(errors.some(e => e.endsWith('unverified_class_annotation')));
  });
});
test('new tree label cannot be mapped into the existing COCO80 detector', () => {
  withSamples(['tree'], ({dir, manifest, historical}) => {
    manifest.experimentKind = 'coco80';
    const report = assessV4Intake(manifest, historical, policy, dir);
    assert(report.errors.includes('mixed_or_unsupported_training_heads'));
    assert.equal(report.intakeReady, false);
  });
});
test('curb boundary requires reviewed polygon; bbox alone is not enough', () => {
  withSamples(['curb_edge'], ({dir, manifest, historical}) => {
    const first = manifest.records[0];
    delete first.objects[0].polygon;
    first.objects[0].bbox = [0.1, 0.1, 0.2, 0.2];
    const errors = assessV4Intake(manifest, historical, policy, dir).errors;
    assert(errors.some(e => e.endsWith('boundary_needs_reviewed_polygon')));
  });
});
test('missing historical exclusion index and empty intake never become ready', () => {
  withSamples(['chair'], ({dir, manifest}) => {
    const noHistory = assessV4Intake(manifest, {}, policy, dir);
    assert(noHistory.errors.includes('missing_historical_final_exclusion_index'));
    const empty = assessV4Intake({...manifest, records: []}, {}, policy, dir);
    assert.equal(empty.intakeReady, false);
    assert(empty.errors.includes('insufficient_independent_train'));
  });
});
test('path traversal and symlink escapes are not accepted', () => {
  withSamples(['chair'], ({dir, manifest, historical}) => {
    assert.throws(() => safeFile(dir, '../unrelated-private-file'));
    manifest.records[0].imagePath = '../unrelated-private-file';
    assert(assessV4Intake(manifest, historical, policy, dir).errors.some(e => e.endsWith('image_not_verified')));
  });
});
