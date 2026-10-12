import {describe,expect,it} from 'vitest';
import type {EstimatedMetricDepthMap,VisionDetection} from '@shared/vision';
import {metricMapForFrame,metricPixels,metricPlacement,metricModelBytes} from './metricModel';
import {estimatedMetersForDetection,measureEstimatedObjects} from './autoMeter';
import {checkAssetResponse,MeterModelError} from './meterDiagnostics';
import {vi} from 'vitest';

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
  it('reads a consistent centre surface without requiring an object name',()=>{
    const snapshot=measureEstimatedObjects([],map(1.5),'web-10',100);
    expect(snapshot.measurements).toEqual([]);
    expect(snapshot.centerSurface).toEqual({distanceMeters:1.5,rawMeters:1.5,rejectionReason:null});
    expect('approximateDistance' in snapshot).toBe(false);
  });
  it('rejects mixed, missing and out-of-range centre surfaces',()=>{
    const mixed=map();
    mixed.values.forEach((_,index)=>{mixed.values[index]=index%2?1:3;});
    expect(measureEstimatedObjects([],mixed,'web',100).centerSurface).toMatchObject({distanceMeters:null,rejectionReason:'DEPTH_INCONSISTENT'});
    expect(measureEstimatedObjects([],map(NaN),'web',100).centerSurface).toMatchObject({distanceMeters:null,rejectionReason:'INVALID_MODEL_DEPTH'});
    expect(measureEstimatedObjects([],map(4),'web',100).centerSurface).toMatchObject({distanceMeters:null,rejectionReason:'OUT_OF_TARGET_RANGE'});
  });
  it('reports object confidence and inconsistent depth separately',()=>{
    expect(measureEstimatedObjects([{...detection(),confidence:.5}],map(),'web',100).measurements[0].rejectionReason).toBe('LOW_CONFIDENCE');
    const mixed=map();mixed.values.forEach((_,index)=>{mixed.values[index]=index%2?1:3;});
    expect(measureEstimatedObjects([detection()],mixed,'web',100).measurements[0].rejectionReason).toBe('DEPTH_INCONSISTENT');
  });
});

describe('hosted metric assets',()=>{
  it('rejects a 200 HTML fallback before attempting ONNX initialization',async()=>{
    const fetch=vi.fn(async()=>new Response('<!doctype html><title>Basira</title>',{status:200,headers:{'content-type':'text/html'}}));
    vi.stubGlobal('fetch',fetch);
    await expect(metricModelBytes()).rejects.toMatchObject({code:'MODEL_HTML'});
    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
  it('distinguishes redirects, wrong MIME and missing files',()=>{
    const response=(status:number,type:string,redirected=false)=>({ok:status>=200&&status<300,status,redirected,url:'',headers:new Headers({'content-type':type})}) as Response;
    expect(()=>checkAssetResponse(response(200,'text/html'),'model')).toThrowError(MeterModelError);
    expect(()=>checkAssetResponse(response(200,'application/octet-stream',true),'model')).toThrowError('MODEL_REDIRECT');
    expect(()=>checkAssetResponse(response(404,'text/html'),'model')).toThrowError('MODEL_HTTP');
    expect(()=>checkAssetResponse(response(200,'application/json'),'model')).toThrowError('MODEL_CONTENT_TYPE');
  });
});
