import type { VisionDetection } from '@shared/vision';
import type { TrackingFrame } from './objectTracking';
import { validNormalizedBox } from './objectTracking';

/** Image motion only. This does not estimate metres, time to contact, or collision probability. */
export interface MotionEvidence {
  source: 'SPARSE_OPTICAL_FLOW';
  trackId: string;
  frameId: string;
  previousFrameId: string;
  capturedAt: number;
  previousCapturedAt: number;
  pointCount: number;
  outwardFraction: number;
  backgroundPointCount: number;
  backgroundInlierRatio: number;
  expansionPerSecond: number;
  globalScaleChange: number;
  globalRotationDegrees: number;
  compensated: boolean;
  quality: 'VALID' | 'INSUFFICIENT';
}
export type ApproachState = 'OBSERVED' | 'POSSIBLE_APPROACH' | 'STRONG_APPROACH' | 'UNAVAILABLE';
export type ApproachReason = 'BOX_ONLY' | 'LOW_FPS' | 'STALE_FRAME' | 'REPEATED_FRAME' | 'TRACK_UNSTABLE' |
  'LOW_CONFIDENCE' | 'ZOOM' | 'CAMERA_ROTATION' | 'GLOBAL_EXPANSION' | 'MOTION_UNRELIABLE' | 'INSUFFICIENT_HISTORY' |
  'NO_CORROBORATED_EXPANSION';
export interface VisualApproachObservation {
  trackId: string;
  type: VisionDetection['type'];
  state: ApproachState;
  capturedAt: number;
  frameId: string;
  reasons: ApproachReason[];
  evidence: readonly ('TRACKING' | 'BOX_EXPANSION' | 'COMPENSATED_OPTICAL_FLOW')[];
  experimental: true;
}
export interface ApproachFrame extends TrackingFrame {
  motion?: readonly MotionEvidence[];
  zoom?: number;
  rotationDegrees?: number;
}
interface Sample { at: number; scale: number; frameId: string; positive: number; firstScale: number; firstAt: number }

/** Multiple timed, independent cues are required. Missing hardware metadata is not proof of no zoom. */
export class VisualApproachEstimator {
  private samples = new Map<string, Sample>();
  private lastFrameId = '';
  private lastAt = -Infinity;
  private lastZoom: number | undefined;
  private lastRotation: number | undefined;
  reset() { this.samples.clear(); this.lastFrameId = ''; this.lastAt = -Infinity; this.lastZoom = undefined; this.lastRotation = undefined; }
  update(detections: readonly VisionDetection[], frame: ApproachFrame): VisualApproachObservation[] {
    const repeated = frame.frameId === this.lastFrameId || frame.capturedAt <= this.lastAt;
    const gap = frame.capturedAt - this.lastAt;
    const zoomChanged = frame.zoom !== undefined && this.lastZoom !== undefined && Math.abs(frame.zoom - this.lastZoom) > .005;
    const rotationChanged = frame.rotationDegrees !== undefined && this.lastRotation !== undefined &&
      Math.abs(((frame.rotationDegrees - this.lastRotation + 540) % 360) - 180) > 1;
    if (!repeated) {
      this.lastFrameId = frame.frameId; this.lastAt = frame.capturedAt;
      this.lastZoom = frame.zoom; this.lastRotation = frame.rotationDegrees;
    }
    const seen = new Set<string>();
    const results: VisualApproachObservation[] = [];
    for (const detection of detections) {
      if (!detection.trackId) continue;
      const trackId = detection.trackId; seen.add(trackId);
      const reasons: ApproachReason[] = [];
      const old = this.samples.get(trackId), scale = Math.sqrt(detection.boundingBox.width * detection.boundingBox.height);
      const motion = frame.motion?.find(item => item.trackId === trackId && item.frameId === frame.frameId);
      if (repeated) reasons.push('REPEATED_FRAME');
      if (![frame.capturedAt, frame.now, detection.timestamp].every(Number.isFinite) || frame.now - frame.capturedAt > 800 ||
        frame.capturedAt > frame.now + 5 || Math.abs(detection.timestamp - frame.capturedAt) > 5) reasons.push('STALE_FRAME');
      if (Number.isFinite(gap) && (gap > 350 || gap < 40)) reasons.push('LOW_FPS');
      if (!detection.tracking || detection.tracking.state !== 'TRACKED' || detection.tracking.observations < 3 ||
        !validNormalizedBox(detection.boundingBox)) reasons.push('TRACK_UNSTABLE');
      if (!Number.isFinite(detection.confidence) || detection.confidence < .75 || detection.confidence > 1) reasons.push('LOW_CONFIDENCE');
      if (zoomChanged) reasons.push('ZOOM');
      if (rotationChanged) reasons.push('CAMERA_ROTATION');
      if (!motion) reasons.push('BOX_ONLY');
      else {
        if (motion.source !== 'SPARSE_OPTICAL_FLOW' || motion.quality !== 'VALID' || !motion.compensated || motion.pointCount < 6 || motion.backgroundPointCount < 12 ||
          motion.backgroundInlierRatio < .7 || motion.backgroundInlierRatio > 1 || motion.outwardFraction < 0 || motion.outwardFraction > 1 || motion.capturedAt !== frame.capturedAt ||
          !old || motion.previousFrameId !== old.frameId || motion.previousCapturedAt !== old.at ||
          ![motion.expansionPerSecond, motion.globalScaleChange, motion.globalRotationDegrees, motion.outwardFraction,
            motion.backgroundInlierRatio, motion.pointCount, motion.backgroundPointCount].every(Number.isFinite)) reasons.push('MOTION_UNRELIABLE');
        if (Math.abs(motion.globalScaleChange) > .015) reasons.push('GLOBAL_EXPANSION');
        if (Math.abs(motion.globalRotationDegrees) > 1) reasons.push('CAMERA_ROTATION');
      }
      let state: ApproachState = 'UNAVAILABLE';
      let positive = 0, firstScale = scale, firstAt = frame.capturedAt;
      if (!reasons.length && old && motion) {
        const expansion = (Math.log(scale) - Math.log(old.scale)) / ((frame.capturedAt - old.at) / 1000);
        const corroborated = expansion > .08 && motion.expansionPerSecond > .1 && motion.outwardFraction >= .75;
        if (corroborated) {
          positive = old.positive + 1; firstScale = old.positive > 0 ? old.firstScale : old.scale;
          firstAt = old.positive > 0 ? old.firstAt : old.at;
          if (positive >= 2 && scale / firstScale >= 1.05 && frame.capturedAt - firstAt >= 350) {
            state = positive >= 4 && expansion > .45 && motion.expansionPerSecond > .45 &&
              motion.pointCount >= 12 && motion.outwardFraction >= .85 ? 'STRONG_APPROACH' : 'POSSIBLE_APPROACH';
          } else { state = 'OBSERVED'; reasons.push('INSUFFICIENT_HISTORY'); }
        } else { state = 'OBSERVED'; reasons.push('NO_CORROBORATED_EXPANSION'); }
      } else if (!reasons.length) reasons.push('INSUFFICIENT_HISTORY');
      if (!repeated) this.samples.set(trackId, { at: frame.capturedAt, frameId: frame.frameId, scale, positive, firstScale, firstAt });
      results.push({ trackId, type: detection.type, state, capturedAt: frame.capturedAt, frameId: frame.frameId,
        reasons: Array.from(new Set(reasons)), evidence: state === 'POSSIBLE_APPROACH' || state === 'STRONG_APPROACH'
          ? ['TRACKING', 'BOX_EXPANSION', 'COMPENSATED_OPTICAL_FLOW'] : ['TRACKING'], experimental: true });
    }
    if (!repeated) for (const trackId of Array.from(this.samples.keys())) if (!seen.has(trackId)) this.samples.delete(trackId);
    return results;
  }
}
