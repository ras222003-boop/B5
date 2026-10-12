import {afterEach,describe,expect,it,vi} from 'vitest';
import {WorkerMetricDepthProvider} from './workerMetricModel';

afterEach(()=>vi.unstubAllGlobals());

describe('optional metric worker isolation',()=>{
  it('rejects unsupported worker canvases so object detection can continue',async()=>{
    vi.stubGlobal('Worker',undefined);
    await expect(WorkerMetricDepthProvider.open()).rejects.toMatchObject({code:'MODEL_INIT'});
  });
  it('stops a model load immediately when measurement is turned off',async()=>{
    const terminate=vi.fn();
    vi.stubGlobal('Worker',class {addEventListener(){}removeEventListener(){}postMessage(){}terminate=terminate;});
    vi.stubGlobal('OffscreenCanvas',class {});
    vi.stubGlobal('createImageBitmap',vi.fn());
    const controller=new AbortController();
    const opening=WorkerMetricDepthProvider.open(controller.signal);
    controller.abort();
    await expect(opening).rejects.toMatchObject({code:'OFF'});
    expect(terminate).toHaveBeenCalledOnce();
  });
  it('transfers the still frame and returns measurements without invoking ONNX on the page',async()=>{
    const messages:unknown[]=[];
    let terminated=false;
    class FakeWorker{
      private listeners=new Map<string,Set<(event:any)=>void>>();
      constructor(_url:URL,_options:WorkerOptions){}
      addEventListener(name:string,listener:(event:any)=>void){const set=this.listeners.get(name)??new Set();set.add(listener);this.listeners.set(name,set);}
      removeEventListener(name:string,listener:(event:any)=>void){this.listeners.get(name)?.delete(listener);}
      emit(name:string,data:unknown){this.listeners.get(name)?.forEach(listener=>listener({data}));}
      postMessage(message:any,transfer?:unknown[]){messages.push({message,transfer});queueMicrotask(()=>{
        if(message.kind==='init')this.emit('message',{kind:'ready'});
        if(message.kind==='estimate')this.emit('message',{kind:'result',id:message.id,map:{width:1,height:1,values:new Float32Array([1]),source:'MONOCULAR_METRIC',timestamp:message.timestamp}});
      });}
      terminate(){terminated=true;}
    }
    const bitmap={width:320,height:240,close:vi.fn()};
    vi.stubGlobal('Worker',FakeWorker);
    vi.stubGlobal('OffscreenCanvas',class {});
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
    const provider=await WorkerMetricDepthProvider.open();
    const map=await provider.estimate({} as HTMLCanvasElement,123);
    expect(map.values[0]).toBe(1);
    expect((messages[1] as any).transfer).toEqual([bitmap]);
    await provider.close();
    expect(terminated).toBe(true);
  });
});
