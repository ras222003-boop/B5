import {describe,expect,it} from 'vitest';
import type {EstimatedMetricDepthMap,VisionDetection} from '@shared/vision';
import {metricMapForFrame,metricPixels,metricPlacement} from './metricModel';
import {estimatedMetersForDetection,measureEstimatedObjects} from './autoMeter';

const detection=(timestamp=10):VisionDetection=>({
  id:'chair',type:'CHAIR',source:'OBJECT_DETECTOR',confidence:.9,
  boundingBox:{x:.25,y:.25,width:.5,height:.5},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',
  approximateDistance:null,timestamp,
});
const map=(meters=1.5):EstimatedMetricDepthMap=>({
  width:80,height:60,values:new Float32Array(80*60).fill(meters),source:'MONOCULAR_METRIC',timestamp:10,
});

describe('metric image processing',()=>{
  it('letterboxes portrait and landscape frames without reversing axes',()=>{
    expect(metricPlacement(640,480)).toEqual({x:0,y:49,width:392,height:294});
    expect(metricPlacement(480,640)).toEqual({x:49,y:0,width:294,height:392});
    const depth=new Float32Array(392*392);
    for(let y=0;y<392;y++)for(let x=0;x<392;x++)depth[y*392+x]=.5+x/392+2*y/392;
    const portrait=metricMapForFrame(depth,480,640,metricPlacement(480,640),10);
    expect(portrait.width).toBe(120);
    expect(portrait.height).toBe(160);
    expect(portrait.values[0]).toBeLessThan(portrait.values[portrait.width-1]);
    expect(portrait.values[0]).toBeLessThan(portrait.values[(portrait.height-1)*portrait.width]);
  });
  it('packs normalized RGB channels and removes invalid outputs',()=>{
    const rgba=new Uint8ClampedArray(392*392*4);
    rgba[0]=255;rgba[1]=128;rgba[2]=0;rgba[3]=255;
    const pixels=metricPixels(rgba),plane=392*392;
    expect(pixels[0]).toBeCloseTo((1-.485)/.229,5);
    expect(pixels[plane]).toBeCloseTo((128/255-.456)/.224,5);
    expect(pixels[2*plane]).toBeCloseTo((0-.406)/.225,5);
    const depth=new Float32Array(plane).fill(21);
    depth[0]=Infinity;
    const result=metricMapForFrame(depth,392,392,metricPlacement(392,392),10);
    expect(result.values.every(value=>Number.isFinite(value)||Number.isNaN(value))).toBe(true);
    expect(result.values.some(Number.isNaN)).toBe(true);
  });
});

describe('unverified AI distance isolation',()=>{
  it('displays a valid same-frame estimate without creating a trusted reading',()=>{
    const d=detection(),snapshot=measureEstimatedObjects([d],map(), 'web-10',100);
    expect(snapshot.measurements[0]).toMatchObject({distanceMeters:1.5,source:'MONOCULAR_METRIC',reliability:'EXPERIMENTAL'});
    expect(d.approximateDistance).toBeNull();
  });
  it('rejects stale, mixed, missing, low-confidence and out-of-range readings',()=>{
    expect(estimatedMetersForDetection(detection(11),map())).toBeNull();
    expect(estimatedMetersForDetection({...detection(),confidence:.5},map())).toBeNull();
    const mixed=map();
    mixed.values.forEach((_,i)=>{mixed.values[i]=i%2?1:3;});
    expect(estimatedMetersForDetection(detection(),mixed)).toBeNull();
    expect(estimatedMetersForDetection(detection(),map(NaN))).toBeNull();
    expect(measureEstimatedObjects([detection()],map(4),'web-10',100).measurements[0]).toMatchObject({distanceMeters:null,rejectionReason:'OUT_OF_TARGET_RANGE'});
  });
});
