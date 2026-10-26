import {describe,it,expect} from 'vitest';
import type {PerceptionSnapshot} from './perception';
import {ObjectTrialRecorder,sourcePixelSignature} from './objectTrial';
const snapshot=(id:string)=>({frameId:id,performance:{inferenceMs:100},tracking:'TRACKING',observations:[],privateImage:'must-not-escape',ground:{secret:'private-location'}} as unknown as PerceptionSnapshot);
describe('local trial metadata is evidence, never automatic device qualification',()=>{
 it('exports allowlisted colour abstention reasons without raw pixels/masks or arbitrary diagnostic text',()=>{
  const t=new ObjectTrialRecorder('v3','b'.repeat(64),0),frame=snapshot('colour-frame');
  const make=(reason:string,name:string|null=null)=>({detection:{id:'object',cocoClass:'car',confidence:.7,boundingBox:{x:.1,y:.1,width:.2,height:.2},color:{name,status:name?'ESTIMATED':'UNCLEAR',reason,data:'private-pixels',mask:'private-mask'}}});
  frame.observations=[make('BACKGROUND_AMBIGUOUS'),make('CLIPPED_OR_REFLECTIVE'),make('private-diagnostic'),make('BOX_ESTIMATE','black')] as unknown as PerceptionSnapshot['observations'];
  t.record(frame);t.record(frame);const out=t.export(100);
  expect(out.colourUnclearReasonCounts).toEqual({BACKGROUND_AMBIGUOUS:1,CLIPPED_OR_REFLECTIVE:1,UNAVAILABLE:1});
  expect(out.frames[0].objects.map(o=>o.colourReason)).toEqual(['BACKGROUND_AMBIGUOUS','CLIPPED_OR_REFLECTIVE','UNAVAILABLE','BOX_ESTIMATE']);
  expect(JSON.stringify(out)).not.toMatch(/private-pixels|private-mask|private-diagnostic/);
 });
 it('detects actual sampled pixel changes while keeping the fingerprint out of the exported report',()=>{
  const data=new Uint8ClampedArray(4*10*10),frame={width:10,height:10,data,timestamp:1,frameId:'a'};
  const a=sourcePixelSignature(frame);expect(sourcePixelSignature(frame)).toBe(a);data[0]=255;const b=sourcePixelSignature(frame);expect(b).not.toBe(a);
  const t=new ObjectTrialRecorder('tiny','a'.repeat(64),0);t.source(a);t.source(a);expect(t.export(1).sourcePixelVariation).toBe('NOT_OBSERVED');t.source(b);
  const out=t.export(2);expect(out.sourcePixelVariation).toBe('OBSERVED');expect(out.sourcePixelChanges).toBe(1);expect(JSON.stringify(out)).not.toContain(String(b));
 });
 it('bounds metadata, ignores repeated frames and never serialises media, location or reference assertions',()=>{
  const t=new ObjectTrialRecorder('tiny','a'.repeat(64),0);
  for(let i=0;i<310;i++)t.record(snapshot('f'+i));t.record(snapshot('f309'));t.finish(10000);t.record(snapshot('after-stop'));
  const out=t.export(20000);expect(out.processedFrames).toBe(310);expect(out.frames).toHaveLength(300);expect(out.truncatedFrameSummaries).toBe(10);
  expect(out.durationMs).toBe(10000);expect(out.detectionAccuracy).toBeNull();expect(out.referenceLabels).toBe(false);
  expect(JSON.stringify(out)).not.toMatch(/must-not-escape|private-location|privateImage/);
 });
 it('records battery reports without claiming a lifetime or actual phone test',()=>{
  const t=new ObjectTrialRecorder('v3','b'.repeat(64),0);t.battery({level:.8,charging:false});t.speech();
  const out=t.export(1000,{battery:{level:.79,charging:false}});expect(out.reportedBatteryLevelChange).toBeCloseTo(.01);
  expect(out.batteryLifeEstimate).toBeNull();expect(out.temperature).toBeNull();expect(out.status).toBe('RECORDED_UNREVIEWED');
 });
});
