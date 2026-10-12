import type { EstimatedMetricDepthMap, MetricDepthMap, VisionDetection, VisionObjectType, HorizontalDirection } from '@shared/vision';
import { metricDepthForDetection } from './fusion';

export const AUTO_METER_MIN_METERS = 0.5;
export const AUTO_METER_MAX_METERS = 3;
const enabledKey='basira-auto-meter-enabled-v1';
const speechKey='basira-auto-meter-speech-v1';

function storedBoolean(key:string):boolean {
  try { return typeof localStorage!=='undefined'&&localStorage.getItem(key)==='true'; }
  catch { return false; }
}
function saveBoolean(key:string,value:boolean):boolean {
  try { localStorage.setItem(key,String(value)); } catch { /* Private mode may disable storage. */ }
  return value;
}
export const getAutoMeterEnabled=()=>storedBoolean(enabledKey);
export const saveAutoMeterEnabled=(value:boolean)=>saveBoolean(enabledKey,value);
export const getAutoMeterSpeechEnabled=()=>storedBoolean(speechKey);
export const saveAutoMeterSpeechEnabled=(value:boolean)=>saveBoolean(speechKey,value);

export interface AutoMeterMeasurement {
  id:string;
  trackId:string;
  type:VisionObjectType;
  direction:HorizontalDirection;
  distanceMeters:number|null;
  /** Validation export only; never render this outside the target range. */
  rawMeters:number|null;
  source:MetricDepthMap['source']|'MONOCULAR_METRIC'|null;
  reliability:'EXPERIMENTAL'|'UNAVAILABLE';
  rejectionReason:'NO_ALIGNED_DEPTH'|'NO_OBJECT_DEPTH'|'OUT_OF_TARGET_RANGE'|'INVALID_MODEL_DEPTH'|null;
  frameId:string;
  capturedAt:number;
}
export interface AutoMeterSnapshot {
  frameId:string;
  nativeSource:MetricDepthMap['source']|'MONOCULAR_METRIC';
  capturedAt:number;
  measurements:AutoMeterMeasurement[];
}

/** Strict association for an AI-only display. This never creates a DepthReading. */
export function estimatedMetersForDetection(d:VisionDetection,map:EstimatedMetricDepthMap):number|null {
  if(d.source!=='OBJECT_DETECTOR'||d.confidence<.75||d.timestamp!==map.timestamp||
    map.source!=='MONOCULAR_METRIC'||!Number.isInteger(map.width)||!Number.isInteger(map.height)||
    map.width<16||map.height<16||map.values.length!==map.width*map.height)return null;
  const b=d.boundingBox;
  if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.x<0||b.y<0||b.width<=0||b.height<=0||
    b.x+b.width>1||b.y+b.height>1||b.width*map.width<7||b.height*map.height<7)return null;
  const samples:number[]=[];
  let center:number|null=null;
  for(let y=0;y<5;y++)for(let x=0;x<5;x++){
    const px=Math.min(map.width-1,Math.floor((b.x+(.26+x*.12)*b.width)*map.width));
    const py=Math.min(map.height-1,Math.floor((b.y+(.26+y*.12)*b.height)*map.height));
    const value=map.values[py*map.width+px];
    if(Number.isFinite(value)&&value>=.2&&value<=20){samples.push(value);if(x===2&&y===2)center=value;}
  }
  if(samples.length<20||center===null)return null;
  samples.sort((a,b)=>a-b);
  const median=samples[Math.floor(samples.length/2)];
  const allowed=Math.max(.15,median*.12);
  if(samples[Math.ceil((samples.length-1)*.9)]-samples[Math.floor((samples.length-1)*.1)]>allowed||
    Math.abs(center-median)>allowed)return null;
  return Math.round(median*100)/100;
}

export function measureEstimatedObjects(
  detections:readonly VisionDetection[],map:EstimatedMetricDepthMap,frameId:string,capturedAt:number,
):AutoMeterSnapshot {
  const measurements=detections.filter(d=>d.source==='OBJECT_DETECTOR').slice(0,8).map(d=>{
    const reading=estimatedMetersForDetection(d,map);
    const inRange=reading!==null&&reading>=AUTO_METER_MIN_METERS&&reading<=AUTO_METER_MAX_METERS;
    return {
      id:d.id,trackId:d.trackId??`${d.type}:${d.horizontalDirection}`,type:d.type,direction:d.horizontalDirection,
      distanceMeters:inRange?reading:null,rawMeters:reading,source:inRange?'MONOCULAR_METRIC':null,
      reliability:inRange?'EXPERIMENTAL':'UNAVAILABLE',
      rejectionReason:reading===null?'INVALID_MODEL_DEPTH':!inRange?'OUT_OF_TARGET_RANGE':null,
      frameId,capturedAt,
    } satisfies AutoMeterMeasurement;
  });
  return {frameId,nativeSource:'MONOCULAR_METRIC',capturedAt,measurements};
}

/** Measurement is display-only. No value from this function feeds obstacle or stair alarms. */
export function measureAutoMeterObjects(
  detections:readonly VisionDetection[],map:MetricDepthMap|null,frameId:string,capturedAt:number,nativeSource:MetricDepthMap['source']='ARKIT_DEPTH',
):AutoMeterSnapshot {
  const measurements=detections.filter(d=>d.source==='OBJECT_DETECTOR').slice(0,8).map(d=>{
    const reading=map?metricDepthForDetection(d,map):null;
    const inRange=reading!==null&&reading.source!=='MONOCULAR_ESTIMATE'&&reading.distanceMeters>=AUTO_METER_MIN_METERS&&reading.distanceMeters<=AUTO_METER_MAX_METERS;
    return {
      id:d.id,trackId:d.trackId??`${d.type}:${d.horizontalDirection}`,type:d.type,direction:d.horizontalDirection,
      distanceMeters:inRange?reading.distanceMeters:null,
      rawMeters:reading?.source!=='MONOCULAR_ESTIMATE'&&reading?reading.distanceMeters:null,
      source:inRange&&reading.source!=='MONOCULAR_ESTIMATE'?reading.source:null,
      reliability:inRange?'EXPERIMENTAL':'UNAVAILABLE',
      rejectionReason:!map?'NO_ALIGNED_DEPTH':!reading?'NO_OBJECT_DEPTH':!inRange?'OUT_OF_TARGET_RANGE':null,
      frameId,capturedAt,
    } satisfies AutoMeterMeasurement;
  });
  return {frameId,nativeSource,capturedAt,measurements};
}

/** A new object is spoken once; a substantial move can interrupt the cooldown. */
export class AutoMeterSpeechPacer {
  private readonly previous=new Map<string,{at:number;distance:number}>();
  constructor(private readonly cooldownMs=10_000,private readonly movedMeters=0.4) {}
  choose(snapshot:AutoMeterSnapshot):AutoMeterMeasurement|null {
    const now=snapshot.capturedAt;
    const measured=snapshot.measurements.filter(m=>m.distanceMeters!==null);
    const next=measured.find(m=>{
      const previous=this.previous.get(m.trackId);
      return !previous||now-previous.at>=this.cooldownMs||Math.abs(previous.distance-m.distanceMeters!)>=this.movedMeters;
    });
    if(!next)return null;
    this.previous.set(next.trackId,{at:now,distance:next.distanceMeters!});
    this.previous.forEach((value,key)=>{if(now-value.at>this.cooldownMs*3)this.previous.delete(key);});
    return next;
  }
  reset(){this.previous.clear();}
}
