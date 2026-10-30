import type { VisionConfig } from './config';

export type CameraFailure = 'UNAVAILABLE' | 'NO_CAMERA' | 'DENIED' | 'DEVICE_SETTINGS' | 'IN_USE' | 'FAILED';
export class CameraServiceError extends Error { constructor(readonly code: CameraFailure) { super(code); } }

export function classifyCameraError(error: unknown, previousPermission: PermissionState | 'unavailable' = 'prompt'): CameraFailure {
  const name = error instanceof DOMException ? error.name : (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return previousPermission === 'denied' ? 'DEVICE_SETTINGS' : 'DENIED';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'NO_CAMERA';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'IN_USE';
  if (name === 'NotSupportedError') return 'UNAVAILABLE';
  return 'FAILED';
}

/** Owns a single rear-camera stream and releases it on stop, failure or page exit. */
export class CameraService {
  private stream: MediaStream | null = null;
  private generation = 0;
  constructor(private readonly config: VisionConfig) {}
  async start(video: HTMLVideoElement): Promise<void> {
    this.stop(video);
    const token = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) throw new CameraServiceError('UNAVAILABLE');
    let previousPermission: PermissionState | 'unavailable' = 'prompt';
    try { previousPermission = (await navigator.permissions?.query({ name: 'camera' as PermissionName }))?.state ?? 'prompt'; } catch { /* unsupported permission query */ }
    if(token!==this.generation)throw new CameraServiceError('FAILED');
    // Ask for a real high-resolution stream; the detector is downsampled separately.
    // "ideal" lets Safari select its supported size without inventing pixels.
    const base = { width: { ideal: this.config.photoResolution.width }, height: { ideal: this.config.photoResolution.height }, frameRate: { ideal: this.config.maxFPS, max: this.config.maxFPS } };
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: { ideal: 'environment' } }, audio: false }); }
    catch (error) {
      if(token!==this.generation||(error as {name?:string}|null)?.name==='AbortError')throw new CameraServiceError('FAILED');
      const failure = classifyCameraError(error, previousPermission);
      if (failure === 'NO_CAMERA') throw new CameraServiceError(failure);
      if (failure !== 'FAILED') throw new CameraServiceError(failure);
      try { stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false }); }
      catch (fallback) { throw new CameraServiceError(classifyCameraError(fallback, previousPermission)); }
    }
    if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); throw new CameraServiceError('FAILED'); }
    this.stream = stream;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try { await video.play(); }
    catch { if(token===this.generation)this.stop(video); throw new CameraServiceError('FAILED'); }
    if(token!==this.generation)throw new CameraServiceError('FAILED');
  }
  stop(video?: HTMLVideoElement) {
    this.generation++;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (video) { video.pause(); video.srcObject = null; }
  }
  get active() { return this.stream?.getVideoTracks().some(track => track.readyState === 'live') ?? false; }
  get frameSize() {
    const settings=this.stream?.getVideoTracks()[0]?.getSettings();
    return settings?.width&&settings.height?{width:settings.width,height:settings.height}:null;
  }
}

/** Frames exist only for one OCR call; no blob is persisted or uploaded. */
export async function captureFrame(video: HTMLVideoElement, config: VisionConfig): Promise<{blob:Blob;width:number;height:number} | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, config.inputResolution.width / video.videoWidth, config.inputResolution.height / video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  const width=canvas.width,height=canvas.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  return blob ? {blob,width,height} : null;
}

/** Give the real-time detector a small frame while the camera retains photo pixels. */
export function detectionFrame(video:HTMLVideoElement,config:VisionConfig):HTMLVideoElement|HTMLCanvasElement{
  if(!video.videoWidth||!video.videoHeight)return video;
  const scale=Math.min(1,config.inputResolution.width/video.videoWidth,config.inputResolution.height/video.videoHeight);
  if(scale>=1)return video;
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
  canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('detector_canvas_unavailable');
  context.drawImage(video,0,0,canvas.width,canvas.height);
  return canvas;
}
