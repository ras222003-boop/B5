export interface VisionCapabilities {
  camera:boolean;webGL:boolean;webGPU:boolean;nativeDepth:boolean;
  performanceTier:'LOW'|'STANDARD'|'HIGH';
  segmentationIntervalMs:number;depthIntervalMs:number;
}
export function detectVisionCapabilities():VisionCapabilities {
  const camera=Boolean(navigator.mediaDevices&&window.isSecureContext);
  let webGL=false;
  try{const canvas=document.createElement('canvas');webGL=Boolean(canvas.getContext('webgl2')||canvas.getContext('webgl'));}catch{/* Unavailable. */}
  const webGPU=Boolean((navigator as Navigator&{gpu?:unknown}).gpu);
  const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory??4;
  const cores=navigator.hardwareConcurrency??4;
  const performanceTier=memory>=6&&cores>=6?'HIGH':memory>=3&&cores>=4?'STANDARD':'LOW';
  return {camera,webGL,webGPU,nativeDepth:Boolean(window.BasiraNativeDepth),performanceTier,
    segmentationIntervalMs:performanceTier==='LOW'?4000:performanceTier==='STANDARD'?1800:1200,
    depthIntervalMs:performanceTier==='HIGH'?4000:7500};
}
