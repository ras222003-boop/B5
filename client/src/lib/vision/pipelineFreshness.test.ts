import {afterEach,describe,expect,it,vi} from 'vitest';
import {VisionPipeline,type VisionPipelineOptions} from './pipeline';
import {DEFAULT_VISION_CONFIG} from './config';
import {visionMessages} from '@/i18n/locales/vision';
import type {VisionDetection,SegmentationGrid,RecognizedPlace,OCRDetection} from '@shared/vision';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(delayMs=0){
 let now=1000;
 vi.spyOn(performance,'now').mockImplementation(()=>now);
 class Video{videoWidth=640;videoHeight=480;readyState=2;currentTime=1;paused=false;ended=false;}
 const video=new Video();
 vi.stubGlobal('HTMLVideoElement',Video);vi.stubGlobal('HTMLMediaElement',{HAVE_CURRENT_DATA:2});
 vi.stubGlobal('window',{setTimeout:vi.fn(()=>1),clearTimeout:vi.fn()});
 vi.stubGlobal('document',{createElement:()=>({width:96,height:72,getContext:()=>({drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(96*72*4).fill(150)})})})});
 const perception=vi.fn(),scene=vi.fn(),analysisState=vi.fn(),fatal=vi.fn(),recognized=vi.fn(),candidate=vi.fn();
 const detect=vi.fn(async(_frame:unknown,timestamp:number)=>{now+=delayMs;return [{id:'chair',type:'CHAIR',timestamp,source:'OBJECT_DETECTOR',confidence:.9,boundingBox:{x:.4,y:.4,width:.2,height:.2},horizontalDirection:'FRONT',verticalPosition:'MIDDLE',approximateDistance:null} as VisionDetection];});
 const pipeline=new VisionPipeline({video:video as unknown as HTMLVideoElement,vision:{detect,close:async()=>{}},ocr:{recognize:async()=>[],close:async()=>{}},depth:{read:async()=>null,close:async()=>{}},
  config:DEFAULT_VISION_CONFIG,copy:visionMessages.ar,mode:'EXPLORATION',buildingId:null,floorId:null,
  announcement:{announce:()=>null,reset:()=>{}},callbacks:{perception,scene,analysisState,fatal,recognized,candidate}} as unknown as VisionPipelineOptions);
 const internals=pipeline as unknown as {running:boolean;ocrEnabled:boolean;cameraLight:string;lastLightCheck:number;tick:()=>Promise<void>;publish:(now:number)=>void;
   options:VisionPipelineOptions;segmentation:SegmentationGrid|null;recognizedPlace:RecognizedPlace|null;recognizedPlaceCapturedAt:number;
   place:{recognize:(reading:OCRDetection)=>Promise<{place:RecognizedPlace|null;candidate:null}>};
   captureCurrentFrame:()=>Promise<{blob:Blob;width:number;height:number}>;
   processGeometry:(generation:number,timestamp:number)=>Promise<void>;processOCR:(generation:number,timestamp:number)=>Promise<void>};
 internals.running=true;internals.ocrEnabled=false;internals.cameraLight='NOT_LOW_LIGHT';internals.lastLightCheck=1000;
 internals.captureCurrentFrame=async()=>({blob:new Blob(),width:10,height:10});
 return {pipeline,internals,video,detect,perception,scene,analysisState,fatal,recognized,candidate,advance:(ms:number)=>{now+=ms;}};
}
describe('pipeline does not convert old or frozen input into live observations',()=>{
 it('publishes fresh native observations even when the unused web video is paused',async()=>{
  const test=setup();await test.internals.tick();test.scene.mockClear();test.video.paused=true;
  test.internals.options.nativeFrames={setMeterEnabled:async()=>{},stop:async()=>{}} as VisionPipelineOptions['nativeFrames'];
  test.internals.publish(1100);expect(test.scene).toHaveBeenCalledOnce();
  test.internals.publish(2400);expect(test.scene).toHaveBeenCalledOnce();await test.pipeline.stop();
 });
 it('drops semantic work from before pause even if the video has since resumed',async()=>{
  const test=setup();await test.internals.tick();
  let finish!:(grid:SegmentationGrid)=>void;
  const segment=vi.fn(()=>new Promise<SegmentationGrid>(resolve=>{finish=resolve;}));
  test.internals.options.segmentation={segment,close:async()=>{}};
  const pending=test.internals.processGeometry(0,1000);await Promise.resolve();expect(segment).toHaveBeenCalledOnce();
  test.video.paused=true;await test.internals.tick();test.video.paused=false;
  finish({width:10,height:10,labels:new Uint8Array(100).fill(5),timestamp:1000});await pending;
  expect(test.internals.segmentation).toBeNull();expect(test.perception).toHaveBeenLastCalledWith(null);await test.pipeline.stop();
 });
 it('accepts fresh semantic evidence but rejects a result after its deadline',async()=>{
  const test=setup();await test.internals.tick();
  const grid={width:10,height:10,labels:new Uint8Array(100).fill(5),timestamp:1000};
  test.internals.options.segmentation={segment:async()=>grid,close:async()=>{}};
  await test.internals.processGeometry(0,1000);expect(test.internals.segmentation).toEqual(grid);
  test.internals.segmentation=null;
  test.internals.options.segmentation.segment=async()=>{test.advance(1300);return grid;};
  await test.internals.processGeometry(0,1000);expect(test.internals.segmentation).toBeNull();await test.pipeline.stop();
 });
 it('rejects an OCR lookup that completes after its source expires',async()=>{
  const test=setup();
  test.internals.options.ocr.recognize=async(_frame,timestamp)=>[{text:'قاعة 101',timestamp,confidence:.9,language:'ar'}];
  test.internals.place.recognize=async()=>{test.advance(1300);return {place:{placeId:'room',name:'قاعة 101',buildingId:'b',floorId:'f',confidence:.9},candidate:null};};
  await test.internals.processOCR(0,1000);expect(test.recognized).not.toHaveBeenCalled();expect(test.candidate).not.toHaveBeenCalled();await test.pipeline.stop();
 });
 it('accepts a fresh OCR lookup and never republishes the recognized place as fresh later',async()=>{
  const test=setup();await test.internals.tick();
  test.internals.options.ocr.recognize=async(_frame,timestamp)=>[{text:'قاعة 101',timestamp,confidence:.9,language:'ar'}];
  test.internals.place.recognize=async()=>({place:{placeId:'room',name:'قاعة 101',buildingId:'b',floorId:'f',confidence:.9},candidate:null});
  await test.internals.processOCR(0,1000);expect(test.recognized).toHaveBeenCalledOnce();
  expect(test.recognized).toHaveBeenCalledWith(expect.objectContaining({placeId:'room'}),1000);
  test.internals.publish(1100);expect(test.scene.mock.lastCall?.[0].recognizedPlace?.name).toBe('قاعة 101');
  test.advance(1400);test.video.currentTime=2;await test.internals.tick();
  expect(test.scene.mock.lastCall?.[0].recognizedPlace).toBeNull();await test.pipeline.stop();
 });
 it('rejects a web video that ended while inference was running',async()=>{
  const test=setup();const original=test.detect.getMockImplementation()!;
  test.detect.mockImplementation(async(frame,timestamp)=>{const result=await original(frame,timestamp);test.video.ended=true;return result;});
  await test.internals.tick();expect(test.scene).not.toHaveBeenCalled();expect(test.analysisState).toHaveBeenLastCalledWith('PAUSED');await test.pipeline.stop();
 });
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
