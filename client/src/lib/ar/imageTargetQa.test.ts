import {describe,it,expect} from 'vitest';
import {imageTargetEventsCsv,summarizeImageTargetQa} from './imageTargetQa';

const sample=[
  {name:'basira-lab-entrance' as const,state:'found' as const,observedAt:300},
  {name:'basira-lab-entrance' as const,state:'lost' as const,observedAt:500},
  {name:'basira-lab-entrance' as const,state:'found' as const,observedAt:700},
];

describe('private device-image-target diagnostics',()=>{
  it('counts sightings without inventing device validation',()=>{
    expect(summarizeImageTargetQa(100,sample)).toEqual({
      observedEvents:3,recognitions:2,trackingLosses:1,firstRecognitionMs:200,
      noRecognitionObserved:false,validatedOnPhysicalDevice:false,
    });
  });
  it('labels no events as unobserved rather than assuming success',()=>{
    const report=summarizeImageTargetQa(null,[]);
    expect(report.noRecognitionObserved).toBe(true);
    expect(report.firstRecognitionMs).toBeNull();
  });
  it('exports only event names and time; never biometric data',()=>{
    expect(imageTargetEventsCsv(sample)).toContain('found,basira-lab-entrance,300');
    expect(imageTargetEventsCsv(sample)).not.toContain('position');
  });
});
