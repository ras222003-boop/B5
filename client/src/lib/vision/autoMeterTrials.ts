import type { MetricDepthMap, VisionObjectType } from '@shared/vision';
import type { AutoMeterMeasurement, AutoMeterSnapshot } from './autoMeter';

export const AUTO_METER_REFERENCE_METERS=[0.5,1,1.5,2,3,4,5] as const;
export type AutoMeterReferenceMeters=typeof AUTO_METER_REFERENCE_METERS[number];

export interface AutoMeterTrial {
  sessionId:string;
  deviceModel:string;
  osVersion:string;
  source:MetricDepthMap['source']|'MONOCULAR_METRIC';
  frameId:string;
  objectType:VisionObjectType;
  referenceMeters:AutoMeterReferenceMeters;
  readingMeters:number|null;
  rejectionReason:string|null;
  condition:string;
  capturedAt:string;
  /** Sensor output beyond the public 0.5–3 m range; excluded from accepted readings. */
  rawMeters?:number;
}

export function createAutoMeterTrial(input:{
  sessionId:string;deviceModel:string;osVersion:string;source:MetricDepthMap['source']|'MONOCULAR_METRIC';
  snapshot:AutoMeterSnapshot|null;measurement:AutoMeterMeasurement|null;
  missedObjectType:VisionObjectType;referenceMeters:AutoMeterReferenceMeters;condition:string;now:number;
}):AutoMeterTrial|null {
  if(!input.sessionId.trim()||!input.deviceModel.trim()||!input.osVersion.trim()||!input.condition.trim()||
    !AUTO_METER_REFERENCE_METERS.includes(input.referenceMeters)||!Number.isFinite(input.now))return null;
  const measured=input.measurement;
  const frameId=measured?.frameId||input.snapshot?.frameId||`attempt-${Math.round(input.now)}`;
  const rejected=measured?.distanceMeters===null||!measured;
  const row:AutoMeterTrial={
    sessionId:input.sessionId.trim(),deviceModel:input.deviceModel.trim(),osVersion:input.osVersion.trim(),
    source:input.source,frameId,objectType:measured?.type??input.missedObjectType,
    referenceMeters:input.referenceMeters,readingMeters:rejected?null:measured!.distanceMeters,
    rejectionReason:rejected?(measured?.rejectionReason??'DETECTOR_MISS'):null,
    condition:input.condition.trim(),capturedAt:new Date(input.now).toISOString(),
  };
  if(measured?.rejectionReason==='OUT_OF_TARGET_RANGE'&&measured.rawMeters!==null&&
    (input.referenceMeters===4||input.referenceMeters===5))row.rawMeters=measured.rawMeters;
  return row;
}

export const autoMeterTrialsJsonl=(trials:readonly AutoMeterTrial[])=>trials.map(row=>JSON.stringify(row)).join('\n')+(trials.length?'\n':'');
