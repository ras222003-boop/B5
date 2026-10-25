import type { BoundingBox, ObjectTracking, VisionDetection } from '@shared/vision';

export type TrackedVisionDetection = VisionDetection & { trackId: string; tracking: ObjectTracking };
export interface TrackingFrame { frameId: string; capturedAt: number; now: number }
export interface TrackingResult {
  detections: TrackedVisionDetection[];
  rejectedFrame: boolean;
  reason?: 'REPEATED_FRAME' | 'STALE_FRAME' | 'INVALID_FRAME';
}
interface Track {
  detection: TrackedVisionDetection;
  vx: number;
  vy: number;
  missed: boolean;
}
const center = (box: BoundingBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
export function validNormalizedBox(box: BoundingBox): boolean {
  return !!box && [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    box.x + box.width <= 1.00001 && box.y + box.height <= 1.00001;
}
export function boxIntersectionOverUnion(a: BoundingBox, b: BoundingBox): number {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

/** Conservative association. Ambiguous crossings lose identity instead of guessing a match. */
export class ObjectTracker {
  private tracks = new Map<string, Track>();
  private serial = 0;
  private lastFrameId = '';
  private lastTimestamp = -Infinity;
  constructor(private readonly maximumAgeMs = 1200, private readonly maximumGapMs = 1800) {}
  reset() { this.tracks.clear(); this.lastFrameId = ''; this.lastTimestamp = -Infinity; }
  update(detections: readonly VisionDetection[], frame: TrackingFrame): TrackingResult {
    const { frameId, capturedAt, now } = frame;
    if (!frameId || ![capturedAt, now].every(Number.isFinite) || capturedAt > now + 5)
      return { detections: [], rejectedFrame: true, reason: 'INVALID_FRAME' };
    if (frameId === this.lastFrameId || capturedAt <= this.lastTimestamp)
      return { detections: [], rejectedFrame: true, reason: 'REPEATED_FRAME' };
    if (now - capturedAt > this.maximumAgeMs) {
      this.tracks.clear();
      return { detections: [], rejectedFrame: true, reason: 'STALE_FRAME' };
    }
    this.lastFrameId = frameId; this.lastTimestamp = capturedAt;
    for (const [id, track] of Array.from(this.tracks)) if (capturedAt - track.detection.timestamp > this.maximumGapMs) this.tracks.delete(id);
    const current = detections.filter(detection => Number.isFinite(detection.confidence) && detection.confidence >= .65 &&
      detection.confidence <= 1 && validNormalizedBox(detection.boundingBox) &&
      Number.isFinite(detection.timestamp) && Math.abs(detection.timestamp - capturedAt) <= 5);
    const previous = Array.from(this.tracks.values());
    const costs = current.map(detection => previous.map(track => {
      const old = track.detection;
      if (old.type !== detection.type || old.source !== detection.source || old.cocoClass!==detection.cocoClass) return Infinity;
      const age = (capturedAt - old.timestamp) / 1000, c = center(detection.boundingBox), p = center(old.boundingBox);
      const distance = Math.hypot(c.x - (p.x + track.vx * age), c.y - (p.y + track.vy * age));
      const scale = Math.abs(Math.log((detection.boundingBox.width * detection.boundingBox.height) /
        (old.boundingBox.width * old.boundingBox.height)));
      if (distance > .18 || scale > 1.1) return Infinity;
      return distance * 2 + scale * .08 + (1 - boxIntersectionOverUnion(detection.boundingBox, old.boundingBox)) * .12;
    }));
    const assignments = new Map<number, number>(), ambiguous = new Set<number>(), retired = new Set<number>();
    // Reject both row and column near-ties before assigning. A track can be used at most once.
    for (let i = 0; i < current.length; i++) {
      const matches = costs[i].map((cost, j) => ({ cost, j })).filter(value => Number.isFinite(value.cost)).sort((a, b) => a.cost - b.cost);
      if (!matches.length) continue;
      const best = matches[0], rivals = costs.map((row, k) => ({ cost: row[best.j], k })).filter(value => Number.isFinite(value.cost)).sort((a, b) => a.cost - b.cost);
      if ((matches[1] && matches[1].cost - best.cost < .045) || (rivals[1] && rivals[1].cost - rivals[0].cost < .045)) {
        ambiguous.add(i); matches.filter(value => value.cost - best.cost < .045).forEach(value => retired.add(value.j));
      } else if (rivals[0].k === i) assignments.set(i, best.j);
    }
    const observed: TrackedVisionDetection[] = [], used = new Set<number>();
    for (let i = 0; i < current.length; i++) {
      const detection = current[i], j = assignments.get(i), old = j !== undefined && !retired.has(j) ? previous[j] : undefined;
      const trackId = old?.detection.trackId ?? `object-${++this.serial}`;
      const gapMs = old ? capturedAt - old.detection.timestamp : 0;
      const reacquired = old?.missed || (old && gapMs > 900);
      const observations = old && !reacquired ? old.detection.tracking.observations + 1 : 1;
      const state: ObjectTracking['state'] = ambiguous.has(i) || (j !== undefined && retired.has(j)) ? 'AMBIGUOUS'
        : reacquired ? 'REACQUIRED' : observations >= 2 ? 'TRACKED' : 'TENTATIVE';
      const tracked: TrackedVisionDetection = { ...detection, trackId, tracking: {
        state, observations, firstSeenAt: old && !reacquired ? old.detection.tracking.firstSeenAt : capturedAt,
        lastSeenAt: capturedAt, gapMs,
      } };
      const a = center(detection.boundingBox), b = old ? center(old.detection.boundingBox) : a;
      this.tracks.set(trackId, { detection: tracked, vx: old ? (a.x - b.x) / (gapMs / 1000) : 0,
        vy: old ? (a.y - b.y) / (gapMs / 1000) : 0, missed: false });
      if (old && j !== undefined) used.add(j);
      observed.push(tracked);
    }
    previous.forEach((track, j) => {
      if (retired.has(j)) this.tracks.delete(track.detection.trackId);
      else if (!used.has(j)) track.missed = true;
    });
    return { detections: observed, rejectedFrame: false };
  }
}
