import {describe,expect,it} from 'vitest';
import {createObjectDepthTrial,objectDepthTrialsCsv,summarizeObjectDepthTrials} from './objectDepthValidation';
import type {VisionDetection} from '@shared/vision';

const detection=():VisionDetection=>({
  id:'test',type:'CHAIR',confidence:.9,source:'OBJECT_DETECTOR',timestamp:1000,
  boundingBox:{x:.2,y:.2,width:.3,height:.3},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',
  approximateDistance:{distanceMeters:1.6,source:'ARKIT_DEPTH',confidence:.92},
});
describe('iPhone LiDAR object-level ground truth experiment',()=>{
  it('records named object, reference, measured error and human matching',()=>{
    const trial=createObjectDepthTrial('arkit-123.456',detection(),1.5,true,new Date('2026-10-11T00:00:00.000Z'));
    expect(trial?.absoluteErrorMeters).toBeCloseTo(.1);
    expect(trial?.objectType).toBe('CHAIR');
    expect(trial?.recordedAt).toBe('2026-10-11T00:00:00.000Z');
    expect(trial?.measuredMeters).toBe(1.6);
  });
  it('records missing depth as a missed measurement rather than erasing failure',()=>{
    const noDistance={...detection(),approximateDistance:null};
    const trial=createObjectDepthTrial('arkit-11.1',noDistance,1,true);
    expect(trial?.measuredMeters).toBeNull();
    const stats=summarizeObjectDepthTrials([trial!]);
    expect(stats.total).toBe(1);
    expect(stats.coverage).toBe(0);
    expect(stats.safetyCertified).toBe(false);
  });
  it('rejects fake frame IDs and invalid tape-measured distances',()=>{
    expect(createObjectDepthTrial('not-arkit',detection(),1,true)).toBeNull();
    expect(createObjectDepthTrial('arkit-1',detection(),7,true)).toBeNull();
    expect(createObjectDepthTrial('arkit-1',detection(),NaN,true)).toBeNull();
  });
  it('keeps human-mismatched labels out of distance accuracy, without deleting the attempt',()=>{
    const t1=createObjectDepthTrial('arkit-1',detection(),1.5,true)!;
    const t2=createObjectDepthTrial('arkit-2',{...detection(),confidence:.8},1.5,false)!;
    const s=summarizeObjectDepthTrials([t1,t2]);
    expect(s.total).toBe(2);
    expect(s.readings).toBe(1);
    expect(s.coverage).toBe(.5);
    expect(objectDepthTrialsCsv([t1,t2])).toContain('human_matched');
    expect(objectDepthTrialsCsv([t1,t2])).toContain('"false"');
  });
});
