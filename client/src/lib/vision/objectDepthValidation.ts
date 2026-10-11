/** Manual, user-confirmed research logs. Never enable guidance from these statistics. */
import type {VisionDetection} from '@shared/vision';

export interface ObjectDepthTrial {
  frameId:string;
  recordedAt:string;
  objectType:string;
  direction:string;
  referenceMeters:number;
  measuredMeters:number|null;
  objectConfidence:number;
  lidarConfidence:number|null;
  absoluteErrorMeters:number|null;
  /** Human-assessed correspondence, not a model certification. */
  visuallyMatched:boolean;
}

export function createObjectDepthTrial(
  frameId:string, object:VisionDetection, referenceMeters:number, visuallyMatched:boolean,
  at=new Date()
):ObjectDepthTrial|null {
  if(!/^arkit-[\d.]+$/.test(frameId) ||
     !Number.isFinite(referenceMeters) || referenceMeters<.5 || referenceMeters>5 ||
     !Number.isFinite(object.confidence) || object.confidence<0 || object.confidence>1) return null;
  const reading=object.approximateDistance;
  const validReading=reading?.source==='ARKIT_DEPTH'&&
    Number.isFinite(reading.distanceMeters)&&reading.distanceMeters>=.25&&reading.distanceMeters<=10&&
    Number.isFinite(reading.confidence)&&reading.confidence>=.7;
  const measuredMeters=validReading?reading!.distanceMeters:null;
  return {
    frameId,recordedAt:at.toISOString(),objectType:object.type,
    direction:object.horizontalDirection,referenceMeters,measuredMeters,
    objectConfidence:object.confidence,lidarConfidence:validReading?reading!.confidence:null,
    absoluteErrorMeters:measuredMeters===null?null:Math.round(Math.abs(measuredMeters-referenceMeters)*1000)/1000,
    visuallyMatched,
  };
}

export function summarizeObjectDepthTrials(trials:ObjectDepthTrial[]) {
  const accepted=trials.filter(item=>item.visuallyMatched&&item.absoluteErrorMeters!==null);
  const errors=accepted.map(item=>item.absoluteErrorMeters!).sort((a,b)=>a-b);
  const percentile=(fraction:number)=>errors.length?errors[Math.max(0,Math.ceil(errors.length*fraction)-1)]:null;
  return {
    total:trials.length,matched:trials.filter(item=>item.visuallyMatched).length,
    readings:accepted.length, coverage:trials.length?accepted.length/trials.length:0,
    medianAbsoluteErrorMeters:percentile(.5),p95AbsoluteErrorMeters:percentile(.95),
    /** A trial is NEVER a field-navigation approval. */
    safetyCertified:false as const,
  };
}

export function objectDepthTrialsCsv(trials:ObjectDepthTrial[]) {
  const head=['frame_id','recorded_at','object_type','direction','reference_m','measured_m',
    'object_confidence','lidar_confidence','absolute_error_m','human_matched'];
  const rows=trials.map(row=>[row.frameId,row.recordedAt,row.objectType,row.direction,row.referenceMeters,
    row.measuredMeters??'',row.objectConfidence,row.lidarConfidence??'',row.absoluteErrorMeters??'',row.visuallyMatched]);
  // Escape CSV delimiters and spreadsheet formula prefixes in text.
  const encode=(value:string|number|boolean)=>{
    let v=String(value);
    if(/^[=+@\-\t\r]/.test(v))v="'"+v;
    return '"'+v.replaceAll('"','""')+'"';
  };
  return [head,...rows].map(row=>row.map(encode).join(',')).join('\r\n');
}
