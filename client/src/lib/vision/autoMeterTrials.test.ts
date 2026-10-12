import {describe,expect,it} from 'vitest';
import {measureAutoMeterObjects,measureEstimatedObjects} from './autoMeter';
import {autoMeterTrialsJsonl,createAutoMeterTrial} from './autoMeterTrials';
import type {MetricDepthMap,VisionDetection} from '@shared/vision';

const object:VisionDetection={id:'chair',trackId:'chair-1',type:'CHAIR',source:'OBJECT_DETECTOR',confidence:.94,
  boundingBox:{x:.3,y:.3,width:.4,height:.4},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null,timestamp:100};
const depth:MetricDepthMap={width:48,height:64,values:new Float32Array(48*64).fill(4.5),
  source:'ARCORE_DEPTH',timestamp:100,confidence:.95,alignmentVerified:true};
const base={sessionId:'session-1',deviceModel:'Pixel test phone',osVersion:'Android test',source:'ARCORE_DEPTH' as const,
  missedObjectType:'CHAIR' as const,referenceMeters:5 as const,condition:'indoor',now:1000};

describe('optional physical validation export',()=>{
  it('records a public-range rejection and keeps raw 4–5 m sensor evidence separate',()=>{
    const snapshot=measureAutoMeterObjects([object],depth,'arcore-1000000000',1000);
    const row=createAutoMeterTrial({...base,snapshot,measurement:snapshot.measurements[0]});
    expect(row).toMatchObject({readingMeters:null,rejectionReason:'OUT_OF_TARGET_RANGE',rawMeters:4.5});
    expect(JSON.parse(autoMeterTrialsJsonl([row!]))).toEqual(row);
  });
  it('counts a missed object as a rejected attempt without inventing metres',()=>{
    const row=createAutoMeterTrial({...base,snapshot:null,measurement:null});
    expect(row).toMatchObject({readingMeters:null,rejectionReason:'DETECTOR_MISS'});
    expect(row?.rawMeters).toBeUndefined();
  });
  it('records a 1.5 m AI attempt separately and omits hidden raw data inside the target range',()=>{
    const snapshot=measureEstimatedObjects([object],{width:48,height:64,values:new Float32Array(48*64).fill(4.5),
      source:'MONOCULAR_METRIC',timestamp:100},'test-1500',1000);
    const row=createAutoMeterTrial({...base,source:'MONOCULAR_METRIC',referenceMeters:1.5,
      snapshot,measurement:snapshot.measurements[0]});
    expect(row).toMatchObject({source:'MONOCULAR_METRIC',referenceMeters:1.5,readingMeters:null});
    expect(row?.rawMeters).toBeUndefined();
  });
});
