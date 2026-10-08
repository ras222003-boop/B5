import { describe, expect, it } from 'vitest';
import type { LocalizationEstimate } from '@shared/localization';
import type { MapEdge, MapNode } from '@shared/navigation';
import type { GeoFix } from './outdoor';
import { WalkRecording } from './walkRecording';

const buildingId='building';
const node=(id:string,x:number,y:number,floorId='ground'):MapNode=>({id,buildingId,floorId,x,y,placeId:null,nodeType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE'});
const edge=(id:string,a:string,b:string,pathType:MapEdge['pathType']='CORRIDOR'):MapEdge=>({
  id,buildingId,fromNodeId:a,toNodeId:b,distanceMeters:5,direction:null,pathType,
  accessibilityLevel:'ACCESSIBLE',hasStairs:pathType==='STAIRS',hasRamp:pathType==='RAMP',
  wheelchairAccessible:true,visuallyImpairedFriendly:true,temporarilyClosed:false,riskLevel:'LOW',
});
const nodes=[node('gate',0,0),node('turn',5,0),node('planned',10,0),node('detour',5,5),node('exam',10,5)];
const edges=[edge('gate-turn','gate','turn'),edge('planned','turn','planned'),edge('turn-detour','turn','detour'),edge('detour-exam','detour','exam')];
const location=(x:number,y:number,timestamp:number,changes:Partial<LocalizationEstimate>={}):LocalizationEstimate=>({
  buildingId,floorId:'ground',x,y,headingDegrees:90,confidence:.9,uncertaintyRadius:1,
  sources:['MANUAL','STEP_MOTION'],timestamp,lastStrongAnchorAt:1000,state:'TRACKING',...changes,
});
const gps=(latitude:number,longitude:number,timestamp:number,accuracy=6):GeoFix=>({latitude,longitude,timestamp,accuracy,heading:null});
const make=()=>new WalkRecording({buildingId,nodes,edges,startNodeId:'gate'});
const walk=(recording:WalkRecording,points:Array<[number,number,number]>)=>points.forEach(([x,y,t])=>recording.observeIndoor(location(x,y,t)));

describe('private observed walk recording',()=>{
  it('saves the observed detour rather than the planned branch',()=>{
    const recording=make();
    walk(recording,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000],
      [5,1,5000],[5,3,6000],[5,5,7000],[6,5,8000],[8,5,9000],[10,5,10000]]);
    const result=recording.saveBody('من البوابة إلى الاختبار','exam',120,edges);
    expect(result).toEqual({ok:true,body:{name:'من البوابة إلى الاختبار',buildingId,
      nodeIds:['gate','turn','detour','exam'],edgeIds:['gate-turn','turn-detour','detour-exam'],durationSeconds:120}});
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|timestamp|confidence|rawTrack/);
    expect(recording.snapshot().indoorSegments[0].points).toHaveLength(10);
  });

  it('will not invent an edge from sparse endpoint fixes or a jumped fix',()=>{
    const sparse=make();
    sparse.observeIndoor(location(0,0,1000));sparse.observeIndoor(location(5,0,5000));
    expect(sparse.saveBody('sparse','turn',20,edges)).toEqual({ok:false,reason:'PATH_INCOMPLETE'});
    expect(sparse.snapshot().edgeIds).toEqual([]);
    const jump=make();
    jump.observeIndoor(location(0,0,1000));jump.observeIndoor(location(10,5,2000));
    expect(jump.snapshot().indoorSegments).toHaveLength(2);
    expect(jump.saveBody('jump','exam',20,edges)).toEqual({ok:false,reason:'PATH_INCOMPLETE'});
  });

  it('splits the drawing and invalidates saving after uncertain movement',()=>{
    const recording=make();recording.observeIndoor(location(0,0,1000));
    recording.observeIndoor(location(1,0,2000));
    expect(recording.observeIndoor(location(2,0,3000,{confidence:.2,state:'LOCALIZATION_LOST'}))).toBe(false);
    recording.observeIndoor(location(3,0,4000));
    expect(recording.snapshot().indoorSegments).toHaveLength(2);
    expect(recording.saveBody('uncertain','turn',20,edges)).toEqual({ok:false,reason:'PATH_INCOMPLETE'});
  });

  it('does not bridge a long localization gap through edge evidence even if the recovered fix is nearby',()=>{
    const recording=make();
    recording.observeIndoor(location(0,0,1000));recording.observeIndoor(location(1,0,2000));
    expect(recording.observeIndoor(location(1,0,3000,{confidence:.2,state:'LOCALIZATION_LOST'}))).toBe(false);
    recording.observeIndoor(location(2,0,61000));recording.observeIndoor(location(3,0,62000));recording.observeIndoor(location(5,0,63000));
    expect(recording.snapshot().incomplete).toBe(true);
    expect(recording.saveBody('unobserved gap','turn',62,edges)).toEqual({ok:false,reason:'PATH_INCOMPLETE'});

    const anchored=make();
    anchored.observeIndoor(location(0,0,1000));
    anchored.observeIndoor(location(0,0,2000,{confidence:.2,state:'LOCALIZATION_LOST'}));
    anchored.observeIndoor(location(0,0,3000,{sources:['QR'],lastStrongAnchorAt:3000}));
    walk(anchored,[[1,0,4000],[3,0,5000],[5,0,6000]]);
    expect(anchored.saveBody('confirmed restart','turn',6,edges).ok).toBe(true);
  });

  it('allows a mapped floor transition only after an explicit event and new-floor anchor',()=>{
    const multiNodes=[node('gate',0,0),node('lift0',5,0),node('lift1',5,0,'first'),node('room',10,0,'first')];
    const multiEdges=[edge('approach','gate','lift0'),edge('lift','lift0','lift1','ELEVATOR'),edge('corridor','lift1','room')];
    const recording=new WalkRecording({buildingId,nodes:multiNodes,edges:multiEdges,startNodeId:'gate'});
    walk(recording,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000]]);
    expect(recording.observeFloorTransition('ELEVATOR',4500)).toBe(true);
    expect(recording.observeIndoor(location(5,0,5000,{floorId:null,x:null,y:null,confidence:.1,state:'LOCALIZATION_LOST'}))).toBe(false);
    recording.observeIndoor(location(5,0,6000,{floorId:'first',sources:['QR'],lastStrongAnchorAt:6000}));
    recording.observeIndoor(location(6,0,7000,{floorId:'first'}));
    recording.observeIndoor(location(8,0,8000,{floorId:'first'}));
    recording.observeIndoor(location(10,0,9000,{floorId:'first'}));
    const result=recording.saveBody('lift journey','room',60,multiEdges);
    expect(result.ok).toBe(true);
    if(result.ok)expect(result.body.edgeIds).toEqual(['approach','lift','corridor']);
    expect(recording.snapshot().indoorSegments.map(segment=>segment.floorId)).toEqual(['ground','first']);

    const unconfirmed=new WalkRecording({buildingId,nodes:multiNodes,edges:multiEdges,startNodeId:'gate'});
    walk(unconfirmed,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000]]);
    unconfirmed.observeIndoor(location(5,0,6000,{floorId:'first',sources:['QR'],lastStrongAnchorAt:6000}));
    expect(unconfirmed.saveBody('unconfirmed','lift1',30,multiEdges)).toEqual({ok:false,reason:'PATH_INCOMPLETE'});
  });

  it('rejects a floor transition away from its entrance or without matching, recent map evidence',()=>{
    const multiNodes=[node('gate',0,0),node('lift0',5,0),node('lift1',5,0,'first')];
    const multiEdges=[edge('approach','gate','lift0'),edge('lift','lift0','lift1','ELEVATOR')];
    const makeMulti=(routeEdges=multiEdges)=>new WalkRecording({buildingId,nodes:multiNodes,edges:routeEdges,startNodeId:'gate'});
    const early=makeMulti();
    early.observeIndoor(location(0,0,1000));
    expect(early.observeFloorTransition('ELEVATOR',1500)).toBe(false);

    const wrongKind=makeMulti();
    walk(wrongKind,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000]]);
    expect(wrongKind.observeFloorTransition('STAIRS',4500)).toBe(false);

    const away=makeMulti();
    walk(away,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000],[7,0,5000]]);
    expect(away.observeFloorTransition('ELEVATOR',5500)).toBe(false);

    const stale=makeMulti();
    walk(stale,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000]]);
    expect(stale.observeFloorTransition('ELEVATOR',15000)).toBe(false);

    const lost=makeMulti();
    walk(lost,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000]]);
    lost.observeIndoor(location(5,0,4200,{confidence:.2,state:'LOCALIZATION_LOST'}));
    expect(lost.observeFloorTransition('ELEVATOR',4500)).toBe(false);

    const closed=makeMulti(multiEdges.map(item=>item.id==='lift'?{...item,temporarilyClosed:true}:item));
    walk(closed,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000]]);
    expect(closed.observeFloorTransition('ELEVATOR',4500)).toBe(false);
  });

  it('rechecks closures, active obstacles and graph changes before saving',()=>{
    const recording=make();walk(recording,[[0,0,1000],[1,0,2000],[3,0,3000],[5,0,4000]]);
    expect(recording.saveBody('route','turn',30,edges,new Set(['gate-turn']))).toEqual({ok:false,reason:'HAZARD'});
    expect(recording.saveBody('route','turn',30,edges.map(item=>item.id==='gate-turn'?{...item,temporarilyClosed:true}:item))).toEqual({ok:false,reason:'HAZARD'});
    expect(recording.saveBody('route','turn',30,edges.filter(item=>item.id!=='gate-turn'))).toEqual({ok:false,reason:'GRAPH_CHANGED'});
    expect(recording.saveBody('route','turn',30,edges.map(item=>item.id==='gate-turn'?{...item,pathType:'DOOR'}:item))).toEqual({ok:false,reason:'GRAPH_CHANGED'});
    expect(recording.saveBody('route','planned',30,edges)).toEqual({ok:false,reason:'DESTINATION_UNCONFIRMED'});
    recording.observeIndoor(location(7,0,5000));
    expect(recording.saveBody('route','turn',30,edges)).toEqual({ok:false,reason:'DESTINATION_UNCONFIRMED'});
  });

  it('filters poor or implausible GPS and retains only volatile outdoor drawing segments',()=>{
    const recording=make();
    expect(recording.observeOutdoor(gps(24.7136,46.6734,1000,70),1000)).toBe(false);
    expect(recording.observeOutdoor(gps(24.7136,46.6734,10000),1000)).toBe(false);
    expect(recording.observeOutdoor(gps(24.7136,46.6734,2000),2000)).toBe(true);
    expect(recording.observeOutdoor(gps(24.7136,46.6734,2500),2500)).toBe(false);
    expect(recording.observeOutdoor(gps(24.71365,46.67345,4000),4000)).toBe(true);
    expect(recording.observeOutdoor(gps(25.71365,47.67345,5000),5000)).toBe(false);
    expect(recording.observeOutdoor(gps(24.7137,46.6735,7000),7000)).toBe(true);
    const segments=recording.snapshot().outdoorSegments;
    expect(segments.map(segment=>segment.points.length)).toEqual([2,1]);
    expect(recording.saveBody('outdoor','exam',20,edges)).toEqual({ok:false,reason:'START_UNCONFIRMED'});
  });

  it('returns defensive copies of the raw trail',()=>{
    const recording=make();recording.observeIndoor(location(0,0,1000));
    const snapshot=recording.snapshot();snapshot.indoorSegments[0].points[0].x=99;snapshot.nodeIds.push('fake');
    expect(recording.snapshot().indoorSegments[0].points[0].x).toBe(0);
    expect(recording.snapshot().nodeIds).toEqual(['gate']);
  });
});
