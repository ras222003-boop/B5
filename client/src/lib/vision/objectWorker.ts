import {MediaPipeVisionProvider} from './providers';
import type {VisionConfig} from './config';
import type {VisionProvider} from '@shared/vision';
import type {ObjectQualityProfile} from '@shared/objectQuality';
import {ObjectQualityProvider} from './objectQuality';
type Request={kind:'init';config:VisionConfig;profile?:ObjectQualityProfile;withMasks?:boolean}|{kind:'detect';id:number;bitmap:ImageBitmap;timestamp:number};
const scope=self as unknown as {onmessage:((event:MessageEvent<Request>)=>void)|null;postMessage:(data:unknown)=>void};
let provider:VisionProvider|null=null;
scope.onmessage=event=>{
 const request=event.data;
 if(request.kind==='init'){
   void (request.profile?ObjectQualityProvider.open(request.profile,request.withMasks):MediaPipeVisionProvider.open(request.config)).then(value=>{provider=value;scope.postMessage({kind:'ready'});})
     .catch(error=>scope.postMessage({kind:'error',id:0,message:error instanceof Error?error.message:'object_worker_init'}));return;
 }
 void (async()=>{let canvas:OffscreenCanvas|null=null;try{
   if(!provider)throw new Error('not_ready');
   canvas=new OffscreenCanvas(request.bitmap.width,request.bitmap.height);
   const context=canvas.getContext('2d',provider.usagePolicy==='EXPERIMENTAL_OBJECTS_ONLY'?{willReadFrequently:true}:undefined);if(!context)throw new Error('no_canvas');
   context.drawImage(request.bitmap,0,0);
   const detections=await provider.detect(canvas,request.timestamp);
   scope.postMessage({kind:'result',id:request.id,detections});
 }catch{scope.postMessage({kind:'error',id:request.id});}finally{request.bitmap.close();if(canvas)canvas.width=canvas.height=0;}})();
};
