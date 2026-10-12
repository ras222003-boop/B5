import {describe,expect,it} from 'vitest';
import type {AutoMeterSnapshot} from './autoMeter';
import {selectMeterSpeech} from './meterSpeech';

const snapshot:AutoMeterSnapshot={frameId:'fresh',capturedAt:1000,nativeSource:'MONOCULAR_METRIC',measurements:[],
  centerSurface:{distanceMeters:1.4,rawMeters:1.4,rejectionReason:null}};

describe('fresh on-demand meter speech',()=>{
  it('uses a validated centre surface when the detector names no object',()=>{
    expect(selectMeterSpeech({snapshot,diagnostic:'READY_CENTER'},1500)).toEqual({kind:'CENTER',meters:1.4});
  });
  it('speaks a specific refusal and never a stale or fabricated number',()=>{
    expect(selectMeterSpeech({snapshot:null,diagnostic:'LOW_LIGHT'},1500)).toEqual({kind:'REASON',diagnostic:'LOW_LIGHT'});
    expect(selectMeterSpeech({snapshot,diagnostic:'READY_CENTER'},7001)).toEqual({kind:'REASON',diagnostic:'FRAME_STALE'});
    expect(selectMeterSpeech({snapshot:{...snapshot,centerSurface:{distanceMeters:null,rawMeters:4,rejectionReason:'OUT_OF_TARGET_RANGE'}},diagnostic:'NO_OBJECT_DETECTED'},1500))
      .toEqual({kind:'REASON',diagnostic:'OUT_OF_TARGET_RANGE'});
  });
});
