import type { MapNode, Place } from '@shared/navigation';
import type { FloorTransitionEvent, MapSuggestion, MapSuggestionType, MappingTrackPoint, PositionObservation } from '@shared/localization';
import type { PlaceCandidate, WalkableAreaResult } from '@shared/vision';
import { BasiraLocalizationEngine, LoopClosureService, MapDeduplicationService, distance, normalizeHeading } from './engine';

export class MappingSessionEngine {
  readonly localization=new BasiraLocalizationEngine();
  readonly track:MappingTrackPoint[]=[];
  readonly anchors:PositionObservation[]=[];
  readonly floorEvents:FloorTransitionEvent[]=[];
  readonly suggestions:MapSuggestion[]=[];
  private lastAnchor=new Map<string,number>();
  private lastCorridorIndex=0;
  private lastHeading:number|null=null;
  private walkable:WalkableAreaResult|null=null;
  readonly dedup=new MapDeduplicationService();
  readonly closure=new LoopClosureService();
  knownPlaces=0;
  constructor(readonly sessionId:string,readonly buildingId:string,readonly nodes:MapNode[]){}

  private record(timestamp:number){
    const e=this.localization.fusion.current(timestamp);
    if(e.x===null||e.y===null||!e.floorId)return;
    this.track.push({sessionId:this.sessionId,timestamp,x:e.x,y:e.y,floorId:e.floorId,
      headingDegrees:e.headingDegrees,confidence:e.confidence,sourceSummary:e.sources});
  }
  anchor(observation:PositionObservation){
    if(observation.buildingId!==this.buildingId)return;
    const key=observation.nodeId??observation.placeId;
    if(key&&observation.x!==null&&observation.y!==null&&observation.floorId&&this.lastAnchor.has(key)){
      const startIndex=this.lastAnchor.get(key)!;
      const oldLast=this.track[this.track.length-1],start=this.track[startIndex];
      const corrected=this.closure.correct(this.track,{x:observation.x,y:observation.y,floorId:observation.floorId},startIndex);
      if(oldLast&&start&&oldLast.floorId===observation.floorId){
        const dx=observation.x-oldLast.x,dy=observation.y-oldLast.y,span=Math.max(1,oldLast.timestamp-start.timestamp);
        for(const suggestion of this.suggestions){
          const at=Date.parse(suggestion.createdAt);
          if(suggestion.floorId!==observation.floorId||at<start.timestamp||at>oldLast.timestamp)continue;
          const fraction=Math.max(0,Math.min(1,(at-start.timestamp)/span));
          if(suggestion.x!==null)suggestion.x+=dx*fraction;
          if(suggestion.y!==null)suggestion.y+=dy*fraction;
          if(suggestion.geometry){
            suggestion.geometry={from:{x:suggestion.geometry.from.x+dx*fraction,y:suggestion.geometry.from.y+dy*fraction},
              to:{x:suggestion.geometry.to.x+dx*fraction,y:suggestion.geometry.to.y+dy*fraction}};
          }
        }
      }
      this.track.splice(0,this.track.length,...corrected);
    }
    this.localization.anchor(observation);
    this.anchors.push(observation);
    if(observation.floorId)this.floorEvents.push({type:'FLOOR_CONFIRMED',floorId:observation.floorId,timestamp:observation.timestamp,source:observation.source});
    this.record(observation.timestamp);
    if(key)this.lastAnchor.set(key,this.track.length-1);
  }
  transition(type:'ENTER_ELEVATOR'|'EXIT_ELEVATOR'|'STAIRS_TRANSITION',timestamp:number){
    this.floorEvents.push({type,floorId:null,timestamp,source:'MANUAL'});
    return this.localization.transition(type,timestamp);
  }
  step(timestamp:number){
    const before=this.localization.fusion.current(timestamp);
    const after=this.localization.step(timestamp);
    if(after.x===before.x&&after.y===before.y)return;
    this.record(timestamp);
    if(after.state!=='TRACKING'||!after.floorId||after.x===null||after.y===null)return;
    const h=after.headingDegrees;
    if(h!==null&&this.lastHeading!==null){
      const turn=Math.abs(((h-this.lastHeading+540)%360)-180);
      if(turn>=55&&this.walkable?.pathAhead==='CLEAR'&&this.walkable.confidence>=.55)
        this.propose('INTERSECTION',after.floorId,after.x,after.y,null,null,Math.min(.55,after.confidence),['STEP_MOTION']);
    }
    this.lastHeading=h;
    const start=this.track[this.lastCorridorIndex];
    if(start&&start.floorId===after.floorId&&distance(start,{x:after.x,y:after.y})>=3&&this.walkable?.pathAhead==='CLEAR'&&this.walkable.confidence>=.55){
      this.propose('CORRIDOR',after.floorId,(start.x+after.x)/2,(start.y+after.y)/2,null,null,
        Math.min(.6,after.confidence,this.walkable.confidence),['STEP_MOTION','VISION_WALKABLE'],
        {from:{x:start.x,y:start.y},to:{x:after.x,y:after.y}});
      this.lastCorridorIndex=this.track.length-1;
    }
  }
  observeWalkable(area:WalkableAreaResult|null){this.walkable=area;}
  recognized(place:Place,confidence:number,timestamp:number){
    const node=this.nodes.find(n=>n.placeId===place.id&&n.floorId===place.floorId);
    const x=node?.x??place.localX,y=node?.y??place.localY;
    if(x===null||y===null){
      this.localization.floors.observe({type:'FLOOR_CONFIRMED',floorId:place.floorId,timestamp,source:'VISUAL_PLACE'});
      this.localization.fusion.confirmFloorOnly(place.buildingId,place.floorId,'VISUAL_PLACE',timestamp);
      this.floorEvents.push({type:'FLOOR_CONFIRMED',floorId:place.floorId,timestamp,source:'VISUAL_PLACE'});
      this.knownPlaces++;return true;
    }
    this.anchor({buildingId:place.buildingId,floorId:place.floorId,x,y,
      headingDegrees:null,confidence:Math.min(confidence,.85),uncertaintyRadius:2,source:'VISUAL_PLACE',
      timestamp,nodeId:node?.id??null,placeId:place.id});
    this.knownPlaces++;
    return true;
  }
  candidate(candidate:PlaceCandidate){
    if(candidate.lookupStatus!=='NOT_FOUND')return null;
    const e=this.localization.fusion.current(candidate.capturedAt);
    if(e.state!=='TRACKING'||e.buildingId!==this.buildingId||!e.floorId||e.x===null||e.y===null)return null;
    return this.propose('PLACE_ANCHOR',e.floorId,e.x,e.y,candidate.detectedText,null,
      Math.min(candidate.confidence,e.confidence,.7),['VISUAL_PLACE'],null,candidate.suggestedType);
  }
  manual(type:MapSuggestionType,name:string|null){
    const e=this.localization.fusion.current(Date.now());
    if(e.state!=='TRACKING'||!e.floorId||e.x===null||e.y===null)return null;
    return this.propose(type,e.floorId,e.x,e.y,name,null,Math.min(.85,e.confidence),['MANUAL']);
  }
  propose(type:MapSuggestionType,floorId:string,x:number,y:number,name:string|null,placeId:string|null,
    confidence:number,source:MapSuggestion['source'],geometry:MapSuggestion['geometry']=null,suggestedPlaceType:MapSuggestion['suggestedPlaceType']=null){
    if(confidence<.3)return null;
    const approximate=`${Math.round(x/2)}:${Math.round(y/2)}`;
    const dedupKey=`${type}:${floorId}:${placeId??name?.normalize('NFKC').trim().toLowerCase()??''}:${approximate}`;
    const suggestion:MapSuggestion={id:crypto.randomUUID(),sessionId:this.sessionId,buildingId:this.buildingId,
      floorId,type,status:'PENDING',confidence,x,y,name,placeId,suggestedPlaceType,fromNodeId:null,toNodeId:null,
      source,geometry,dedupKey,createdAt:new Date().toISOString(),reviewedAt:null,reviewedBy:null};
    if(this.dedup.duplicate(suggestion,this.suggestions)||this.suggestions.some(s=>s.dedupKey===dedupKey))return null;
    this.suggestions.push(suggestion);return suggestion;
  }
}
