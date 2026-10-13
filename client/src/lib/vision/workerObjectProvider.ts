import type {VisionDetection,VisionProvider} from '@shared/vision';
import type {VisionConfig} from './config';
import {MediaPipeVisionProvider} from './providers';

/** At most one transferable frame in flight; closed/late workers cannot publish results. */
export class WorkerObjectProvider implements VisionProvider {
 private closed=false;
 private busy=false;
 private serial=0;
 private pending:{id:number;resolve:(value:VisionDetection[])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
 private constructor(private readonly worker:Worker){
   worker.addEventListener('message',event=>{const value=event.data,pending=this.pending;if(!pending||value.id!==pending.id)return;
     clearTimeout(pending.timer);this.pending=null;
     if(value.kind==='result')pending.resolve(value.detections);else pending.reject(new Error('object_worker_failed'));
   });
   worker.addEventListener('error',()=>this.fail());
 }
 private fail(){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('object_worker_failed'));this.pending=null;}}
 static async open(config:VisionConfig):Promise<WorkerObjectProvider>{
   if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')throw new Error('object_worker_unavailable');
   const worker=new Worker(new URL('./objectWorker.ts',import.meta.url),{type:'module'});
   const provider=new WorkerObjectProvider(worker);
   await new Promise<void>((resolve,reject)=>{
     const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',ready);worker.removeEventListener('error',failed);};
     const failed=()=>{cleanup();worker.terminate();reject(new Error('object_worker_init'));};
     const ready=(event:MessageEvent)=>{if(event.data.kind==='ready'){cleanup();resolve();}else if(event.data.kind==='error')failed();};
     const timer=setTimeout(failed,15_000);
     worker.addEventListener('message',ready);worker.addEventListener('error',failed);worker.postMessage({kind:'init',config});
   });return provider;
 }
 async detect(frame:HTMLVideoElement|HTMLCanvasElement,timestamp:number):Promise<VisionDetection[]>{
   if(this.closed||this.busy)throw new Error('object_worker_unavailable');
   this.busy=true;
   try{
     const bitmap=await createImageBitmap(frame);
     if(this.closed){bitmap.close();throw new Error('object_worker_closed');}
     const id=++this.serial;
     return await new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>{this.fail();this.worker.terminate();this.closed=true;},5000);
       this.pending={id,resolve,reject,timer};
       try{this.worker.postMessage({kind:'detect',id,bitmap,timestamp},[bitmap]);}catch{bitmap.close();this.fail();}
     });
   }finally{this.busy=false;}
 }
 async close(){this.closed=true;this.fail();this.worker.terminate();}
}
export async function openObjectProvider(config:VisionConfig):Promise<{provider:VisionProvider;execution:'WORKER'|'MAIN_THREAD'}>{
 try{return {provider:await WorkerObjectProvider.open(config),execution:'WORKER'};}
 catch{return {provider:await MediaPipeVisionProvider.open(config),execution:'MAIN_THREAD'};}
}
