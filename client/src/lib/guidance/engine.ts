import type { Floor, MapEdge, MapNode, Place } from '@shared/navigation';
import type { LocalizationEstimate } from '@shared/localization';
import type { NavigationDestination, NavigationRoute, NavigationSession, RerouteReason, RouteProgress, RouteType, ArrivalEvidence } from '@shared/guidance';
import { RoutePlanner, metreDistance, trustedOrigin } from './route';
import { NavigationInstructionGenerator, arrived, type DirectionStyle, type GuidanceLanguage } from './instructions';
import { NavigationSafetyFusion, TemporaryRouteConstraints, type SafetyDecision } from './safety';
import type { SceneDescription } from '@shared/vision';

const terminal=new Set(['ARRIVED','CANCELLED','FAILED']);
const segmentDistance=(point:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));return metreDistance(point,{x:a.x+t*dx,y:a.y+t*dy});};
export class ReroutingEngine {
  constructor(private readonly planner:RoutePlanner,private readonly constraints:TemporaryRouteConstraints){}
  reroute(location:LocalizationEstimate,destination:NavigationDestination,type:RouteType,now=Date.now()):NavigationRoute|null {
    const origin=trustedOrigin(this.planner.nodes,location);
    return origin?this.planner.plan(origin.id,destination,type,this.constraints.active(now),now):null;
  }
}
export class BasiraNavigationEngine {
  readonly constraints=new TemporaryRouteConstraints();
  readonly safety=new NavigationSafetyFusion();
  readonly rerouting:ReroutingEngine;
  private instructions:NavigationInstructionGenerator;
  private offRouteCount=0;
  private lastReroute=0;
  private lastScene:SceneDescription|null=null;
  private destinationPlace:Place|null=null;
  readonly session:NavigationSession={id:crypto.randomUUID(),state:'PREPARING',route:null,destination:null,location:null,progress:null,instruction:null,safety:'ROUTE_UNCERTAIN',startedAt:Date.now(),endedAt:null,lastRerouteReason:null,failureReason:null};
  constructor(readonly planner:RoutePlanner,readonly floors:Floor[],lang:GuidanceLanguage='ar',style:DirectionStyle='LEFT_RIGHT'){
    this.instructions=new NavigationInstructionGenerator(floors,lang,style);
    this.safety.setLanguage(lang);
    this.rerouting=new ReroutingEngine(planner,this.constraints);
  }
  configure(lang:GuidanceLanguage,style:DirectionStyle){this.instructions=new NavigationInstructionGenerator(this.floors,lang,style);this.safety.setLanguage(lang);if(this.session.route&&this.session.progress)this.session.instruction=this.instructions.forEdge(this.session.route,this.session.progress.edgeIndex,this.session.location?.confidence??0);}
  prepare(destination:NavigationDestination,location:LocalizationEstimate,type:RouteType='RECOMMENDED',destinationPlace:Place|null=null):boolean {
    this.session.destination=destination;this.destinationPlace=destinationPlace;this.session.location=location;
    const origin=trustedOrigin(this.planner.nodes,location);
    if(!origin){this.session.state='RELOCALIZING';this.session.failureReason='location_uncertain';return false;}
    if(this.planner.building.mapStatus!=='MAPPED'||!this.planner.nodes.length||!this.planner.edges.length){this.session.state='FAILED';this.session.failureReason='incomplete_map';return false;}
    const route=this.planner.plan(origin.id,destination,type,this.constraints.active());
    if(!route){this.session.state='FAILED';this.session.failureReason='no_route';return false;}
    this.session.route=route;this.session.state='READY';this.session.failureReason=null;this.session.progress={nodeIndex:0,edgeIndex:0,distanceRemaining:route.totalDistance,fraction:0,offRoute:false,timestamp:Date.now()};
    this.session.instruction=this.instructions.forEdge(route,0,location.confidence);return true;
  }
  start(){if(this.session.state==='READY'){this.session.state='NAVIGATING';return true;}return false;}
  pause(){if(this.session.state==='NAVIGATING')this.session.state='PAUSED';}
  resume(){if(this.session.state==='PAUSED'&&this.session.location?.state==='TRACKING'&&(this.session.location.confidence>=.55))this.session.state='NAVIGATING';}
  cancel(){if(terminal.has(this.session.state))return;this.session.state='CANCELLED';this.session.endedAt=Date.now();this.constraints.clear();}
  fail(reason:string){this.session.state='FAILED';this.session.failureReason=reason;this.session.endedAt=Date.now();this.constraints.clear();}
  updateLocation(location:LocalizationEstimate,now=Date.now()):'LOST'|'RECOVERED'|'OFF_ROUTE'|'PROGRESS'|'UNCHANGED' {
    this.session.location=location;
    if(terminal.has(this.session.state))return 'UNCHANGED';
    if(location.state!=='TRACKING'||location.confidence<.55||location.floorId===null||location.x===null||location.y===null){
      if(this.session.state!=='RELOCALIZING'){this.session.state='RELOCALIZING';return 'LOST';}return 'UNCHANGED';
    }
    if(this.session.state==='RELOCALIZING'){
      if(location.confidence<.55)return 'UNCHANGED';
      if(this.session.route&&this.session.destination)return this.reroute('OFF_ROUTE',now)?'RECOVERED':'UNCHANGED';
      if(this.session.destination&&this.prepare(this.session.destination,location)){this.start();return 'RECOVERED';}
      return 'UNCHANGED';
    }
    if(this.session.state!=='NAVIGATING'||!this.session.route)return 'UNCHANGED';
    const progress=this.measure(this.session.route,location,now);
    this.session.progress=progress;
    if(progress.offRoute){this.offRouteCount++;if(this.offRouteCount>=3&&now-this.lastReroute>12_000){this.reroute('OFF_ROUTE',now);return 'OFF_ROUTE';}}
    else this.offRouteCount=0;
    this.session.instruction=this.instructions.forEdge(this.session.route,progress.edgeIndex,location.confidence);
    return 'PROGRESS';
  }
  private measure(route:NavigationRoute,location:LocalizationEstimate,now:number):RouteProgress {
    const point={x:location.x!,y:location.y!};let edgeIndex=0,best=Infinity;
    for(let i=0;i<route.orderedEdges.length;i++){
      const a=route.orderedNodes[i],b=route.orderedNodes[i+1];if(a.floorId!==location.floorId||b.floorId!==location.floorId)continue;
      const d=segmentDistance(point,a,b);if(d<best){best=d;edgeIndex=i;}
    }
    if(best===Infinity){const sameFloor=route.orderedNodes.findIndex(n=>n.floorId===location.floorId);if(sameFloor>=0){edgeIndex=Math.min(sameFloor,Math.max(0,route.orderedEdges.length-1));best=metreDistance(route.orderedNodes[sameFloor],point);}}
    const upcoming=route.orderedNodes[edgeIndex+1];
    if(upcoming&&upcoming.floorId===location.floorId&&metreDistance(point,upcoming)<=Math.max(1.5,Math.min(3,location.uncertaintyRadius??2))&&route.orderedEdges[edgeIndex+1])edgeIndex++;
    const current=route.orderedNodes[edgeIndex],next=route.orderedNodes[edgeIndex+1];
    const remaining=next?metreDistance(point,next)+route.orderedEdges.slice(edgeIndex+1).reduce((sum,e)=>sum+e.distanceMeters,0):0;
    const reliable=location.confidence>=.8&&route.confidence>=.8&&location.uncertaintyRadius!==null&&location.uncertaintyRadius<=3&&current?.floorId===next?.floorId;
    return {nodeIndex:edgeIndex,edgeIndex,distanceRemaining:reliable?remaining:null,fraction:reliable&&route.totalDistance>0?Math.max(0,Math.min(1,1-remaining/route.totalDistance)):null,offRoute:best>Math.max(5,(location.uncertaintyRadius??3)+2),timestamp:now};
  }
  observeScene(scene:SceneDescription,now=Date.now()):SafetyDecision {
    this.lastScene=scene;
    const decision=this.safety.evaluate(this.session.route,this.session.progress?.edgeIndex??0,this.session.location,scene,now);
    this.session.safety=decision.state;
    if(this.session.state==='NAVIGATING'&&decision.state==='ROUTE_BLOCKED'&&this.safety.persistent(decision,now)&&decision.edgeId){this.constraints.add(decision.edgeId,decision.hazard?'OBSTACLE':'UNCERTAIN_HAZARD',now);this.reroute('PERSISTENT_OBSTACLE',now);}
    return decision;
  }
  updateEdges(edges:MapEdge[],now=Date.now()){
    this.planner.edges.splice(0,this.planner.edges.length,...edges);
    if(this.session.state==='NAVIGATING'&&this.session.route?.orderedEdges.some(e=>{const current=edges.find(candidate=>candidate.id===e.id);return !current||current.temporarilyClosed;})){this.reroute('CLOSED_EDGE',now);return true;}
    return false;
  }
  reroute(reason:RerouteReason,now=Date.now()):boolean {
    const {location,destination,route}=this.session;if(!location||!destination)return false;
    this.session.state='REROUTING';this.session.lastRerouteReason=reason;this.lastReroute=now;
    const replacement=this.rerouting.reroute(location,destination,route?.routeType??'RECOMMENDED',now);
    if(!replacement){this.session.state=location.state==='TRACKING'?'FAILED':'RELOCALIZING';this.session.failureReason=location.state==='TRACKING'?'no_route':'location_uncertain';if(this.session.state==='FAILED')this.session.endedAt=now;return false;}
    this.session.route=replacement;this.session.progress={nodeIndex:0,edgeIndex:0,distanceRemaining:replacement.totalDistance,fraction:0,offRoute:false,timestamp:now};
    this.session.instruction=this.instructions.forEdge(replacement,0,location.confidence);this.session.state='NAVIGATING';return true;
  }
  considerArrival(visualPlaceId:string|null,ocrMatch:boolean,doorDirection:ArrivalEvidence['doorDirection']=null,manualConfirmation=false):boolean {
    const {location,destination}=this.session;if(!location||!destination||location.x===null||location.y===null)return false;
    const node=this.planner.nodes.find(n=>n.id===destination.nodeId);
    const matched=!!destination.placeId&&visualPlaceId===destination.placeId;
    const evidence:ArrivalEvidence={nodeProximity:!!node&&location.floorId===node.floorId&&location.uncertaintyRadius!==null&&location.uncertaintyRadius<=3&&metreDistance(location as {x:number;y:number},node)<=3,visualPlace:matched,ocrMatch:ocrMatch&&matched,manualConfirmation,localizationConfidence:location.confidence,doorDirection};
    if(this.session.state==='NAVIGATING'&&location.sources.some(source=>source!=='VISUAL_PLACE')&&arrived(evidence)){
      this.session.state='ARRIVED';this.session.endedAt=Date.now();this.session.instruction={id:'arrival',edgeId:null,nodeId:destination.nodeId,text:this.instructions.arrival(destination.name,doorDirection??null),kind:'ARRIVAL',distanceMeters:null,floorId:destination.floorId,confidence:location.confidence};this.constraints.clear();return true;
    }
    return false;
  }
  get scene(){return this.lastScene;}
}
