import test from 'node:test';
import assert from 'node:assert/strict';
import { boxIoU, detectionMetrics, segmentationMetrics, timingMetrics, evaluate } from './perception-evaluation.mjs';

// All fixtures below are synthetic arithmetic cases. They are not image/model tests.
const box = { x: .1, y: .1, width: .2, height: .2 };
const gt = (category = 'chair', bounds = box) => ({ class: category, box: bounds });
const pred = (score = .9, category = 'chair', bounds = box) => ({ ...gt(category, bounds), score });
const frame = (groundTruth = [gt()], predictions = [pred()], id = 'frame-1') => ({ id, groundTruth, predictions });

test('perfect detection has AP at all ten IoU thresholds', () => {
  const result = detectionMetrics([frame()]);
  assert.equal(result.mAP50_95, 1);
  assert.equal(result.microPrecision, 1);
  assert.equal(result.microRecall, 1);
  assert.equal(Object.keys(result.perClass[0].apByIoU).length, 10);
});

test('duplicate predictions match one ground truth only', () => {
  const result = detectionMetrics([frame([gt()], [pred(.9), pred(.8)])]);
  assert.equal(result.truePositives, 1);
  assert.equal(result.falsePositives, 1);
  assert.equal(result.microPrecision, .5);
  assert.equal(result.mAP50, 1); // The duplicate follows full recall in the ranking.
});

test('high confidence false positive reduces interpolated AP', () => {
  const remote = { x: .6, y: .6, width: .2, height: .2 };
  const result = detectionMetrics([frame([gt()], [pred(.99, 'chair', remote), pred(.8)])]);
  assert.equal(result.mAP50, .5);
});

test('missing detections and wrong classes are counted without inventing precision', () => {
  const result = detectionMetrics([frame([gt('chair')], [pred(.9, 'car')])]);
  assert.equal(result.microRecall, 0);
  assert.equal(result.mAP50_95, 0);
  assert.equal(result.perClass.find(c => c.class === 'car').ap50, null);
  assert.equal(result.perClass.find(c => c.class === 'chair').precision, null);
});

test('negatives without any ground truth cannot produce an accuracy score', () => {
  const result = detectionMetrics([frame([], [pred()])]);
  assert.equal(result.falsePositives, 1);
  assert.equal(result.mAP50, null);
  assert.equal(result.microRecall, null);
});

test('operating threshold does not censor the AP ranking', () => {
  const result = detectionMetrics([frame([gt()], [pred(.2)])], { scoreThreshold: .8 });
  assert.equal(result.microRecall, 0);
  assert.equal(result.mAP50_95, 1);
});

test('IoU distinguishes partially overlapping localization thresholds', () => {
  const shifted = { ...box, x: .15 };
  assert.ok(Math.abs(boxIoU(box, shifted) - .6) < 1e-10);
  const result = detectionMetrics([frame([gt()], [pred(.9, 'chair', shifted)])]);
  assert.equal(result.perClass[0].apByIoU['0.50'], 1);
  assert.equal(result.perClass[0].apByIoU['0.75'], 0);
});

test('matching never crosses frame boundaries and cap is explicit', () => {
  const result = detectionMetrics([frame([gt()], [], 'a'), frame([], [pred()], 'b')]);
  assert.equal(result.truePositives, 0);
  assert.equal(result.falseNegatives, 1);
  const capped = detectionMetrics([frame([gt()], [pred(.99, 'chair', { ...box, x: .6 }), pred(.8)])], { maxDetectionsPerFramePerClass: 1 });
  assert.equal(capped.microRecall, 0);
});

test('rejects malformed, missing, duplicate and unsupported annotations', () => {
  assert.throws(() => detectionMetrics([]), /annotated frame/);
  assert.throws(() => detectionMetrics([frame(), frame()]), /unique/);
  assert.throws(() => detectionMetrics([{ id: 'a', predictions: [] }]), /explicitly/);
  assert.throws(() => detectionMetrics([frame([gt()], [pred(NaN)])]), /score/);
  assert.throws(() => detectionMetrics([frame([gt('chair', { ...box, width: 2 })])]), /normalized/);
  assert.throws(() => detectionMetrics([frame([{ ...gt(), iscrowd: 1 }])]), /official COCO/);
});

test('segmentation uses intersection, union and Dice with explicit ignore pixels', () => {
  const result = segmentationMetrics([{ width: 2, height: 2, groundTruth: [1, 1, 0, 255], prediction: [1, 0, 0, 1], ignoreLabel: 255 }]);
  assert.equal(result.validPixels, 3);
  assert.equal(result.perClass.find(c => c.label === 1).iou, .5);
  assert.equal(result.perClass.find(c => c.label === 1).dice, 2 / 3);
  assert.equal(result.meanIoU, .5);
  assert.equal(segmentationMetrics([{ width: 1, height: 1, groundTruth: [255], prediction: [1], ignoreLabel: 255 }]).meanIoU, null);
});

test('false-positive mask class and ignored predictions are not silently dropped', () => {
  const result = segmentationMetrics([{ width: 1, height: 1, groundTruth: [1], prediction: [255], ignoreLabel: 255 }]);
  assert.equal(result.meanIoU, 0);
  assert.equal(result.perClass.length, 2);
  assert.throws(() => segmentationMetrics([{ width: 2, height: 1, groundTruth: [1], prediction: [1] }]), /lengths/);
  assert.equal(segmentationMetrics([]), null);
});

test('timing uses nearest-rank p95 and actual processed frame count over observation time', () => {
  const result = timingMetrics({ inferenceMs: Array.from({ length: 20 }, (_, i) => i + 1), framesProcessed: 3, measurementDurationMs: 2000 });
  assert.equal(result.inference.p95Ms, 19);
  assert.equal(result.processedFPS, 1.5);
  assert.equal(result.captureToSpeech, null);
  assert.throws(() => timingMetrics({ framesProcessed: 2 }), /FPS/);
  assert.throws(() => timingMetrics({ inferenceMs: [-1] }), /nonnegative/);
});

test('reports retain provenance and mark synthetic evidence', () => {
  const input = { schemaVersion: 1, dataset: { id: 'arithmetic-fixture', split: 'synthetic', annotationRevision: '1' },
    run: { model: 'none', device: 'none', browser: 'none' }, samples: [frame()] };
  assert.match(evaluate(input).evidenceScope, /SYNTHETIC/);
  assert.equal(evaluate(input).timing, null);
  assert.throws(() => evaluate({ ...input, dataset: {} }), /dataset/);
});
