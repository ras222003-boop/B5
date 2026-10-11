import {describe,it,expect} from 'vitest';
import {parseTrustedWorldPose,displacementMetres,recentCameraDisplacementMetres,summarizeWorldTrials} from './worldScaleResearch';

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
  it('fails closed when world pose is stale, future, missing or expired after tracking break',()=>{
    const start={x:0,y:0,z:0,trackingStatus:'NORMAL' as const,timestampMs:1000};
    const end={...start,x:1.5,timestampMs:2000};
    expect(recentCameraDisplacementMetres(start,end,2200)).toBeCloseTo(1.5);
    expect(recentCameraDisplacementMetres(start,end,3300)).toBeNull();
    expect(recentCameraDisplacementMetres(start,end,1800)).toBeNull();
    expect(recentCameraDisplacementMetres(start,null,2200)).toBeNull();
    expect(recentCameraDisplacementMetres(null,end,2200)).toBeNull();
    expect(recentCameraDisplacementMetres(end,start,2200)).toBeNull();
    expect(recentCameraDisplacementMetres(start,end,NaN)).toBeNull();
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
