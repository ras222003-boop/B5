import {describe,expect,it} from 'vitest';
import type {MetricDepthMap,SegmentationGrid,VisionDetection} from '@shared/vision';
import {DEFAULT_VISION_CONFIG} from './config';
import {FUSION_MAX_AGE_MS,FUSION_MAX_SKEW_MS,VisionFusionEngine,type FusionInput,metricDepthForDetection} from './fusion';
import {BasiraSafetyEngine} from './safety';
import {SEG,DropOffHazardDetector,SemanticWalkableAreaProvider,detectionsFromSegmentation} from './segmentation';

const object=(timestamp=1000):VisionDetection=>({id:'chair',type:'CHAIR',confidence:.9,timestamp,source:'OBJECT_DETECTOR',
  boundingBox:{x:.2,y:.3,width:.4,height:.4},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null});
const grid=(timestamp=1000):SegmentationGrid=>({timestamp,width:32,height:32,labels:new Uint8Array(1024).fill(SEG.FLOOR)});
const depth=(timestamp=1000):MetricDepthMap=>({timestamp,width:32,height:32,values:new Float32Array(1024).fill(1.2),confidence:.9,source:'LIDAR',alignmentVerified:true});
const input=(changes:Partial<FusionInput>={}):FusionInput=>({objects:[object()],signs:[],segmentation:grid(),relativeDepth:null,metricDepth:null,...changes});
const engine=()=>new VisionFusionEngine(new BasiraSafetyEngine(DEFAULT_VISION_CONFIG));

describe('fusion freshness and source synchronization',()=>{
  it('removes aged objects, signs and semantic surfaces from both detections and events',()=>{
    const result=engine().fuse(input({signs:[{...object(),type:'SIGN',source:'OCR_SIGN'}]}),1001+FUSION_MAX_AGE_MS);
    expect(result).toEqual({detections:[],events:[],walkableArea:null,surfaceAnalysis:null});
  });
  it('accepts the TTL boundary but rejects future and nonfinite timestamps',()=>{
    expect(engine().fuse(input(),1000+FUSION_MAX_AGE_MS).detections).toHaveLength(1);
    for(const timestamp of [1001,NaN,Infinity])expect(engine().fuse(input({objects:[object(timestamp)],segmentation:grid(timestamp)}),1000).detections).toEqual([]);
    expect(engine().fuse(input(),NaN).detections).toEqual([]);
  });
  it('does not combine an older semantic surface with a newer detector scene',()=>{
    const result=engine().fuse(input({objects:[object(1001+FUSION_MAX_SKEW_MS)]}),1300);
    expect(result.detections).toHaveLength(1);
    expect(result.walkableArea).toBeNull();
  });
  it('does not retain older object or sign positions when a newer semantic scene arrives',()=>{
    const result=engine().fuse(input({segmentation:grid(1300),signs:[{...object(),type:'SIGN',source:'OCR_SIGN'}]}),1300);
    expect(result.detections).toEqual([]);
    expect(result.walkableArea?.surface).toBe('FLOOR');
  });
  it('accepts exactly the skew boundary while preserving stricter object-depth association',()=>{
    const result=engine().fuse(input({objects:[object(1250)],metricDepth:depth()}),1250);
    expect(result.walkableArea?.surface).toBe('FLOOR');
    expect(result.detections[0].approximateDistance).toBeNull();
  });
  it('rejects an aged supplied depth map without preserving an earlier measurement',()=>{
    const result=engine().fuse(input({objects:[{...object(2000),approximateDistance:{distanceMeters:1,confidence:.9,source:'LIDAR'}}],segmentation:null,metricDepth:depth(500)}),2000);
    expect(result.detections[0].approximateDistance).toBeNull();
  });
  it('rejects malformed detector scores and geometry before risk classification',()=>{
    for(const change of [{confidence:NaN},{confidence:1.2},{boundingBox:{x:-.1,y:.3,width:.4,height:.4}}])
      expect(engine().fuse(input({objects:[{...object(),...change}],segmentation:null}),1000).events).toEqual([]);
    expect(metricDepthForDetection(object(),{...depth(),confidence:NaN})).toBeNull();
  });
});

describe('semantic validation boundaries',()=>{
  it('rejects malformed mask dimensions, length and label vocabulary',()=>{
    for(const value of [{...grid(),width:NaN},{...grid(),height:0},{...grid(),labels:new Uint8Array(4)},
      {...grid(),labels:new Uint8Array(1024).fill(255)}]){
      expect(detectionsFromSegmentation(value)).toEqual([]);
      expect(new SemanticWalkableAreaProvider().analyze(value,[]).pathAhead).toBe('UNKNOWN');
      expect(new DropOffHazardDetector().detect(value,depth())).toBeNull();
      expect(engine().fuse(input({segmentation:value}),1000).walkableArea).toBeNull();
    }
  });
  it('requires exact segmentation-depth capture alignment and trusted metric alignment',()=>{
    const g=grid();g.labels.fill(SEG.OTHER);
    for(let y=22;y<28;y++)for(let x=0;x<32;x++)g.labels[y*32+x]=SEG.FLOOR;
    const d=depth();d.values.fill(4,0,20*32);
    expect(new DropOffHazardDetector().detect(g,d)?.type).toBe('DROP_OFF_UNCERTAIN');
    for(const change of [{timestamp:1001},{alignmentVerified:false},{confidence:NaN},{confidence:2},{width:1.5}])
      expect(new DropOffHazardDetector().detect(g,{...d,...change})).toBeNull();
  });
});
