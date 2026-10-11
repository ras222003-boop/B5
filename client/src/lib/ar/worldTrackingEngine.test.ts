import {describe,it,expect} from 'vitest';
import {canStartWorldSandbox,BASIRA_BINARY_SDK_CDN,BASIRA_SLAM_CHUNK_CDN} from './worldTrackingEngine';
const all={labEnabled:true,licenseApproved:true,userConsent:true,secure:true,camera:true,webgl:true};
describe('8th Wall binary sandbox licensing and consent',()=>{
  it('denies the engine when legal review is unapproved',()=>{
    expect(canStartWorldSandbox({...all,licenseApproved:false})).toBe(false);
    expect(canStartWorldSandbox({...all,labEnabled:false})).toBe(false);
    expect(canStartWorldSandbox({...all,userConsent:false})).toBe(false);
  });
  it('requires the secure browser APIs explicitly',()=>{
    expect(canStartWorldSandbox({...all,secure:false})).toBe(false);
    expect(canStartWorldSandbox({...all,camera:false})).toBe(false);
    expect(canStartWorldSandbox({...all,webgl:false})).toBe(false);
    expect(canStartWorldSandbox(all)).toBe(true);
  });
  it('keeps MIT engine and restricted binary URLs separately identified',()=>{
    expect(BASIRA_BINARY_SDK_CDN).toContain('@8thwall/engine@0.1.0');
    expect(BASIRA_SLAM_CHUNK_CDN).toContain('@8thwall/engine-binary@1');
  });
});
