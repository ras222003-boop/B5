import type { EstimatedMetricDepthMap, EstimatedMetricDepthProvider } from '@shared/vision';

const SIDE=392;
const MODEL='/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/onnx/model_fp32.onnx';
const MEAN=[.485,.456,.406] as const;
const STD=[.229,.224,.225] as const;

async function metricModelBytes():Promise<Uint8Array> {
  const response=await fetch(MODEL,{cache:'force-cache'});
  if(!response.ok)throw new Error(`metric_model_http_${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength<90_000_000||bytes.byteLength>100_000_000)throw new Error('invalid_metric_model_size');
  return bytes;
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
    const session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    return new MonocularMetricDepthProvider(ort,session,'wasm');
  }
  private async run(frame:HTMLCanvasElement,timestamp:number):Promise<EstimatedMetricDepthMap> {
    if(this.closed||!frame.width||!frame.height)throw new Error('invalid_metric_frame');
    const placement=metricPlacement(frame.width,frame.height);
    const canvas=document.createElement('canvas');canvas.width=SIDE;canvas.height=SIDE;
    const context=canvas.getContext('2d',{willReadFrequently:true});
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
        this.session=await this.ort.InferenceSession.create(await metricModelBytes(),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
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
  estimate(frame:HTMLCanvasElement,timestamp:number):Promise<EstimatedMetricDepthMap> {
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
