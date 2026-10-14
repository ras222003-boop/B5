import type {VisionDetection} from '@shared/vision';
import type {GroundHazardSnapshot} from './groundHazards';
import type {VisualApproachObservation} from './visualApproach';

/** All timestamps here use performance.now(), including producer timestamps. */
export const PERCEPTION_TTL_MS=1250;
export const APPROACH_TTL_MS=800;
export const freshTimestamp=(capturedAt:number,now:number,ttl=PERCEPTION_TTL_MS)=>
  Number.isFinite(capturedAt)&&Number.isFinite(now)&&now>=capturedAt&&now-capturedAt<=ttl;
export interface PerceptionObservation {
  detection:VisionDetection;
  validity:'CURRENT'|'UNCERTAIN';
  evidence:string[];
  uncertainty:string[];
}
export interface PerceptionSnapshot {
  frameId:string;
  capturedAt:number;
  completedAt:number;
  observations:PerceptionObservation[];
  ground:GroundHazardSnapshot;
  approach:VisualApproachObservation[];
  performance:{inferenceMs:number;p95InferenceMs:number;effectiveFps:number;processedFrames:number};
  tracking:'WARMING_UP'|'TRACKING'|'LIMITED';
}
export function currentPerception(snapshot:PerceptionSnapshot|null,now:number){
  if(!snapshot||!freshTimestamp(snapshot.capturedAt,now))return null;
  // An asynchronous semantic observation can be older than its enclosing detector frame.
  const ground=snapshot.ground.observations.filter(item=>freshTimestamp(item.lastSeenAt,now));
  const approach=snapshot.approach.filter(item=>freshTimestamp(item.capturedAt,now,APPROACH_TTL_MS));
  return ground.length===snapshot.ground.observations.length&&approach.length===snapshot.approach.length?snapshot:
    {...snapshot,ground:{...snapshot.ground,observations:ground},approach};
}
export function observationFor(detection:VisionDetection):PerceptionObservation{
  const uncertain=detection.confidence<.65||detection.tracking?.state==='AMBIGUOUS';
  return {detection,validity:uncertain?'UNCERTAIN':'CURRENT',
    evidence:[detection.source,'VISIBLE_BOUNDING_BOX',...(detection.trackId?['TEMPORAL_ASSOCIATION']:[])],
    uncertainty:[...(detection.confidence<.65?['CLASSIFICATION_BELOW_NAMING_THRESHOLD']:[]),
      ...(detection.tracking?.state==='AMBIGUOUS'?['IDENTITY_AMBIGUOUS']:[]),
      'NO_VERIFIED_DISTANCE','CAMERA_DIRECTION_IS_NOT_WALKING_DIRECTION']};
}
/** Bounded telemetry contains timings only; never pixels, audio, or locations. */
export class PerceptionTelemetry {
  private samples:number[]=[];
  private captures:number[]=[];
  private count=0;
  record(capturedAt:number,completedAt:number){
    const inferenceMs=Math.max(0,completedAt-capturedAt);
    this.samples.push(inferenceMs);this.captures.push(capturedAt);this.count++;
    if(this.samples.length>120)this.samples.shift();
    this.captures=this.captures.filter(at=>completedAt-at<=10_000);
    const sorted=[...this.samples].sort((a,b)=>a-b);
    const span=completedAt-(this.captures[0]??completedAt);
    return {inferenceMs,p95InferenceMs:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??0,
      effectiveFps:this.captures.length>1&&span>0?(this.captures.length-1)*1000/span:0,processedFrames:this.count};
  }
}
