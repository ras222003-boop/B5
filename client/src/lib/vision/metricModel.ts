import type { EstimatedMetricDepthMap, EstimatedMetricDepthProvider } from '@shared/vision';
import {checkAssetResponse,MeterModelError} from './meterDiagnostics';

const SIDE=392;
const MODEL_BASE='/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/onnx/';
const EXPECTED_BYTES=98_940_415;
const EXPECTED_SHA='2e762752eb777176c94036ecd0003fee8dfee78784e1e80a8bc3aaf1075e8bc4';
const PART_SIZE=16*1024*1024;
const MEAN=[.485,.456,.406] as const;
const STD=[.229,.224,.225] as const;

async function fetchMetricAsset(path:string,kind:'model'|'manifest'):Promise<Response> {
  let response:Response;
  try { response=await fetch(MODEL_BASE+path,{cache:'force-cache'}); }
  catch { throw new MeterModelError('MODEL_NETWORK'); }
  checkAssetResponse(response,kind);
  return response;
}

interface PartManifest {format:string;totalBytes:number;sha256:string;parts:{file:string;bytes:number}[]}
/** The current hosted single-file route returns HTML. Fetch smaller slices of the same FP32 bytes. */
export async function metricModelBytes():Promise<Uint8Array> {
  const manifestResponse=await fetchMetricAsset('parts.json','manifest');
  let manifest:PartManifest;
  try{manifest=await manifestResponse.json() as PartManifest;}
  catch{throw new MeterModelError('MODEL_HTML');}
  if(manifest?.format!=='basira-metric-onnx-parts-v1'||manifest.totalBytes!==EXPECTED_BYTES||
    manifest.sha256!==EXPECTED_SHA||!Array.isArray(manifest.parts)||manifest.parts.length!==6||
    manifest.parts.some((part,index)=>!part||part.file!==`model_fp32.part-${index}.bin`||
      part.bytes!==(index<5?PART_SIZE:EXPECTED_BYTES-5*PART_SIZE)))throw new MeterModelError('MODEL_SIZE');
  const bytes=new Uint8Array(EXPECTED_BYTES);
  let offset=0;
  for(const part of manifest.parts){
    const response=await fetchMetricAsset(part.file,'model');
    const advertised=Number(response.headers.get('content-length'));
    if(advertised&&advertised!==part.bytes)throw new MeterModelError('MODEL_SIZE');
    let chunk:Uint8Array;
    try{chunk=new Uint8Array(await response.arrayBuffer());}
    catch{throw new MeterModelError('MODEL_NETWORK');}
    const prefix=new TextDecoder().decode(chunk.subarray(0,64)).trimStart().toLowerCase();
    if(prefix.startsWith('<!doctype html')||prefix.startsWith('<html'))throw new MeterModelError('MODEL_HTML');
    if(chunk.byteLength!==part.bytes)throw new MeterModelError('MODEL_SIZE');
    bytes.set(chunk,offset);
    offset+=chunk.byteLength;
  }
  const hash=await crypto.subtle.digest('SHA-256',bytes.buffer as ArrayBuffer);
  const actual=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
  if(actual!==EXPECTED_SHA)throw new MeterModelError('MODEL_CHECKSUM');
  return bytes;
}

async function diagnoseWasmAssets():Promise<boolean> {
  for(const file of ['ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.mjs']){
    let response:Response;
    try{response=await fetch(`/vision/onnx/${file}`,{method:'HEAD',cache:'no-store'});}
    catch{return false;}
    try{checkAssetResponse(response,file.endsWith('.wasm')?'wasm':'module');}
    catch{return false;}
    const size=Number(response.headers.get('content-length'));
    if(size&&size<(file.endsWith('.wasm')?1_000_000:1_000))return false;
  }
  return true;
}

export interface MetricImagePlacement { x:number;y:number;width:number;height:number }

/** Keep the source image's aspect ratio; model pixels outside the image are ignored. */
export function metricPlacement(width:number,height:number):MetricImagePlacement {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('invalid_metric_frame');
  const scale=Math.min(SIDE/width,SIDE/height);
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  return {x:Math.floor((SIDE-w)/2),y:Math.floor((SIDE-h)/2),width:w,height:h};
}

/** RGB, channel-first and ImageNet-normalized exactly once. */
export function metricPixels(rgba:Uint8ClampedArray):Float32Array {
  if(rgba.length!==SIDE*SIDE*4)throw new Error('invalid_metric_pixels');
  const plane=SIDE*SIDE,result=new Float32Array(plane*3);
  for(let i=0;i<plane;i++)for(let channel=0;channel<3;channel++)
    result[channel*plane+i]=(rgba[i*4+channel]/255-MEAN[channel])/STD[channel];
  return result;
}

/** Project the ONNX output back to the full detector frame before box sampling. */
export function metricMapForFrame(
  depth:Float32Array,frameWidth:number,frameHeight:number,placement:MetricImagePlacement,timestamp:number,
):EstimatedMetricDepthMap {
  if(depth.length!==SIDE*SIDE||!Number.isFinite(timestamp)||frameWidth<1||frameHeight<1)throw new Error('invalid_metric_output');
  const width=Math.min(160,Math.max(16,Math.round(frameWidth/4)));
  const height=Math.min(160,Math.max(16,Math.round(frameHeight/4)));
  const values=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.max(0,Math.min(SIDE-1,Math.floor(placement.x+(x+.5)*placement.width/width)));
    const sy=Math.max(0,Math.min(SIDE-1,Math.floor(placement.y+(y+.5)*placement.height/height)));
    const value=depth[sy*SIDE+sx];
    values[y*width+x]=Number.isFinite(value)&&value>=.2&&value<=20?value:NaN;
  }
  return {width,height,values,source:'MONOCULAR_METRIC',timestamp};
}

export class MonocularMetricDepthProvider implements EstimatedMetricDepthProvider {
  private closed=false;
  private pending:Promise<unknown>|null=null;
  private constructor(
    private readonly ort:typeof import('onnxruntime-web'),
    private session:import('onnxruntime-web').InferenceSession,
    private backend:'webgpu'|'wasm',
  ) {}
  static async open():Promise<MonocularMetricDepthProvider> {
    const ort=await import('onnxruntime-web');
    ort.env.wasm.wasmPaths='/vision/onnx/';
    ort.env.wasm.numThreads=1;
    const bytes=await metricModelBytes();
    if((navigator as Navigator&{gpu?:unknown}).gpu){
      try{
        const session=await ort.InferenceSession.create(bytes,{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
        return new MonocularMetricDepthProvider(ort,session,'webgpu');
      }catch{/* A WebGPU adapter may lack a required ONNX operator. */}
    }
    let session:import('onnxruntime-web').InferenceSession;
    try{session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});}
    catch{
      throw new MeterModelError(await diagnoseWasmAssets()?'MODEL_INIT':'WASM_ASSET');
    }
    return new MonocularMetricDepthProvider(ort,session,'wasm');
  }
  private async run(frame:HTMLCanvasElement|OffscreenCanvas,timestamp:number):Promise<EstimatedMetricDepthMap> {
    if(this.closed||!frame.width||!frame.height)throw new Error('invalid_metric_frame');
    const placement=metricPlacement(frame.width,frame.height);
    const canvas=typeof document==='undefined'?new OffscreenCanvas(SIDE,SIDE):document.createElement('canvas');canvas.width=SIDE;canvas.height=SIDE;
    const context=canvas.getContext('2d',{willReadFrequently:true}) as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null;
    if(!context)throw new Error('metric_canvas_unavailable');
    context.fillStyle='#000';context.fillRect(0,0,SIDE,SIDE);
    context.drawImage(frame,placement.x,placement.y,placement.width,placement.height);
    const pixels=metricPixels(context.getImageData(0,0,SIDE,SIDE).data);
    canvas.width=canvas.height=0;
    const input=new this.ort.Tensor('float32',pixels,[1,3,SIDE,SIDE]);
    let output:Record<string,import('onnxruntime-web').Tensor>|null=null;
    try {
      try{output=await this.session.run({pixel_values:input});}
      catch(error){
        if(this.backend!=='webgpu'||this.closed)throw error;
        await this.session.release();
        try{this.session=await this.ort.InferenceSession.create(await metricModelBytes(),{executionProviders:['wasm'],graphOptimizationLevel:'all'});}
        catch(error){throw error instanceof MeterModelError?error:new MeterModelError(await diagnoseWasmAssets()?'MODEL_INIT':'WASM_ASSET');}
        this.backend='wasm';
        output=await this.session.run({pixel_values:input});
      }
      if(this.closed)throw new Error('metric_model_closed');
      const tensor=output.depth_meters;
      if(!tensor||tensor.dims.at(-2)!==SIDE||tensor.dims.at(-1)!==SIDE)throw new Error('invalid_metric_output');
      const data=tensor.data;
      const values=data instanceof Float32Array?data:Float32Array.from(data as ArrayLike<number>);
      return metricMapForFrame(values,frame.width,frame.height,placement,timestamp);
    } finally {
      input.dispose();
      if(output)for(const tensor of Object.values(output))tensor.dispose();
    }
  }
  estimate(frame:HTMLCanvasElement|OffscreenCanvas,timestamp:number):Promise<EstimatedMetricDepthMap> {
    const promise=this.run(frame,timestamp);
    this.pending=promise;
    void promise.finally(()=>{if(this.pending===promise)this.pending=null;}).catch(()=>{});
    return promise;
  }
  async close():Promise<void> {
    this.closed=true;
    await this.pending?.catch(()=>{});
    await this.session.release();
  }
}
