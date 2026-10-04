import { describe,expect,it } from 'vitest';
import type { MapNode, Place } from '@shared/navigation';
import type { MapSuggestion, MappingTrackPoint, PositionObservation } from '@shared/localization';
import { BasiraLocalizationEngine, FloorEstimator, LocalizationFusionEngine, LoopClosureService, MapDeduplicationService } from './engine';
import { MappingSessionEngine } from './mapping';
import { decodeNfcAnchor, parseQrAnchor } from './providers';

const building='11111111-1111-4111-8111-111111111111',floor='22222222-2222-4222-8222-222222222222',nodeId='33333333-3333-4333-8333-333333333333';
const node:MapNode={id:nodeId,buildingId:building,floorId:floor,placeId:null,x:0,y:0,nodeType:'ENTRANCE',accessibilityLevel:'UNKNOWN'};
const observation=(timestamp=1000):PositionObservation=>({buildingId:building,floorId:floor,x:0,y:0,headingDegrees:null,confidence:.95,uncertaintyRadius:1,source:'QR',timestamp,nodeId});

describe('B3 localization',()=>{
  it('decays confidence, expands uncertainty, freezes dead reckoning when lost and recovers at a strong anchor',()=>{
    const engine=new LocalizationFusionEngine();engine.apply(observation());
    const initial=engine.current(1000),later=engine.current(121000);
    expect(later.confidence).toBeLessThan(initial.confidence);
    expect(later.uncertaintyRadius).toBeGreaterThan(initial.uncertaintyRadius!);
    expect(later.state).toBe('LOCALIZATION_LOST');
    expect(engine.move(.65,90,122000).x).toBe(0);
    expect(engine.apply({...observation(123000),x:8,y:3,source:'VISUAL_PLACE',confidence:.8}).state).toBe('TRACKING');
    expect(engine.current(123000)).toMatchObject({x:8,y:3,floorId:floor});
    expect(engine.drainEvents().map(e=>e.type)).toContain('LOCALIZATION_RECOVERED');
  });
  it('keeps GPS at building granularity and uses known B1 place geometry to correct motion',()=>{
    const engine=new BasiraLocalizationEngine();
    engine.anchor({...observation(),source:'GPS_BUILDING',floorId:null,x:null,y:null,confidence:1});
    expect(engine.fusion.current(1000).x).toBeNull();
    engine.anchor(observation());engine.heading.observe(90,'COMPASS',1100,true);engine.step(1100);
    const place={id:'44444444-4444-4444-8444-444444444444',buildingId:building,floorId:floor,localX:10,localY:2} as Place;
    expect(engine.visualAnchor(place,[],.9,1200)).toMatchObject({x:10,y:2});
    expect(engine.fusion.current(1200)).toMatchObject({x:10,y:2});
    engine.anchor({...observation(1300),buildingId:'99999999-9999-4999-8999-999999999999',floorId:null,x:null,y:null,source:'GPS_BUILDING'});
    expect(engine.fusion.current(1300)).toMatchObject({buildingId:building,x:10,y:2});
  });
  it('uses only QR anchors matching the loaded graph',()=>{
    const found=parseQrAnchor(`basira://building/${building}/floor/${floor}/node/${nodeId}`,[node]);
    expect(found).toEqual(node);
    const engine=new BasiraLocalizationEngine();engine.anchor(observation());engine.fusion.current(121000);
    if(found)engine.anchor({...observation(122000),x:found.x,y:found.y,nodeId:found.id});
    expect(engine.fusion.current(122000).state).toBe('TRACKING');
    expect(parseQrAnchor(`basira://building/${building}/floor/${floor}/node/another`,[node])).toBeNull();
    expect(parseQrAnchor('https://example.com/secret',[node])).toBeNull();
  });
  it('decodes an NFC text anchor without leaking tag metadata into the identifier',()=>{
    const value=`basira://building/${building}/floor/${floor}/node/${nodeId}`;
    const bytes=new Uint8Array([2,101,110,...new TextEncoder().encode(value)]);
    expect(decodeNfcAnchor({recordType:'text',data:new DataView(bytes.buffer)})).toBe(value);
  });
  it('clears the floor during transitions and waits for confirmation',()=>{
    const floors=new FloorEstimator();
    floors.observe({type:'FLOOR_CONFIRMED',floorId:floor,timestamp:1000,source:'QR'});
    expect(floors.current().floorId).toBe(floor);
    expect(floors.observe({type:'ENTER_ELEVATOR',floorId:null,timestamp:2000,source:'MANUAL'})).toMatchObject({floorId:null,transitionPending:true});
    const engine=new BasiraLocalizationEngine();engine.anchor(observation());engine.transition('STAIRS_TRANSITION',2000);
    expect(engine.fusion.current(2000)).toMatchObject({floorId:null,state:'LOCALIZATION_LOST'});
  });
  it('recognizes a floor sign without pretending it supplies metric coordinates',()=>{
    const engine=new MappingSessionEngine('session',building,[]);
    const place={id:'44444444-4444-4444-8444-444444444444',buildingId:building,floorId:floor,localX:null,localY:null} as Place;
    expect(engine.recognized(place,.8,1000)).toBe(true);
    expect(engine.localization.fusion.current(1000)).toMatchObject({floorId:floor,x:null,y:null,state:'LOCALIZATION_LOST'});
  });
  it('corrects accumulated loop drift back to a known point',()=>{
    const track:MappingTrackPoint[]=[0,1,2].map((n)=>({sessionId:'s',timestamp:1000+n*1000,x:[0,3,4][n],y:n, floorId:floor,headingDegrees:null,confidence:.6,sourceSummary:['STEP_MOTION']}));
    const result=new LoopClosureService().correct(track,{x:0,y:0,floorId:floor});
    expect(result[0]).toMatchObject({x:0,y:0});expect(result[2]).toMatchObject({x:0,y:0});expect(result[1].x).toBeCloseTo(1);
  });
  it('deduplicates named places nearby but keeps separate floors and distant places',()=>{
    const candidate={type:'PLACE_ANCHOR' as const,floorId:floor,x:5,y:5,name:'قاعة 121',placeId:null};
    const service=new MapDeduplicationService();
    expect(service.duplicate(candidate,[{...candidate,name:' قاعة 121 ',x:6}])).toBe(true);
    expect(service.duplicate(candidate,[{...candidate,x:20}])).toBe(false);
    expect(service.duplicate(candidate,[{...candidate,floorId:'other'}])).toBe(false);
  });
  it('proposes a reviewable corridor only with motion plus observed walkable area',()=>{
    const engine=new MappingSessionEngine('session',building,[node]);engine.anchor(observation());
    engine.localization.heading.observe(90,'COMPASS',1000,true);
    for(let i=1;i<=5;i++)engine.step(1000+i*500);
    expect(engine.suggestions).toHaveLength(0);
    engine.observeWalkable({pathAhead:'CLEAR',freeSpaceLeft:.7,freeSpaceCenter:.8,freeSpaceRight:.7,confidence:.8,source:'SEMANTIC_SEGMENTATION'});
    for(let i=6;i<=12;i++)engine.step(1000+i*500);
    const corridor=engine.suggestions.find(s=>s.type==='CORRIDOR');
    expect(corridor?.status).toBe('PENDING');expect(corridor?.geometry).not.toBeNull();
    expect(engine.suggestions.every(s=>s.status==='PENDING')).toBe(true);
  });
});
