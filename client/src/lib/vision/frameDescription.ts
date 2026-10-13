export type DescriptionMode='brief'|'detailed'|'inspect'|'read_text'|'ask';
export type InspectionRegion='full'|'left'|'center'|'right'|'top'|'bottom';
export type DescriptionFrame={imageBase64:string;width:number;height:number;sourceWidth:number;sourceHeight:number;source:'photo'|'video'|'native'|'crop'};

const maxSide=2048;

async function encodeCanvas(source:CanvasImageSource,width:number,height:number,sourceWidth:number,sourceHeight:number,kind:DescriptionFrame['source']):Promise<DescriptionFrame>{
  if(!width||!height)throw new Error('camera_frame_unavailable');
  const scale=Math.min(1,maxSide/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('camera_frame_unavailable');
  context.drawImage(source,0,0,canvas.width,canvas.height);
  const outputWidth=canvas.width,outputHeight=canvas.height;
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
  canvas.width=canvas.height=0;
  if(!blob||blob.size<128||blob.size>8*1024*1024)throw new Error('camera_frame_unavailable');
  const imageBase64=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('camera_frame_unavailable'));
    reader.onerror=()=>reject(new Error('camera_frame_unavailable'));
    reader.readAsDataURL(blob);
  });
  return {imageBase64,width:outputWidth,height:outputHeight,sourceWidth,sourceHeight,source:kind};
}

/** Capture a real still when supported, otherwise use the actual video pixels. */
export async function captureDescriptionFrame(video:HTMLVideoElement,nativeCanvas:HTMLCanvasElement|null,useNative:boolean):Promise<DescriptionFrame>{
  if(useNative){
    if(!nativeCanvas?.width||!nativeCanvas.height)throw new Error('camera_frame_unavailable');
    return encodeCanvas(nativeCanvas,nativeCanvas.width,nativeCanvas.height,nativeCanvas.width,nativeCanvas.height,'native');
  }
  if(!video.videoWidth||!video.videoHeight||video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA)throw new Error('camera_frame_unavailable');
  const track=(video.srcObject as MediaStream|null)?.getVideoTracks?.()[0];
  const PhotoCapture=(globalThis as unknown as {ImageCapture?:new(track:MediaStreamTrack)=>{takePhoto:()=>Promise<Blob>}}).ImageCapture;
  if(track?.readyState==='live'&&PhotoCapture){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const blob=await Promise.race([new PhotoCapture(track).takePhoto(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('photo_timeout')),8000);})]);
      if(blob.size>16*1024*1024)throw new Error('photo_too_large');
      const url=URL.createObjectURL(blob);
      try{
        const image=new Image();image.src=url;await image.decode();
        if(image.naturalWidth&&image.naturalHeight&&image.naturalWidth*image.naturalHeight<=16_000_000){
          return await encodeCanvas(image,image.naturalWidth,image.naturalHeight,image.naturalWidth,image.naturalHeight,'photo');
        }
      }finally{URL.revokeObjectURL(url);}
    }catch{/* Safari and some camera drivers do not implement still capture. */}
    finally{if(timer)clearTimeout(timer);}
  }
  return encodeCanvas(video,video.videoWidth,video.videoHeight,video.videoWidth,video.videoHeight,'video');
}

/** Cropping focuses attention but never adds pixels or issues another request by itself. */
export async function cropDescriptionFrame(frame:DescriptionFrame,region:InspectionRegion):Promise<DescriptionFrame>{
  if(region==='full')return frame;
  const image=new Image();image.src=frame.imageBase64;await image.decode();
  const width=image.naturalWidth,height=image.naturalHeight;
  const cropWidth=region==='top'||region==='bottom'?width:Math.ceil(width/2);
  const cropHeight=region==='top'||region==='bottom'?Math.ceil(height/2):height;
  const x=region==='right'?width-cropWidth:region==='center'?Math.floor((width-cropWidth)/2):0;
  const y=region==='bottom'?height-cropHeight:0;
  const canvas=document.createElement('canvas');canvas.width=cropWidth;canvas.height=cropHeight;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('camera_frame_unavailable');
  context.drawImage(image,x,y,cropWidth,cropHeight,0,0,cropWidth,cropHeight);
  try{return await encodeCanvas(canvas,cropWidth,cropHeight,cropWidth,cropHeight,'crop');}
  finally{canvas.width=canvas.height=0;}
}

export type DescriptionResult={description:string;diagnostics?:{requestedModel:string;providerModel:string|null;latencyMs:number;promptTokens:number|null;completionTokens:number|null}};
export async function requestFrameDescription(imageBase64:string,mode:DescriptionMode,question='',signal?:AbortSignal):Promise<DescriptionResult>{
  const response=await fetch('/api/vision/describe-frame',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64,mode,question,consent:true}),signal});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload.code==='string'?payload.code:'unavailable');
  if(typeof payload.description!=='string'||!payload.description.trim())throw new Error('unavailable');
  return {description:payload.description.trim(),diagnostics:payload.diagnostics};
}
