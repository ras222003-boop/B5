import type { FloorEstimate, FloorTransitionEvent, HeadingEstimate, LocalizationConfig, LocalizationEstimate, LocalizationSource, MapSuggestion, MappingTrackPoint, PositionObservation, RelocalizationEvent, VisualAnchor } from '@shared/localization';
import { DEFAULT_LOCALIZATION_CONFIG } from '@shared/localization';
import type { Place, MapNode } from '@shared/navigation';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const strong=new Set<LocalizationSource>(['QR','MANUAL','VISUAL_PLACE','NFC','NATIVE_AR']);
const sourceCap:Record<LocalizationSource,number>={QR:.97,MANUAL:.9,VISUAL_PLACE:.85,VISION_WALKABLE:.55,NFC:.95,NATIVE_AR:.9,GPS_BUILDING:.25,STEP_MOTION:.55,COMPASS:.2,GYROSCOPE:.4,BEACON:.7,WIFI:.5,BAROMETER:.35};
export const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
export const normalizeHeading=(degrees:number)=>((degrees%360)+360)%360;

export class LocalizationFusionEngine {
  private estimate:LocalizationEstimate={buildingId:null,floorId:null,x:null,y:null,headingDegrees:null,confidence:0,uncertaintyRadius:null,sources:[],timestamp:0,lastStrongAnchorAt:null,state:'UNANCHORED'};
  private events:RelocalizationEvent[]=[];
  constructor(private readonly config:LocalizationConfig=DEFAULT_LOCALIZATION_CONFIG){}
  current(now:number):LocalizationEstimate {
    const base=this.estimate;
    if(base.state==='UNANCHORED')return {...base,timestamp:now};
    const elapsed=Math.max(0,now-base.timestamp);
    const anchorAge=base.lastStrongAnchorAt===null?Infinity:now-base.lastStrongAnchorAt;
    const confidence=clamp(base.confidence*Math.pow(.5,elapsed/this.config.confidenceHalfLifeMs));
    const uncertaintyRadius=base.uncertaintyRadius===null?null:base.uncertaintyRadius+elapsed/1000*.03;
    const state=confidence<this.config.lostThreshold||anchorAge>this.config.maxAnchorAgeMs?'LOCALIZATION_LOST':'TRACKING';
    if(state!==base.state)this.events.push({type:'LOCALIZATION_LOST',estimate:{...base,confidence,uncertaintyRadius,state,timestamp:now},timestamp:now});
    this.estimate={...base,confidence,uncertaintyRadius,state,timestamp:now};
    return {...this.estimate};
  }
  apply(observation:PositionObservation):LocalizationEstimate {
    const previous=this.current(observation.timestamp);
    const cap=sourceCap[observation.source];
    const confidence=clamp(Math.min(observation.confidence,cap));
    if(observation.source==='GPS_BUILDING'){
      this.estimate={...previous,buildingId:previous.state==='UNANCHORED'?observation.buildingId??previous.buildingId:previous.buildingId,
        confidence:previous.state==='UNANCHORED'?confidence:previous.confidence,
        sources:Array.from(new Set<LocalizationSource>([...previous.sources,'GPS_BUILDING'])),timestamp:observation.timestamp};
      return {...this.estimate};
    }
    if(observation.x===null||observation.y===null||!observation.floorId||!observation.buildingId)return previous;
    const isStrong=strong.has(observation.source);
    if(!isStrong&&previous.state==='UNANCHORED')return previous;
    if(!isStrong&&(previous.buildingId!==observation.buildingId||previous.floorId!==observation.floorId))return previous;
    let x=observation.x,y=observation.y,radius=observation.uncertaintyRadius??(isStrong?2:8);
    if(!isStrong&&previous.x!==null&&previous.y!==null){
      const weight=confidence/(confidence+previous.confidence||1);
      x=previous.x*(1-weight)+x*weight;y=previous.y*(1-weight)+y*weight;
      radius=Math.max(radius,previous.uncertaintyRadius??radius);
    }
    const next:LocalizationEstimate={buildingId:observation.buildingId,floorId:observation.floorId,x,y,
      headingDegrees:observation.headingDegrees??previous.headingDegrees,
      confidence:isStrong?confidence:Math.max(previous.confidence*.8,confidence),uncertaintyRadius:radius,
      sources:isStrong?[observation.source]:Array.from(new Set([...previous.sources,observation.source])),
      timestamp:observation.timestamp,lastStrongAnchorAt:isStrong?observation.timestamp:previous.lastStrongAnchorAt,state:'TRACKING'};
    if(previous.state==='LOCALIZATION_LOST')this.events.push({type:'LOCALIZATION_RECOVERED',estimate:next,source:observation.source,timestamp:observation.timestamp});
    else if(isStrong)this.events.push({type:'ANCHOR_APPLIED',estimate:next,source:observation.source,timestamp:observation.timestamp});
    this.estimate=next;return {...next};
  }
  move(stepLengthMeters:number,headingDegrees:number|null,timestamp:number):LocalizationEstimate {
    const previous=this.current(timestamp);
    if(previous.x===null||previous.y===null||headingDegrees===null||previous.state!=='TRACKING'||!previous.floorId)return previous;
    const radians=normalizeHeading(headingDegrees)*Math.PI/180;
    const x=previous.x+stepLengthMeters*Math.sin(radians),y=previous.y+stepLengthMeters*Math.cos(radians);
    const uncertaintyRadius=(previous.uncertaintyRadius??2)+this.config.driftPerStepMeters;
    const confidence=clamp(previous.confidence*Math.exp(-this.config.driftPerStepMeters/Math.max(1,uncertaintyRadius)));
    const state=confidence<this.config.lostThreshold?'LOCALIZATION_LOST':'TRACKING';
    this.estimate={...previous,x,y,headingDegrees:normalizeHeading(headingDegrees),uncertaintyRadius,confidence,
      sources:Array.from(new Set([...previous.sources,'STEP_MOTION' as const])),timestamp,state};
    if(state==='LOCALIZATION_LOST')this.events.push({type:'LOCALIZATION_LOST',estimate:this.estimate,timestamp});
    return {...this.estimate};
  }
  drainEvents(){const copy=this.events;this.events=[];return copy;}
  unknownFloor(timestamp:number){const previous=this.current(timestamp);this.estimate={...previous,floorId:null,confidence:Math.min(previous.confidence,.25),state:'LOCALIZATION_LOST',timestamp};this.events.push({type:'LOCALIZATION_LOST',estimate:this.estimate,timestamp});return {...this.estimate};}
  confirmFloorOnly(buildingId:string,floorId:string,source:LocalizationSource,timestamp:number){
    const previous=this.current(timestamp);
    this.estimate={...previous,buildingId,floorId,x:null,y:null,uncertaintyRadius:null,
      confidence:Math.min(sourceCap[source],.4),sources:[source],timestamp,state:'LOCALIZATION_LOST'};
    return {...this.estimate};
  }
}

export class FloorEstimator {
  private value:FloorEstimate={floorId:null,confidence:0,sources:[],timestamp:0,transitionPending:false};
  current(){return {...this.value};}
  observe(event:FloorTransitionEvent):FloorEstimate {
    if(event.type==='ENTER_ELEVATOR'||event.type==='STAIRS_TRANSITION'){
      this.value={floorId:null,confidence:0,sources:[event.source],timestamp:event.timestamp,transitionPending:true};
    }else if(event.type==='FLOOR_CONFIRMED'&&event.floorId){
      this.value={floorId:event.floorId,confidence:Math.min(sourceCap[event.source],1),sources:[event.source],timestamp:event.timestamp,transitionPending:false};
    }else if(event.type==='EXIT_ELEVATOR'){
      this.value={...this.value,floorId:null,confidence:0,timestamp:event.timestamp,transitionPending:true};
    }
    return this.current();
  }
}

export class HeadingProvider {
  private heading:HeadingEstimate={degrees:null,confidence:0,source:'NONE',timestamp:0};
  observe(degrees:number|null,source:HeadingEstimate['source'],timestamp:number,absolute:boolean):HeadingEstimate {
    if(degrees===null||!Number.isFinite(degrees))return this.heading;
    const jump=this.heading.degrees===null?0:Math.abs(((normalizeHeading(degrees)-this.heading.degrees+540)%360)-180);
    const interference=source==='COMPASS'&&timestamp-this.heading.timestamp<750&&jump>60;
    this.heading={degrees:normalizeHeading(degrees),confidence:interference?.2:source==='NATIVE_AR'?.9:absolute?.55:source==='GYROSCOPE'?.35:.25,source,timestamp};
    return {...this.heading};
  }
  current(now:number){return {...this.heading,confidence:this.heading.confidence*Math.pow(.5,Math.max(0,now-this.heading.timestamp)/15_000)};}
}

export class BasiraLocalizationEngine {
  readonly fusion:LocalizationFusionEngine;
  readonly floors=new FloorEstimator();
  readonly heading=new HeadingProvider();
  private stepLength:number;
  constructor(readonly config:LocalizationConfig=DEFAULT_LOCALIZATION_CONFIG){this.fusion=new LocalizationFusionEngine(config);this.stepLength=config.defaultStepLengthMeters;}
  calibrate(knownDistanceMeters:number,steps:number){
    if(!Number.isFinite(knownDistanceMeters)||!Number.isInteger(steps)||steps<3||knownDistanceMeters<=0)throw new Error('invalid_calibration');
    const length=knownDistanceMeters/steps;
    if(length<this.config.minStepLengthMeters||length>this.config.maxStepLengthMeters)throw new Error('calibration_out_of_range');
    this.stepLength=length;return length;
  }
  get calibratedStepLength(){return this.stepLength;}
  anchor(observation:PositionObservation){
    if(observation.floorId)this.floors.observe({type:'FLOOR_CONFIRMED',floorId:observation.floorId,timestamp:observation.timestamp,source:observation.source});
    return this.fusion.apply(observation);
  }
  transition(type:'ENTER_ELEVATOR'|'EXIT_ELEVATOR'|'STAIRS_TRANSITION',timestamp:number){
    this.floors.observe({type,floorId:null,timestamp,source:'MANUAL'});
    return this.fusion.unknownFloor(timestamp);
  }
  step(timestamp:number){const heading=this.heading.current(timestamp);return this.fusion.move(this.stepLength,heading.confidence>=.3?heading.degrees:null,timestamp);}
  visualAnchor(place:Place,nodes:MapNode[],confidence:number,timestamp:number):VisualAnchor|null {
    const node=nodes.find(item=>item.placeId===place.id&&item.floorId===place.floorId);
    const x=node?.x??place.localX,y=node?.y??place.localY;
    if(x===null||y===null)return null;
    this.anchor({buildingId:place.buildingId,floorId:place.floorId,x,y,headingDegrees:null,
      confidence:Math.min(confidence,.85),uncertaintyRadius:2,source:'VISUAL_PLACE',timestamp,nodeId:node?.id??null,placeId:place.id});
    return {placeId:place.id,nodeId:node?.id??null,buildingId:place.buildingId,floorId:place.floorId,x,y,confidence,timestamp};
  }
}

export class LoopClosureService {
  correct(track:MappingTrackPoint[],anchor:{x:number;y:number;floorId:string},startIndex=0):MappingTrackPoint[] {
    if(track.length<2||startIndex>=track.length-1)return track;
    const last=track[track.length-1];
    if(last.floorId!==anchor.floorId)return track;
    const dx=anchor.x-last.x,dy=anchor.y-last.y;
    const startTime=track[startIndex].timestamp,span=Math.max(1,last.timestamp-startTime);
    return track.map((point,index)=>{
      if(index<startIndex||point.floorId!==anchor.floorId)return point;
      const fraction=(point.timestamp-startTime)/span;
      return {...point,x:point.x+dx*fraction,y:point.y+dy*fraction};
    });
  }
}

export class MapDeduplicationService {
  constructor(private readonly radiusMeters:number=DEFAULT_LOCALIZATION_CONFIG.dedupRadiusMeters){}
  duplicate(candidate:Pick<MapSuggestion,'type'|'floorId'|'x'|'y'|'name'|'placeId'>,existing:Pick<MapSuggestion,'type'|'floorId'|'x'|'y'|'name'|'placeId'>[]):boolean {
    const normalized=(value:string|null)=>value?.normalize('NFKC').trim().toLocaleLowerCase()??'';
    return existing.some(item=>{
      if(item.floorId!==candidate.floorId)return false;
      if(item.placeId&&candidate.placeId&&item.placeId===candidate.placeId)return true;
      if(item.type!==candidate.type)return false;
      const named=normalized(item.name)&&normalized(item.name)===normalized(candidate.name);
      const nearby=item.x!==null&&item.y!==null&&candidate.x!==null&&candidate.y!==null&&distance({x:item.x,y:item.y},{x:candidate.x,y:candidate.y})<=this.radiusMeters;
      return Boolean(named&&nearby||named&&candidate.x===null||nearby&&(!item.name||!candidate.name));
    });
  }
}
