import {describe,expect,it} from 'vitest';
import {basiraArPreflight,basiraArFeatureState} from './browserCapabilities';
describe('WebAR unsupported-device and legal fallback',()=>{
  it('never treats a camera alone as sufficient to start XR',()=>{
    expect(basiraArPreflight({secureOrigin:true,cameraApi:true,webgl:false,mobileBrowser:true}).readyForPermissionRequest).toBe(false);
    expect(basiraArPreflight({secureOrigin:false,cameraApi:true,webgl:true,mobileBrowser:true}).readyForPermissionRequest).toBe(false);
  });
  it('returns readiness only when secure, camera and graphics APIs exist',()=>{
    expect(basiraArPreflight({secureOrigin:true,cameraApi:true,webgl:true,mobileBrowser:false}).readyForPermissionRequest).toBe(true);
  });
  it('never marks SLAM and absolute scale as generally available experiments',()=>{
    expect(basiraArFeatureState('absolute-scale')).toBe('license-gated');
    expect(basiraArFeatureState('world-tracking')).toBe('license-gated');
    expect(basiraArFeatureState('world-effects')).toBe('license-gated');
    expect(basiraArFeatureState('face-effects')).toBe('lab');
    expect(basiraArFeatureState('sky-effects')).toBe('lab');
    expect(basiraArFeatureState('image-targets')).toBe('lab');
  });
});
