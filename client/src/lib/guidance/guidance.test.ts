import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Building, Floor, MapEdge, MapNode, Place, SavedPlace } from '@shared/navigation';
import type { LocalizationEstimate } from '@shared/localization';
import type { NavigationDestination } from '@shared/guidance';
import type { SceneDescription, VisionDetection } from '@shared/vision';
import { RoutePlanner, resolveDestination, trustedOrigin } from './route';
import { BasiraNavigationEngine } from './engine';
import { NavigationInstructionGenerator, arrived } from './instructions';
import { NavigationSafetyFusion, TemporaryRouteConstraints } from './safety';
import { AnnouncementPriorityQueue, NavigationIntentService } from './voice';
import { authorizedSavedPlace } from './destination';
import { navApi } from '@/lib/navigationApi';
import { BasiraLocalizationEngine } from '@/lib/localization/engine';

const building={id:'b',name:'كلية التربية',mapStatus:'MAPPED',verificationStatus:'OFFICIAL'} as Building;
const floors=[{id:'f0',buildingId:'b',name:'الأرضي'},{id:'f1',buildingId:'b',name:'الأول'}] as Floor[];
const node=(id:string,x:number,y:number,floorId='f0',placeId:string|null=null):MapNode=>({id,buildingId:'b',floorId,placeId,x,y,nodeType:placeId?'ROOM':'CORRIDOR',accessibilityLevel:'ACCESSIBLE'});
const nodes=[node('a',0,0),node('b',5,0),node('c',10,0,'f0','p121'),node('d',0,8),node('e',10,8),node('lift0',10,10),node('lift1',10,10,'f1'),node('room1',12,10,'f1','p122')];
const edge=(id:string,fromNodeId:string,toNodeId:string,distanceMeters:number,changes:Partial<MapEdge>={}):MapEdge=>({id,buildingId:'b',fromNodeId,toNodeId,distanceMeters,direction:null,pathType:'CORRIDOR',accessibilityLevel:'ACCESSIBLE',hasStairs:false,hasRamp:false,wheelchairAccessible:true,visuallyImpairedFriendly:true,temporarilyClosed:false,riskLevel:'LOW',...changes});
const edges=[edge('ab','a','b',5),edge('bc','b','c',5),edge('ad','a','d',8),edge('de','d','e',10),edge('ec','e','c',8),edge('cl','c','lift0',10),edge('lift','lift0','lift1',3,{pathType:'ELEVATOR'}),edge('lr','lift1','room1',2)];
const destination:NavigationDestination={kind:'place',id:'p121',name:'قاعة 121',buildingId:'b',floorId:'f0',nodeId:'c',placeId:'p121'};
const location=(x=0,y=0,floorId='f0',changes:Partial<LocalizationEstimate>={}):LocalizationEstimate=>({buildingId:'b',floorId,x,y,headingDegrees:90,confidence:.9,uncertaintyRadius:1,sources:['MANUAL'],timestamp:Date.now(),lastStrongAnchorAt:Date.now(),state:'TRACKING',...changes});
const planner=(items=edges,points=nodes)=>new RoutePlanner(building,points,[...items]);
const scene=(objects:VisionDetection[],at=Date.now()):SceneDescription=>({shortText:'',detailedText:'',riskLevel:'HIGH',objects,recognizedPlace:null,capturedAt:at,walkableArea:{pathAhead:'UNKNOWN',freeSpaceLeft:0,freeSpaceCenter:0,freeSpaceRight:0,confidence:0,source:'SEMANTIC_SEGMENTATION'}});
const chair:VisionDetection={id:'chair',trackId:'chair',type:'CHAIR',confidence:.9,boundingBox:{x:.4,y:.4,width:.2,height:.3},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null,timestamp:1,source:'OBJECT_DETECTOR'};
afterEach(()=>vi.restoreAllMocks());

describe('B4 route planning and guidance',()=>{
  it('chooses the shortest geometric route',()=>{
    expect(planner().plan('a',destination,'SHORTEST')?.orderedEdges.map(e=>e.id)).toEqual(['ab','bc']);
  });
  it('recommends an elevator over a shorter stair route',()=>{
    const points=[node('s',0,0),node('t',0,4,'f1','p122'),node('el0',5,0),node('el1',5,4,'f1')];
    const links=[edge('stair','s','t',4,{pathType:'STAIRS',hasStairs:true,wheelchairAccessible:false}),edge('to-el','s','el0',5),edge('elevator','el0','el1',3,{pathType:'ELEVATOR'}),edge('from-el','el1','t',5)];
    const target={...destination,id:'p122',nodeId:'t',floorId:'f1'};
    expect(planner(links,points).plan('s',target,'SHORTEST')?.orderedEdges[0].id).toBe('stair');
    expect(planner(links,points).plan('s',target,'RECOMMENDED')?.orderedEdges.map(e=>e.id)).toEqual(['to-el','elevator','from-el']);
    expect(planner(links,points).plan('s',target,'ACCESSIBLE')?.orderedEdges.map(e=>e.id)).toEqual(['to-el','elevator','from-el']);
  });
  it('skips closed edges and session-only constraints without mutating B1',()=>{
    const closed=edges.map(e=>e.id==='ab'?{...e,temporarilyClosed:true}:e);
    expect(planner(closed).plan('a',destination)?.orderedEdges[0].id).toBe('ad');
    const constraints=new TemporaryRouteConstraints();constraints.add('ab','OBSTACLE',100,1000);
    expect(planner().plan('a',destination,'RECOMMENDED',constraints.active(200),200)?.orderedEdges[0].id).toBe('ad');
    expect(constraints.active(1200)).toEqual([]);expect(edges[0].temporarilyClosed).toBe(false);
  });
  it('routes across floors only through a transition edge',()=>{
    const target={...destination,id:'p122',nodeId:'room1',floorId:'f1'};
    const route=planner().plan('a',target);
    expect(route?.floors).toEqual(['f0','f1']);expect(route?.orderedEdges.some(e=>e.pathType==='ELEVATOR')).toBe(true);
    const invalid=planner([...edges,edge('shortcut','a','room1',1)]).plan('a',target,'SHORTEST');
    expect(invalid?.orderedEdges.some(e=>e.id==='shortcut')).toBe(false);
  });
  it('routes across floors by an accessible ramp and names the ramp correctly',()=>{
    const points=[node('r0',0,0),node('r1',0,4,'f1','p122')];
    const links=[edge('ramp','r0','r1',4,{pathType:'RAMP',hasRamp:true,wheelchairAccessible:true})];
    const target={...destination,id:'p122',nodeId:'r1',floorId:'f1'};
    const route=planner(links,points).plan('r0',target,'ACCESSIBLE');
    expect(route?.orderedEdges[0].pathType).toBe('RAMP');
    expect(new NavigationInstructionGenerator(floors,'ar').forEdge(route!,0,.9).text).toContain('المنحدر');
    expect(new NavigationInstructionGenerator(floors,'en').forEdge(route!,0,.9).text).toContain('ramp');
    expect(new NavigationInstructionGenerator(floors,'zh-CN').forEdge(route!,0,.9).text).toContain('坡道');
  });
  it('returns no route for disconnected or entirely closed graph',()=>{
    expect(planner(edges.filter(e=>!['ab','ad'].includes(e.id))).plan('a',destination)).toBeNull();
  });
  it('requires a trusted B3 estimate before starting',()=>{
    expect(trustedOrigin(nodes,location(0,0,'f0',{confidence:.3}))).toBeNull();
    const engine=new BasiraNavigationEngine(planner(),floors);
    expect(engine.prepare(destination,location(0,0,'f0',{confidence:.3}))).toBe(false);
    expect(engine.session.state).toBe('RELOCALIZING');
  });
  it('uses approximate wording until both map and location warrant metres',()=>{
    const route=planner().plan('a',destination)!;
    const generator=new NavigationInstructionGenerator(floors);
    expect(generator.forEdge(route,0,.65).text).not.toMatch(/\d+ أمتار/);
    expect(generator.forEdge(route,0,.9).text).toMatch(/5 أمتار/);
  });
  it('supports clock direction and multilingual floor instructions',()=>{
    const detour=planner(edges.map(e=>e.id==='ab'?{...e,temporarilyClosed:true}:e)).plan('a',destination)!;
    expect(new NavigationInstructionGenerator(floors,'ar','CLOCK').forEdge(detour,1,.9).text).toContain('الساعة الثالثة');
    const target={...destination,id:'p122',floorId:'f1',nodeId:'room1',placeId:'p122'};
    const multi=planner().plan('a',target)!;
    const transition=multi.orderedEdges.findIndex(e=>e.pathType==='ELEVATOR');
    expect(new NavigationInstructionGenerator(floors,'en').forEdge(multi,transition,.9).text).toContain('elevator');
    expect(new NavigationInstructionGenerator(floors,'zh-CN').forEdge(multi,transition,.9).text).toContain('电梯');
  });
  it('uses concise Saudi navigation phrases while keeping safety explicit',()=>{
    const route=planner().plan('a',destination)!;
    const sa=new NavigationInstructionGenerator(floors,'ar','LEFT_RIGHT','SAUDI');
    expect(sa.forEdge(route,0,.9).text).toContain('قدام');
    expect(sa.arrival('غرفة 121','FRONT')).toContain('قدامك');
    const safety=new NavigationSafetyFusion('ar','SAUDI');
    expect(safety.evaluate(route,0,location(),scene([chair])).message).toContain('عائق');
  });
  it('detects off-route over repeated readings and replans from the new node',()=>{
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(destination,location());engine.start();
    const offset=location(0,8);
    expect(engine.updateLocation(offset,20_000)).toBe('PROGRESS');
    expect(engine.updateLocation(offset,21_000)).toBe('PROGRESS');
    expect(engine.updateLocation(offset,22_000)).toBe('OFF_ROUTE');
    expect(engine.session.lastRerouteReason).toBe('OFF_ROUTE');expect(engine.session.route?.origin.id).toBe('d');
  });
  it('reroutes around a persistent obstacle and keeps the graph intact',()=>{
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(destination,location());engine.start();
    const frame=scene([chair],1000);
    engine.observeScene(frame,1000);engine.observeScene({...frame,capturedAt:2000},2000);engine.observeScene({...frame,capturedAt:3000},3000);
    expect(engine.session.lastRerouteReason).toBe('PERSISTENT_OBSTACLE');
    expect(engine.session.route?.orderedEdges[0].id).toBe('ad');expect(engine.planner.edges[0].temporarilyClosed).toBe(false);
  });
  it('stops turn guidance on localization loss and resumes after a strong anchor',()=>{
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(destination,location());engine.start();
    expect(engine.updateLocation(location(0,0,'f0',{state:'LOCALIZATION_LOST',confidence:.1}),1000)).toBe('LOST');
    expect(engine.session.state).toBe('RELOCALIZING');
    expect(engine.updateLocation(location(),20_000)).toBe('RECOVERED');expect(engine.session.state).toBe('NAVIGATING');
  });
  it('does not declare arrival on proximity or OCR alone',()=>{
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(destination,location());engine.start();
    expect(engine.considerArrival('p121',true)).toBe(false);
    engine.updateLocation(location(10,0));expect(engine.considerArrival(null,false)).toBe(false);
    expect(engine.considerArrival('another-place',true)).toBe(false);
    expect(engine.considerArrival('p121',true,'RIGHT')).toBe(true);
    expect(engine.session.instruction?.text).toContain('الباب على يمينك');
  });
  it('rejects an OCR-only location for arrival',()=>{
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(destination,location());engine.start();
    engine.updateLocation(location(10,0,'f0',{sources:['VISUAL_PLACE']}));
    expect(engine.considerArrival('p121',true)).toBe(false);
  });
  it('prompts for the elevator when nearing the floor transition',()=>{
    const target={...destination,id:'p122',floorId:'f1',nodeId:'room1',placeId:'p122'};
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(target,location());engine.start();
    engine.updateLocation(location(10,10));
    expect(engine.session.instruction?.kind).toBe('FLOOR_TRANSITION');
    expect(engine.session.instruction?.text).toContain('المصعد');
  });
  it('supports manual arrival only with nearby trusted location',()=>{
    expect(arrived({nodeProximity:true,visualPlace:false,ocrMatch:false,manualConfirmation:true,localizationConfidence:.8})).toBe(true);
    expect(arrived({nodeProximity:false,visualPlace:false,ocrMatch:false,manualConfirmation:true,localizationConfidence:.8})).toBe(false);
  });
  it('reacts to a closure refresh during the session',()=>{
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(destination,location());engine.start();
    expect(engine.updateEdges(edges.map(e=>e.id==='ab'?{...e,temporarilyClosed:true}:e))).toBe(true);
    expect(engine.session.lastRerouteReason).toBe('CLOSED_EDGE');expect(engine.session.route?.orderedEdges[0].id).toBe('ad');
  });
  it('resolves personal coordinates only when close to the B1 graph',()=>{
    const saved={id:'mine',name:'قاعتي',buildingId:'b',floorId:'f0',placeId:null,localX:10,localY:0,localizationConfidence:.8} as SavedPlace;
    expect(resolveDestination(saved,'saved',nodes)?.nodeId).toBe('c');
    expect(resolveDestination({...saved,localX:100},'saved',nodes)).toBeNull();
    expect(resolveDestination({...saved,localizationConfidence:.2},'saved',nodes)).toBeNull();
  });
  it('rechecks authorization for a saved ID before use',async()=>{
    vi.spyOn(navApi,'savedPlace').mockImplementation(async id=>id==='mine'?{savedPlace:{id:'mine',name:'قاعتي'} as SavedPlace}:Promise.reject(new Error('not_found')));
    expect((await authorizedSavedPlace('mine'))?.name).toBe('قاعتي');
    expect(await authorizedSavedPlace('another-user-place')).toBeNull();
    expect(navApi.savedPlace).toHaveBeenCalledWith('another-user-place');
  });
  it('parses commands beyond exact strings',()=>{
    const service=new NavigationIntentService();
    expect(service.parse('بصيرة، خذيني إلى قاعة 121')).toEqual({type:'NAVIGATE_TO',query:'قاعة 121'});
    expect(service.parse('لو سمحت أين أقرب مصعد')).toEqual({type:'NEAREST_PLACE',query:'مصعد'});
    expect(service.parse('أعد التعليمات من فضلك')).toEqual({type:'REPEAT_INSTRUCTION'});
    expect(service.parse('احفظ هذا المكان باسم قاعتي')).toEqual({type:'SAVE_PLACE',name:'قاعتي'});
    expect(service.parse('ابدأ التوجيه')).toEqual({type:'START_NAVIGATION'});
  });
  it('preempts information with safety and suppresses repeated announcements',()=>{
    const spoken:string[]=[],interrupted=vi.fn();let done:()=>void=()=>{};
    const queue=new AnnouncementPriorityQueue((item,finish)=>{spoken.push(item.text);done=finish;},interrupted,5000);
    expect(queue.enqueue({text:'وصف',key:'info',priority:'INFORMATION',at:1000})).toBe(true);
    expect(queue.enqueue({text:'توقف',key:'hazard',priority:'CRITICAL_SAFETY',at:1002})).toBe(true);
    expect(interrupted).toHaveBeenCalledTimes(1);expect(spoken).toEqual(['وصف','توقف']);
    expect(queue.enqueue({text:'توقف',key:'hazard',priority:'CRITICAL_SAFETY',at:1003})).toBe(false);
    expect(queue.enqueue({text:'انعطف',key:'turn',priority:'TURN',at:1004})).toBe(true);
    done();expect(spoken).toContain('انعطف');
  });
  it('does not assert a safe path when segmentation is uncertain',()=>{
    const fusion=new NavigationSafetyFusion();const decision=fusion.evaluate(planner().plan('a',destination),0,location(),scene([]),Date.now());
    expect(decision.state).toBe('ROUTE_UNCERTAIN');expect(decision.message).not.toContain('آمن');
  });
  it('does not attach a camera hazard to an edge when heading differs',()=>{
    const fusion=new NavigationSafetyFusion();const decision=fusion.evaluate(planner().plan('a',destination),0,location(0,0,'f0',{headingDegrees:270}),scene([chair]),Date.now());
    expect(decision.edgeId).toBeNull();expect(decision.priority).toBe(3);
  });
  it('localizes safety warnings for the selected voice language',()=>{
    const decision=new NavigationSafetyFusion('en').evaluate(planner().plan('a',destination),0,location(),scene([chair]),Date.now());
    expect(decision.message).toContain('obstacle');
  });
  it('reroutes after repeated blocked walkable-area observations',()=>{
    const engine=new BasiraNavigationEngine(planner(),floors);engine.prepare(destination,location());engine.start();
    const blocked={...scene([],1000),walkableArea:{...scene([],1000).walkableArea!,pathAhead:'BLOCKED' as const}};
    engine.observeScene(blocked,1000);engine.observeScene({...blocked,capturedAt:2000},2000);engine.observeScene({...blocked,capturedAt:3000},3000);
    expect(engine.session.route?.orderedEdges[0].id).toBe('ad');
  });
  it('runs the logical entrance, obstacle, elevator, floor anchor and OCR arrival flow',()=>{
    const b3=new BasiraLocalizationEngine();
    const start=b3.anchor({buildingId:'b',floorId:'f0',x:0,y:0,headingDegrees:90,confidence:.9,uncertaintyRadius:1,source:'MANUAL',timestamp:1000});
    const target={...destination,id:'p122',name:'قاعة 122',floorId:'f1',nodeId:'room1',placeId:'p122'};
    const engine=new BasiraNavigationEngine(planner(),floors);
    expect(engine.prepare(target,start)).toBe(true);engine.start();
    engine.observeScene(scene([chair],2000),2000);engine.observeScene(scene([chair],3000),3000);engine.observeScene(scene([chair],4000),4000);
    expect(engine.session.lastRerouteReason).toBe('PERSISTENT_OBSTACLE');
    engine.updateLocation(b3.anchor({buildingId:'b',floorId:'f0',x:10,y:10,headingDegrees:0,confidence:.9,uncertaintyRadius:1,source:'MANUAL',timestamp:5000}),5000);
    expect(engine.updateLocation(b3.transition('ENTER_ELEVATOR',6000),6000)).toBe('LOST');
    expect(engine.session.state).toBe('RELOCALIZING');
    expect(engine.updateLocation(b3.anchor({buildingId:'b',floorId:'f1',x:10,y:10,headingDegrees:90,confidence:.9,uncertaintyRadius:1,source:'QR',timestamp:7000}),7000)).toBe('RECOVERED');
    engine.updateLocation(b3.anchor({buildingId:'b',floorId:'f1',x:12,y:10,headingDegrees:90,confidence:.9,uncertaintyRadius:1,source:'MANUAL',timestamp:8000}),8000);
    expect(engine.considerArrival('p122',true,'RIGHT')).toBe(true);
    expect(engine.session.state).toBe('ARRIVED');expect(engine.session.instruction?.text).toContain('يمينك');
  });
});
