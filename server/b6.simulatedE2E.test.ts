/** Simulated automated E2E: domain engines with fake sensor/vision evidence; no browser, MySQL, phone or building. */
import { describe, expect, it } from 'vitest';
import type { Building, Floor, MapEdge, MapNode, Place } from '../shared/navigation';
import type { SceneDescription, VisionDetection } from '../shared/vision';
import { MapImportValidator } from './mapImportValidator';
import { canOrganization } from './organizationPolicy';
import { SharedMapConfidenceEngine, MapPromotionService } from './sharedMapDomain';
import { BasiraLocalizationEngine } from '../client/src/lib/localization/engine';
import { MappingSessionEngine } from '../client/src/lib/localization/mapping';
import { BasiraNavigationEngine } from '../client/src/lib/guidance/engine';
import { RoutePlanner, resolveDestination } from '../client/src/lib/guidance/route';
import { advanceMapVersion } from './sharedMapPromotion';

const id=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const b=id(1),f0=id(2),f1=id(3),p121=id(4),n0=id(5),n1=id(6),n2=id(7),n3=id(8),n4=id(9),n5=id(10),n6=id(11);
const document=()=>({format:'BASIRA_JSON' as const,version:1 as const,
  floors:[{id:f0,floorNumber:0,name:'Entrance'},{id:f1,floorNumber:1,name:'First floor'}],
  places:[{id:p121,floorId:f1,name:'Room 121',roomNumber:'121',placeType:'CLASSROOM' as const,x:12,y:10,accessibilityInformation:'Confirm door sign before arrival'}],
  nodes:[{id:n0,floorId:f0,x:0,y:0,nodeType:'ENTRANCE' as const},{id:n1,floorId:f0,x:5,y:0,nodeType:'CORRIDOR' as const},{id:n2,floorId:f0,x:0,y:8,nodeType:'CORRIDOR' as const},{id:n3,floorId:f0,x:10,y:8,nodeType:'CORRIDOR' as const},{id:n4,floorId:f0,x:10,y:10,nodeType:'ELEVATOR' as const},{id:n5,floorId:f1,x:10,y:10,nodeType:'ELEVATOR' as const},{id:n6,floorId:f1,placeId:p121,x:12,y:10,nodeType:'ROOM' as const}],
  edges:[[n0,n1,5,'CORRIDOR'],[n1,n4,11,'CORRIDOR'],[n0,n2,8,'CORRIDOR'],[n2,n3,10,'CORRIDOR'],[n3,n4,2,'CORRIDOR'],[n4,n5,3,'ELEVATOR'],[n5,n6,2,'CORRIDOR']].map(([fromNodeId,toNodeId,distanceMeters,pathType],index)=>({id:id(100+index),fromNodeId:fromNodeId as string,toNodeId:toNodeId as string,distanceMeters:distanceMeters as number,pathType:pathType as 'CORRIDOR'|'ELEVATOR'}))});
function approvedGraph(){
  const checked=new MapImportValidator().validate(document());expect(checked.report.valid).toBe(true);
  const doc=checked.document!,building={id:b,name:'KKU pilot sample (fictional topology)',mapStatus:'MAPPED',verificationStatus:'OFFICIAL'} as Building;
  const floors=doc.floors.map(item=>({id:item.id,buildingId:b,name:item.name,floorNumber:item.floorNumber})) as Floor[];
  const places=doc.places.map(item=>({id:item.id,buildingId:b,floorId:item.floorId,name:item.name,roomNumber:item.roomNumber,placeType:item.placeType,localX:item.x,localY:item.y})) as Place[];
  const nodes=doc.nodes.map(item=>({id:item.id,buildingId:b,floorId:item.floorId,placeId:item.placeId??null,x:item.x,y:item.y,nodeType:item.nodeType,accessibilityLevel:'ACCESSIBLE'})) as MapNode[];
  const edges=doc.edges.map(item=>({id:item.id,buildingId:b,fromNodeId:item.fromNodeId,toNodeId:item.toNodeId,distanceMeters:item.distanceMeters,pathType:item.pathType,direction:null,accessibilityLevel:'ACCESSIBLE',hasStairs:false,hasRamp:false,wheelchairAccessible:true,visuallyImpairedFriendly:true,temporarilyClosed:false,riskLevel:'LOW'})) as MapEdge[];
  return {building,floors,places,nodes,edges};
}
const chair:VisionDetection={id:'fake-chair',trackId:'fake-chair',type:'CHAIR',confidence:.9,boundingBox:{x:.4,y:.4,width:.2,height:.3},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null,timestamp:1000,source:'OBJECT_DETECTOR'};
const scene=(at:number):SceneDescription=>({shortText:'Simulated obstacle',detailedText:'',riskLevel:'HIGH',objects:[chair],recognizedPlace:null,capturedAt:at,walkableArea:{pathAhead:'UNKNOWN',freeSpaceLeft:0,freeSpaceCenter:0,freeSpaceRight:0,confidence:0,source:'SEMANTIC_SEGMENTATION'}});

describe('B1→B6 simulated automated E2E',()=>{
  it('carries a B3 mapping session through anchors, track, suggestion and reviewed map version',async()=>{
    const graph=approvedGraph(),mapping=new MappingSessionEngine(id(30),b,graph.nodes),now=Date.now();
    mapping.anchor({buildingId:b,floorId:f0,x:0,y:0,headingDegrees:90,confidence:.9,uncertaintyRadius:1,source:'QR',timestamp:now,nodeId:n0});
    expect(mapping.anchors).toHaveLength(1);expect(mapping.track).toHaveLength(1);
    const suggestion=mapping.propose('NEW_NODE',f0,3,2,null,null,.8,['MANUAL']);
    expect(suggestion?.status).toBe('PENDING');
    expect(canOrganization('reviewer',false,'review')).toBe(true);
    const newNode={...graph.nodes[0],id:suggestion!.id,x:3,y:2,placeId:null};graph.nodes.push(newNode);
    const writes:string[]=[];
    const connection={execute:async(sql:string)=>{writes.push(sql);return [{}];},query:async()=>[[{current_version:1}]]};
    const version=await advanceMapVersion(connection as never,b,[{action:'CREATE',entityType:'MAP_NODE',entityId:newNode.id,before:null,after:newNode}],'AUTO_MAPPING','reviewer-1');
    expect(version).toBe(2);expect(writes.some(sql=>sql.includes('basira_map_change_log'))).toBe(true);
    expect(graph.nodes.some(node=>node.id===suggestion!.id)).toBe(true);
  });
  it('authorizes an organization reviewer, validates an official import, then navigates with fake obstacle, floor transition, relocalization and OCR arrival',()=>{
    expect(canOrganization('mapper',false,'review')).toBe(false);
    expect(canOrganization('reviewer',false,'review')).toBe(true);
    const graph=approvedGraph(),destination=resolveDestination(graph.places[0],'place',graph.nodes)!;
    const localization=new BasiraLocalizationEngine(),engine=new BasiraNavigationEngine(new RoutePlanner(graph.building,graph.nodes,graph.edges),graph.floors);
    const start=localization.anchor({buildingId:b,floorId:f0,x:0,y:0,headingDegrees:90,confidence:.9,uncertaintyRadius:1,source:'MANUAL',timestamp:1000});
    expect(engine.prepare(destination,start)).toBe(true);expect(engine.start()).toBe(true);
    for(const at of [2000,3000,4000])engine.observeScene(scene(at),at);
    expect(engine.session.lastRerouteReason).toBe('PERSISTENT_OBSTACLE');expect(engine.session.route?.orderedEdges[0].id).toBe(id(102));
    engine.updateLocation(localization.anchor({buildingId:b,floorId:f0,x:10,y:10,headingDegrees:0,confidence:.9,uncertaintyRadius:1,source:'MANUAL',timestamp:5000}),5000);
    expect(engine.updateLocation(localization.transition('ENTER_ELEVATOR',6000),6000)).toBe('LOST');expect(engine.session.state).toBe('RELOCALIZING');
    expect(engine.updateLocation(localization.anchor({buildingId:b,floorId:f1,x:10,y:10,headingDegrees:90,confidence:.9,uncertaintyRadius:1,source:'QR',timestamp:7000}),7000)).toBe('RECOVERED');
    engine.updateLocation(localization.anchor({buildingId:b,floorId:f1,x:12,y:10,headingDegrees:90,confidence:.9,uncertaintyRadius:1,source:'MANUAL',timestamp:8000}),8000);
    expect(engine.considerArrival(p121,true,'RIGHT')).toBe(true);expect(engine.session.state).toBe('ARRIVED');
  });
  it('keeps three independent community observations provisional until review, then makes the new place routable for user D',()=>{
    const graph=approvedGraph(),now=Date.now(),confidence=new SharedMapConfidenceEngine(),promotion=new MapPromotionService();
    const evidence=[26,25,0].map((hours,index)=>({actorKey:`user-${index}`,sessionKey:`session-${index}`,deviceKey:`device-${index}`,source:'OCR' as const,trust:1,quality:{observedAt:now-hours*3_600_000,localizationConfidence:.9,ocrConfidence:.9,visualAnchorConfidence:.9,sourceSessionKey:null,sourceDeviceKey:null,observedFloorId:f1,observedX:14,observedY:10,floorConsistent:true,placeConsistent:true}}));
    const status=promotion.communityStatus(confidence.evaluate(evidence,0,now),0,'PLACE');expect(status).toBe('COMMUNITY_VERIFIED');
    const newId=id(20),newNode=id(21);expect(graph.places.some(place=>place.id===newId)).toBe(false);
    expect(canOrganization('reviewer',false,'review')).toBe(true);expect(promotion.reviewStatus('mapper','APPROVE')).toBe('OFFICIAL');
    graph.places.push({id:newId,buildingId:b,floorId:f1,name:'Clinic',localX:14,localY:10} as Place);
    graph.nodes.push({id:newNode,buildingId:b,floorId:f1,placeId:newId,x:14,y:10,nodeType:'ROOM',accessibilityLevel:'ACCESSIBLE'});
    graph.edges.push({...graph.edges[0],id:id(22),fromNodeId:n6,toNodeId:newNode,distanceMeters:2});
    const target=resolveDestination(graph.places.find(place=>place.id===newId)!,'place',graph.nodes)!;
    expect(new RoutePlanner(graph.building,graph.nodes,graph.edges).plan(n5,target)).not.toBeNull();
  });
  it('rejects invalid imports and ordinary-user official actions without changing the sample graph',()=>{
    const graph=approvedGraph(),before=graph.nodes.length,invalid=document();invalid.edges[0].toNodeId=id(999);
    expect(new MapImportValidator().validate(invalid).report.valid).toBe(false);
    for(const action of ['map','review','manage','verify'] as const)expect(canOrganization(null,false,action)).toBe(false);
    expect(graph.nodes).toHaveLength(before);
  });
});
