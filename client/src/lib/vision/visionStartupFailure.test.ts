import {describe,expect,it} from 'vitest';
import {CameraServiceError} from './camera';
import {visionStartupFailure} from './visionStartupFailure';

describe('vision startup failure source',()=>{
  it.each(['camera_denied',new Error('camera_denied')])('keeps native permission denial separate from V3 model policy: %s',error=>{
    expect(visionStartupFailure(error)).toEqual({code:'DENIED',source:'NATIVE_CAMERA',retry:false});
  });
  it.each(['camera_stopped','camera_permission_required'])('offers retry after native session interruption: %s',message=>{
    expect(visionStartupFailure(new Error(message))).toEqual({code:'FAILED',source:'NATIVE_CAMERA',retry:true});
  });
  it.each(['camera_unavailable','arkit_unsupported'])('reports native capability unavailability without model fallback: %s',message=>{
    expect(visionStartupFailure(new Error(message))).toEqual({code:'UNAVAILABLE',source:'NATIVE_CAMERA',retry:false});
  });
  it('preserves browser camera errors and genuine model fallback',()=>{
    expect(visionStartupFailure(new CameraServiceError('DEVICE_SETTINGS'))).toEqual({code:'DEVICE_SETTINGS',source:'WEB_CAMERA',retry:false});
    expect(visionStartupFailure(new Error('object_quality_unavailable'))).toEqual({code:'MODEL',source:'MODEL',retry:false});
  });
});
