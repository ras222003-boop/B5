import {describe,expect,it} from 'vitest';
import {estimateNativeObjectDepth} from './nativeObjectDepth';
import type {MetricDepthMap,VisionDetection} from '@shared/vision';

const map=(v=1.4):MetricDepthMap=>({
  width:48,height:64,values:new Float32Array(48*64).fill(v),
  source:'ARKIT_DEPTH',timestamp:1000,confidence:.95,
});
const detection=():VisionDetection=>({
  id:'chair', type:'CHAIR',confidence:.96,
  boundingBox:{x:.35,y:.35,width:.28,height:.28},
  horizontalDirection:'FRONT',verticalPosition:'MIDDLE',
  approximateDistance:null,timestamp:1000,source:'OBJECT_DETECTOR',
});
describe('research-only depth measurement over detected objects',()=>{
  it('accepts enough consistent high-confidence local depth',()=>{
    const evidence=estimateNativeObjectDepth(detection(),map(1.4));
    expect(evidence.reason).toBeNull();
    expect(evidence.valid).toBe(25);
    expect(evidence.reading?.distanceMeters).toBeCloseTo(1.4);
    expect(evidence.reading?.confidence).toBeLessThanOrEqual(1);
  });
  it('rejects uncertain object label, unverified depth and unsynchronized frames',()=>{
    expect(estimateNativeObjectDepth({...detection(),confidence:.6},map()).reason).toBe('LOW_OBJECT_CONFIDENCE');
    expect(estimateNativeObjectDepth(detection(),{...map(),confidence:.4}).reason).toBe('UNVERIFIED_DEPTH');
    expect(estimateNativeObjectDepth({...detection(),timestamp:1250},map()).reason).toBe('STALE_FRAME');
    expect(estimateNativeObjectDepth({...detection(),boundingBox:{x:.2,y:.2,width:.03,height:.03}},map()).reason).toBe('SMALL_OBJECT');
    expect(estimateNativeObjectDepth({...detection(),boundingBox:{x:-.1,y:.2,width:.2,height:.2}},map()).reason).toBe('SMALL_OBJECT');
  });
  it('does not replace missing object pixels with background estimates',()=>{
    const values=map();
    // Interior 5x5 lies near x=17..29 and y=27..39.
    for(let y=25;y<45;y++)for(let x=16;x<35;x++)values.values[y*values.width+x]=0;
    expect(estimateNativeObjectDepth(detection(),values).reason).toBe('LOW_LOCAL_COVERAGE');
  });
  it('rejects two incompatible depth layers in the same bounding box',()=>{
    const values=map(1.2);
    for(let y=0;y<values.height;y++)for(let x=24;x<values.width;x++)values.values[y*values.width+x]=2.9;
    const result=estimateNativeObjectDepth(detection(),values);
    expect(result.reason).toBe('MIXED_SURFACES');
    expect(result.reading).toBeNull();
  });
  it('does not infer an obstacle distance from glass or transparent object with no reliable LiDAR',()=>{
    const values=map(0);
    expect(estimateNativeObjectDepth(detection(),values).reading).toBeNull();
  });
});
