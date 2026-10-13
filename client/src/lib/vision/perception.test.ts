import {describe,it,expect} from 'vitest';
import {currentPerception,freshTimestamp,PerceptionTelemetry,type PerceptionSnapshot} from './perception';
import {answerLocalQuestion,localVoiceCommand} from './localQuestions';
import {visionMessages} from '@/i18n/locales/vision';
const snapshot:PerceptionSnapshot={frameId:'one',capturedAt:1000,completedAt:1100,tracking:'TRACKING',ground:{frameId:'one',capturedAt:1000,status:'CURRENT',observations:[]},approach:[],
 performance:{processedFrames:3,inferenceMs:100,p95InferenceMs:100,effectiveFps:2},observations:[{validity:'CURRENT',evidence:[],uncertainty:[],detection:{id:'chair',trackId:'chair',type:'CHAIR',timestamp:1000,confidence:.9,source:'OBJECT_DETECTOR',boundingBox:{x:.7,y:.3,width:.2,height:.3},horizontalDirection:'RIGHT',verticalPosition:'MIDDLE',approximateDistance:null}}]};
describe('current perception and local question routing',()=>{
 it('expires older source evidence even while the enclosing detector snapshot is current',()=>{
  const mixed:PerceptionSnapshot={...snapshot,ground:{...snapshot.ground,observations:[{id:'old',kind:'VISIBLE_STAIRS',boundingBox:{x:0,y:0,width:1,height:1},firstSeenAt:0,lastSeenAt:0,confidence:null,evidenceStrength:'SINGLE_FRAME',evidence:[],uncertainty:[],labelAr:'درج محتمل'}]},approach:[{trackId:'chair',type:'CHAIR',state:'POSSIBLE_APPROACH',capturedAt:400,frameId:'old',reasons:[],evidence:['TRACKING'],experimental:true}]};
  const current=currentPerception(mixed,1300)!;
  expect(current.observations).toHaveLength(1);expect(current.ground.observations).toEqual([]);expect(current.approach).toEqual([]);
  expect(mixed.ground.observations).toHaveLength(1);
 });
 it('rejects future, nonfinite and stale timestamps even when no new frame arrives',()=>{
  expect(currentPerception(snapshot,2251)).toBeNull();expect(currentPerception(snapshot,999)).toBeNull();
  expect(freshTimestamp(NaN,1000)).toBe(false);expect(currentPerception(snapshot,1200)).toBe(snapshot);
 });
 it('answers names and directions locally without a cloud or distance dependency',()=>{
  const answer=answerLocalQuestion('أين الكرسي؟',snapshot,1200,visionMessages.ar);
  expect(answer.route).toBe('LOCAL');expect('text'in answer&&answer.text).toContain('كرسي');
  expect(answerLocalQuestion('ما لون السيارة؟',snapshot,1200,visionMessages.ar).route).toBe('CLOUD');
  expect(answerLocalQuestion('ماذا يوجد فوق الطاولة؟',snapshot,1200,visionMessages.ar).route).toBe('CLOUD');
  expect(answerLocalQuestion('اقرأ النص',snapshot,1200,visionMessages.ar).route).toBe('CLOUD');
 });
 it('never claims absence, on-floor placement, metres, or no approach from missing data',()=>{
  expect(answerLocalQuestion('هل يوجد شخص؟',snapshot,1200,visionMessages.ar)).toMatchObject({route:'LOCAL',text:expect.stringContaining('لا يثبت عدم وجوده')});
  expect(answerLocalQuestion('كم متر؟',snapshot,1200,visionMessages.ar)).toMatchObject({text:expect.stringContaining('غير معروفة')});
  expect(answerLocalQuestion('هل يبدو أنني أقترب؟',snapshot,1200,visionMessages.ar)).toMatchObject({text:expect.stringContaining('لا تتوفر أدلة')});
  expect(answerLocalQuestion('ما الموجود على الأرض؟',snapshot,1200,visionMessages.ar)).toMatchObject({text:expect.stringContaining('لا يثبت')});
  expect(answerLocalQuestion('أين الكرسي؟',snapshot,5000,visionMessages.ar)).toMatchObject({text:expect.stringContaining('لا توجد قراءة حديثة')});
 });
 it('only accepts explicit voice commands, and counts processed frames rather than redisplays',()=>{
  expect(localVoiceCommand('أوقف وصف الأشياء')).toBe('OBJECTS_OFF');expect(localVoiceCommand('هل أوقف وصف الأشياء')).toBeNull();
  const metrics=new PerceptionTelemetry();metrics.record(1000,1100);const report=metrics.record(1500,1600);
  expect(report.processedFrames).toBe(2);expect(report.effectiveFps).toBeCloseTo(1.667,2);expect(report.p95InferenceMs).toBe(100);
 });
});
