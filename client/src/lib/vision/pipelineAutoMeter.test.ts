import {afterEach,describe,expect,it,vi} from 'vitest';
import type {EstimatedMetricDepthProvider} from '@shared/vision';
import {VisionPipeline,type VisionPipelineOptions} from './pipeline';

afterEach(()=>vi.unstubAllGlobals());

describe('browser metric model lifecycle',()=>{
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
