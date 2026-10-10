import { describe, expect, it } from 'vitest';
import { DEPTH_TARGETS, evaluateCalibration, rejectNativeSample, type LabObservation, type NativeDepthLabSample } from './depthCalibration';

const sample = (meters:number):NativeDepthLabSample => ({
  source:'ARCORE_DEPTH',frameId:'camera-depth-frame-1',frameTimestampMs:1024,
  distanceMeters:meters,confidence:.95,alignedToCameraFrame:true,
  capturedWithNativeSession:true,rawDepthFresh:true,
});
describe('isolated native depth laboratory (never controls navigation)', () => {
  it('rejects web RGB estimates, missing frames, stale raw depth and low confidence', () => {
    expect(rejectNativeSample(null)).toBe('depth_unavailable');
    expect(rejectNativeSample({...sample(1),capturedWithNativeSession:false})).toBe('frame_unverified');
    expect(rejectNativeSample({...sample(1),alignedToCameraFrame:false})).toBe('frame_unverified');
    expect(rejectNativeSample({...sample(1),rawDepthFresh:false})).toBe('frame_unverified');
    expect(rejectNativeSample({...sample(1),confidence:.55})).toBe('low_confidence');
    expect(rejectNativeSample({...sample(0)})).toBe('invalid_distance');
    expect(rejectNativeSample(sample(1))).toBeNull();
  });
  it('requires all reference distances, sufficient coverage and varied conditions', () => {
    const observations:LabObservation[]=DEPTH_TARGETS.flatMap(targetMeters=>
      Array.from({length:20},(_,i)=>({targetMeters,condition:(i<10?'INDOOR_BRIGHT':'INDOOR_DIM') as const,
        sample:sample(targetMeters+(i%2?.04:-.04))})));
    const report=evaluateCalibration(observations);
    expect(report.labCriteriaMet).toBe(true);
    expect(report.safetyCertified).toBe(false);
    expect(evaluateCalibration(observations.slice(0,-1)).labCriteriaMet).toBe(false);
    expect(evaluateCalibration(observations.map(row=>({...row,condition:'INDOOR_BRIGHT'}))).labCriteriaMet).toBe(false);
  });
  it('fails high error and missing native depth', () => {
    const poor:LabObservation[]=DEPTH_TARGETS.flatMap(targetMeters=>
      Array.from({length:20},(_,i)=>({targetMeters,condition:(i<10?'INDOOR_BRIGHT':'OUTDOOR') as const,
        sample:i<3?null:sample(targetMeters+1)})));
    const report=evaluateCalibration(poor);
    expect(report.labCriteriaMet).toBe(false);
    expect(report.targets.every(t=>!t.pass)).toBe(true);
  });
});
