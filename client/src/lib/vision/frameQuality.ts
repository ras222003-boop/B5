export type FrameLightStatus = 'LOW_LIGHT' | 'NOT_LOW_LIGHT' | 'UNKNOWN';

/** A negative quality gate only: sufficient brightness does not imply a safe or sharp view. */
export function assessFrameLight(pixels:Uint8ClampedArray):FrameLightStatus {
  if(pixels.length<4||pixels.length%4!==0)return 'UNKNOWN';
  let total=0,valid=0;
  for(let index=0;index<pixels.length;index+=4){
    if(pixels[index+3]<128)continue;
    const brightness=.2126*pixels[index]+.7152*pixels[index+1]+.0722*pixels[index+2];
    total+=brightness;valid++;
  }
  if(valid<pixels.length/8)return 'UNKNOWN';
  return total/valid<38?'LOW_LIGHT':'NOT_LOW_LIGHT';
}

/** Reads a tiny temporary canvas. No image, pixels, or frame is retained. */
export function sampleFrameLight(video:HTMLVideoElement):FrameLightStatus {
  if(video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA)return 'UNKNOWN';
  try{
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return 'UNKNOWN';
    context.drawImage(video,0,0,canvas.width,canvas.height);
    return assessFrameLight(context.getImageData(0,0,canvas.width,canvas.height).data);
  }catch{return 'UNKNOWN';}
}
