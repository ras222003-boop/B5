import {afterEach,describe,expect,it,vi} from 'vitest';
import {VisionPipeline,type VisionPipelineOptions} from './pipeline';
import {DEFAULT_VISION_CONFIG} from './config';
import {visionMessages} from '@/i18n/locales/vision';
import type {VisionDetection} from '@shared/vision';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(delayMs=0){
 let now=1000;
 vi.spyOn(performance,'now').mockImplementation(()=>now);
 class Video{videoWidth=640;videoHeight=480;readyState=2;currentTime=1;paused=false;}
 const video=new Video();
 vi.stubGlobal('HTMLVideoElement',Video);vi.stubGlobal('HTMLMediaElement',{HAVE_CURRENT_DATA:2});
 vi.stubGlobal('window',{setTimeout:vi.fn(()=>1),clearTimeout:vi.fn()});
 vi.stubGlobal('document',{createElement:()=>({width:96,height:72,getContext:()=>({drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(96*72*4).fill(150)})})})});
 const perception=vi.fn(),scene=vi.fn(),analysisState=vi.fn(),fatal=vi.fn();
 const detect=vi.fn(async(_frame:unknown,timestamp:number)=>{now+=delayMs;return [{id:'chair',type:'CHAIR',timestamp,source:'OBJECT_DETECTOR',confidence:.9,boundingBox:{x:.4,y:.4,width:.2,height:.2},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null} as VisionDetection];});
 const pipeline=new VisionPipeline({video:video as unknown as HTMLVideoElement,vision:{detect,close:async()=>{}},ocr:{recognize:async()=>[],close:async()=>{}},depth:{read:async()=>null,close:async()=>{}},
  config:DEFAULT_VISION_CONFIG,copy:visionMessages.ar,mode:'EXPLORATION',buildingId:null,floorId:null,
  announcement:{announce:()=>null,reset:()=>{}},callbacks:{perception,scene,analysisState,fatal}} as unknown as VisionPipelineOptions);
 const internals=pipeline as unknown as {running:boolean;ocrEnabled:boolean;cameraLight:string;lastLightCheck:number;tick:()=>Promise<void>;publish:(now:number)=>void};
 internals.running=true;internals.ocrEnabled=false;internals.cameraLight='NOT_LOW_LIGHT';internals.lastLightCheck=1000;
 return {pipeline,internals,video,detect,perception,scene,analysisState,fatal,advance:(ms:number)=>{now+=ms;}};
}
describe('pipeline does not convert old or frozen input into live observations',()=>{
 it('discards inference that completes after the camera is paused',async()=>{
  const test=setup();const original=test.detect.getMockImplementation()!;
  test.detect.mockImplementation(async(frame,timestamp)=>{const result=await original(frame,timestamp);test.video.paused=true;return result;});
  await test.internals.tick();expect(test.perception).toHaveBeenLastCalledWith(null);
  expect(test.scene).not.toHaveBeenCalled();expect(test.analysisState).toHaveBeenLastCalledWith('PAUSED');await test.pipeline.stop();
 });
 it('processes distinct frames once and clears a paused camera',async()=>{
  const test=setup();await test.internals.tick();expect(test.perception.mock.lastCall?.[0]?.observations).toHaveLength(1);
  test.advance(500);await test.internals.tick();expect(test.detect).toHaveBeenCalledOnce();
  test.video.currentTime=2;await test.internals.tick();expect(test.detect).toHaveBeenCalledTimes(2);
  test.video.paused=true;await test.internals.tick();expect(test.perception).toHaveBeenLastCalledWith(null);
  expect(test.analysisState).toHaveBeenLastCalledWith('PAUSED');expect(test.fatal).not.toHaveBeenCalled();await test.pipeline.stop();
 });
 it('rejects a slow detector result instead of refreshing its age',async()=>{
  const test=setup(1300);await test.internals.tick();
  expect(test.perception).toHaveBeenLastCalledWith(null);expect(test.scene).not.toHaveBeenCalled();
  expect(test.analysisState).toHaveBeenLastCalledWith('STALE');await test.pipeline.stop();
 });
 it('expires a frozen video even when readyState remains ready',async()=>{
  const test=setup();await test.internals.tick();test.advance(1500);await test.internals.tick();
  expect(test.detect).toHaveBeenCalledOnce();expect(test.perception).toHaveBeenLastCalledWith(null);await test.pipeline.stop();
 });
});
