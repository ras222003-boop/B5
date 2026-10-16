import { detectionMetrics, timingMetrics, boxIoU } from '../perception-evaluation.mjs';
import { readJson, jsonHash, fileHash, requireValue as check, nonempty, sha, finite, asBox, validBox, taxonomyPath } from './common.mjs';
import { validateDataset } from './data.mjs';
import { stairsTruth, stairsMetrics } from './stairs-task.mjs';

export async function evaluateRun(data, root, run, { verifyFiles = true, allowSynthetic = false } = {}) {
  const quality = await validateDataset(data, root, { verifyFiles, allowSynthetic });
  const taxonomy = await readJson(taxonomyPath);
  const stairs = run.task === 'basira-stairs-v1';
  check(run.task == null || stairs, 'unsupported evaluation task');
  const taskPolicy = stairs ? await readJson(new URL('../../ml/vision/stairs-task.v1.json', import.meta.url)) : null;
  if (stairs) check(run.taskPolicySha256 === await fileHash(new URL('../../ml/vision/stairs-task.v1.json', import.meta.url)), 'stairs policy hash mismatch');
  check(run.schemaVersion === 1 && ['validation', 'test'].includes(run.split), 'only validation/test evaluation allowed');
  check(run.datasetSha256 === quality.datasetSha256 && run.taxonomySha256 === quality.taxonomySha256, 'evaluation data/taxonomy hash mismatch');
  check(sha(run.modelSha256) && nonempty(run.modelVersion) && nonempty(run.sourceCommit) && nonempty(run.device) &&
    nonempty(run.browser) && nonempty(run.backend) && nonempty(run.protocol), 'run provenance required');
  check(run.scoreThreshold === .45 && run.maxDetections === 12 && run.nmsIoU === .6, 'deployed comparison contract: score=.45, max=12, NMS=.6');
  const selected = data.samples.filter(s => s.split === run.split), samplesById = new Map(selected.map(s => [s.id, s]));
  check(Array.isArray(run.samples) && run.samples.length === selected.length, 'every held-out frame required, including misses/negatives');
  const classes = stairs ? new Map(taskPolicy.categories.map(c=>[c.id,c.name])) : new Map(taxonomy.classes.filter(c => c.kind !== 'surface').map(c => [c.id, c.key]));
  const ids = new Set(), times = [];
  const samples = run.samples.map(p => {
    const s = samplesById.get(p.id);
    check(s && !ids.has(p.id) && p.imageSha256 === s.sha256, 'duplicate/unknown frame or wrong image hash'); ids.add(p.id);
    check(finite(p.inferenceMs) && p.inferenceMs >= 0 && Array.isArray(p.predictions) && p.predictions.length <= 12, 'invalid predictions/timing');
    times.push(p.inferenceMs);
    const predictions = p.predictions.map(o => {
      check((classes.has(o.classId) || o.classId === -1) && validBox(o.box) && finite(o.score) && o.score >= .45 && o.score <= 1, 'invalid prediction');
      return { class: classes.get(o.classId) ?? '__unmapped__', box: asBox(o.box), score: o.score };
    });
    return { id: s.id, groundTruth: (stairs ? stairsTruth(s) : s.annotation.objects).map(o => ({ class: classes.get(o.classId), box: asBox(o.box) })), predictions };
  });
  check(finite(run.measurementDurationMs) && run.measurementDurationMs > 0 &&
    run.measurementDurationMs + 1 >= times.reduce((n, t) => n + t, 0), 'invalid measurement window');
  const metrics = detectionMetrics(samples);
  const slices = {};
  for (const key of ['lighting', 'scene', 'motion']) {
    for (const value of new Set(selected.map(s => s.conditions[key]))) {
      const subset = samples.filter(s => samplesById.get(s.id).conditions[key] === value);
      slices[`${key}:${value}`] = detectionMetrics(subset);
    }
  }
  // Object-size recall uses full-frame matching, so unrelated boxes do not become artificial false positives.
  const sizeRecall = Object.fromEntries(['small', 'medium', 'large'].map(k => [k, { truth: 0, matched: 0, recall: null }]));
  for (const s of samples) {
    const used = new Set();
    for (const p of [...s.predictions].sort((a, b) => b.score - a.score)) {
      let best = -1, overlap = .5;
      s.groundTruth.forEach((g, i) => { const iou = boxIoU(p.box, g.box); if (!used.has(i) && g.class === p.class && iou >= overlap) { best = i; overlap = iou; } });
      if (best >= 0) used.add(best);
    }
    s.groundTruth.forEach((g, i) => { const a = g.box.width * g.box.height;
      const bucket = sizeRecall[a < .01 ? 'small' : a < .1 ? 'medium' : 'large']; bucket.truth++; if (used.has(i)) bucket.matched++; });
  }
  for (const b of Object.values(sizeRecall)) b.recall = b.truth ? b.matched / b.truth : null;
  const negativeFrames = samples.filter(s => !s.groundTruth.length);
  return { schemaVersion: 1, scope: data.contentKind === 'synthetic' ? 'synthetic-arithmetic-only' : 'offline-held-out-detection',
    datasetSha256: quality.datasetSha256, taxonomySha256: await fileHash(taxonomyPath), split: run.split,
    runSha256: jsonHash(run), run: Object.fromEntries(Object.entries(run).filter(([k]) => k !== 'samples')),
    task: stairs ? {id:run.task,policySha256:run.taskPolicySha256} : null,
    stairs: stairs ? stairsMetrics(samples) : null,
    detection: metrics, slices, sizeRecall, negativeFrames: { count: negativeFrames.length,
      falsePositiveFrames: negativeFrames.filter(s => s.predictions.length).length },
    timing: timingMetrics({ inferenceMs: times, measurementDurationMs: run.measurementDurationMs, framesProcessed: samples.length }),
    apLimitation: 'AP is truncated at deployed score=.45 and max=12. Not full-score AP or official COCO. Compare only this protocol.',
    fpsLimitation: 'Sequential still/frame replay throughput includes decode and scheduling. Not live camera FPS, tracking or thermal validation.',
    mobile: null, tracking: null, approach: null, segmentation: null, warnings: quality.warnings };
}

export function compareReports(baseline, candidate) {
  check(baseline.schemaVersion === 1 && candidate.schemaVersion === 1, 'invalid report');
  for (const key of ['datasetSha256', 'taxonomySha256', 'split', 'scope']) check(baseline[key] === candidate[key], `comparison mismatch: ${key}`);
  check(JSON.stringify(baseline.task??null) === JSON.stringify(candidate.task??null), 'comparison task mismatch');
  for (const key of ['device', 'browser', 'protocol', 'scoreThreshold', 'maxDetections', 'nmsIoU'])
    check(baseline.run[key] === candidate.run[key], `comparison mismatch: ${key}`);
  const delta = (a, b) => a === null || b === null ? null : b - a;
  return { schemaVersion: 1, scope: baseline.scope, baselineModel: baseline.run.modelVersion, candidateModel: candidate.run.modelVersion,
    datasetSha256: baseline.datasetSha256, baselineReportSha256: jsonHash(baseline), candidateReportSha256: jsonHash(candidate),
    deltaCandidateMinusBaseline: { mAP50: delta(baseline.detection.mAP50, candidate.detection.mAP50),
      mAP50_95: delta(baseline.detection.mAP50_95, candidate.detection.mAP50_95),
      recall: delta(baseline.detection.microRecall, candidate.detection.microRecall),
      precision: delta(baseline.detection.microPrecision, candidate.detection.microPrecision),
      p95Ms: delta(baseline.timing.inference.p95Ms, candidate.timing.inference.p95Ms) },
    perClass: [...new Set([...baseline.detection.perClass, ...candidate.detection.perClass].map(c => c.class))].map(key => ({ class: key,
      baseline: baseline.detection.perClass.find(c => c.class === key) ?? null, candidate: candidate.detection.perClass.find(c => c.class === key) ?? null })),
    decision: 'REVIEW_REQUIRED: no automatic promotion; inspect class/slice regressions and phone evidence',
    mobileAcceptance: false, approachAcceptance: false };
}

/** Gate for manually exported, synchronized phone traces; never enables a production feature. */
export function phoneGate(trace) {
  check(trace?.schemaVersion === 1 && nonempty(trace.device) && nonempty(trace.browser) && sha(trace.modelSha256) &&
    trace.physicalDevice === true && finite(trace.durationMs) && trace.durationMs >= 600_000, 'physical phone trace of at least 10 minutes required');
  check(Array.isArray(trace.frames) && trace.frames.length > 1, 'completed unique frame trace required');
  const ids = new Set(), gaps = [], ages = [];
  let previous = -Infinity, lastComplete = -Infinity;
  for (const f of trace.frames) {
    check(nonempty(f.id) && !ids.has(f.id) && finite(f.capturedAtMs) && finite(f.completedAtMs) && f.capturedAtMs >= 0 &&
      f.capturedAtMs > previous && f.completedAtMs >= f.capturedAtMs && f.completedAtMs >= lastComplete && f.completedAtMs <= trace.durationMs, 'invalid/repeated/out-of-order phone frame');
    if (ids.size) gaps.push(f.capturedAtMs - previous);
    ids.add(f.id); previous = f.capturedAtMs; lastComplete = f.completedAtMs; ages.push(f.completedAtMs - f.capturedAtMs);
  }
  const quantile = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
  const fps = ids.size * 1000 / trace.durationMs;
  const metrics = { completedFPS: fps, p95GapMs: quantile(gaps), maxGapMs: Math.max(...gaps), p95AgeMs: quantile(ages),
    gapsOutsideApproachWindow: gaps.filter(v => v < 40 || v > 350).length };
  const reasons = [];
  if (trace.frames[0].capturedAtMs > 350 || trace.durationMs - lastComplete > 350) reasons.push('UNOBSERVED_WINDOW_BOUNDARY');
  if (fps < 4 || metrics.p95GapMs > 300 || metrics.maxGapMs > 350 || metrics.p95AgeMs > 500 || ages.some(v => v > 800)) reasons.push('FPS_OR_FRESHNESS');
  const t = trace.tracking;
  check(t && Number.isSafeInteger(t.idSwitches) && t.idSwitches >= 0 && finite(t.labeledMinutes) && t.labeledMinutes > 0 &&
    t.labeledMinutes <= trace.durationMs / 60000 && sha(t.groundTruthSha256), 'tracking ground truth evidence required');
  if (t.idSwitches / t.labeledMinutes > 1) reasons.push('TRACK_ID_SWITCHES');
  if (trace.thermalStable !== true || trace.batteryMeasured !== true) reasons.push('THERMAL_OR_BATTERY_EVIDENCE');
  if (trace.zoomRotationOcclusionTestsPassed !== true || trace.falseApproachReviewPassed !== true) reasons.push('MOTION_NEGATIVE_CONTROLS');
  return { schemaVersion: 1, metrics, reasons, engineeringGate: reasons.length ? 'FAIL' : 'PASS_PENDING_FIELD_REVIEW',
    enableApproach: false, note: 'Proposed phase-2 engineering targets, not safety certification. Per-frame runtime gates remain mandatory.' };
}
