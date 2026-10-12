import {afterEach,describe,expect,it,vi} from 'vitest';
import type {MetricDepthMap,VisionDetection} from '@shared/vision';
import {AutoMeterSpeechPacer,getAutoMeterEnabled,getAutoMeterSpeechEnabled,measureAutoMeterObjects,saveAutoMeterEnabled,saveAutoMeterSpeechEnabled} from './autoMeter';

const detection=(timestamp=100):VisionDetection=>({
  id:'chair',trackId:'chair-1',type:'CHAIR',source:'OBJECT_DETECTOR',confidence:.92,
  boundingBox:{x:.3,y:.3,width:.4,height:.4},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',
  approximateDistance:null,timestamp,
});
const map=(meters=1.2):MetricDepthMap=>({
  width:48,height:64,values:new Float32Array(48*64).fill(meters),source:'ARKIT_DEPTH',
  confidence:.95,timestamp:100,alignmentVerified:true,
});

afterEach(()=>vi.unstubAllGlobals());

describe('Basira Auto Meter display-only measurements',()=>{
  it('starts off by default and persists both user choices independently',()=>{
    const values=new Map<string,string>();
    vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
    expect(getAutoMeterEnabled()).toBe(false);
    expect(getAutoMeterSpeechEnabled()).toBe(false);
    saveAutoMeterEnabled(true);saveAutoMeterSpeechEnabled(true);
    expect(getAutoMeterEnabled()).toBe(true);
    expect(getAutoMeterSpeechEnabled()).toBe(true);
    saveAutoMeterEnabled(false);
    expect(getAutoMeterEnabled()).toBe(false);
    expect(getAutoMeterSpeechEnabled()).toBe(true);
  });
  it('uses only same-frame verified object depth within 0.5–3 metres',()=>{
    const good=measureAutoMeterObjects([detection()],map(), 'arkit-1', 1000).measurements[0];
    expect(good).toMatchObject({distanceMeters:1.2,source:'ARKIT_DEPTH',reliability:'EXPERIMENTAL'});
    expect(measureAutoMeterObjects([detection()],null,'arkit-2',1000).measurements[0]).toMatchObject({distanceMeters:null,rejectionReason:'NO_ALIGNED_DEPTH'});
    expect(measureAutoMeterObjects([detection()],{...map(),timestamp:250},'arkit-3',1000).measurements[0]).toMatchObject({distanceMeters:null,rejectionReason:'NO_OBJECT_DEPTH'});
    expect(measureAutoMeterObjects([detection()],map(4),'arkit-4',1000).measurements[0]).toMatchObject({distanceMeters:null,rawMeters:4,rejectionReason:'OUT_OF_TARGET_RANGE'});
    expect(measureAutoMeterObjects([detection()],map(.4),'arkit-5',1000).measurements[0].distanceMeters).toBeNull();
  });
  it('limits automatic speech and permits a substantial change in distance',()=>{
    const pacer=new AutoMeterSpeechPacer();
    const snapshot=(meters:number,time:number)=>measureAutoMeterObjects([detection()],map(meters),'arkit-1',time);
    expect(pacer.choose(snapshot(1.2,1000))?.distanceMeters).toBe(1.2);
    expect(pacer.choose(snapshot(1.25,1500))).toBeNull();
    expect(pacer.choose(snapshot(1.8,2000))?.distanceMeters).toBe(1.8);
    expect(pacer.choose(snapshot(1.8,3000))).toBeNull();
    expect(pacer.choose(snapshot(1.8,13_000))?.distanceMeters).toBe(1.8);
    pacer.reset();
    expect(pacer.choose(snapshot(1.8,13_100))?.distanceMeters).toBe(1.8);
  });
});
