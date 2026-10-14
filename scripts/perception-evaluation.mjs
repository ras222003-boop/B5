#!/usr/bin/env node
/** Offline metrics for fully annotated normalized boxes and semantic masks.
 * This is NOT the official COCO evaluator: no crowd/ignore/area-range handling.
 * See docs/basira-field-evaluation.md for the input contract and limitations.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const thresholds = Array.from({ length: 10 }, (_, i) => (50 + i * 5) / 100);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const ratio = (n, d) => d ? n / d : null;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finite = n => typeof n === 'number' && Number.isFinite(n);
const name = n => typeof n === 'string' && n.trim().length > 0;

function validateBox(box, context) {
  assert(box && ['x', 'y', 'width', 'height'].every(k => finite(box[k])), `${context}: invalid box`);
  assert(box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    box.x + box.width <= 1 + 1e-9 && box.y + box.height <= 1 + 1e-9,
  `${context}: boxes must be normalized xywh within [0,1]`);
}

export function boxIoU(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

function validateSamples(samples) {
  assert(Array.isArray(samples) && samples.length > 0, 'samples must contain at least one annotated frame');
  const ids = new Set();
  for (const sample of samples) {
    assert(name(sample.id) && !ids.has(sample.id), 'sample ids must be nonempty and unique');
    ids.add(sample.id);
    for (const key of ['groundTruth', 'predictions']) {
      assert(Array.isArray(sample[key]), `${sample.id}: ${key} must explicitly be an array, including negative frames`);
      for (const detection of sample[key]) {
        assert(name(detection.class), `${sample.id}: detection class is required`);
        assert(!('iscrowd' in detection) && !('ignore' in detection), 'crowd/ignore annotations require the official COCO evaluator');
        validateBox(detection.box, sample.id);
        if (key === 'predictions') assert(finite(detection.score) && detection.score >= 0 && detection.score <= 1,
          `${sample.id}: prediction score must be in [0,1]`);
      }
    }
  }
}

function matchClass(samples, category, threshold, scoreThreshold, maxDetections) {
  let groundTruthCount = 0;
  const frames = new Map();
  const predictions = [];
  for (const sample of samples) {
    const truth = sample.groundTruth.filter(d => d.class === category);
    groundTruthCount += truth.length;
    frames.set(sample.id, { truth, used: new Set() });
    const selected = sample.predictions.filter(d => d.class === category && d.score >= scoreThreshold)
      .sort((a, b) => b.score - a.score).slice(0, maxDetections);
    predictions.push(...selected.map(d => ({ ...d, frame: sample.id })));
  }
  predictions.sort((a, b) => b.score - a.score);
  let truePositives = 0;
  let falsePositives = 0;
  const points = [];
  for (const prediction of predictions) {
    const frame = frames.get(prediction.frame);
    let best = -1;
    let bestIoU = threshold;
    frame.truth.forEach((truth, index) => {
      if (frame.used.has(index)) return;
      const overlap = boxIoU(prediction.box, truth.box);
      if (overlap >= bestIoU) { best = index; bestIoU = overlap; }
    });
    if (best >= 0) { frame.used.add(best); truePositives++; } else falsePositives++;
    points.push({ recall: ratio(truePositives, groundTruthCount) ?? 0,
      precision: truePositives / (truePositives + falsePositives) });
  }
  let averagePrecision = null;
  if (groundTruthCount) {
    // The precision envelope sampled at 101 recall levels, including zero.
    let total = 0;
    for (let i = 0; i <= 100; i++) {
      let maximum = 0;
      for (const point of points) if (point.recall >= i / 100) maximum = Math.max(maximum, point.precision);
      total += maximum;
    }
    averagePrecision = total / 101;
  }
  return { groundTruthCount, predictions: predictions.length, truePositives, falsePositives,
    falseNegatives: groundTruthCount - truePositives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, groundTruthCount), averagePrecision };
}

export function detectionMetrics(samples, { scoreThreshold = .45, maxDetectionsPerFramePerClass = 100 } = {}) {
  validateSamples(samples);
  assert(finite(scoreThreshold) && scoreThreshold >= 0 && scoreThreshold <= 1, 'invalid scoreThreshold');
  assert(Number.isInteger(maxDetectionsPerFramePerClass) && maxDetectionsPerFramePerClass > 0, 'invalid maxDetectionsPerFramePerClass');
  const categories = [...new Set(samples.flatMap(s => [...s.groundTruth, ...s.predictions].map(d => d.class)))].sort();
  const perClass = categories.map(category => {
    const operating = matchClass(samples, category, .5, scoreThreshold, maxDetectionsPerFramePerClass);
    const ap = thresholds.map(threshold => matchClass(samples, category, threshold, 0, maxDetectionsPerFramePerClass).averagePrecision);
    const { averagePrecision: ignored, ...counts } = operating;
    return { class: category, ...counts, ap50: ap[0], ap50_95: mean(ap.filter(v => v !== null)),
      apByIoU: Object.fromEntries(thresholds.map((t, i) => [t.toFixed(2), ap[i]])) };
  });
  const tp = perClass.reduce((sum, c) => sum + c.truePositives, 0);
  const fp = perClass.reduce((sum, c) => sum + c.falsePositives, 0);
  const fn = perClass.reduce((sum, c) => sum + c.falseNegatives, 0);
  return { frames: samples.length, operatingPoint: { scoreThreshold, iou: .5 },
    maxDetectionsPerFramePerClass, method: '101-point AP; IoU 0.50:0.05:0.95; all exported scores; no crowd/ignore/area ranges; not official COCO',
    truePositives: tp, falsePositives: fp, falseNegatives: fn,
    microPrecision: ratio(tp, tp + fp), microRecall: ratio(tp, tp + fn),
    mAP50: mean(perClass.map(c => c.ap50).filter(v => v !== null)),
    mAP50_95: mean(perClass.map(c => c.ap50_95).filter(v => v !== null)), perClass };
}

export function segmentationMetrics(masks) {
  assert(Array.isArray(masks), 'masks must be an array');
  if (!masks.length) return null;
  const counts = new Map();
  let validPixels = 0;
  for (const mask of masks) {
    const { width, height, groundTruth, prediction, ignoreLabel } = mask;
    assert(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0, 'invalid mask dimensions');
    assert(Array.isArray(groundTruth) && Array.isArray(prediction) && groundTruth.length === width * height && prediction.length === width * height,
      'mask lengths must match width * height');
    assert([...groundTruth, ...prediction].every(n => Number.isSafeInteger(n) && n >= 0), 'mask labels must be nonnegative integers');
    assert(ignoreLabel === undefined || Number.isSafeInteger(ignoreLabel) && ignoreLabel >= 0, 'invalid ignoreLabel');
    const get = label => {
      if (!counts.has(label)) counts.set(label, { label, intersection: 0, truthPixels: 0, predictedPixels: 0 });
      return counts.get(label);
    };
    for (let i = 0; i < groundTruth.length; i++) {
      const truth = groundTruth[i], pred = prediction[i];
      if (truth === ignoreLabel) continue;
      validPixels++;
      get(truth).truthPixels++;
      // Predicting the ignore label over a valid pixel is an error, not an ignored pixel.
      get(pred).predictedPixels++;
      if (truth === pred) get(truth).intersection++;
    }
  }
  const perClass = [...counts.values()].sort((a, b) => a.label - b.label).map(c => ({ ...c,
    iou: ratio(c.intersection, c.truthPixels + c.predictedPixels - c.intersection),
    dice: ratio(2 * c.intersection, c.truthPixels + c.predictedPixels) }));
  return { masks: masks.length, validPixels, aggregation: 'pixel totals per class; macro mean includes false-positive classes',
    meanIoU: mean(perClass.map(c => c.iou).filter(v => v !== null)),
    meanDice: mean(perClass.map(c => c.dice).filter(v => v !== null)), perClass };
}

export function timingMetrics(timing) {
  if (timing === undefined) return null;
  assert(timing && typeof timing === 'object', 'invalid timing');
  const summarize = values => {
    if (values === undefined) return null;
    assert(Array.isArray(values) && values.every(n => finite(n) && n >= 0), 'timing values must be nonnegative finite milliseconds');
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const quantile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    return { count: sorted.length, meanMs: mean(sorted), p50Ms: quantile(.5), p95Ms: quantile(.95), maxMs: sorted.at(-1) };
  };
  const hasWindow = timing.measurementDurationMs !== undefined || timing.framesProcessed !== undefined;
  if (hasWindow) assert(finite(timing.measurementDurationMs) && timing.measurementDurationMs > 0 &&
    Number.isSafeInteger(timing.framesProcessed) && timing.framesProcessed >= 0,
  'FPS requires positive measurementDurationMs and nonnegative integer framesProcessed');
  return { quantileMethod: 'nearest rank', inference: summarize(timing.inferenceMs),
    captureToSpeech: summarize(timing.captureToSpeechMs),
    measurementDurationMs: timing.measurementDurationMs ?? null, framesProcessed: timing.framesProcessed ?? null,
    processedFPS: hasWindow ? timing.framesProcessed * 1000 / timing.measurementDurationMs : null };
}

export function evaluate(input) {
  assert(input?.schemaVersion === 1, 'schemaVersion must be 1');
  assert(input.dataset && name(input.dataset.id) && name(input.dataset.annotationRevision) &&
    ['test', 'validation', 'synthetic'].includes(input.dataset.split), 'dataset id, annotationRevision and split are required');
  assert(input.run && ['model', 'device', 'browser'].every(k => name(input.run[k])), 'run model/device/browser are required');
  const detection = detectionMetrics(input.samples, input.options);
  return { schemaVersion: 1, dataset: input.dataset, run: input.run,
    evidenceScope: input.dataset.split === 'synthetic' ? 'SYNTHETIC: validates arithmetic only; not model accuracy' :
      'ANNOTATED DATA: metadata supplied by operator; no field safety or participant validation implied',
    detection, segmentation: segmentationMetrics(input.samples.filter(s => s.mask).map(s => s.mask)), timing: timingMetrics(input.timing) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath) throw new Error('Usage: node scripts/perception-evaluation.mjs annotations-and-predictions.json [report.json]');
    const report = JSON.stringify(evaluate(JSON.parse(await readFile(inputPath, 'utf8'))), null, 2) + '\n';
    if (outputPath) await writeFile(outputPath, report);
    else process.stdout.write(report);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
