import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '@shared/navigation';
import type { VisionDetection } from '@shared/vision';
import { navApi } from '@/lib/navigationApi';
import { DEFAULT_VISION_CONFIG, normalizeVisionAlertDistance, visionConfigForAlertDistance } from './config';
import { classifyCameraError } from './camera';
import { mappedCocoType } from './providers';
import { VisualPlaceRecognitionService, matchPlace, normalizePlaceText, signTypeForText } from './placeRecognition';
import { AlertDeduplicator, BasiraSafetyEngine, classifyDirection } from './safety';
import { SceneUnderstandingService } from './scene';
import { visionMessages } from '@/i18n/locales/vision';

const detection=(changes:Partial<VisionDetection>={}):VisionDetection=>({
  id:'one',type:'CHAIR',confidence:0.94,boundingBox:{x:0.4,y:0.2,width:0.2,height:0.5},
  horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null,timestamp:1000,
  source:'OBJECT_DETECTOR',...changes,
});
const place={id:'p1',name:'قاعة 121',roomNumber:'121',aliases:['قاعتي','Room 121'],buildingId:'b1',floorId:'f1'} as Place;
afterEach(()=>vi.restoreAllMocks());

describe('direction and safety',()=>{
  it('classifies horizontal position at all five directions',()=>{
    expect([0.05,0.25,0.45,0.65,0.85].map(x=>classifyDirection({x,y:0,width:0.1,height:0.2})))
      .toEqual(['LEFT','FRONT_LEFT','FRONT','FRONT_RIGHT','RIGHT']);
  });
  it('does not call an unmeasured descending stair critical or a named vehicle within range',()=>{
    const engine=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG);
    expect(engine.classify(detection({type:'STAIRS_DOWN'})).riskLevel).toBe('HIGH');
    expect(engine.classify(detection({type:'VEHICLE'})).riskLevel).toBe('MEDIUM');
    expect(engine.classify(detection({type:'STAIRS_UNCERTAIN'})).reason).toBe('UNCERTAIN');
  });
  it('reserves critical for nearby high-confidence metric depth',()=>{
    const engine=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG);
    expect(engine.classify(detection({type:'STAIRS_DOWN',approximateDistance:{distanceMeters:0.8,confidence:0.9,source:'LIDAR'}})).riskLevel).toBe('CRITICAL');
    expect(engine.classify(detection({type:'STAIRS_DOWN',approximateDistance:{distanceMeters:0.8,confidence:0.4,source:'LIDAR'}})).riskLevel).toBe('HIGH');
    expect(engine.classify(detection({type:'STAIRS_DOWN',approximateDistance:{distanceMeters:0.8,confidence:0.9,source:'MONOCULAR_ESTIMATE'}})).riskLevel).toBe('HIGH');
  });
  it('treats a central unidentified object as high risk without inventing distance',()=>{
    const engine=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG);
    expect(engine.classify(detection({type:'UNKNOWN_OBSTACLE'}))).toMatchObject({riskLevel:'HIGH',distanceBand:'UNKNOWN'});
    expect(engine.classify(detection({approximateDistance:{distanceMeters:-1,confidence:0.9,source:'LIDAR'}})).distanceBand).toBe('UNKNOWN');
  });
  it('suppresses repeats while allowing escalation and new proximity',()=>{
    const engine=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG),dedup=new AlertDeduplicator(5000);
    const chair=engine.classify(detection({trackId:'chair-1'}));
    expect(dedup.shouldAnnounce(chair,1000)).toBe(true);
    expect(dedup.shouldAnnounce(chair,1500)).toBe(false);
    const nearer=engine.classify(detection({trackId:'chair-1',approximateDistance:{distanceMeters:1.5,confidence:0.9,source:'LIDAR'}}));
    expect(dedup.shouldAnnounce(nearer,1600)).toBe(true);
    expect(dedup.shouldAnnounce(nearer,1700)).toBe(false);
    expect(dedup.shouldAnnounce(nearer,7000)).toBe(true);
  });
  it('alerts a named object only within the user-selected metric range',()=>{
    const engine=new BasiraSafetyEngine(visionConfigForAlertDistance(5));
    const within=engine.classify(detection({type:'CHAIR',approximateDistance:{distanceMeters:4.6,confidence:.9,source:'LIDAR'}}));
    const outside=engine.classify(detection({type:'CHAIR',approximateDistance:{distanceMeters:5.4,confidence:.9,source:'LIDAR'}}));
    const monocular=engine.classify(detection({type:'CHAIR',approximateDistance:{distanceMeters:1,confidence:.9,source:'MONOCULAR_ESTIMATE'}}));
    expect(within.riskLevel).toBe('HIGH');
    expect(outside.riskLevel).toBe('MEDIUM');
    expect(monocular.riskLevel).toBe('MEDIUM');
  });
  it('accepts half a metre and custom distances, and rejects invalid values',()=>{
    expect(normalizeVisionAlertDistance(0.5)).toBe(0.5);
    expect(normalizeVisionAlertDistance(1.5)).toBe(1.5);
    expect(normalizeVisionAlertDistance(0)).toBe(DEFAULT_VISION_CONFIG.alertDistanceMeters);
  });
  it('tracks approach speed from fresh metric readings on the same object',()=>{
    const engine=new BasiraSafetyEngine(visionConfigForAlertDistance(3));
    engine.classify(detection({trackId:'chair-approach',timestamp:1000,approximateDistance:{distanceMeters:2.5,confidence:.9,source:'LIDAR'}}));
    const approaching=engine.classify(detection({trackId:'chair-approach',timestamp:2000,approximateDistance:{distanceMeters:1.5,confidence:.9,source:'LIDAR'}}));
    expect(approaching.approachSpeedMps).toBeCloseTo(1);
    expect(approaching.riskLevel).toBe('HIGH');
  });
  it('maps additional COCO classes to their spoken names',()=>{
    expect(mappedCocoType('couch',.8)).toBe('SOFA');
    expect(mappedCocoType('backpack',.8)).toBe('BACKPACK');
    expect(visionMessages.ar.object.SOFA).toBe('أريكة');
  });
  it('keeps named vehicles silent outside the selected metric range',()=>{
    const engine=new BasiraSafetyEngine(visionConfigForAlertDistance(5));
    expect(engine.classify(detection({type:'CAR',approximateDistance:{distanceMeters:4.6,confidence:.9,source:'LIDAR'}})).riskLevel).toBe('HIGH');
    expect(engine.classify(detection({type:'CAR',approximateDistance:{distanceMeters:5.4,confidence:.9,source:'LIDAR'}})).riskLevel).toBe('MEDIUM');
    expect(engine.classify(detection({type:'CAR',approximateDistance:{distanceMeters:1,confidence:.9,source:'MONOCULAR_ESTIMATE'}})).riskLevel).toBe('MEDIUM');
  });
  it('speaks the detected vehicle type and measured distance without inventing monocular metres',()=>{
    const engine=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG);
    const car=engine.classify(detection({type:'CAR',approximateDistance:{distanceMeters:2.4,confidence:.9,source:'LIDAR'}}));
    const measured=new SceneUnderstandingService(visionMessages.ar).summarize([car],null,1000).shortText;
    const unmeasured=new SceneUnderstandingService(visionMessages.ar).summarize([engine.classify(detection({type:'CAR',approximateDistance:{distanceMeters:2.4,confidence:.9,source:'MONOCULAR_ESTIMATE'}}))],null,1000).shortText;
    expect(measured).toContain('سيارة');
    expect(measured).toContain('2');
    expect(unmeasured).toContain('سيارة');
    expect(unmeasured).not.toContain('2 متر');
  });
});

describe('place recognition and permission errors',()=>{
  it('matches Arabic and English room labels to the same B1 place',()=>{
    expect(normalizePlaceText('قاعة ١٢١')).toBe('قاعة 121');
    expect(matchPlace('قاعة ١٢١',[place])?.id).toBe('p1');
    expect(matchPlace('Room 121',[place])?.id).toBe('p1');
    expect(matchPlace('Room 122',[place])).toBeNull();
    expect(matchPlace('121',[place,{...place,id:'p2',buildingId:'b2'}])).toBeNull();
  });
  it('creates a private pending candidate only after B1 has no match',async()=>{
    vi.spyOn(navApi,'search').mockResolvedValue({results:[]}).mockResolvedValueOnce({results:[{kind:'place',priority:0,item:place}]});
    const service=new VisualPlaceRecognitionService('b1','f1');
    const matched=await service.recognize({text:'Room 121',confidence:0.9,boundingBox:null,timestamp:10,language:'en'});
    expect(matched.place?.placeId).toBe('p1');
    expect(matched.candidate).toBeNull();
    const unknown=await service.recognize({text:'Room 222',confidence:0.9,boundingBox:null,timestamp:20,language:'en'});
    expect(unknown.place).toBeNull();
    expect(unknown.candidate).toMatchObject({detectedText:'Room 222',buildingId:'b1',floorId:'f1',source:'VISION',reviewStatus:'PENDING',lookupStatus:'NOT_FOUND'});
  });
  it('falls back to the room number when the OCR language differs from B1 aliases',async()=>{
    const search=vi.spyOn(navApi,'search').mockResolvedValue({results:[]});
    search.mockResolvedValueOnce({results:[]}).mockResolvedValueOnce({results:[]}).mockResolvedValueOnce({results:[{kind:'place',priority:0,item:place}]});
    const result=await new VisualPlaceRecognitionService('b1','f1').recognize({text:'Room 121',confidence:0.9,boundingBox:null,timestamp:10,language:'en'});
    expect(result.place?.placeId).toBe('p1');
    expect(search).toHaveBeenCalledWith('121','b1');
  });
  it('identifies entrance and exit signs from multilingual OCR text',()=>{
    expect(signTypeForText('مخرج')).toBe('EXIT');
    expect(signTypeForText('Exit')).toBe('EXIT');
    expect(signTypeForText('入口')).toBe('ENTRANCE');
    expect(signTypeForText('Room 121')).toBe('SIGN');
  });
  it('distinguishes camera denial, settings and absence without starting a camera',()=>{
    expect(classifyCameraError({name:'NotAllowedError'},'prompt')).toBe('DENIED');
    expect(classifyCameraError({name:'NotAllowedError'},'denied')).toBe('DEVICE_SETTINGS');
    expect(classifyCameraError({name:'NotFoundError'})).toBe('NO_CAMERA');
    expect(classifyCameraError({name:'NotReadableError'})).toBe('IN_USE');
  });
});
