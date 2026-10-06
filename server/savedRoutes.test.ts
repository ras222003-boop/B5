import { describe, expect, it } from 'vitest';
import { summarizeGraphRoute } from './savedRouteDomain';

const nodes=[
  {id:'gate',floor_id:'ground',place_id:'entrance',x:0,y:0},
  {id:'lift0',floor_id:'ground',place_id:'lift',x:5,y:0},
  {id:'lift2',floor_id:'second',place_id:'lift',x:5,y:0},
  {id:'turn',floor_id:'second',place_id:null,x:5,y:8},
  {id:'exam',floor_id:'second',place_id:'room',x:12,y:8},
];
const edges=[
  {id:'a',from_node_id:'gate',to_node_id:'lift0',temporarily_closed:0,risk_level:'LOW',path_type:'CORRIDOR'},
  {id:'b',from_node_id:'lift0',to_node_id:'lift2',temporarily_closed:0,risk_level:'LOW',path_type:'ELEVATOR'},
  {id:'c',from_node_id:'lift2',to_node_id:'turn',temporarily_closed:0,risk_level:'LOW',path_type:'CORRIDOR'},
  {id:'d',from_node_id:'turn',to_node_id:'exam',temporarily_closed:0,risk_level:'LOW',path_type:'CORRIDOR'},
];
describe('private saved route summary',()=>{
  it('retains decisions and anchors but no raw points',()=>{
    const summary=summarizeGraphRoute(nodes.map(n=>n.id),edges.map(e=>e.id),nodes,edges);
    expect(summary?.floorTransitions).toEqual([{fromFloorId:'ground',toFloorId:'second',edgeId:'b'}]);
    expect(summary?.anchorNodeIds).toEqual(['gate','lift0','lift2','exam']);
    expect(summary?.turnNodeIds).toContain('turn');
    expect(Object.keys(summary??{}).sort()).toEqual(['anchorNodeIds','edgeIds','floorTransitions','nodeIds','turnNodeIds']);
  });
  it('rejects a blocked, disconnected or fake floor-transition edge',()=>{
    expect(summarizeGraphRoute(nodes.map(n=>n.id),edges.map(e=>e.id),nodes,edges.map(e=>e.id==='c'?{...e,temporarily_closed:1}:e))).toBeNull();
    expect(summarizeGraphRoute(nodes.map(n=>n.id),['d','b','c','a'],nodes,edges)).toBeNull();
    expect(summarizeGraphRoute(nodes.map(n=>n.id),edges.map(e=>e.id),nodes,edges.map(e=>e.id==='b'?{...e,path_type:'CORRIDOR'}:e))).toBeNull();
  });
});
