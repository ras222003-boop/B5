import type { MetricDepthMap, VisionDetection } from '@shared/vision';
import { metricDepthForDetection } from './fusion';
import { validNormalizedBox } from './objectTracking';
import { validMetricThresholds } from './approachPreferences';
import type { VisualApproachObservation } from './visualApproach';

export type ApproachSensitivity = 'LOW' | 'BALANCED' | 'HIGH';
export type ApproachAlertMode = 'RELATIVE' | 'TRUSTED_METRIC';
export type ApproachRiskLevel = 'UNAVAILABLE' | 'NONE' | 'ATTENTION' | 'HIGH' | 'URGENT';
export type PathRelation = 'POSSIBLE' | 'OUTSIDE' | 'UNKNOWN';
export interface MetricAlertThresholds { caution: number; high: number; critical: number }
export interface ApproachRiskContext {
  frameId: string;
  capturedAt: number;
  now: number;
  /** Only a trusted RGB-aligned hardware map from this camera frame is accepted. */
  metricDepth?: MetricDepthMap | null;
  mode?: ApproachAlertMode;
  sensitivity?: ApproachSensitivity;
  metricThresholdsMeters?: MetricAlertThresholds;
  /** Image corridor is a weak proxy for a possible walking path, never a safe-path result. */
  pathCorridor?: { left: number; right: number };
}
export interface ApproachRiskAssessment {
  trackId: string;
  type: VisionDetection['type'];
  frameId: string;
  capturedAt: number;
  level: ApproachRiskLevel;
  pathRelation: PathRelation;
  metricMeters: number | null;
  metricSource: MetricDepthMap['source'] | null;
  /** Optical/metric time-to-contact approximation; never a collision prediction. */
  approximateTtcSeconds: number | null;
  evidence: readonly ('TRACKED_IDENTITY' | 'COMPENSATED_FLOW' | 'BOX_EXPANSION' | 'POSSIBLE_IMAGE_PATH' | 'SYNCHRONIZED_METRIC_DEPTH' | 'METRIC_CLOSING_TREND')[];
  reasons: readonly ('STALE_FRAME' | 'UNSTABLE_TRACK' | 'NO_MOTION_EVIDENCE' | 'OUTSIDE_IMAGE_PATH' | 'NO_TRUSTED_METRIC_DEPTH' | 'NO_METRIC_CLOSING_TREND' | 'CONFLICTING_TTC')[];
  experimental: true;
}
export interface ApproachRiskResult {
  risks: ApproachRiskAssessment[];
  /** An event only when a credible level rises after stabilization and cooldown. */
  alert: ApproachRiskAssessment | null;
  status: 'UNAVAILABLE' | 'NO_APPROACH_EVIDENCE' | 'APPROACH_EVIDENCE';
}

type Level = Exclude<ApproachRiskLevel, 'UNAVAILABLE'>;
interface MetricSample { at: number; meters: number }
interface TrackState {
  type: VisionDetection['type']; source: VisionDetection['source']; cocoClass?: string; firstSeenAt: number;
  at: number; cx: number; level: Level; pending: Level | null; pendingCount: number;
  metric: MetricSample[];
}
const rank: Record<Level, number> = { NONE: 0, ATTENTION: 1, HIGH: 2, URGENT: 3 };
const defaults: MetricAlertThresholds = { caution: 2.5, high: 1.5, critical: .8 };
const evidenceFor = (approach: VisualApproachObservation) =>
  approach.experimental === true && approach.reasons.length === 0 &&
  approach.evidence.includes('TRACKING') && approach.evidence.includes('BOX_EXPANSION') &&
  approach.evidence.includes('COMPENSATED_OPTICAL_FLOW') &&
  (approach.state === 'POSSIBLE_APPROACH' || approach.state === 'STRONG_APPROACH');
const validThresholds = (value?: MetricAlertThresholds): MetricAlertThresholds =>
  value && validMetricThresholds(value) ? value : defaults;
function metricClosing(samples: readonly MetricSample[]): { speed: number; ttc: number } | null {
  if (samples.length < 3) return null;
  const first = samples[0], last = samples[samples.length - 1], elapsed = (last.at - first.at) / 1000;
  if (elapsed < .35 || elapsed > 1.6 || first.meters - last.meters < .15) return null;
  // Reject a noisy or reversing sequence, even when the endpoints suggest closing.
  if (samples.some((sample, index) => index > 0 && sample.meters - samples[index - 1].meters > .06)) return null;
  const speed = (first.meters - last.meters) / elapsed;
  return speed >= .2 && speed <= 3.5 ? { speed, ttc: last.meters / speed } : null;
}
function corridorRelation(detection: VisionDetection, state: TrackState | undefined, at: number,
  corridor: { left: number; right: number }, ttc: number | undefined): PathRelation {
  if (!validNormalizedBox(detection.boundingBox)) return 'UNKNOWN';
  const box = detection.boundingBox, center = box.x + box.width / 2;
  const covered = Math.max(0, Math.min(box.x + box.width, corridor.right) - Math.max(box.x, corridor.left));
  if (covered / box.width < .25) return 'OUTSIDE';
  if (state && at > state.at) {
    const sideways = (center - state.cx) / ((at - state.at) / 1000);
    const projected = center + sideways * Math.min(ttc ?? .8, 1);
    if (Math.abs(sideways) > .15 && (projected < corridor.left - .05 || projected > corridor.right + .05)) return 'OUTSIDE';
  }
  return 'POSSIBLE';
}

/** Experimental approach cues. A detection, large box or nearby surface alone never produces an alert. */
export class SmartApproachRiskEngine {
  private tracks = new Map<string, TrackState>();
  private announced = new Map<string, { level: Level; at: number }>();
  private lastFrameId = '';
  private lastAt = -Infinity;
  private mode: ApproachAlertMode | null = null;
  reset() { this.tracks.clear(); this.announced.clear(); this.lastFrameId = ''; this.lastAt = -Infinity; this.mode = null; }

  update(detections: readonly VisionDetection[], approaches: readonly VisualApproachObservation[],
    context: ApproachRiskContext): ApproachRiskResult {
    const { frameId, capturedAt, now } = context;
    if (!frameId || ![capturedAt, now].every(Number.isFinite) || capturedAt > now + 5 ||
      now - capturedAt > 800 || frameId === this.lastFrameId || capturedAt <= this.lastAt) {
      this.tracks.clear();
      return { risks: [], alert: null, status: 'UNAVAILABLE' };
    }
    this.lastFrameId = frameId; this.lastAt = capturedAt;
    const mode = context.mode ?? 'RELATIVE';
    if (this.mode !== null && this.mode !== mode) { this.tracks.clear(); this.announced.clear(); }
    this.mode = mode;
    const corridor = context.pathCorridor && Number.isFinite(context.pathCorridor.left) &&
      Number.isFinite(context.pathCorridor.right) && context.pathCorridor.left >= 0 &&
      context.pathCorridor.right <= 1 && context.pathCorridor.right - context.pathCorridor.left >= .1
      ? context.pathCorridor : { left: .36, right: .64 };
    const thresholds = validThresholds(context.metricThresholdsMeters);
    const risks: ApproachRiskAssessment[] = [], seen = new Set<string>(), promoted = new Set<string>();
    for (const detection of detections) {
      if (!detection.trackId || seen.has(detection.trackId)) continue;
      const trackId = detection.trackId; seen.add(trackId);
      const earlier = this.tracks.get(trackId);
      const compatible = earlier && earlier.type === detection.type && earlier.source === detection.source &&
        earlier.cocoClass === detection.cocoClass && earlier.firstSeenAt === detection.tracking?.firstSeenAt &&
        capturedAt - earlier.at <= 500 ? earlier : undefined;
      const reasons: ApproachRiskAssessment['reasons'][number][] = [];
      const evidence: ApproachRiskAssessment['evidence'][number][] = [];
      const fresh = Number.isFinite(detection.timestamp) && Math.abs(detection.timestamp - capturedAt) <= 5;
      const tracked = fresh && detection.source === 'OBJECT_DETECTOR' && !detection.experimental &&
        detection.tracking?.state === 'TRACKED' && detection.tracking.observations >= 3 &&
        Number.isFinite(detection.confidence) && detection.confidence >= .75 && detection.confidence <= 1 &&
        validNormalizedBox(detection.boundingBox);
      if (!fresh) reasons.push('STALE_FRAME');
      if (!tracked) reasons.push('UNSTABLE_TRACK');
      if (tracked) evidence.push('TRACKED_IDENTITY');
      const approach = approaches.find(item => item.trackId === trackId && item.type === detection.type &&
        item.frameId === frameId && item.capturedAt === capturedAt);
      const approaching = !!approach && evidenceFor(approach);
      if (!approaching) reasons.push('NO_MOTION_EVIDENCE');
      else evidence.push('COMPENSATED_FLOW', 'BOX_EXPANSION');
      const opticalTtc = approach?.opticalTtcSeconds;
      const usableOpticalTtc = Number.isFinite(opticalTtc) && opticalTtc! >= .3 && opticalTtc! <= 20 ? opticalTtc : undefined;
      const pathRelation = tracked ? corridorRelation(detection, compatible, capturedAt, corridor, usableOpticalTtc) : 'UNKNOWN';
      if (pathRelation === 'POSSIBLE') evidence.push('POSSIBLE_IMAGE_PATH');
      else if (pathRelation === 'OUTSIDE') reasons.push('OUTSIDE_IMAGE_PATH');

      const map = context.metricDepth;
      const aligned = map?.alignmentVerified === true && Number.isFinite(map.timestamp) &&
        Math.abs(map.timestamp - capturedAt) <= 50;
      const reading = tracked && aligned ? metricDepthForDetection(detection, map!) : null;
      const metricMeters = reading && reading.source !== 'MONOCULAR_ESTIMATE' &&
        Number.isFinite(reading.distanceMeters) && reading.confidence >= .75 ? reading.distanceMeters : null;
      if (metricMeters !== null) evidence.push('SYNCHRONIZED_METRIC_DEPTH');
      else if (mode === 'TRUSTED_METRIC') reasons.push('NO_TRUSTED_METRIC_DEPTH');
      const metric = compatible?.metric ? [...compatible.metric] : [];
      if (metricMeters === null) metric.length = 0;
      else { metric.push({ at: capturedAt, meters: metricMeters }); while (metric.length > 5) metric.shift(); }
      const closing = metricClosing(metric);
      if (closing) evidence.push('METRIC_CLOSING_TREND');
      let conflictingTtc = false;
      if (closing && usableOpticalTtc !== undefined) {
        const ratio = closing.ttc / usableOpticalTtc;
        conflictingTtc = ratio < .4 || ratio > 2.5;
        if (conflictingTtc) reasons.push('CONFLICTING_TTC');
      }

      let candidate: Level | 'UNAVAILABLE' = 'UNAVAILABLE';
      if (tracked && pathRelation === 'POSSIBLE' && (mode === 'RELATIVE' || metricMeters !== null)) {
        if (!approaching) {
          candidate = approach?.state === 'OBSERVED' && approach.reasons.every(reason => reason === 'NO_CORROBORATED_EXPANSION') ? 'NONE' : 'UNAVAILABLE';
        } else {
          candidate = 'ATTENTION';
          if (mode === 'TRUSTED_METRIC') {
            if (metricMeters! > thresholds.caution) candidate = 'NONE';
            else if (approach!.state === 'STRONG_APPROACH' && closing && !conflictingTtc &&
              metricMeters! <= thresholds.high && usableOpticalTtc !== undefined && usableOpticalTtc <= 6) {
              candidate = 'HIGH';
              if (metricMeters! <= thresholds.critical && closing.ttc <= 2.5 && usableOpticalTtc <= 2.5)
                candidate = 'URGENT';
            } else if (!closing) reasons.push('NO_METRIC_CLOSING_TREND');
          } else if (approach!.state === 'STRONG_APPROACH' && usableOpticalTtc !== undefined &&
            usableOpticalTtc <= (context.sensitivity === 'HIGH' ? 8 : context.sensitivity === 'LOW' ? 4 : 6))
            candidate = 'HIGH';
          if (context.sensitivity === 'LOW' && candidate === 'ATTENTION' && approach!.state !== 'STRONG_APPROACH') candidate = 'NONE';
        }
      } else if (tracked && pathRelation === 'OUTSIDE') candidate = 'NONE';

      // Loss of evidence cancels haptics immediately; rising levels require repeated good frames.
      let level: ApproachRiskLevel = candidate;
      if (candidate === 'UNAVAILABLE' || candidate === 'NONE') this.tracks.delete(trackId);
      else {
        const state: TrackState = compatible ?? { type: detection.type, source: detection.source,
          cocoClass: detection.cocoClass, firstSeenAt: detection.tracking!.firstSeenAt,
          at: capturedAt, cx: detection.boundingBox.x + detection.boundingBox.width / 2,
          level: 'NONE', pending: null, pendingCount: 0, metric: [] };
        if (rank[candidate] > rank[state.level]) {
          state.pendingCount = state.pending === candidate ? state.pendingCount + 1 : 1;
          state.pending = candidate;
          if (state.pendingCount >= (context.sensitivity === 'LOW' ? 3 : 2)) {
            state.level = candidate; state.pending = null; state.pendingCount = 0; promoted.add(trackId);
          }
        } else if (rank[candidate] < rank[state.level]) {
          state.pendingCount = state.pending === candidate ? state.pendingCount + 1 : 1;
          state.pending = candidate;
          if (state.pendingCount >= 2) { state.level = candidate; state.pending = null; state.pendingCount = 0; }
        } else { state.pending = null; state.pendingCount = 0; }
        state.at = capturedAt; state.cx = detection.boundingBox.x + detection.boundingBox.width / 2;
        state.metric = metric; this.tracks.set(trackId, state); level = state.level;
      }
      risks.push({ trackId, type: detection.type, frameId, capturedAt, level, pathRelation,
        metricMeters, metricSource: metricMeters !== null ? map!.source : null,
        approximateTtcSeconds: closing && !conflictingTtc ? Math.round(closing.ttc * 100) / 100 : usableOpticalTtc ?? null,
        evidence, reasons, experimental: true });
    }
    for (const id of Array.from(this.tracks.keys())) if (!seen.has(id)) this.tracks.delete(id);
    for (const [id, prior] of Array.from(this.announced)) if (capturedAt - prior.at > 60_000) this.announced.delete(id);
    const alert = risks.filter(risk => promoted.has(risk.trackId) && risk.level !== 'UNAVAILABLE' && risk.level !== 'NONE')
      .filter(risk => {
        const prior = this.announced.get(risk.trackId), value = rank[risk.level as Level];
        return !prior || value > rank[prior.level] || capturedAt - prior.at >= 20_000;
      })
      .sort((a, b) => rank[b.level as Level] - rank[a.level as Level] ||
        (a.approximateTtcSeconds ?? Infinity) - (b.approximateTtcSeconds ?? Infinity))[0] ?? null;
    if (alert) this.announced.set(alert.trackId, { level: alert.level as Level, at: capturedAt });
    const status = risks.some(risk => rank[risk.level as Level] > 0) ? 'APPROACH_EVIDENCE'
      : risks.some(risk => risk.level === 'NONE') ? 'NO_APPROACH_EVIDENCE' : 'UNAVAILABLE';
    return { risks, alert, status };
  }
}
