import type { LocalizationEstimate } from '@shared/localization';
import type { MapEdge, MapNode } from '@shared/navigation';
import { acceptGeoFix } from './geographicRoute';
import { geoDistance, gpsQuality, type GeoFix } from './outdoor';

export type IndoorTrailPoint = { x:number; y:number; timestamp:number; confidence:number; uncertaintyRadius:number };
export type IndoorTrailSegment = { floorId:string; points:IndoorTrailPoint[] };
export type OutdoorTrailSegment = { points:GeoFix[] };
export type WalkSaveBody = { name:string; buildingId:string; nodeIds:string[]; edgeIds:string[]; durationSeconds:number|null };
export type WalkSaveFailure = 'INVALID_INPUT'|'START_UNCONFIRMED'|'PATH_INCOMPLETE'|'DESTINATION_UNCONFIRMED'|'GRAPH_CHANGED'|'HAZARD';
export type WalkSaveResult = {ok:true;body:WalkSaveBody}|{ok:false;reason:WalkSaveFailure};

type IndoorFix = IndoorTrailPoint & {floorId:string};
type EdgeEvidence = {count:number; minProgress:number; maxProgress:number; lastPoint:IndoorFix|null};
type TransitionKind = 'STAIRS'|'ELEVATOR'|'RAMP';
type Transition = {kind:TransitionKind;at:number;fromNodeId:string};

const strongSources = new Set(['QR','NFC','MANUAL','VISUAL_PLACE','NATIVE_AR']);
const planarDistance = (a:{x:number;y:number},b:{x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
const edgeConnects = (edge:MapEdge,a:string,b:string) => edge.fromNodeId===a&&edge.toNodeId===b||edge.toNodeId===a&&edge.fromNodeId===b;
const project = (point:{x:number;y:number},a:MapNode,b:MapNode) => {
  const dx=b.x-a.x,dy=b.y-a.y,lengthSquared=dx*dx+dy*dy;
  if(lengthSquared<.25)return {progress:0,distance:Infinity};
  const progress=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSquared));
  return {progress,distance:planarDistance(point,{x:a.x+progress*dx,y:a.y+progress*dy})};
};
const copyIndoor = (segment:IndoorTrailSegment):IndoorTrailSegment => ({floorId:segment.floorId,points:segment.points.map(point=>({...point}))});
const copyOutdoor = (segment:OutdoorTrailSegment):OutdoorTrailSegment => ({points:segment.points.map(point=>({...point}))});

/** A private, volatile observation log. It never infers a walked edge from the planned route. */
export class WalkRecording {
  private readonly byId:Map<string,MapNode>;
  private readonly indoor:IndoorTrailSegment[]=[];
  private readonly outdoor:OutdoorTrailSegment[]=[];
  private readonly nodeIds:string[]=[];
  private readonly edgeIds:string[]=[];
  private readonly evidence=new Map<string,EdgeEvidence>();
  private cursor:string|null=null;
  private lastIndoor:IndoorFix|null=null;
  private lastOutdoor:GeoFix|null=null;
  private indoorGap=false;
  private outdoorGap=false;
  private incomplete=false;
  private transition:Transition|null=null;

  constructor(private readonly graph:{buildingId:string;nodes:MapNode[];edges:MapEdge[];startNodeId?:string|null}) {
    this.byId=new Map(graph.nodes.filter(node=>node.buildingId===graph.buildingId).map(node=>[node.id,node]));
  }

  /** A floor change needs an explicit transition event followed by a new-floor anchor. */
  observeFloorTransition(kind:TransitionKind,at:number){
    if(!this.cursor||!Number.isFinite(at)||at<=0)return false;
    const from=this.byId.get(this.cursor),fix=this.lastIndoor;
    // A button press is transition evidence only at the mapped entrance, with a recent
    // trusted fix. A prior endpoint or a stale/lost fix cannot certify an unseen walk.
    if(!from||!fix||this.indoorGap||this.transition||fix.floorId!==from.floorId||
      at<fix.timestamp||at-fix.timestamp>10_000||this.nearNode(fix)?.id!==from.id)return false;
    const matchingEdge=this.graph.edges.some(edge=>{
      if(edge.buildingId!==this.graph.buildingId||edge.pathType!==kind||edge.temporarilyClosed||edge.riskLevel==='HIGH')return false;
      const otherId=edge.fromNodeId===from.id?edge.toNodeId:edge.toNodeId===from.id?edge.fromNodeId:null;
      const other=otherId?this.byId.get(otherId):null;
      return !!other&&other.floorId!==from.floorId;
    });
    if(!matchingEdge)return false;
    this.transition={kind,at,fromNodeId:this.cursor};
    this.indoorGap=true;
    return true;
  }

  /** Accepts only bounded, monotonic indoor estimates; a gap cannot silently bridge movement. */
  observeIndoor(estimate:LocalizationEstimate):boolean {
    if(this.lastIndoor&&estimate.timestamp<=this.lastIndoor.timestamp)return false;
    if(!this.validIndoor(estimate)){
      if(this.lastIndoor){this.indoorGap=true;this.evidence.clear();}
      return false;
    }
    const fix:IndoorFix={floorId:estimate.floorId!,x:estimate.x!,y:estimate.y!,timestamp:estimate.timestamp,
      confidence:estimate.confidence,uncertaintyRadius:estimate.uncertaintyRadius!};
    const previous=this.lastIndoor;
    const changingFloor=!!previous&&previous.floorId!==fix.floorId;
    const recoveringGap=this.indoorGap;
    const moved=previous?planarDistance(previous,fix):0;
    const elapsed=previous?(fix.timestamp-previous.timestamp)/1000:0;
    const continuous=!!previous&&!changingFloor&&(!this.indoorGap||moved<=1.5)&&
      !(elapsed>20&&moved>2)&&moved<=Math.max(2.5,elapsed*2.5+previous!.uncertaintyRadius+fix.uncertaintyRadius);
    if(previous&&!continuous&&!changingFloor){this.startIndoorSegment(fix);if(this.cursor)this.incomplete=true;}
    else if(!previous||changingFloor||this.indoorGap)this.startIndoorSegment(fix);
    else this.appendIndoor(fix);
    this.lastIndoor=fix;
    this.indoorGap=false;

    const node=this.nearNode(fix);
    if(previous&&recoveringGap&&!changingFloor){
      const freshAnchor=estimate.lastStrongAnchorAt!==null&&estimate.timestamp-estimate.lastStrongAnchorAt<=2_000&&
        estimate.sources.some(source=>strongSources.has(source));
      // A gap may resume only at the last confirmed node with a fresh strong anchor.
      if(node?.id!==this.cursor||!freshAnchor)this.incomplete=true;
      this.evidence.clear();
    }
    if(!this.cursor){
      const start=this.graph.startNodeId?this.byId.get(this.graph.startNodeId):node;
      const freshAnchor=estimate.lastStrongAnchorAt!==null&&estimate.timestamp-estimate.lastStrongAnchorAt<=2_000&&
        estimate.sources.some(source=>strongSources.has(source));
      if(start&&node?.id===start.id&&(this.graph.startNodeId||freshAnchor)){
        this.cursor=start.id;this.nodeIds.push(start.id);
      }
      return true;
    }
    if(changingFloor){this.completeTransition(node,estimate);return true;}
    if(!continuous&&previous){if(node)this.cursor=node.id;this.evidence.clear();return true;}
    this.observeEdgeEvidence(fix);
    if(node&&node.id!==this.cursor)this.visitNode(node);
    return true;
  }

  /** GPS remains an outdoor drawing only; it is never included in saved-routes payloads. */
  observeOutdoor(fix:GeoFix,now=Date.now()):boolean {
    if(!Number.isFinite(fix.latitude)||!Number.isFinite(fix.longitude)||Math.abs(fix.latitude)>90||Math.abs(fix.longitude)>180||
      !Number.isFinite(fix.accuracy)||fix.accuracy<0||fix.accuracy>25||!Number.isFinite(fix.timestamp)||
      fix.timestamp>now+5_000||gpsQuality(fix,now)==='LOST'||gpsQuality(fix,now)==='LOW'){
      this.outdoorGap=true;return false;
    }
    if(this.lastOutdoor&&fix.timestamp<=this.lastOutdoor.timestamp)return false;
    const previous=this.lastOutdoor;
    if(previous&&!acceptGeoFix(fix,previous)){
      if(geoDistance(fix,previous)>Math.max(35,fix.accuracy+previous.accuracy))this.outdoorGap=true;
      return false;
    }
    const separated=previous&&(this.outdoorGap||fix.timestamp-previous.timestamp>20_000||
      geoDistance(fix,previous)>Math.max(30,fix.accuracy+previous.accuracy));
    if(!previous||separated)this.outdoor.push({points:[{...fix}]});
    else this.outdoor[this.outdoor.length-1].points.push({...fix});
    this.lastOutdoor={...fix};this.outdoorGap=false;
    this.trimOutdoor();
    return true;
  }

  snapshot(){
    return {indoorSegments:this.indoor.map(copyIndoor),outdoorSegments:this.outdoor.map(copyOutdoor),
      nodeIds:[...this.nodeIds],edgeIds:[...this.edgeIds],incomplete:this.incomplete,
      startConfirmed:this.nodeIds.length>0};
  }

  /** Current map hazards are checked again immediately before POST /saved-routes. */
  saveBody(name:string,destinationNodeId:string,durationSeconds:number|null,currentEdges:MapEdge[],blockedEdgeIds:ReadonlySet<string>=new Set()):WalkSaveResult {
    const trimmed=name.trim();
    if(!trimmed||trimmed.length>255||durationSeconds!==null&&(!Number.isInteger(durationSeconds)||durationSeconds<1||durationSeconds>86400))
      return {ok:false,reason:'INVALID_INPUT'};
    if(!this.nodeIds.length)return {ok:false,reason:'START_UNCONFIRMED'};
    if(this.incomplete||!this.edgeIds.length||this.edgeIds.length!==this.nodeIds.length-1||new Set(this.nodeIds).size!==this.nodeIds.length)
      return {ok:false,reason:'PATH_INCOMPLETE'};
    const destination=this.byId.get(destinationNodeId);
    if(this.nodeIds[this.nodeIds.length-1]!==destinationNodeId||this.cursor!==destinationNodeId||!destination||
      !this.lastIndoor||this.indoorGap||this.transition||this.lastIndoor.floorId!==destination.floorId||
      planarDistance(this.lastIndoor,destination)>1.25)
      return {ok:false,reason:'DESTINATION_UNCONFIRMED'};
    const byId=new Map(currentEdges.filter(edge=>edge.buildingId===this.graph.buildingId).map(edge=>[edge.id,edge]));
    const originalById=new Map(this.graph.edges.map(edge=>[edge.id,edge]));
    for(let i=0;i<this.edgeIds.length;i++){
      const edge=byId.get(this.edgeIds[i]),original=originalById.get(this.edgeIds[i]);
      const a=this.byId.get(this.nodeIds[i]),b=this.byId.get(this.nodeIds[i+1]);
      if(!edge||!original||!a||!b||edge.pathType!==original.pathType||!edgeConnects(edge,a.id,b.id)||
        a.floorId!==b.floorId&&!['STAIRS','ELEVATOR','RAMP'].includes(edge.pathType))
        return {ok:false,reason:'GRAPH_CHANGED'};
      if(edge.temporarilyClosed||edge.riskLevel==='HIGH'||blockedEdgeIds.has(edge.id))return {ok:false,reason:'HAZARD'};
    }
    return {ok:true,body:{name:trimmed,buildingId:this.graph.buildingId,nodeIds:[...this.nodeIds],edgeIds:[...this.edgeIds],durationSeconds}};
  }

  private validIndoor(estimate:LocalizationEstimate){
    return estimate.state==='TRACKING'&&estimate.buildingId===this.graph.buildingId&&!!estimate.floorId&&
      estimate.x!==null&&estimate.y!==null&&Number.isFinite(estimate.x)&&Number.isFinite(estimate.y)&&
      estimate.confidence>=.65&&estimate.uncertaintyRadius!==null&&estimate.uncertaintyRadius<=3&&
      estimate.uncertaintyRadius>=0&&Number.isFinite(estimate.timestamp)&&estimate.timestamp>0;
  }
  private nearNode(fix:IndoorFix):MapNode|null {
    const ranked=this.graph.nodes.filter(node=>node.buildingId===this.graph.buildingId&&node.floorId===fix.floorId)
      .map(node=>({node,distance:planarDistance(node,fix)})).sort((a,b)=>a.distance-b.distance);
    return ranked[0]?.distance<=1.25&&(!ranked[1]||ranked[1].distance-ranked[0].distance>=.6)?ranked[0].node:null;
  }
  private startIndoorSegment(fix:IndoorFix){this.indoor.push({floorId:fix.floorId,points:[{x:fix.x,y:fix.y,timestamp:fix.timestamp,confidence:fix.confidence,uncertaintyRadius:fix.uncertaintyRadius}]});this.trimIndoor();}
  private appendIndoor(fix:IndoorFix){this.indoor[this.indoor.length-1].points.push({x:fix.x,y:fix.y,timestamp:fix.timestamp,confidence:fix.confidence,uncertaintyRadius:fix.uncertaintyRadius});this.trimIndoor();}
  private trimIndoor(){let count=this.indoor.reduce((sum,segment)=>sum+segment.points.length,0);while(count>600&&this.indoor.length){const first=this.indoor[0];first.points.shift();count--;if(!first.points.length)this.indoor.shift();}}
  private trimOutdoor(){let count=this.outdoor.reduce((sum,segment)=>sum+segment.points.length,0);while(count>300&&this.outdoor.length){const first=this.outdoor[0];first.points.shift();count--;if(!first.points.length)this.outdoor.shift();}}
  private observeEdgeEvidence(fix:IndoorFix){
    const from=this.cursor?this.byId.get(this.cursor):null;
    if(!from||from.floorId!==fix.floorId)return;
    const matches=this.graph.edges.flatMap(edge=>{
      const otherId=edge.fromNodeId===from.id?edge.toNodeId:edge.toNodeId===from.id?edge.fromNodeId:null;
      const other=otherId?this.byId.get(otherId):null;
      if(!other||other.floorId!==fix.floorId)return [];
      const position=project(fix,from,other);
      return position.progress>=.12&&position.progress<=.88&&position.distance<=1.5?[{edge,position}]:[];
    }).sort((a,b)=>a.position.distance-b.position.distance);
    if(!matches.length||matches[1]&&matches[1].position.distance-matches[0].position.distance<.35)return;
    const {edge,position}=matches[0],previous=this.evidence.get(edge.id)??{count:0,minProgress:1,maxProgress:0,lastPoint:null};
    if(previous.lastPoint&&planarDistance(previous.lastPoint,fix)<.45)return;
    this.evidence.set(edge.id,{count:previous.count+1,minProgress:Math.min(previous.minProgress,position.progress),
      maxProgress:Math.max(previous.maxProgress,position.progress),lastPoint:fix});
  }
  private visitNode(node:MapNode){
    const from=this.cursor?this.byId.get(this.cursor):null;
    const edge=this.graph.edges.find(candidate=>from&&edgeConnects(candidate,from.id,node.id));
    const evidence=edge?this.evidence.get(edge.id):null;
    const confirmed=!!edge&&!!from&&from.floorId===node.floorId&&!!evidence&&evidence.count>=2&&
      evidence.minProgress<=.55&&evidence.maxProgress>=.45&&evidence.maxProgress-evidence.minProgress>=.2;
    if(!confirmed||this.nodeIds.includes(node.id))this.incomplete=true;
    else if(!this.incomplete){this.nodeIds.push(node.id);this.edgeIds.push(edge.id);}
    this.cursor=node.id;this.evidence.clear();this.transition=null;
  }
  private completeTransition(node:MapNode|null,estimate:LocalizationEstimate){
    const pending=this.transition;
    const anchored=estimate.lastStrongAnchorAt!==null&&estimate.timestamp-estimate.lastStrongAnchorAt<=2_000&&
      estimate.sources.some(source=>strongSources.has(source));
    const edge=pending&&node?this.graph.edges.find(candidate=>edgeConnects(candidate,pending.fromNodeId,node.id)&&candidate.pathType===pending.kind):null;
    if(!pending||!node||!edge||!anchored||estimate.timestamp-pending.at>120_000||this.nodeIds.includes(node.id))this.incomplete=true;
    else if(!this.incomplete){this.nodeIds.push(node.id);this.edgeIds.push(edge.id);}
    if(node)this.cursor=node.id;
    this.transition=null;this.evidence.clear();
  }
}
