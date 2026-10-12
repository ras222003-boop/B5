import type { EstimatedMetricDepthMap, MetricDepthMap, VisionDetection, VisionObjectType, HorizontalDirection } from '@shared/vision';
import { metricDepthForDetection } from './fusion';
import type {MeterDiagnostic} from './meterDiagnostics';

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
  rejectionReason:'NO_ALIGNED_DEPTH'|'NO_OBJECT_DEPTH'|'OUT_OF_TARGET_RANGE'|'INVALID_MODEL_DEPTH'|'DEPTH_INCONSISTENT'|'LOW_CONFIDENCE'|null;
  frameId:string;
  capturedAt:number;
}
export interface AutoMeterSnapshot {
  frameId:string;
  nativeSource:MetricDepthMap['source']|'MONOCULAR_METRIC';
  capturedAt:number;
  measurements:AutoMeterMeasurement[];
  /** AI-only visible surface at the frame centre; never a detector or safety reading. */
  centerSurface?:{distanceMeters:number|null;rawMeters:number|null;rejectionReason:MeterDiagnostic|null};
}

type SurfaceResult={meters:number|null;reason:'INVALID_MODEL_DEPTH'|'DEPTH_INCONSISTENT'|null};
function validEstimatedMap(map:EstimatedMetricDepthMap):boolean {
  return map.source==='MONOCULAR_METRIC'&&Number.isInteger(map.width)&&Number.isInteger(map.height)&&
    map.width>=16&&map.height>=16&&map.values.length===map.width*map.height;
}
function sampleSurface(map:EstimatedMetricDepthMap,b:{x:number;y:number;width:number;height:number},center=false):SurfaceResult {
  if(!validEstimatedMap(map)||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.x<0||b.y<0||
    b.width<=0||b.height<=0||b.x+b.width>1||b.y+b.height>1||
    b.width*map.width<7||b.height*map.height<7)return {meters:null,reason:'INVALID_MODEL_DEPTH'};
  const samples:number[]=[];
  let middle:number|null=null;
  for(let y=0;y<5;y++)for(let x=0;x<5;x++){
    const offset=.26,step=.12;
    const px=Math.min(map.width-1,Math.floor((b.x+(offset+x*step)*b.width)*map.width));
    const py=Math.min(map.height-1,Math.floor((b.y+(offset+y*step)*b.height)*map.height));
    const value=map.values[py*map.width+px];
    if(Number.isFinite(value)&&value>=.2&&value<=20){samples.push(value);if(x===2&&y===2)middle=value;}
  }
  if(samples.length<(center?23:20)||middle===null)return {meters:null,reason:'INVALID_MODEL_DEPTH'};
  samples.sort((a,b)=>a-b);
  const median=samples[Math.floor(samples.length/2)];
  const allowed=center?Math.max(.1,median*.08):Math.max(.15,median*.12);
  if(samples[Math.ceil((samples.length-1)*.9)]-samples[Math.floor((samples.length-1)*.1)]>allowed||
    Math.abs(middle-median)>allowed)return {meters:null,reason:'DEPTH_INCONSISTENT'};
  return {meters:Math.round(median*100)/100,reason:null};
}

/** Strict association for an AI-only display. This never creates a DepthReading. */
export function estimatedMetersForDetection(d:VisionDetection,map:EstimatedMetricDepthMap):number|null {
  if(d.source!=='OBJECT_DETECTOR'||d.confidence<.75||d.timestamp!==map.timestamp)return null;
  return sampleSurface(map,d.boundingBox).meters;
}

export function estimatedCenterSurface(map:EstimatedMetricDepthMap):AutoMeterSnapshot['centerSurface'] {
  const result=sampleSurface(map,{x:.35,y:.35,width:.3,height:.3},true);
  const inRange=result.meters!==null&&result.meters>=AUTO_METER_MIN_METERS&&result.meters<=AUTO_METER_MAX_METERS;
  return {distanceMeters:inRange?result.meters:null,rawMeters:result.meters,
    rejectionReason:result.reason??(inRange?null:'OUT_OF_TARGET_RANGE')};
}

export function measureEstimatedObjects(
  detections:readonly VisionDetection[],map:EstimatedMetricDepthMap,frameId:string,capturedAt:number,
):AutoMeterSnapshot {
  const measurements=detections.filter(d=>d.source==='OBJECT_DETECTOR').slice(0,8).map(d=>{
    const result=d.confidence<.75?{meters:null,reason:'LOW_CONFIDENCE' as const}
      :d.timestamp!==map.timestamp?{meters:null,reason:'NO_ALIGNED_DEPTH' as const}:sampleSurface(map,d.boundingBox);
    const reading=result.meters;
    const inRange=reading!==null&&reading>=AUTO_METER_MIN_METERS&&reading<=AUTO_METER_MAX_METERS;
    return {
      id:d.id,trackId:d.trackId??`${d.type}:${d.horizontalDirection}`,type:d.type,direction:d.horizontalDirection,
      distanceMeters:inRange?reading:null,rawMeters:reading,source:inRange?'MONOCULAR_METRIC':null,
      reliability:inRange?'EXPERIMENTAL':'UNAVAILABLE',
      rejectionReason:result.reason??(!inRange?'OUT_OF_TARGET_RANGE':null),
      frameId,capturedAt,
    } satisfies AutoMeterMeasurement;
  });
  return {frameId,nativeSource:'MONOCULAR_METRIC',capturedAt,measurements,centerSurface:estimatedCenterSurface(map)};
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
