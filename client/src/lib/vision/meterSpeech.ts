import type {AutoMeterMeasurement,AutoMeterSnapshot} from './autoMeter';
import type {MeterAttempt} from './pipeline';
import type {MeterDiagnostic} from './meterDiagnostics';

export type MeterSpeechSelection =
  | {kind:'OBJECTS';source:AutoMeterSnapshot['nativeSource'];objects:AutoMeterMeasurement[]}
  | {kind:'CENTER';meters:number}
  | {kind:'REASON';diagnostic:MeterDiagnostic};

/** A spoken number must come from the completed fresh attempt, never a cached UI snapshot. */
export function selectMeterSpeech(attempt:MeterAttempt,now:number):MeterSpeechSelection {
  const snapshot=attempt.snapshot;
  if(!snapshot||now-snapshot.capturedAt>6000||now<snapshot.capturedAt)
    return {kind:'REASON',diagnostic:snapshot?'FRAME_STALE':attempt.diagnostic};
  const objects=snapshot.measurements.filter(item=>item.distanceMeters!==null&&item.frameId===snapshot.frameId).slice(0,3);
  if(objects.length)return {kind:'OBJECTS',source:snapshot.nativeSource,objects};
  if(snapshot.nativeSource==='MONOCULAR_METRIC'&&snapshot.centerSurface?.distanceMeters!=null)
    return {kind:'CENTER',meters:snapshot.centerSurface.distanceMeters};
  return {kind:'REASON',diagnostic:snapshot.measurements[0]?.rejectionReason??snapshot.centerSurface?.rejectionReason??attempt.diagnostic};
}
