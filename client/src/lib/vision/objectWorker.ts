import {MediaPipeVisionProvider} from './providers';
import type {VisionConfig} from './config';
type Request={kind:'init';config:VisionConfig}|{kind:'detect';id:number;bitmap:ImageBitmap;timestamp:number};
const scope=self as unknown as {onmessage:((event:MessageEvent<Request>)=>void)|null;postMessage:(data:unknown)=>void};
let provider:MediaPipeVisionProvider|null=null;
scope.onmessage=event=>{
 const request=event.data;
 if(request.kind==='init'){
   void MediaPipeVisionProvider.open(request.config).then(value=>{provider=value;scope.postMessage({kind:'ready'});})
     .catch(()=>scope.postMessage({kind:'error',id:0}));return;
 }
 void (async()=>{try{
   if(!provider)throw new Error('not_ready');
   const canvas=new OffscreenCanvas(request.bitmap.width,request.bitmap.height);
   const context=canvas.getContext('2d');if(!context)throw new Error('no_canvas');
   context.drawImage(request.bitmap,0,0);
   const detections=await provider.detect(canvas,request.timestamp);
   scope.postMessage({kind:'result',id:request.id,detections});
 }catch{scope.postMessage({kind:'error',id:request.id});}finally{request.bitmap.close();}})();
};
