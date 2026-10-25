import type {VisionDetection,VisionProvider} from '@shared/vision';
import {experimentalDisplayOnly,type ExperimentalModel} from '@shared/experimentalModels';
import {classifyDirection,classifyVertical} from './safety';
import {normalizeEntry,makeInput,decodeOutputs,type ResearchContract,type ResearchResult} from '../../../../scripts/vision-ai/camera-lab/adapter.mjs';

export const experimentalBase='/api/vision/experimental-models';
export async function experimentalModels(signal?:AbortSignal):Promise<ExperimentalModel[]>{
  const response=await fetch(experimentalBase,{cache:'no-store',signal});if(!response.ok)throw new Error('تعذر قراءة قائمة النماذج التجريبية المحلية.');
  const result=await response.json();return (result.models??[]).filter((model:ExperimentalModel)=>experimentalDisplayOnly(model)&&/^[a-z0-9][a-z0-9-]{0,95}$/.test(model.id));
}
export function researchDetections(result:ResearchResult,model:ExperimentalModel,timestamp:number):VisionDetection[]{
  if(result.classId===null||!result.box)return[];
  const [x,y,width,height]=result.box,boundingBox={x,y,width,height};
  return [{id:`research-${timestamp}`,type:result.classId===2301?'STAIRS_UP':result.classId===2302?'STAIRS_DOWN':result.classId===2303?'STAIRS_UNCERTAIN':'UNKNOWN_OBSTACLE',
    confidence:result.score,boundingBox,horizontalDirection:classifyDirection(boundingBox),verticalPosition:classifyVertical(boundingBox),approximateDistance:null,
    timestamp,source:'OBJECT_DETECTOR',confidenceKind:'MODEL_SCORE',evidence:['EXPERIMENTAL_DISPLAY_ONLY','UNCALIBRATED_CONFIDENCE'],
    experimental:{modelId:model.id,modelSha256:model.modelSha256,classId:result.classId,navigationEligible:false,referenceLabel:false}}];
}
/** Implements Basira's provider contract; rejected by the production safety pipeline. */
export class ExperimentalStairsProvider implements VisionProvider{
  readonly usagePolicy='EXPERIMENTAL_DISPLAY_ONLY' as const;
  private readonly canvas=document.createElement('canvas');
  private sequence=0;private closed=false;
  private pending: {id:number;resolve:(outputs:Parameters<typeof decodeOutputs>[0])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
  lastResult:ResearchResult|null=null;
  private constructor(private worker:Worker,readonly contract:ResearchContract,readonly model:ExperimentalModel){}
  static async open(model:ExperimentalModel,signal?:AbortSignal){
    if(!experimentalDisplayOnly(model))throw new Error('experimental_policy_required');
    const response=await fetch(`${experimentalBase}/${model.id}/entry.json`,{cache:'no-store',signal});if(!response.ok)throw new Error('experimental_entry_unavailable');
    const contract=normalizeEntry(await response.json());if(contract.adapter!=='separated-v3'||contract.sha256!==model.modelSha256)throw new Error('experimental_contract_mismatch');
    const worker=new Worker(new URL('./experimentalStairsWorker.ts',import.meta.url),{type:'module'});
    const provider=new ExperimentalStairsProvider(worker,contract,model);
    try{await new Promise<void>((done,reject)=>{
      const timer=setTimeout(()=>finish(new Error('experimental_model_timeout')),30000);
      const abort=()=>finish(new Error('experimental_model_cancelled'));
      const finish=(error?:Error)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.onmessage=null;worker.onerror=null;error?reject(error):done();};
      worker.onmessage=event=>event.data.kind==='ready'?finish():finish(new Error(event.data.message??'experimental_model_failed'));
      worker.onerror=()=>finish(new Error('experimental_worker_failed'));signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}worker.postMessage({kind:'init',contract,modelUrl:`${experimentalBase}/${model.id}/model.onnx`});
    });}catch(error){await provider.close();throw error;}
    worker.onmessage=event=>{const reply=event.data,request=provider.pending;if(!request||reply.id!==request.id)return;clearTimeout(request.timer);provider.pending=null;
      reply.kind==='result'?request.resolve(reply.outputs):request.reject(new Error(reply.message??'experimental_inference_failed'));};
    worker.onerror=()=>{if(provider.pending){clearTimeout(provider.pending.timer);provider.pending.reject(new Error('experimental_worker_failed'));provider.pending=null;}};
    return provider;
  }
  async detect(frame:HTMLVideoElement|HTMLCanvasElement|OffscreenCanvas,timestamp:number):Promise<VisionDetection[]>{
    if(this.closed||this.pending)throw new Error('experimental_provider_unavailable_or_busy');
    const {data,transform}=makeInput(frame,this.contract,this.canvas),id=++this.sequence;
    const output=await new Promise<Parameters<typeof decodeOutputs>[0]>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending=null;this.worker.terminate();this.closed=true;reject(new Error('experimental_inference_timeout'));},15000);
      this.pending={id,resolve,reject,timer};this.worker.postMessage({kind:'infer',id,input:data},[data.buffer]);
    });
    if(this.closed)throw new Error('experimental_provider_closed');
    this.lastResult=decodeOutputs(output,this.contract,transform);return researchDetections(this.lastResult,this.model,timestamp);
  }
  async close(){this.closed=true;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('experimental_provider_closed'));this.pending=null;}this.worker.terminate();this.canvas.width=this.canvas.height=0;this.lastResult=null;}
}
