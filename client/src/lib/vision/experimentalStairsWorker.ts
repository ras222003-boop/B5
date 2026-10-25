import * as ort from 'onnxruntime-web/wasm';
import {normalizeEntry} from '../../../../scripts/vision-ai/camera-lab/adapter.mjs';
let session:ort.InferenceSession|undefined;
type WorkerMessage={kind:'init';contract:unknown;modelUrl:string}|{kind:'infer';id:number;input:Float32Array};
const context=self as unknown as {onmessage:((event:MessageEvent<WorkerMessage>)=>Promise<void>)|null;postMessage:(value:unknown)=>void};
context.onmessage=async event=>{
  const message=event.data;
  try{
    if(message.kind==='init'){
      const contract=normalizeEntry(message.contract),url=new URL(message.modelUrl,self.location.origin);
      if(url.origin!==self.location.origin||!url.pathname.startsWith('/api/vision/experimental-models/'))throw new Error('same_origin_model_required');
      const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error('experimental_model_unavailable');
      const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      if(digest!==contract.sha256)throw new Error('experimental_model_hash_mismatch');
      ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths='/api/vision/experimental-models/runtime/';
      session=await ort.InferenceSession.create(new Uint8Array(bytes),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
      if(JSON.stringify(session.inputNames)!=='["image"]'||JSON.stringify([...session.outputNames].sort())!==JSON.stringify([...contract.outputs].sort()))throw new Error('experimental_tensor_names_mismatch');
      const probe=await session.run({image:new ort.Tensor('float32',new Float32Array(3*160*160),[1,3,160,160])});
      for(const[name,size]of[['presence_logits',3],['direction_logits',3],['box_xywh',4]] as const){const output=probe[name];if(JSON.stringify(output?.dims)!==`[1,${size}]`||output.type!=='float32'||!Array.from(output.data as Float32Array).every(Number.isFinite))throw new Error('experimental_tensor_shape_mismatch');}
      context.postMessage({kind:'ready'});return;
    }
    if(message.kind==='infer'){
      if(!session)throw new Error('experimental_model_not_ready');
      const result=await session.run({image:new ort.Tensor('float32',message.input,[1,3,160,160])});
      const outputs=Object.fromEntries((Object.entries(result) as [string,ort.Tensor][]).map(([name,value])=>[name,{dims:[...value.dims],data:Array.from(value.data as Float32Array)}]));
      context.postMessage({kind:'result',id:message.id,outputs});
    }
  }catch(error){context.postMessage({kind:'error',id:message.kind==='infer'?message.id:undefined,message:error instanceof Error?error.message:'experimental_inference_failed'});}
};
