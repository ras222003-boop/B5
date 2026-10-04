import type { MetricDepthMap, MetricDepthProvider, RelativeDepthMap, RelativeDepthProvider, SceneSegmentationProvider, SegmentationGrid } from '@shared/vision';
import { semanticCode } from './segmentation';

async function localTransformers() {
  const library=await import('@huggingface/transformers');
  library.env.allowLocalModels=true;
  library.env.allowRemoteModels=false;
  library.env.localModelPath='/vision/models/';
  const wasm=library.env.backends.onnx.wasm;
  if(!wasm)throw new Error('onnx_wasm_unavailable');
  wasm.wasmPaths='/vision/onnx/';
  wasm.numThreads=1;
  return library;
}

/** Quantized ADE20K SegFormer; model and ONNX runtime are served by Basira. */
export class SegFormerSceneProvider implements SceneSegmentationProvider {
  private constructor(private readonly run:(frame:Blob)=>Promise<Awaited<ReturnType<import('@huggingface/transformers').ImageSegmentationPipeline['_call']>>>,private readonly dispose:()=>Promise<void>) {}
  static async open():Promise<SegFormerSceneProvider> {
    const {pipeline}=await localTransformers();
    const model=await pipeline('image-segmentation','Xenova/segformer-b0-finetuned-ade-512-512',{device:'wasm',dtype:'q8'});
    return new SegFormerSceneProvider(frame=>model(frame,{subtask:'semantic'}),()=>model.dispose());
  }
  async segment(frame:Blob,timestamp:number):Promise<SegmentationGrid> {
    const masks=await this.run(frame),width=64,height=48,labels=new Uint8Array(width*height);
    for(const result of masks){
      const code=semanticCode(result.label??'');if(!code)continue;
      const mask=result.mask;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const sx=Math.min(mask.width-1,Math.floor((x+.5)*mask.width/width));
        const sy=Math.min(mask.height-1,Math.floor((y+.5)*mask.height/height));
        if(mask.data[(sy*mask.width+sx)*mask.channels]>0)labels[y*width+x]=code;
      }
    }
    return {width,height,labels,timestamp};
  }
  close(){return this.dispose();}
}

/** Relative Depth Anything V2 output: normalized structure, never metres. */
export class MonocularRelativeDepthProvider implements RelativeDepthProvider {
  private constructor(private readonly run:(frame:Blob)=>Promise<import('@huggingface/transformers').DepthEstimationPipelineOutput>,private readonly dispose:()=>Promise<void>) {}
  static async open():Promise<MonocularRelativeDepthProvider> {
    const {pipeline}=await localTransformers();
    const model=await pipeline('depth-estimation','onnx-community/depth-anything-v2-small',{device:'wasm',dtype:'q8'});
    return new MonocularRelativeDepthProvider(async frame=>{
      const result=await model(frame);return Array.isArray(result)?result[0]:result;
    },()=>model.dispose());
  }
  async estimate(frame:Blob,timestamp:number):Promise<RelativeDepthMap> {
    const result=await this.run(frame),tensor=result.predicted_depth;
    const height=tensor.dims[tensor.dims.length-2],width=tensor.dims[tensor.dims.length-1];
    const raw=tensor.data,values=new Float32Array(width*height);
    let min=Infinity,max=-Infinity;
    for(let i=0;i<values.length;i++){const n=Number(raw[i]);if(Number.isFinite(n)){min=Math.min(min,n);max=Math.max(max,n);}}
    const range=max-min;
    if(!Number.isFinite(range)||range<=0)throw new Error('invalid_relative_depth');
    for(let i=0;i<values.length;i++)values[i]=Number.isFinite(Number(raw[i]))?(Number(raw[i])-min)/range:0;
    return {width,height,values,confidence:.5,source:'MONOCULAR_ESTIMATE',timestamp};
  }
  close(){return this.dispose();}
}

/** A native wrapper must provide a camera-aligned metric map; all values are validated. */
export interface BasiraNativeDepthBridge {
  getAlignedDepth():Promise<{width:number;height:number;values:number[];confidence:number;source:'ARKIT_DEPTH'|'LIDAR'|'ARCORE_DEPTH'|'DEPTH_SENSOR'}|null>;
}
declare global { interface Window { BasiraNativeDepth?:BasiraNativeDepthBridge } }
export class NativeMetricDepthProvider implements MetricDepthProvider {
  constructor(private readonly bridge:BasiraNativeDepthBridge) {}
  async capture(timestamp:number):Promise<MetricDepthMap|null> {
    const result=await this.bridge.getAlignedDepth();
    if(!result)return null;
    const {width,height,confidence,source,values}=result;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width*height>2_000_000||values.length!==width*height||
      !Number.isFinite(confidence)||confidence<0||confidence>1||!['ARKIT_DEPTH','LIDAR','ARCORE_DEPTH','DEPTH_SENSOR'].includes(source))return null;
    const map=new Float32Array(values.map(n=>Number.isFinite(n)&&n>0?n:NaN));
    return {width,height,values:map,confidence,source,timestamp};
  }
  async close(){/* Owned by the native bridge. */}
}
