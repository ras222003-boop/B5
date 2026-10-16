import { readJson, repo, requireValue as check, finite, nonempty, sha, checkedFile, localPath } from './common.mjs';
import { resolve } from 'node:path';
import { unknownStairsStillMotion } from './stairs-task.mjs';

export const proximityPolicy = await readJson(resolve(repo, 'ml/vision/proximity-policy.v1.json'));
const unit = x => finite(x) && x >= 0 && x <= 1;
const reviewed = r => r?.status === 'reviewed' && nonempty(r.annotator) && nonempty(r.reviewer) &&
  r.annotator !== r.reviewer && Number.isFinite(Date.parse(r.at));

/** Ground-truth label only. Never estimates meters from pixels or a detector score. */
export function proximityClass(distance, policy = proximityPolicy) {
  if (distance?.status !== 'measured' || !finite(distance.meters) || distance.meters <= 0 ||
      !finite(distance.uncertaintyMeters) || distance.uncertaintyMeters < 0 || distance.uncertaintyMeters >= distance.meters)
    return policy.uncertainClass;
  const band = x => policy.boundariesMeters.filter(b => x >= b).length;
  const low = band(distance.meters - distance.uncertaintyMeters), high = band(distance.meters + distance.uncertaintyMeters);
  return low === high ? policy.classes[low] : policy.uncertainClass;
}

/** Future sensor/model adapter. Evidence hashes must resolve to reviewed records before this is integrated. */
export function estimatedProximity(e, nowMs) {
  if (!e || !['depth_sensor', 'calibrated_model'].includes(e.source) || e.status !== 'valid' ||
      !sha(e.calibrationSha256) || !sha(e.errorValidationSha256) || !finite(e.capturedAtMs) || !finite(nowMs) ||
      !finite(e.validForMs) || e.validForMs < 0 || e.validForMs > 800 || nowMs < e.capturedAtMs ||
      nowMs - e.capturedAtMs > e.validForMs) return 'distance_uncertain';
  const range = e.calibrationRangeMeters;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(finite) || range[0] < 0 || range[1] <= range[0] ||
      !finite(e.meters) || !finite(e.uncertaintyMeters) || e.meters - e.uncertaintyMeters < range[0] ||
      e.meters + e.uncertaintyMeters > range[1]) return 'distance_uncertain';
  return proximityClass({ status: 'measured', meters: e.meters, uncertaintyMeters: e.uncertaintyMeters });
}

export const unknownSpatial = () => ({
  distance: { status: 'uncertain', reason: 'not_measured' }, proximity: 'distance_uncertain',
  direction: { reference: 'camera', sector: 'unknown', facing: 'unknown' }
});

async function evidence(e, root, verifyFiles) {
  check(nonempty(e?.path) && sha(e.sha256), 'measurement/motion evidence path and SHA-256 required');
  localPath(root, e.path);
  if (verifyFiles) await checkedFile(root, e.path, e.sha256);
}

export async function validateSpatial(spatial, sample, root, verifyFiles = true) {
  check(spatial && spatial.direction?.reference === 'camera' &&
    ['left', 'center', 'right', 'unknown'].includes(spatial.direction.sector) &&
    ['toward_camera', 'away_from_camera', 'side_on', 'unknown'].includes(spatial.direction.facing), 'invalid camera-relative direction/orientation');
  const d = spatial.distance;
  check(sample.conditions?.motion !== unknownStairsStillMotion || d?.status === 'uncertain',
    'Unknown capture motion stairs stills cannot supply metric distance/calibration evidence');
  check(['measured', 'uncertain'].includes(d?.status), 'distance status required');
  if (d.status === 'uncertain') {
    check(['not_measured', 'occluded', 'calibration_missing', 'out_of_range', 'unsynchronized'].includes(d.reason) &&
      d.meters == null && d.uncertaintyMeters == null, 'uncertain distance must not contain a numeric claim');
  } else {
    check(finite(d.meters) && d.meters > 0 && d.meters <= 200 && finite(d.uncertaintyMeters) &&
      d.uncertaintyMeters >= 0 && d.uncertaintyMeters < d.meters, 'invalid metric measurement/uncertainty');
    check(['tape', 'laser', 'calibrated_depth'].includes(d.method) && d.reference === proximityPolicy.reference &&
      nonempty(d.operator) && nonempty(d.instrumentId) && Number.isFinite(Date.parse(d.measuredAt)) &&
      Number.isFinite(Date.parse(d.capturedAt)) && finite(d.validForMs) && d.validForMs >= 0 && d.validForMs <= 800 &&
      d.validity === 'valid_at_capture', 'measurement provenance and capture validity required');
    check(Math.abs(Date.parse(d.measuredAt) - Date.parse(d.capturedAt)) <= d.validForMs, 'measurement outside capture validity window');
    await evidence(d.evidence, root, verifyFiles);
    if (d.method === 'calibrated_depth') await evidence(d.calibrationEvidence, root, verifyFiles);
    if (sample.media.kind === 'video_frame') check(finite(d.videoTimestampMs) && finite(d.syncErrorMs) &&
      d.syncErrorMs >= 0 && d.syncErrorMs <= proximityPolicy.maxVideoSyncErrorMs &&
      Math.abs(d.videoTimestampMs - sample.media.timestampMs) <= d.syncErrorMs, 'video measurement is not synchronized');
  }
  check(spatial.proximity === proximityClass(d), 'proximity must match measured interval or be distance_uncertain');
}

/** Opt in without fabricating measurements or reviews. Existing labels remain pending for a human. */
export function spatialDraft(data) {
  return { ...data, annotationRevision: `${data.annotationRevision}-spatial-draft`,
    spatialPolicyVersion: proximityPolicy.version, motionSegments: data.motionSegments ?? [],
    samples: data.samples.map(s => ({ ...s, annotation: { ...s.annotation, status: 'pending', reviewer: '', exhaustive: false,
      objects: s.annotation.objects.map(o => ({ ...o, spatial: o.spatial ?? unknownSpatial() })) } })) };
}

export async function validateMotion(data, root, verifyFiles = true) {
  check(Array.isArray(data.motionSegments), 'phase-two motionSegments array required (empty for stills)');
  const ids = new Set();
  for (const m of data.motionSegments) {
    check(nonempty(m.id) && !ids.has(m.id), 'duplicate/empty motion segment id'); ids.add(m.id);
    check(sha(m.videoSha256) && nonempty(m.trackId) && finite(m.startMs) && finite(m.endMs) &&
      m.startMs >= 0 && m.endMs > m.startMs && reviewed(m.review), 'reviewed motion interval required');
    check(['approaching', 'receding', 'lateral_left', 'lateral_right', 'stationary', 'uncertain'].includes(m.relativeMotion) &&
      ['stationary', 'translation', 'rotation', 'zoom', 'mixed', 'unknown'].includes(m.cameraMotion) &&
      ['rotation', 'none', 'unknown'].includes(m.objectRotation), 'invalid object/camera motion labels');
    await evidence(m.evidence, root, verifyFiles);
    const frames = data.samples.filter(s => s.media.kind === 'video_frame' && s.media.video.sha256 === m.videoSha256 &&
      s.media.timestampMs >= m.startMs && s.media.timestampMs <= m.endMs && s.annotation.objects.some(o => o.trackId === m.trackId))
      .sort((a, b) => a.media.timestampMs - b.media.timestampMs);
    check(frames.every(s => s.conditions?.motion !== unknownStairsStillMotion),
      'Unknown capture motion stairs stills cannot supply motion evaluation evidence');
    check(frames.length >= 2 && frames[0].media.timestampMs === m.startMs && frames.at(-1).media.timestampMs === m.endMs,
      'motion interval must have labeled track endpoints in the same video');
    if (['approaching', 'receding'].includes(m.relativeMotion)) {
      const distance = s => s.annotation.objects.find(o => o.trackId === m.trackId).spatial?.distance;
      const a = distance(frames[0]), b = distance(frames.at(-1));
      check(a?.status === 'measured' && b?.status === 'measured', 'approach/recede ground truth requires synchronized endpoint measurements');
      check(m.relativeMotion === 'approaching' ? b.meters + b.uncertaintyMeters < a.meters - a.uncertaintyMeters :
        a.meters + a.uncertaintyMeters < b.meters - b.uncertaintyMeters, 'motion conflicts with measured distance intervals');
    }
  }
}

/** Offline ranking experiment. Its scores are ordering heuristics, not collision probabilities. */
export function rankAlerts(observations, taxonomy, nowMs) {
  check(Array.isArray(observations) && finite(nowMs) && nowMs >= 0, 'observations and clock required');
  const classes = new Map(taxonomy.classes.filter(c => c.kind !== 'surface').map(c => [c.id, c]));
  const rejected = [], ranked = [], ids = new Set();
  for (const o of observations) {
    check(nonempty(o.id) && !ids.has(o.id) && classes.has(o.classId) && unit(o.confidence) && finite(o.observedAtMs), 'invalid priority observation');
    ids.add(o.id);
    const ageMs = nowMs - o.observedAtMs;
    if (ageMs < 0 || ageMs > proximityPolicy.priorityMaxAgeMs) { rejected.push({ id: o.id, reason: ageMs < 0 ? 'future_timestamp' : 'stale' }); continue; }
    const c = classes.get(o.classId), hazardous = c.kind === 'ground_hazard' || c.id === 31;
    const proximity = estimatedProximity(o.metricEstimate, nowMs);
    const direction = o.spatial?.direction?.sector;
    check(['left', 'center', 'right', 'unknown'].includes(direction), 'camera-relative sector required');
    const components = {
      proximity: { very_near: 50, near: 40, medium: 25, far: 10, very_far: 5, distance_uncertain: 30 }[proximity],
      hazard: hazardous ? 60 : [4, 5, 6, 7, 8].includes(c.id) ? 40 : 10,
      direction: direction === 'center' ? 15 : direction === 'unknown' ? 10 : 5,
      motion: o.motionEvidenceVerified === true && o.relativeMotion === 'approaching' ? 25 : 0,
      confidence: 10 * o.confidence, freshness: 10 * (1 - ageMs / proximityPolicy.priorityMaxAgeMs)
    };
    ranked.push({ id: o.id, classId: o.classId, proximity, ageMs, components,
      score: Object.values(components).reduce((a, b) => a + b, 0),
      reviewRequired: proximity === 'distance_uncertain' || o.confidence < .75, metricClaimAllowed: false,
      safePathClaimAllowed: false, userTravelDirection: 'unknown' });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { scope: 'offline-priority-experiment', policyVersion: proximityPolicy.version, ranked, rejected,
    productionActivation: false, collisionProbability: null };
}
