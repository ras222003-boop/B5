export type DescriptionMode='brief'|'detailed'|'read_text'|'ask';

/** Capture a still from the same live source the detector sees. Never persist it. */
export async function captureDescriptionFrame(video:HTMLVideoElement,nativeCanvas:HTMLCanvasElement|null,useNative:boolean):Promise<string>{
  const source=useNative?nativeCanvas:video;
  const width=useNative?nativeCanvas?.width:video.videoWidth;
  const height=useNative?nativeCanvas?.height:video.videoHeight;
  if(!source||!width||!height||(!useNative&&video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA))throw new Error('camera_frame_unavailable');
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,2048/Math.max(width,height));
  canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  const context=canvas.getContext('2d');
  if(!context)throw new Error('camera_frame_unavailable');
  context.drawImage(source,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
  canvas.width=canvas.height=0;
  if(!blob||blob.size<128||blob.size>8*1024*1024)throw new Error('camera_frame_unavailable');
  return await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('camera_frame_unavailable'));
    reader.onerror=()=>reject(new Error('camera_frame_unavailable'));
    reader.readAsDataURL(blob);
  });
}

export async function requestFrameDescription(imageBase64:string,mode:DescriptionMode,question='',signal?:AbortSignal):Promise<string>{
  const response=await fetch('/api/vision/describe-frame',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64,mode,question,consent:true}),signal});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload.code==='string'?payload.code:'unavailable');
  if(typeof payload.description!=='string'||!payload.description.trim())throw new Error('unavailable');
  return payload.description.trim();
}
