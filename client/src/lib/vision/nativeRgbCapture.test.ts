import {afterEach,describe,expect,it,vi} from 'vitest';
import {captureNativeRgb} from './nativeRgbCapture';
import type {AtomicNativeFrame} from './nativeFramePair';

function setup(){
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
  const frame:AtomicNativeFrame={frameId:'arkit-100',nativeTimestampMs:100_000,bridgeAgeMs:0,source:'ARKIT_DEPTH',
    capturedWithNativeSession:true,cameraWidth:1920,cameraHeight:1440,imageBase64:'A'.repeat(256),
    depthEnabled:false,alignedToCameraFrame:false,rawDepthFresh:false,depthWidth:0,depthHeight:0,values:[],validCoverage:0};
  const context={save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),drawImage:vi.fn()};
  const canvas={width:0,height:0,getContext:()=>context} as unknown as HTMLCanvasElement;
  const decode=vi.fn(async()=>{});
  vi.stubGlobal('Image',class{src='';naturalWidth=640;naturalHeight=480;decode=decode;});
  const bridge={start:vi.fn(),stop:vi.fn(),setMeterEnabled:vi.fn(),nextFrame:vi.fn(async()=>frame)};
  return{frame,context,canvas,decode,bridge};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('experimental detector native RGB transport',()=>{
  it('applies the documented clockwise sensor-to-portrait transform to RGB only',async()=>{
    const {frame,context,canvas,bridge}=setup();
    Object.defineProperty(frame,'values',{get(){throw Error('depth_must_not_be_read');}});
    expect(await captureNativeRgb(bridge,canvas,'')).toMatchObject({frameId:frame.frameId,capturedAt:0});
    expect([canvas.width,canvas.height]).toEqual([480,640]);
    expect(context.translate).toHaveBeenCalledWith(480,0);expect(context.rotate).toHaveBeenCalledWith(Math.PI/2);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(),0,0,640,480);expect(context.restore).toHaveBeenCalledOnce();
  });
  it('uses native age and includes image decoding latency in freshness checks',async()=>{
    const {frame,bridge,canvas,decode,context}=setup();
    await vi.advanceTimersByTimeAsync(1000);frame.bridgeAgeMs=200;
    expect(await captureNativeRgb(bridge,canvas,'')).toMatchObject({capturedAt:800});
    decode.mockImplementation(async()=>{await vi.advanceTimersByTimeAsync(1100);});
    expect(await captureNativeRgb(bridge,canvas,'')).toBeNull();expect(context.drawImage).toHaveBeenCalledOnce();
  });
  it.each(['repeated','stale','unverified','invalid-geometry'] as const)('rejects %s frames before decoding',async invalid=>{
    const {frame,bridge,canvas,decode}=setup();
    if(invalid==='stale')frame.bridgeAgeMs=501;
    if(invalid==='unverified')frame.capturedWithNativeSession=false;
    if(invalid==='invalid-geometry')frame.cameraWidth=1440;
    expect(await captureNativeRgb(bridge,canvas,invalid==='repeated'?frame.frameId:'')).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
  it.each([[480,640],[1280,960],[640,360],[0,0],[NaN,480]])('rejects decoded geometry %s × %s instead of stretching',async(width,height)=>{
    const {canvas,context,bridge}=setup();
    vi.stubGlobal('Image',class{src='';naturalWidth=width;naturalHeight=height;decode=async()=>{};});
    expect(await captureNativeRgb(bridge,canvas,'')).toBeNull();expect(context.drawImage).not.toHaveBeenCalled();
  });
});
