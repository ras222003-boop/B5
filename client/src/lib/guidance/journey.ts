import type { Building, MapEdge, MapNode, SavedRoute } from '@shared/navigation';
import type { NavigationRoute, RouteConstraint } from '@shared/guidance';

export type FamiliarAssessment = {eligible:boolean;reason:'READY'|'DIFFERENT_DESTINATION'|'DIFFERENT_START'|'MAP_CHANGED'|'HAZARD'|'STALE';edgeIds:ReadonlySet<string>};
/** Saved IDs are only a prior preference. Live graph conditions always decide the actual route. */
export function assessFamiliarRoute(saved:SavedRoute, building:Building, nodes:MapNode[], edges:MapEdge[], originId:string, destinationId:string, constraints:RouteConstraint[], now=Date.now()):FamiliarAssessment {
  const unavailable=(reason:FamiliarAssessment['reason']):FamiliarAssessment=>({eligible:false,reason,edgeIds:new Set()});
  if (saved.destinationNodeId !== destinationId || saved.buildingId !== building.id) return unavailable('DIFFERENT_DESTINATION');
  const start=nodes.find(node=>node.id===saved.originNodeId),current=nodes.find(node=>node.id===originId);
  if (!start||!current||start.floorId!==current.floorId||Math.hypot(start.x-current.x,start.y-current.y)>12) return unavailable('DIFFERENT_START');
  const nodeById=new Map(nodes.map(node=>[node.id,node]));
  const edgeById=new Map(edges.map(edge=>[edge.id,edge]));
  if (saved.routeData.edgeIds.length!==saved.routeData.nodeIds.length-1||new Set(saved.routeData.nodeIds).size!==saved.routeData.nodeIds.length) return unavailable('MAP_CHANGED');
  const temporary=new Set(constraints.filter(item=>item.expiresAt>now).map(item=>item.edgeId));
  for (let i=0;i<saved.routeData.edgeIds.length;i++) {
    const a=nodeById.get(saved.routeData.nodeIds[i]),b=nodeById.get(saved.routeData.nodeIds[i+1]),edge=edgeById.get(saved.routeData.edgeIds[i]);
    if (!a||!b||!edge||!((edge.fromNodeId===a.id&&edge.toNodeId===b.id)||(edge.toNodeId===a.id&&edge.fromNodeId===b.id))) return unavailable('MAP_CHANGED');
    if(a.floorId!==b.floorId&&!['ELEVATOR','STAIRS','RAMP'].includes(edge.pathType))return unavailable('MAP_CHANGED');
    if (edge.temporarilyClosed||temporary.has(edge.id)||edge.riskLevel==='HIGH') return unavailable('HAZARD');
  }
  const age=now-new Date(saved.lastSuccessfulAt).getTime();
  if (!Number.isFinite(age)||age>180*86400000) return unavailable('STALE');
  return {eligible:true,reason:'READY',edgeIds:new Set(saved.routeData.edgeIds)};
}

/** The official graph is already simplified to decision nodes; retain no per-step or GPS samples. */
export function routeSaveBody(route:NavigationRoute,name:string,durationSeconds:number|null) {
  return {name:name.trim(),buildingId:route.origin.buildingId,nodeIds:route.orderedNodes.map(node=>node.id),edgeIds:route.orderedEdges.map(edge=>edge.id),durationSeconds};
}
