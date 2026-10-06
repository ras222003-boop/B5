export type NodeRow = {id:string; floor_id:string; place_id:string|null; x:number; y:number};
export type EdgeRow = {id:string; from_node_id:string; to_node_id:string; temporarily_closed:number; risk_level:string; path_type:string};

/** Reject disconnected, closed, duplicated or foreign graph elements before persisting a journey. */
export function summarizeGraphRoute(nodeIds:string[], edgeIds:string[], nodes:NodeRow[], edges:EdgeRow[]) {
  if (nodeIds.length < 2 || edgeIds.length !== nodeIds.length - 1 || new Set(nodeIds).size !== nodeIds.length) return null;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edgeById = new Map(edges.map(edge => [edge.id, edge]));
  const orderedNodes = nodeIds.map(id => nodeById.get(id));
  const orderedEdges = edgeIds.map(id => edgeById.get(id));
  if (orderedNodes.some(node => !node) || orderedEdges.some(edge => !edge)) return null;
  const floorTransitions:{fromFloorId:string;toFloorId:string;edgeId:string}[] = [];
  const turnNodeIds:string[] = [];
  for (let i = 0; i < edgeIds.length; i++) {
    const a = orderedNodes[i]!, b = orderedNodes[i+1]!, edge = orderedEdges[i]!;
    if (edge.temporarily_closed || edge.risk_level === 'HIGH' || !((edge.from_node_id === a.id && edge.to_node_id === b.id) || (edge.to_node_id === a.id && edge.from_node_id === b.id))) return null;
    if (a.floor_id !== b.floor_id && !['ELEVATOR','STAIRS','RAMP'].includes(edge.path_type)) return null;
    if (a.floor_id !== b.floor_id) floorTransitions.push({fromFloorId:a.floor_id,toFloorId:b.floor_id,edgeId:edge.id});
    if (i > 0) {
      const before = orderedNodes[i-1]!, after = orderedNodes[i+1]!;
      const x1 = a.x-before.x, y1 = a.y-before.y, x2 = after.x-a.x, y2 = after.y-a.y;
      if (Math.abs(Math.atan2(x1*y2-y1*x2, x1*x2+y1*y2)) > Math.PI/4) turnNodeIds.push(a.id);
    }
  }
  return {nodeIds,edgeIds,floorTransitions,anchorNodeIds:orderedNodes.filter(node => node!.place_id).map(node => node!.id),turnNodeIds};
}
