import {describe,it,expect,vi} from 'vitest';
import type {VisionDetection,ObjectColorObservation} from '@shared/vision';
import {ObjectColorTracker} from './objectColors';import {colourForSpeech,COLOUR_SPEECH_QUALIFICATION} from './colourAnnouncement';import {ObjectSpeechTracker} from './objectSpeech';import {visionMessages} from '@/i18n/locales/vision';import {rgbToLab} from './objectColorSpaces';
describe('independent colour-speech qualification, separate from estimates',()=>{
 it('keeps known sRGB black/white Lab endpoints correct',()=>{expect(rgbToLab(0,0,0)).toEqual([0,0,0]);expect(rgbToLab(255,255,255)[0]).toBeCloseTo(100,3);});
 it('does not let seven repeated black estimates, perfect pixel support or detector confidence manufacture calibration',()=>{
  const tracker=new ObjectColorTracker(),speech=new ObjectSpeechTracker(visionMessages.ar),announce=vi.fn(()=>true);
  for(let i=0;i<12;i++){
   const at=1000+i*636,d={id:'object-2',trackId:'object-2',type:'CAR',cocoClass:'car',confidence:1,boundingBox:{x:.2,y:.2,width:.5,height:.5},source:'OBJECT_DETECTOR',timestamp:at,horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null,tracking:{state:'TRACKED',observations:5,firstSeenAt:1000,lastSeenAt:at,gapMs:636}} as VisionDetection;
   const o={name:i>=5?'black':null,status:i>=5?'ESTIMATED':'UNCLEAR',reason:i>=5?'BOX_ESTIMATE':'BACKGROUND_AMBIGUOUS',samples:300,supportFraction:1,timestamp:at,stableFrames:1,calibrated:false,quality:{version:'inset-grid-v2',method:'INSET_GRID',score:1,labelSupport:1,spatialAgreement:1,usableFraction:1,clippedFraction:0,darkFraction:0,backgroundSeparation:90,contextSamples:100,sampledPixels:300,calibrated:false}} as ObjectColorObservation;
   d.color=tracker.update(d,o);expect(d.color.calibrated).toBe(false);expect(colourForSpeech(d,{now:at,live:true})).toBe('');expect(colourForSpeech(d,{now:at,live:false})).toBe('');speech.observe([d],at,announce,[],true,announce,true);
  }
  expect(announce).toHaveBeenCalledOnce();expect(announce.mock.calls[0][0]).toContain('سيارة');expect(announce.mock.calls[0][0]).not.toMatch(/أسود|سوداء|اللون غير واضح/);
  expect(Object.isFrozen(COLOUR_SPEECH_QUALIFICATION)).toBe(true);expect(COLOUR_SPEECH_QUALIFICATION.eligibleClasses).toHaveLength(0);
 });
});
