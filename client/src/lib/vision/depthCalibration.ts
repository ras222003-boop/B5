/** Independent laboratory gate. Results NEVER enable navigation alerts automatically. */
export const DEPTH_TARGETS = [0.5, 1, 2, 3, 5] as const;
export type CalibrationTarget = (typeof DEPTH_TARGETS)[number];
export type LabCondition = 'INDOOR_BRIGHT' | 'INDOOR_DIM' | 'OUTDOOR';
export type NativeDepthSource = 'ARKIT_DEPTH' | 'ARCORE_DEPTH';

export interface NativeDepthLabSample {
  source: NativeDepthSource;
  /** ID of the native AR frame that supplied BOTH camera and depth. */
  frameId: string;
  frameTimestampMs: number;
  distanceMeters: number | null;
  confidence: number;
  alignedToCameraFrame: boolean;
  capturedWithNativeSession: boolean;
  /** Android raw depth may be reprojected; stale data must never pass. */
  rawDepthFresh: boolean;
}

export interface LabObservation {
  targetMeters: CalibrationTarget;
  condition: LabCondition;
  sample: NativeDepthLabSample | null;
}

declare global {
  interface Window {
    /** Implemented only by a future native host. Never shim in the website. */
    BasiraDepthLab?: { captureSample(): Promise<NativeDepthLabSample | null> };
  }
}

export function rejectNativeSample(sample: NativeDepthLabSample | null): string | null {
  if (!sample) return 'depth_unavailable';
  if (sample.source !== 'ARKIT_DEPTH' && sample.source !== 'ARCORE_DEPTH') return 'invalid_source';
  if (!sample.capturedWithNativeSession || !sample.alignedToCameraFrame || !sample.rawDepthFresh) return 'frame_unverified';
  if (!sample.frameId?.trim() || !Number.isFinite(sample.frameTimestampMs) || sample.frameTimestampMs <= 0) return 'invalid_frame';
  if (!Number.isFinite(sample.confidence) || sample.confidence < 0.7 || sample.confidence > 1) return 'low_confidence';
  if (sample.distanceMeters === null || !Number.isFinite(sample.distanceMeters) || sample.distanceMeters <= 0 || sample.distanceMeters > 10) return 'invalid_distance';
  return null;
}

export interface TargetReport {
  targetMeters: CalibrationTarget;
  attempts: number;
  valid: number;
  coverage: number;
  medianAbsoluteError: number | null;
  p95AbsoluteError: number | null;
  conditions: number;
  pass: boolean;
}
const percentile = (sorted: number[], q: number) => sorted[Math.ceil(q * sorted.length) - 1];
export function evaluateCalibration(observations: LabObservation[]): {
  targets: TargetReport[];
  labCriteriaMet: boolean;
  safetyCertified: false;
} {
  const targets = DEPTH_TARGETS.map(targetMeters => {
    const rows = observations.filter(row => row.targetMeters === targetMeters);
    const good = rows.filter(row => rejectNativeSample(row.sample) === null);
    const errors = good.map(row => Math.abs(row.sample!.distanceMeters! - targetMeters)).sort((a,b) => a-b);
    const attempts = rows.length, valid = good.length, coverage = attempts ? valid / attempts : 0;
    const medianAbsoluteError = errors.length ? percentile(errors, .5) : null;
    const p95AbsoluteError = errors.length ? percentile(errors, .95) : null;
    const conditions = new Set(good.map(row => row.condition)).size;
    // Conservative INITIAL lab criteria, not validated pedestrian safety thresholds.
    const pass = attempts >= 20 && valid >= 18 && coverage >= .9 && conditions >= 2 &&
      medianAbsoluteError !== null && medianAbsoluteError <= Math.max(.15, targetMeters * .10) &&
      p95AbsoluteError !== null && p95AbsoluteError <= Math.max(.25, targetMeters * .15);
    return {targetMeters,attempts,valid,coverage,medianAbsoluteError,p95AbsoluteError,conditions,pass};
  });
  return {targets,labCriteriaMet:targets.every(item => item.pass),safetyCertified:false};
}
