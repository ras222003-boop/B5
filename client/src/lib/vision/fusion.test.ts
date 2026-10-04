import { describe,expect,it,vi } from 'vitest';
import type { MetricDepthMap, RelativeDepthMap, SegmentationGrid, VisionDetection } from '@shared/vision';
import { visionMessages } from '@/i18n/locales/vision';
import { DEFAULT_VISION_CONFIG } from './config';
import { VisionFusionEngine } from './fusion';
import { BasiraSafetyEngine } from './safety';
import { VisionAnnouncementService } from './scene';
import { DropOffHazardDetector, SEG, SemanticWalkableAreaProvider, detectionsFromSegmentation, semanticCode } from './segmentation';

const grid=(width=30,height=30):SegmentationGrid=>({width,height,labels:new Uint8Array(width*height),timestamp:100});
const paint=(g:SegmentationGrid,code:number,x0:number,y0:number,x1:number,y1:number)=>{
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)g.labels[y*g.width+x]=code;
};
const object=(type:VisionDetection['type'],confidence=.8):VisionDetection=>({id:type,type,confidence,
  boundingBox:{x:.4,y:.55,width:.2,height:.35},horizontalDirection:'FRONT',verticalPosition:'BOTTOM',
  approximateDistance:null,timestamp:100,source:'OBJECT_DETECTOR'});

describe('local semantic vision and fusion',()=>{
  it('maps actual ADE20K labels and emits cautious stair, door, column and unknown obstacle regions',()=>{
    expect(['stairs','stairway','step','door','column','box'].map(semanticCode)).toEqual([SEG.STAIRS,SEG.STAIRS,SEG.STAIRS,SEG.DOOR,SEG.COLUMN,SEG.SOLID]);
    const g=grid();
    paint(g,SEG.STAIRS,3,15,9,24);paint(g,SEG.DOOR,12,5,18,20);
    paint(g,SEG.COLUMN,21,7,26,27);paint(g,SEG.SOLID,10,22,16,29);
    const types=detectionsFromSegmentation(g).map(d=>d.type);
    expect(types).toEqual(expect.arrayContaining(['STAIRS_UNCERTAIN','DOOR','COLUMN','UNKNOWN_OBSTACLE']));
    expect(types).not.toContain('STAIRS_DOWN');
  });
  it('reports visible free-space sectors and blocks a central obstacle without claiming safety',()=>{
    const g=grid();paint(g,SEG.FLOOR,0,16,30,27);
    const provider=new SemanticWalkableAreaProvider();
    const open=provider.analyze(g,[]);
    expect(open.pathAhead).toBe('CLEAR');
    expect(open.freeSpaceCenter).toBeGreaterThan(.7);
    expect(provider.analyze(g,[object('UNKNOWN_OBSTACLE')]).pathAhead).toBe('BLOCKED');
    expect(provider.analyze(grid(),[]).pathAhead).toBe('UNKNOWN');
  });
  it('marks a depth discontinuity with floor termination as uncertain, with highest high-risk priority',()=>{
    const g=grid();paint(g,SEG.FLOOR,0,21,30,28);
    const values=new Float32Array(30*30).fill(.2);
    for(let y=0;y<20;y++)for(let x=0;x<30;x++)values[y*30+x]=.9;
    const depth:RelativeDepthMap={width:30,height:30,values,confidence:.5,source:'MONOCULAR_ESTIMATE',timestamp:100};
    const hazard=new DropOffHazardDetector().detect(g,depth);
    expect(hazard?.type).toBe('DROP_OFF_UNCERTAIN');
    const events=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG).classifyAll([object('VEHICLE'),hazard!]);
    expect(events[0].type).toBe('DROP_OFF_UNCERTAIN');
    expect(events[0].riskLevel).toBe('HIGH');
  });
  it('fuses segmentation, COCO and measured native depth without making monocular metres',()=>{
    const g=grid();paint(g,SEG.FLOOR,0,16,30,27);paint(g,SEG.DOOR,20,6,26,21);
    const values=new Float32Array(30*30).fill(1.2);
    const metric:MetricDepthMap={width:30,height:30,values,confidence:.9,source:'LIDAR',timestamp:100};
    const fusion=new VisionFusionEngine(new BasiraSafetyEngine(DEFAULT_VISION_CONFIG));
    const frame=fusion.fuse({objects:[object('CHAIR')],segmentation:g,relativeDepth:null,metricDepth:metric,signs:[]});
    expect(frame.detections.some(d=>d.type==='DOOR')).toBe(true);
    expect(frame.detections.find(d=>d.type==='CHAIR')?.approximateDistance?.source).toBe('LIDAR');
    expect(frame.walkableArea?.pathAhead).toBe('BLOCKED');
    const noMetric=fusion.fuse({objects:[object('CHAIR')],segmentation:g,relativeDepth:{width:30,height:30,values,confidence:.5,source:'MONOCULAR_ESTIMATE',timestamp:100},metricDepth:null,signs:[]});
    expect(noMetric.detections.find(d=>d.type==='CHAIR')?.approximateDistance).toBeNull();
  });
  it('does not fuse an old depth frame into a new ground boundary',()=>{
    const g=grid();paint(g,SEG.FLOOR,0,21,30,28);
    const values=new Float32Array(30*30).fill(.2);
    for(let y=0;y<20;y++)for(let x=0;x<30;x++)values[y*30+x]=.9;
    const oldDepth:RelativeDepthMap={width:30,height:30,values,confidence:.5,source:'MONOCULAR_ESTIMATE',timestamp:99};
    const result=new VisionFusionEngine(new BasiraSafetyEngine(DEFAULT_VISION_CONFIG)).fuse({objects:[],segmentation:g,relativeDepth:oldDepth,metricDepth:null,signs:[]});
    expect(result.detections.some(d=>d.type==='DROP_OFF_UNCERTAIN')).toBe(false);
  });
  it('does not let an informational sign interrupt a recent high-risk alert',()=>{
    const speak=vi.fn(),haptic={critical:vi.fn()};
    const announce=new VisionAnnouncementService(visionMessages.ar,speak,haptic,5000);
    const safety=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG);
    expect(announce.announce(safety.classifyAll([object('STAIRS_UNCERTAIN')]),1000)?.event.type).toBe('STAIRS_UNCERTAIN');
    expect(announce.announce(safety.classifyAll([object('SIGN')]),2000)).toBeNull();
    expect(speak).toHaveBeenCalledTimes(1);
  });
  it('speaks and vibrates for measured critical drop-off ahead before ordinary objects',()=>{
    const speak=vi.fn(),haptic={critical:vi.fn()};
    const safety=new BasiraSafetyEngine(DEFAULT_VISION_CONFIG);
    const events=safety.classifyAll([object('CHAIR'),{...object('DROP_OFF',.92),approximateDistance:{distanceMeters:.7,confidence:.9,source:'ARCORE_DEPTH'}}]);
    expect(events[0].type).toBe('DROP_OFF');
    expect(events[0].riskLevel).toBe('CRITICAL');
    const announce=new VisionAnnouncementService(visionMessages.ar,speak,haptic,5000);
    expect(announce.announce(events,1000)?.text).toBe(visionMessages.ar.dropOff);
    expect(haptic.critical).toHaveBeenCalledTimes(1);
  });
});
