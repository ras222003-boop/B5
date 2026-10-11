import { describe, expect, it } from 'vitest';
import { checkAtomicFrame, rotateNativeDepthClockwise, type AtomicNativeFrame } from './nativeFramePair';

const fixture = (): AtomicNativeFrame => ({
  frameId:'arkit-123.123456',nativeTimestampMs:123123.456,source:'ARKIT_DEPTH',
  capturedWithNativeSession:true,alignedToCameraFrame:true,rawDepthFresh:true,
  cameraWidth:1920,cameraHeight:1440,imageBase64:'A'.repeat(256),
  depthWidth:64,depthHeight:48,values:Array(64*48).fill(1.5),validCoverage:1,
});

describe('single-frame ARKit RGB+depth bridge',()=>{
  it('accepts verified LiDAR samples with consistent geometry',()=>{
    expect(checkAtomicFrame(fixture())).toBeNull();
  });
  it('does not use non-native, mismatched, stale or untrusted camera frames',()=>{
    expect(checkAtomicFrame(null)).toBe('frame_unavailable');
    expect(checkAtomicFrame({...fixture(),capturedWithNativeSession:false})).toBe('unverified_source');
    expect(checkAtomicFrame({...fixture(),alignedToCameraFrame:false})).toBe('unverified_source');
    expect(checkAtomicFrame({...fixture(),rawDepthFresh:false})).toBe('unverified_source');
    expect(checkAtomicFrame({...fixture(),frameId:''})).toBe('unverified_frame');
    expect(checkAtomicFrame({...fixture(),nativeTimestampMs:123333.45})).toBe('unverified_frame');
    expect(checkAtomicFrame({...fixture(),cameraWidth:1080})).toBe('invalid_camera_geometry');
    expect(checkAtomicFrame({...fixture(),values:[1,2,3]})).toBe('invalid_depth_geometry');
    expect(checkAtomicFrame({...fixture(),validCoverage:.4})).toBe('low_depth_coverage');
    expect(checkAtomicFrame({...fixture(),values:[...Array(64*48-1).fill(1.5),Infinity]})).toBe('invalid_depth_values');
  });
  it('rejects implausible claimed map confidence vs actual valid pixel coverage',()=>{
    expect(checkAtomicFrame({...fixture(),values:Array(64*48).fill(0)})).toBe('unverified_depth_coverage');
  });
  it('rotates depth map with camera image clockwise, preserving native coordinates',()=>{
    const original=fixture();
    original.values[0]=2;
    original.values[63]=3;
    original.values[(48-1)*64]=4;
    const oriented=rotateNativeDepthClockwise(original,1200);
    expect([oriented.width,oriented.height]).toEqual([48,64]);
    expect(oriented.values[47]).toBe(2); // raw top-left -> rotated top-right
    expect(oriented.values[0]).toBe(4); // raw bottom-left -> rotated top-left
    expect(oriented.values[(64-1)*48+47]).toBe(3); // raw top-right -> rotated bottom-right
    expect(oriented.timestamp).toBe(1200);
  });
});
