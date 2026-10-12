import type {EstimatedMetricDepthMap,EstimatedMetricDepthProvider} from '@shared/vision';
import {MeterModelError,type MeterDiagnostic} from './meterDiagnostics';

type WorkerReply={kind:'ready'}|{kind:'result';id:number;map:EstimatedMetricDepthMap}|{kind:'error';id:number;code:MeterDiagnostic};

/** All ONNX initialization and inference stay off the UI thread. */
export class WorkerMetricDepthProvider implements EstimatedMetricDepthProvider{
  private readonly pending=new Map<number,{resolve:(map:EstimatedMetricDepthMap)=>void;reject:(error:Error)=>void}>();
  private nextId=0;
  private closed=false;
  private constructor(private readonly worker:Worker){
    worker.addEventListener('message',event=>this.receive(event.data as WorkerReply));
    worker.addEventListener('error',()=>this.failAll(new MeterModelError('INFERENCE_FAILED')));
  }
  static async open(signal?:AbortSignal):Promise<WorkerMetricDepthProvider>{
    if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')throw new MeterModelError('MODEL_INIT');
    if(signal?.aborted)throw new MeterModelError('OFF');
    const worker=new Worker(new URL('./metricWorker.ts',import.meta.url),{type:'module'});
    const provider=new WorkerMetricDepthProvider(worker);
    return await new Promise<WorkerMetricDepthProvider>((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();worker.terminate();reject(new MeterModelError('MODEL_TIMEOUT'));},60_000);
      const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',ready);worker.removeEventListener('error',failed);signal?.removeEventListener('abort',aborted);};
      const ready=(event:MessageEvent<WorkerReply>)=>{
        if(event.data.kind==='ready'){cleanup();resolve(provider);}
        else if(event.data.kind==='error'&&event.data.id===0){cleanup();worker.terminate();reject(new MeterModelError(event.data.code));}
      };
      const failed=()=>{cleanup();worker.terminate();reject(new MeterModelError('MODEL_INIT'));};
      const aborted=()=>{cleanup();worker.terminate();reject(new MeterModelError('OFF'));};
      worker.addEventListener('message',ready);worker.addEventListener('error',failed);
      signal?.addEventListener('abort',aborted,{once:true});
      if(signal?.aborted)aborted();else worker.postMessage({kind:'init'});
    });
  }
  private receive(reply:WorkerReply){
    if(reply.kind==='ready')return;
    const item=this.pending.get(reply.id);if(!item)return;
    this.pending.delete(reply.id);
    if(reply.kind==='result')item.resolve(reply.map);
    else item.reject(new MeterModelError(reply.code));
  }
  private failAll(error:Error){this.pending.forEach(item=>item.reject(error));this.pending.clear();}
  async estimate(frame:HTMLCanvasElement,timestamp:number):Promise<EstimatedMetricDepthMap>{
    if(this.closed)throw new MeterModelError('INFERENCE_FAILED');
    const bitmap=await createImageBitmap(frame);
    if(this.closed){bitmap.close();throw new MeterModelError('INFERENCE_FAILED');}
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      try{this.worker.postMessage({kind:'estimate',id,bitmap,timestamp},[bitmap]);}
      catch(error){bitmap.close();this.pending.delete(id);reject(error);}
    });
  }
  async close(){if(this.closed)return;this.closed=true;this.failAll(new MeterModelError('INFERENCE_FAILED'));this.worker.terminate();}
}
