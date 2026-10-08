import { describe, expect, it } from 'vitest';
import { assessFrameLight } from './frameQuality';

const frame=(value:number,alpha=255)=>new Uint8ClampedArray(Array.from({length:64},()=>[value,value,value,alpha]).flat());

describe('negative camera light gate',()=>{
  it('blocks low-light frames from supporting a clear-path claim',()=>{
    expect(assessFrameLight(frame(18))).toBe('LOW_LIGHT');
    expect(assessFrameLight(frame(100))).toBe('NOT_LOW_LIGHT');
    expect(assessFrameLight(frame(0,0))).toBe('UNKNOWN');
  });
});
