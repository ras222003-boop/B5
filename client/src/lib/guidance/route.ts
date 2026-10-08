import type { Building, MapEdge, MapNode, Place, SavedPlace } from '@shared/navigation';
import type { LocalizationEstimate } from '@shared/localization';
import type { NavigationDestination, NavigationRoute, RouteConstraint, RouteType } from '@shared/guidance';

export const metreDistance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
export function trustedOrigin(nodes:MapNode[],estimate:LocalizationEstimate):MapNode|null {
  if(estimate.state!=='TRACKING'||estimate.confidence<.55||estimate.x===null||estimate.y===null||!estimate.floorId||!estimate.buildingId)return null;
  const candidates=nodes.filter(n=>n.buildingId===estimate.buildingId&&n.floorId===estimate.floorId).sort((a,b)=>metreDistance(a,estimate as {x:number;y:number})-metreDistance(b,estimate as {x:number;y:number}));
  const nearest=candidates[0];
  return nearest&&metreDistance(nearest,estimate as {x:number;y:number})<=Math.max(5,Math.min(10,(estimate.uncertaintyRadius??3)+3))?nearest:null;
}
/** Saved-place lookup must come from the authenticated private saved-places endpoint. */
export function resolveDestination(item:Place|SavedPlace,kind:'place'|'saved',nodes:MapNode[]):NavigationDestination|null {
  if(!item.buildingId||!item.floorId)return null;
  const id=kind==='place'?item.id:(item as SavedPlace).placeId;
  if(kind==='saved'&&!id&&((item as SavedPlace).localizationConfidence??0)<.55)return null;
  let node=id?nodes.find(n=>n.placeId===id&&n.floorId===item.floorId):undefined;
  const x=item.localX,y=item.localY;
  if(!node&&x!=null&&y!=null)node=nodes.filter(n=>n.floorId===item.floorId&&n.buildingId===item.buildingId).sort((a,b)=>metreDistance(a,{x,y})-metreDistance(b,{x,y}))[0];
  if(!node||((!id||node.placeId!==id)&&x!=null&&y!=null&&metreDistance(node,{x,y})>6))return null;
  return {kind,id:item.id,name:item.name,buildingId:item.buildingId,floorId:item.floorId,nodeId:node.id,placeId:id??null};
}

export class AccessibilityCostModel {
  constructor(private readonly building:Building){}
  cost(edge:MapEdge,type:RouteType):number {
    // A high-risk edge is not a valid shortcut, even in SHORTEST mode.
    if(edge.temporarilyClosed||edge.riskLevel==='HIGH'||!Number.isFinite(edge.distanceMeters)||edge.distanceMeters<=0)return Infinity;
    if(type==='ACCESSIBLE'&&(edge.hasStairs||edge.pathType==='STAIRS'||!edge.wheelchairAccessible))return Infinity;
    const distance=edge.distanceMeters;
    const hazard=edge.riskLevel==='MEDIUM'?12:0;
    if(type==='SHORTEST')return distance+hazard;
    const stairs=edge.hasStairs||edge.pathType==='STAIRS'?35:0;
    const elevator=edge.pathType==='ELEVATOR'?5:0;
    const access=edge.accessibilityLevel==='UNKNOWN'?8:edge.accessibilityLevel==='STANDARD'?3:0;
    const visual=edge.visuallyImpairedFriendly?0:12;
    const map=this.building.verificationStatus==='DISCOVERED'?10:this.building.mapStatus!=='MAPPED'?6:0;
    return distance+hazard+stairs+elevator+access+visual+map;
  }
}
export class RoutePlanner {
  private readonly byId:Map<string,MapNode>;
  private readonly model:AccessibilityCostModel;
  private familiarEdgeIds:ReadonlySet<string>=new Set();
  constructor(readonly building:Building,readonly nodes:MapNode[],readonly edges:MapEdge[]){this.byId=new Map(nodes.map(n=>[n.id,n]));this.model=new AccessibilityCostModel(building);}
  preferFamiliarEdges(edgeIds:ReadonlySet<string>){this.familiarEdgeIds=edgeIds;}
  plan(originId:string,destination:NavigationDestination,type:RouteType='RECOMMENDED',constraints:RouteConstraint[]=[],now=Date.now()):NavigationRoute|null {
    const origin=this.byId.get(originId),target=this.byId.get(destination.nodeId);
    if(!origin||!target||origin.buildingId!==destination.buildingId||target.buildingId!==destination.buildingId)return null;
    const blocked=new Set(constraints.filter(c=>c.expiresAt>now).map(c=>c.edgeId));
    const distance=new Map<string,number>([[origin.id,0]]),previous=new Map<string,{node:string;edge:MapEdge}>(),unvisited=new Set(this.nodes.filter(n=>n.buildingId===origin.buildingId).map(n=>n.id));
    while(unvisited.size){
      let current:string|null=null,best=Infinity;
      for(const id of Array.from(unvisited)){const score=distance.get(id)??Infinity;if(score<best){best=score;current=id;}}
      if(!current||best===Infinity)break;
      if(current===target.id)break;
      unvisited.delete(current);
      for(const edge of this.edges){
        if(blocked.has(edge.id))continue;
        const next=edge.fromNodeId===current?edge.toNodeId:edge.toNodeId===current?edge.fromNodeId:null;
        if(!next||!unvisited.has(next))continue;
        const a=this.byId.get(current),b=this.byId.get(next);
        if(!a||!b||a.buildingId!==b.buildingId)continue;
        if(a.floorId!==b.floorId&&!['ELEVATOR','STAIRS','RAMP'].includes(edge.pathType))continue;
        const base=this.model.cost(edge,type);
        // Familiarity can soften a low-risk edge's cost, never make a closed or hazardous edge usable.
        const cost=type==='RECOMMENDED'&&this.familiarEdgeIds.has(edge.id)&&edge.riskLevel==='LOW'&&Number.isFinite(base)?base*.78:base;
        if(best+cost<(distance.get(next)??Infinity)){distance.set(next,best+cost);previous.set(next,{node:current,edge});}
      }
    }
    if(origin.id!==target.id&&!previous.has(target.id))return null;
    const orderedNodes:MapNode[]=[target],orderedEdges:MapEdge[]=[];
    let cursor=target.id;
    while(cursor!==origin.id){const step=previous.get(cursor);if(!step)return null;orderedEdges.unshift(step.edge);orderedNodes.unshift(this.byId.get(step.node)!);cursor=step.node;}
    const totalDistance=orderedEdges.reduce((sum,e)=>sum+e.distanceMeters,0);
    const riskScore=Math.min(1,orderedEdges.reduce((sum,e)=>sum+(e.riskLevel==='HIGH'?.2:e.riskLevel==='MEDIUM'?.07:0),0));
    const accessibilityScore=Math.max(0,1-orderedEdges.reduce((sum,e)=>sum+(e.hasStairs?.15:0)+(!e.visuallyImpairedFriendly?.07:0)+(e.accessibilityLevel==='UNKNOWN'?.04:0),0));
    const confidence=Math.max(0,Math.min(1,(this.building.verificationStatus==='OFFICIAL'?.92:this.building.verificationStatus==='COMMUNITY_VERIFIED'?.78:.58)-(this.building.mapStatus==='MAPPED'?0:.2)-riskScore*.25));
    return {id:crypto.randomUUID(),origin,destination,floors:Array.from(new Set(orderedNodes.map(n=>n.floorId))),orderedNodes,orderedEdges,totalDistance,estimatedSteps:Math.round(totalDistance/.65),accessibilityScore,riskScore,confidence,routeType:type};
  }
  options(originId:string,destination:NavigationDestination,constraints:RouteConstraint[]=[],now=Date.now()){
    return (['RECOMMENDED','SHORTEST','ACCESSIBLE'] as const).map(type=>this.plan(originId,destination,type,constraints,now)).filter((route):route is NavigationRoute=>route!==null);
  }
  nearestPlace(originId:string,places:Place[],kind:string,constraints:RouteConstraint[]=[],now=Date.now()){
    const matching=places.filter(p=>p.placeType===kind||p.name.includes(kind));
    return matching.map(place=>{const destination=resolveDestination(place,'place',this.nodes);return destination?{place,route:this.plan(originId,destination,'RECOMMENDED',constraints,now)}:null;}).filter((v):v is {place:Place;route:NavigationRoute}=>!!v?.route).sort((a,b)=>a.route.totalDistance-b.route.totalDistance)[0]??null;
  }
}
