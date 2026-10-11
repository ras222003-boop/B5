import {describe,it,expect} from 'vitest';
import {parseTrustedWorldPose,displacementMetres,summarizeWorldTrials} from './worldScaleResearch';

describe('8th Wall world scale research only',()=>{
  it('rejects tracking initialization and nonfinite positions',()=>{
    expect(parseTrustedWorldPose({trackingStatus:'LIMITED',position:{x:0,y:0,z:0}},10)).toBeNull();
    expect(parseTrustedWorldPose({trackingStatus:'NORMAL',trackingReason:'INITIALIZING',position:{x:0,y:0,z:0}},10)).toBeNull();
    expect(parseTrustedWorldPose({trackingStatus:'NORMAL',position:{x:NaN,y:0,z:0}},10)).toBeNull();
    expect(parseTrustedWorldPose({trackingStatus:'NORMAL',position:{x:0,y:0,z:0}},10)?.x).toBe(0);
  });
  it('computes distance between two camera poses and rejects stale/invalid intervals',()=>{
    const s={x:0,y:0,z:0,trackingStatus:'NORMAL' as const,timestampMs:1000};
    const e={...s,x:3,y:4,timestampMs:2000};
    expect(displacementMetres(s,e)).toBe(5);
    expect(displacementMetres(e,s)).toBeNull();
    expect(displacementMetres(s,{...e,timestampMs:70_000})).toBeNull();
  });
  it('never certifies safe independent mobility from a lab calibration score',()=>{
    const sum=summarizeWorldTrials([
      {referenceMeters:1,cameraDisplacementMeters:1,observedAt:1,device:'iPhone test'},
      {referenceMeters:2,cameraDisplacementMeters:2.2,observedAt:2,device:'Android test'},
    ]);
    expect(sum.attempts).toBe(2);
    expect(sum.p95AbsoluteErrorMetres).toBeCloseTo(.2);
    expect(sum.approvedForWalking).toBe(false);
  });
});
