import {afterEach,describe,expect,it,vi} from 'vitest';
import type {EstimatedMetricDepthProvider} from '@shared/vision';
import {VisionPipeline,type VisionPipelineOptions} from './pipeline';
import {MeterModelError} from './meterDiagnostics';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

describe('browser metric model lifecycle',()=>{
  it('keeps the previous measured still when the next camera inference begins',async()=>{
    class FakeVideo {videoWidth=640;videoHeight=480;readyState=2;currentTime=1;paused=false;}
    vi.stubGlobal('HTMLVideoElement',FakeVideo);
    vi.stubGlobal('HTMLMediaElement',{HAVE_CURRENT_DATA:2});
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(96*72*4).fill(160)})})})});
    vi.stubGlobal('window',{setTimeout,clearTimeout});
    const display:{snapshot:string|null;image:string|null}={snapshot:'prior-frame',image:'prior-frame'};
    const close=vi.fn(async()=>{});
    const model={close} as unknown as EstimatedMetricDepthProvider;
    const pipeline=new VisionPipeline({autoMeterEnabled:true,video:new FakeVideo() as unknown as HTMLVideoElement,
      vision:{detect:async()=>[],close},ocr:{close},depth:{close},
      config:{inputResolution:{width:640,height:480},frameAnalysisRate:2,OCRRefreshRate:3000} as VisionPipelineOptions['config'],
      copy:{} as VisionPipelineOptions['copy'],mode:'EXPLORATION',buildingId:null,floorId:null,
      announcement:{reset:()=>{}},callbacks:{
        autoMeterSnapshot:snapshot=>{display.snapshot=snapshot?.frameId??null;},
        pinnedMetricFrame:result=>{display.image=result?.frame.frameId??null;},
      },
    } as unknown as VisionPipelineOptions);
    const internals=pipeline as unknown as {running:boolean;estimatedModel:EstimatedMetricDepthProvider|null;
      cameraLight:string;lastLightCheck:number;ocrEnabled:boolean;publish:()=>void;
      processEstimatedMetric:()=>Promise<void>;tick:()=>Promise<void>};
    internals.running=true;internals.estimatedModel=model;internals.cameraLight='NOT_LOW_LIGHT';
    internals.lastLightCheck=performance.now();internals.ocrEnabled=false;
    internals.publish=()=>{};
    const inferred=vi.fn(async()=>{});internals.processEstimatedMetric=inferred;
    await internals.tick();
    expect(inferred).toHaveBeenCalledOnce();
    expect(display).toEqual({snapshot:'prior-frame',image:'prior-frame'});
    await pipeline.stop();
    expect(display).toEqual({snapshot:null,image:null});
  });
  function waitingPipeline(open:()=>Promise<EstimatedMetricDepthProvider>){
    vi.stubGlobal('window',{setTimeout,clearTimeout});
    const close=vi.fn(async()=>{});
    const pipeline=new VisionPipeline({autoMeterEnabled:true,estimatedMetricModel:open,
      video:{} as HTMLVideoElement,config:{} as VisionPipelineOptions['config'],copy:{} as VisionPipelineOptions['copy'],
      mode:'EXPLORATION',buildingId:null,floorId:null,announcement:{reset:()=>{}},callbacks:{},
      vision:{close},ocr:{close},depth:{close},
    } as unknown as VisionPipelineOptions);
    const internals=pipeline as unknown as {running:boolean;estimatedModel:EstimatedMetricDepthProvider|null;
      finishMeterAttempt:(at:number,result:{snapshot:null;diagnostic:'LOW_LIGHT'})=>void};
    internals.running=true;
    return {pipeline,internals};
  }
  it('keeps a button request pending while the model loads and accepts only a newer frame',async()=>{
    let loaded!:(model:EstimatedMetricDepthProvider)=>void;
    const open=vi.fn(()=>new Promise<EstimatedMetricDepthProvider>(resolve=>{loaded=resolve;}));
    const {pipeline,internals}=waitingPipeline(open);
    const request=pipeline.requestMeterNow();
    let settled=false;void request.then(()=>{settled=true;});
    expect(open).toHaveBeenCalledOnce();
    const model={close:vi.fn(async()=>{})} as unknown as EstimatedMetricDepthProvider;
    loaded(model);
    await vi.waitFor(()=>expect(internals.estimatedModel).toBe(model));
    internals.finishMeterAttempt(0,{snapshot:null,diagnostic:'LOW_LIGHT'});
    await Promise.resolve();expect(settled).toBe(false);
    internals.finishMeterAttempt(performance.now()+1,{snapshot:null,diagnostic:'LOW_LIGHT'});
    await expect(request).resolves.toEqual({snapshot:null,diagnostic:'LOW_LIGHT'});
    await pipeline.stop();
  });
  it('returns a specific model failure to a waiting button request',async()=>{
    const {pipeline}=waitingPipeline(()=>Promise.reject(new MeterModelError('MODEL_HTTP',404)));
    await expect(pipeline.requestMeterNow()).resolves.toEqual({snapshot:null,diagnostic:'MODEL_HTTP'});
    await pipeline.stop();
  });
  it('returns a model timeout instead of leaving the button waiting indefinitely',async()=>{
    vi.useFakeTimers();
    let loaded!:(model:EstimatedMetricDepthProvider)=>void;
    const {pipeline}=waitingPipeline(()=>new Promise(resolve=>{loaded=resolve;}));
    const request=pipeline.requestMeterNow();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(request).resolves.toEqual({snapshot:null,diagnostic:'MODEL_TIMEOUT'});
    loaded({close:vi.fn(async()=>{})} as unknown as EstimatedMetricDepthProvider);
    await Promise.resolve();
    await pipeline.stop();
  });
  it('returns a camera-frame timeout after the model has loaded',async()=>{
    vi.useFakeTimers();
    const model={close:vi.fn(async()=>{})} as unknown as EstimatedMetricDepthProvider;
    const {pipeline,internals}=waitingPipeline(async()=>model);
    internals.estimatedModel=model;
    const request=pipeline.requestMeterNow();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(request).resolves.toEqual({snapshot:null,diagnostic:'FRAME_TIMEOUT'});
    await pipeline.stop();
  });
  it('cancels a pending request when measurement is switched off',async()=>{
    let loaded!:(model:EstimatedMetricDepthProvider)=>void;
    const {pipeline}=waitingPipeline(()=>new Promise(resolve=>{loaded=resolve;}));
    const request=pipeline.requestMeterNow();
    await pipeline.setAutoMeterEnabled(false);
    await expect(request).resolves.toEqual({snapshot:null,diagnostic:'OFF'});
    loaded({close:vi.fn(async()=>{})} as unknown as EstimatedMetricDepthProvider);
    await pipeline.stop();
  });
  it('waits for a frame captured after the measurement request',async()=>{
    vi.stubGlobal('window',{setTimeout,clearTimeout});
    const pipeline=new VisionPipeline({autoMeterEnabled:true,nativeFrames:{} as VisionPipelineOptions['nativeFrames'],
      video:{} as HTMLVideoElement,config:{} as VisionPipelineOptions['config'],copy:{} as VisionPipelineOptions['copy'],
      mode:'EXPLORATION',buildingId:null,floorId:null,announcement:{reset:()=>{}},callbacks:{},
      vision:{close:async()=>{}},ocr:{close:async()=>{}},depth:{close:async()=>{}},
    } as VisionPipelineOptions);
    const internals=pipeline as unknown as {running:boolean;finishMeterAttempt:(at:number,result:{snapshot:null;diagnostic:'LOW_LIGHT'})=>void;cancelMeterRequests:(diagnostic:'OFF')=>void};
    internals.running=true;
    const requestedAt=performance.now();
    const reading=pipeline.requestMeterNow();
    let settled=false;void reading.then(()=>{settled=true;});
    internals.finishMeterAttempt(requestedAt-1,{snapshot:null,diagnostic:'LOW_LIGHT'});
    await Promise.resolve();expect(settled).toBe(false);
    internals.finishMeterAttempt(performance.now()+1,{snapshot:null,diagnostic:'LOW_LIGHT'});
    await expect(reading).resolves.toEqual({snapshot:null,diagnostic:'LOW_LIGHT'});
    internals.cancelMeterRequests('OFF');
  });
  it('loads the new opt-in after an earlier model load becomes stale',async()=>{
    let finishFirst!:(model:EstimatedMetricDepthProvider)=>void;
    const first=new Promise<EstimatedMetricDepthProvider>(resolve=>{finishFirst=resolve;});
    const stale={close:vi.fn(async()=>{})} as unknown as EstimatedMetricDepthProvider;
    const active={close:vi.fn(async()=>{})} as unknown as EstimatedMetricDepthProvider;
    const open=vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(active);
    const statuses:string[]=[];
    vi.stubGlobal('window',{setTimeout:()=>1,clearTimeout:()=>{}});
    vi.stubGlobal('navigator',{});
    const close=vi.fn(async()=>{});
    const pipeline=new VisionPipeline({
      video:{} as HTMLVideoElement,
      vision:{close},ocr:{close},depth:{close},
      config:{} as VisionPipelineOptions['config'],copy:{} as VisionPipelineOptions['copy'],
      mode:'EXPLORATION',buildingId:null,floorId:null,autoMeterEnabled:true,
      estimatedMetricModel:open,announcement:{reset:()=>{}},
      callbacks:{estimatedMetricStatus:status=>statuses.push(status)},
    } as unknown as VisionPipelineOptions);
    await pipeline.start();
    await pipeline.setAutoMeterEnabled(false);
    await pipeline.setAutoMeterEnabled(true);
    finishFirst(stale);
    await vi.waitFor(()=>expect(open).toHaveBeenCalledTimes(2));
    expect(stale.close).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe('WAITING');
    await pipeline.stop();
    expect(active.close).toHaveBeenCalledOnce();
  });
});
