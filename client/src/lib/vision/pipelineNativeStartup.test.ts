import {afterEach,describe,expect,it,vi} from 'vitest';
import {visionMessages} from '@/i18n/locales/vision';
import {DEFAULT_VISION_CONFIG} from './config';
import {DEFAULT_APPROACH_PREFERENCES} from './approachPreferences';
import {VisionPipeline,type VisionPipelineOptions} from './pipeline';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

function deferred(){
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const promise=new Promise<void>((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
}
function setup(bridge?:NonNullable<VisionPipelineOptions['nativeFrames']>){
  const schedule=vi.fn(()=>1);
  vi.stubGlobal('window',{setTimeout:schedule,clearTimeout:vi.fn()});
  vi.stubGlobal('navigator',{});
  const native=bridge??{
    start:vi.fn(async()=>{}),setMeterEnabled:vi.fn(async()=>{}),
    nextFrame:vi.fn(async()=>null),stop:vi.fn(async()=>{}),
  };
  const close=vi.fn(async()=>{}),rejected=vi.fn();
  const pipeline=new VisionPipeline({
    nativeFrames:native,video:{} as HTMLVideoElement,
    vision:{close},ocr:{close},depth:{close},
    config:DEFAULT_VISION_CONFIG,copy:visionMessages.ar,
    mode:'EXPLORATION',buildingId:null,floorId:null,
    experimentalApproachEnabled:true,
    approachPreferences:{...DEFAULT_APPROACH_PREFERENCES,mode:'TRUSTED_METRIC'},
    announcement:{reset:vi.fn()},callbacks:{autoMeterRejected:rejected},
  } as unknown as VisionPipelineOptions);
  return {pipeline,native,close,schedule,rejected};
}

describe('native startup keeps ownership across pending camera and meter requests',()=>{
  it('does not enable depth or analysis after a cancelled camera permission resolves',async()=>{
    const {pipeline,native,schedule}=setup(),permission=deferred();
    vi.mocked(native.start).mockReturnValueOnce(permission.promise);
    const starting=pipeline.start();
    await pipeline.stop();
    permission.resolve();await starting;
    expect(pipeline.active).toBe(false);
    expect(native.setMeterEnabled).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not stop a newer native session when old permission fails late',async()=>{
    const old=setup(),permission=deferred();
    vi.mocked(old.native.start).mockReturnValueOnce(permission.promise);
    const starting=old.pipeline.start();await old.pipeline.stop();
    const next=setup(old.native);await next.pipeline.start();
    expect(next.pipeline.active).toBe(true);
    permission.reject(Error('camera_stopped'));
    await expect(starting).resolves.toBeUndefined();
    expect(next.pipeline.active).toBe(true);
    expect(old.native.stop).toHaveBeenCalledOnce();
    await next.pipeline.stop();
  });

  it('does not reject a meter opt-in or schedule work after stop and a late meter failure',async()=>{
    const {pipeline,native,rejected,schedule}=setup(),meter=deferred();
    vi.mocked(native.setMeterEnabled).mockReturnValueOnce(meter.promise);
    const starting=pipeline.start();
    await Promise.resolve();expect(native.setMeterEnabled).toHaveBeenCalledWith(true);
    await pipeline.stop();meter.reject(Error('camera_stopped'));
    await expect(starting).resolves.toBeUndefined();
    expect(rejected).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it('discards a late opt-in failure without changing a newer session',async()=>{
    const {pipeline,native,rejected}=setup();await pipeline.start();
    const meter=deferred();vi.mocked(native.setMeterEnabled).mockReturnValueOnce(meter.promise);
    const enabled=pipeline.setAutoMeterEnabled(true);await pipeline.stop();
    const next=setup(native);await next.pipeline.start();
    meter.reject(Error('camera_stopped'));
    await expect(enabled).resolves.toBe(false);
    expect(rejected).not.toHaveBeenCalled();expect(next.pipeline.active).toBe(true);
    expect(native.stop).toHaveBeenCalledOnce();
    await next.pipeline.stop();
  });

  it('sends native stop before yielding, without a separate pending meter-off request',async()=>{
    const {pipeline,native}=setup();await pipeline.start();
    vi.mocked(native.setMeterEnabled).mockClear();
    const closing=deferred();vi.mocked(native.stop).mockReturnValueOnce(closing.promise);
    const stopping=pipeline.stop();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(native.setMeterEnabled).not.toHaveBeenCalled();
    const next=setup(native);await next.pipeline.start();
    closing.resolve();await stopping;
    expect(native.stop).toHaveBeenCalledOnce();expect(next.pipeline.active).toBe(true);
    await next.pipeline.stop();
  });

  it('still closes resources and surfaces an active native startup failure',async()=>{
    const {pipeline,native,close,schedule}=setup();
    vi.mocked(native.start).mockRejectedValueOnce(Error('camera_denied'));
    await expect(pipeline.start()).rejects.toThrow('camera_denied');
    expect(pipeline.active).toBe(false);expect(native.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(3);expect(schedule).not.toHaveBeenCalled();
  });
});
