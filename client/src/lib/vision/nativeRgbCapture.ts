import {checkAtomicRgbFrame, nativeApproachCapturedAt} from './nativeFramePair';
import {freshTimestamp} from './perception';

/** RGB transport only. Never exposes native depth to an experimental detector. */
export async function captureNativeRgb(
  bridge: NonNullable<Window['BasiraNativeFrames']>,
  canvas: HTMLCanvasElement,
  previousFrameId: string,
): Promise<{frameId:string;capturedAt:number;wallTime:number}|null> {
  const frame=await bridge.nextFrame();
  const receivedAt=performance.now();
  if(!frame||checkAtomicRgbFrame(frame)||frame.frameId===previousFrameId)return null;
  const capturedAt=nativeApproachCapturedAt(frame,receivedAt);
  if(capturedAt===null)return null;
  const image=new Image();
  image.src='data:image/jpeg;base64,'+frame.imageBase64;
  await image.decode();
  // Metadata alone cannot establish the decoded image geometry. Do not stretch
  // a portrait, corrupt or unexpectedly large image into the sensor transform.
  if(!freshTimestamp(capturedAt,performance.now())||
      !Number.isInteger(image.naturalWidth)||!Number.isInteger(image.naturalHeight)||
      image.naturalWidth<300||image.naturalHeight<200||
      image.naturalWidth>640||image.naturalHeight>480||
      Math.abs(image.naturalWidth/image.naturalHeight-frame.cameraWidth/frame.cameraHeight)>.03)return null;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw Error('native_canvas_unavailable');
  canvas.width=480;canvas.height=640;
  context.save();context.translate(480,0);context.rotate(Math.PI/2);
  context.drawImage(image,0,0,640,480);context.restore();
  return {frameId:frame.frameId,capturedAt,wallTime:Date.now()-(performance.now()-capturedAt)};
}
