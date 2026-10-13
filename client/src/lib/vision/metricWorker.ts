import {MonocularMetricDepthProvider} from './metricModel';
import {MeterModelError} from './meterDiagnostics';

type RequestMessage={kind:'init'}|{kind:'estimate';id:number;bitmap:ImageBitmap;timestamp:number};
const scope=self as unknown as {onmessage:((event:MessageEvent<RequestMessage>)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
let model:MonocularMetricDepthProvider|null=null;

scope.onmessage=event=>{
  const message=event.data;
  if(message.kind==='init'){
    void MonocularMetricDepthProvider.open().then(opened=>{model=opened;scope.postMessage({kind:'ready'});})
      .catch(error=>scope.postMessage({kind:'error',id:0,code:error instanceof MeterModelError?error.code:'MODEL_INIT'}));
    return;
  }
  void (async()=>{
    try{
      if(!model)throw new Error('metric_model_not_ready');
      const canvas=new OffscreenCanvas(message.bitmap.width,message.bitmap.height);
      const context=canvas.getContext('2d');
      if(!context)throw new Error('metric_canvas_unavailable');
      context.drawImage(message.bitmap,0,0);
      const map=await model.estimate(canvas,message.timestamp);
      scope.postMessage({kind:'result',id:message.id,map},[map.values.buffer]);
    }catch(error){scope.postMessage({kind:'error',id:message.id,code:error instanceof MeterModelError?error.code:'INFERENCE_FAILED'});}
    finally{message.bitmap.close();}
  })();
};
