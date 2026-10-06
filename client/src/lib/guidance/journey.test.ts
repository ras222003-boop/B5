import { describe, expect, it } from 'vitest';
import type { Building, MapEdge, MapNode, SavedRoute } from '@shared/navigation';
import type { NavigationDestination } from '@shared/guidance';
import { RoutePlanner } from './route';
import { assessFamiliarRoute, routeSaveBody } from './journey';
import { geoDistance, gpsQuality } from './outdoor';

const building={id:'university',name:'University',verificationStatus:'OFFICIAL',mapStatus:'MAPPED'} as Building;
const n=(id:string,x:number,y:number,floorId='ground'):MapNode=>({id,buildingId:building.id,floorId,x,y,placeId:null,nodeType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE'});
const nodes=[n('entrance',0,0),n('lift0',4,0),n('lift2',4,0,'second'),n('corridor',12,0,'second'),n('exam',20,0,'second'),n('alternative',12,9,'second')];
const e=(id:string,a:string,b:string,distanceMeters:number,extra:Partial<MapEdge>={}):MapEdge=>({id,buildingId:building.id,fromNodeId:a,toNodeId:b,distanceMeters,direction:null,pathType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE',hasStairs:false,hasRamp:false,wheelchairAccessible:true,visuallyImpairedFriendly:true,temporarilyClosed:false,riskLevel:'LOW',...extra});
const edges=[e('entry','entrance','lift0',4),e('lift','lift0','lift2',3,{pathType:'ELEVATOR'}),e('usual','lift2','corridor',8),e('last','corridor','exam',8),e('detour1','lift2','alternative',12),e('detour2','alternative','exam',12)];
const destination:NavigationDestination={kind:'place',id:'room',name:'Exam room',buildingId:building.id,floorId:'second',nodeId:'exam',placeId:'room'};
const saved:SavedRoute={id:'route',name:'From gate to exam room',buildingId:building.id,originNodeId:'entrance',destinationNodeId:'exam',routeData:{nodeIds:['entrance','lift0','lift2','corridor','exam'],edgeIds:['entry','lift','usual','last'],floorTransitions:[{fromFloorId:'ground',toFloorId:'second',edgeId:'lift'}],anchorNodeIds:['entrance','exam'],turnNodeIds:[]},mapVersion:1,successfulArrivalCount:1,typicalDurationSeconds:100,lastSuccessfulAt:new Date().toISOString(),lastVerifiedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),familiarity:'NEWLY_LEARNED'};

describe('gate → entrance → elevator → floor 2 → exam room, day 2',()=>{
  it('discovers a familiar route and recomputes it on the live graph',()=>{
    expect(gpsQuality({latitude:0,longitude:0,accuracy:8,heading:null,timestamp:1000},1000)).toBe('HIGH');
    expect(geoDistance({latitude:0,longitude:0},{latitude:0,longitude:.0001})).toBeGreaterThan(10);
    const assessment=assessFamiliarRoute(saved,building,nodes,edges,'entrance','exam',[]);
    expect(assessment.eligible).toBe(true);
    const planner=new RoutePlanner(building,nodes,edges);planner.preferFamiliarEdges(assessment.edgeIds);
    const route=planner.plan('entrance',destination);
    expect(route?.orderedEdges.map(edge=>edge.id)).toEqual(saved.routeData.edgeIds);
    expect(routeSaveBody(route!,'From gate to exam room',100)).toEqual({name:'From gate to exam room',buildingId:'university',nodeIds:saved.routeData.nodeIds,edgeIds:saved.routeData.edgeIds,durationSeconds:100});
  });
  it('rejects the familiar corridor while blocked, takes an alternative, and restores eligibility after clearing',()=>{
    const blocked=edges.map(edge=>edge.id==='usual'?{...edge,temporarilyClosed:true}:edge);
    const assessment=assessFamiliarRoute(saved,building,nodes,blocked,'entrance','exam',[]);
    expect(assessment.reason).toBe('HAZARD');
    expect(new RoutePlanner(building,nodes,blocked).plan('entrance',destination)?.orderedEdges.map(edge=>edge.id)).toEqual(['entry','lift','detour1','detour2']);
    expect(assessFamiliarRoute(saved,building,nodes,edges,'entrance','exam',[]).eligible).toBe(true);
  });
  it('expires temporary constraints and rejects stale or displaced journeys',()=>{
    const constraint={edgeId:'usual',kind:'TEMPORARY_CLOSURE' as const,createdAt:100,expiresAt:200};
    expect(assessFamiliarRoute(saved,building,nodes,edges,'entrance','exam',[constraint],150).eligible).toBe(false);
    expect(assessFamiliarRoute(saved,building,nodes,edges,'entrance','exam',[constraint],250).eligible).toBe(true);
    expect(assessFamiliarRoute(saved,building,nodes,edges,'alternative','exam',[]).reason).toBe('DIFFERENT_START');
    expect(gpsQuality({latitude:0,longitude:0,accuracy:100,heading:null,timestamp:1000},1000)).toBe('LOW');
    expect(gpsQuality({latitude:0,longitude:0,accuracy:5,heading:null,timestamp:1000},22000)).toBe('LOST');
  });
  it('may select a somewhat longer familiar route but never discounts a newly risky edge',()=>{
    const points=[n('origin',0,0),n('known',10,0),n('new',10,10),n('target',20,0)];
    const paths=[e('known1','origin','known',15),e('known2','known','target',15),e('new1','origin','new',12),e('new2','new','target',13)];
    const goal={...destination,nodeId:'target'};
    const planner=new RoutePlanner(building,points,paths);
    expect(planner.plan('origin',goal)?.orderedEdges.map(edge=>edge.id)).toEqual(['new1','new2']);
    planner.preferFamiliarEdges(new Set(['known1','known2']));
    expect(planner.plan('origin',goal)?.orderedEdges.map(edge=>edge.id)).toEqual(['known1','known2']);
    const risky=new RoutePlanner(building,points,paths.map(edge=>edge.id==='known2'?{...edge,riskLevel:'HIGH' as const}:edge));
    risky.preferFamiliarEdges(new Set(['known1','known2']));
    expect(risky.plan('origin',goal)?.orderedEdges.map(edge=>edge.id)).toEqual(['new1','new2']);
  });
});
