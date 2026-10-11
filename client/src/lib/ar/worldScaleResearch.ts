/**
 * 8th Wall World Tracking research calculations.
 *
 * Absolute scale measures camera-pose separation (estimated metres); it does
 * NOT measure distance to a chair/person/car and MUST NOT trigger mobility alerts.
 */
export type WorldPose = Readonly<{
  x: number;
  y: number;
  z: number;
  timestampMs: number;
  trackingStatus: 'NORMAL';
}>;

export type WorldReferenceTarget = 0.5 | 1 | 2 | 3 | 5;
export const WORLD_REFERENCE_TARGETS: readonly WorldReferenceTarget[] = [0.5, 1, 2, 3, 5];
export type WorldResearchTrial = Readonly<{
  referenceMeters: WorldReferenceTarget;
  cameraDisplacementMeters: number;
  observedAt: number;
  device: string;
}>;

export function parseTrustedWorldPose(raw: unknown, now: number): WorldPose | null {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(now) || now < 0) return null;
  const value=raw as {position?: {x?:unknown;y?:unknown;z?:unknown};trackingStatus?:unknown;trackingReason?:unknown};
  if (value.trackingStatus !== 'NORMAL' || value.trackingReason === 'INITIALIZING') return null;
  const pos=value.position;
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.z !== 'number') return null;
  if (![pos.x,pos.y,pos.z].every(Number.isFinite)) return null;
  if ([pos.x,pos.y,pos.z].some(v=>Math.abs(v)>10000)) return null;
  return {x:pos.x,y:pos.y,z:pos.z,timestampMs:now,trackingStatus:'NORMAL'};
}

export function displacementMetres(start: WorldPose, end: WorldPose): number | null {
  if (end.timestampMs <= start.timestampMs) return null;
  const dt=end.timestampMs-start.timestampMs;
  // Reset after tracking interruption; this is not a continuous user trail.
  if (dt>60_000) return null;
  const d=Math.hypot(end.x-start.x,end.y-start.y,end.z-start.z);
  return Number.isFinite(d) && d >= 0 && d <= 100 ? d : null;
}

export type WorldErrorSummary=Readonly<{
  attempts:number;
  medianAbsoluteErrorMetres:number|null;
  p95AbsoluteErrorMetres:number|null;
  approvedForWalking:false;
}>;

function quantile(sorted:number[],portion:number){
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*portion)-1))];
}

export function summarizeWorldTrials(trials: readonly WorldResearchTrial[]):WorldErrorSummary{
  const errors=trials.filter(t=>WORLD_REFERENCE_TARGETS.includes(t.referenceMeters) &&
    Number.isFinite(t.cameraDisplacementMeters) && t.cameraDisplacementMeters>=0)
    .map(t=>Math.abs(t.cameraDisplacementMeters-t.referenceMeters)).sort((a,b)=>a-b);
  return {
    attempts:errors.length,
    medianAbsoluteErrorMetres:errors.length?quantile(errors,.5):null,
    p95AbsoluteErrorMetres:errors.length?quantile(errors,.95):null,
    approvedForWalking:false,
  };
}
