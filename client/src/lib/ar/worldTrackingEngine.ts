import {reserveBasiraArCamera, releaseBasiraArCamera} from './cameraOwnership';
import {parseTrustedWorldPose,type WorldPose} from './worldScaleResearch';

/** Closed-source SLAM is separate from the 8th Wall MIT package. */
export const BASIRA_BINARY_SDK_CDN = 'https://cdn.jsdelivr.net/npm/@8thwall/engine@0.1.0/dist/xr.js';
export const BASIRA_SLAM_CHUNK_CDN = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr-slam.js';

/**
 * These env flags must be explicitly set in a dedicated non-production test
 * after a documented review of the XR Engine Binary license.
 */
export const BINARY_LAB_ENABLED = import.meta.env.VITE_BASIRA_AR_BINARY_LAB_ENABLED === 'true';
export const BINARY_LICENSE_APPROVED = import.meta.env.VITE_BASIRA_AR_BINARY_LICENSE_APPROVED === 'true';

export interface WorldSandboxPrerequisites {
  labEnabled: boolean;
  licenseApproved: boolean;
  userConsent: boolean;
  secure: boolean;
  camera: boolean;
  webgl: boolean;
}
export function canStartWorldSandbox(p:WorldSandboxPrerequisites):boolean{
  return p.labEnabled && p.licenseApproved && p.userConsent && p.secure && p.camera && p.webgl;
}
type PipelineEvent={name:string;detail?:unknown};
interface PipelineModule{
  name:string;
  listeners?:Array<{event:string;process:(event:PipelineEvent)=>void}>;
  onCameraStatusChange?:(status:{status:string})=>void;
  onUpdate?:(event:{processCpuResult?:{reality?:unknown}})=>void;
  onException?:(error:unknown)=>void;
}
interface WorldXRRuntime{
  XrController:{
    configure:(settings:{disableWorldTracking:false;scale:'absolute';enableWorldPoints:false})=>void;
    pipelineModule:()=>PipelineModule;
  };
  GlTextureRenderer:{pipelineModule:()=>PipelineModule};
  XrConfig:{camera:()=>{BACK:string}};
  addCameraPipelineModules:(items:PipelineModule[])=>void;
  removeCameraPipelineModules:(names:string[])=>void;
  run:(options:{canvas:HTMLCanvasElement;cameraConfig:{direction:string}})=>void;
  stop:()=>void;
}
export interface WorldLabCallbacks{
  onStatus:(message:string)=>void;
  onPose:(pose:WorldPose)=>void;
  onError:(message:string)=>void;
}
export interface WorldLabSession{stop:()=>void}
let binarySdkLoading:Promise<WorldXRRuntime>|null=null;

async function loadReviewedBinaryEngine():Promise<WorldXRRuntime>{
  if(!BINARY_LICENSE_APPROVED || !BINARY_LAB_ENABLED) throw new Error('BINARY_NOT_APPROVED');
  if(!window.isSecureContext) throw new Error('HTTPS_REQUIRED');
  // The MIT labs may have loaded XR8 already. Reload to ensure a clean source
  // instead of silently overwriting a running/previous engine in global scope.
  if(window.XR8) throw new Error('FRESH_PAGE_REQUIRED_AFTER_MIT_LAB');
  if(binarySdkLoading) return binarySdkLoading;
  binarySdkLoading=new Promise<WorldXRRuntime>((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=BASIRA_BINARY_SDK_CDN;
    script.async=true;
    script.crossOrigin='anonymous';
    script.setAttribute('data-preload-chunks','slam: '+BASIRA_SLAM_CHUNK_CDN);
    let done=false;
    const clear=()=>{window.removeEventListener('xrloaded',ready);window.clearTimeout(timer)};
    const ready=()=>{
      if(done||!window.XR8)return;
      done=true;clear();resolve(window.XR8 as unknown as WorldXRRuntime);
    };
    const fail=()=>{
      if(done)return;
      done=true;clear();script.remove();reject(new Error('WORLD_ENGINE_NOT_LOADED'));
    };
    const timer=window.setTimeout(fail,30000);
    window.addEventListener('xrloaded',ready);
    script.addEventListener('error',fail,{once:true});
    script.addEventListener('load',ready,{once:true});
    document.head.appendChild(script);
  }).catch(e=>{binarySdkLoading=null;throw e});
  return binarySdkLoading;
}

export async function startWorldScaleResearchSession(
  canvas:HTMLCanvasElement,
  callbacks:WorldLabCallbacks,
  consent:boolean,
  signal?:AbortSignal,
):Promise<WorldLabSession>{
  if(!canStartWorldSandbox({
    labEnabled:BINARY_LAB_ENABLED,
    licenseApproved:BINARY_LICENSE_APPROVED,
    userConsent:consent,
    secure:window.isSecureContext,
    camera:Boolean(navigator.mediaDevices?.getUserMedia),
    webgl:Boolean(canvas.getContext('webgl')||canvas.getContext('webgl2')),
  })) throw new Error('WORLD_LAB_REQUIREMENTS_NOT_MET');
  if(signal?.aborted) throw new Error('CANCELLED');
  const owner='basira-world-scale-research';
  if(!reserveBasiraArCamera(owner)) throw new Error('CAMERA_IN_USE');
  let runtime:WorldXRRuntime|null=null;
  let names:string[]=[];
  let stopped=false;
  const stop=()=>{
    if(stopped)return;
    stopped=true;
    releaseBasiraArCamera(owner);
    try{runtime?.stop()}catch{/* best effort */}
    if(names.length)try{runtime?.removeCameraPipelineModules(names)}catch{/* best effort */}
  };
  try{
    runtime=await loadReviewedBinaryEngine();
    if(signal?.aborted)throw new Error('CANCELLED');
    runtime.XrController.configure({disableWorldTracking:false,scale:'absolute',enableWorldPoints:false});
    const controller=runtime.XrController.pipelineModule();
    const renderer=runtime.GlTextureRenderer.pipelineModule();
    const listener:PipelineModule={
      name:owner+'-listener',
      listeners:[{event:'reality.trackingstatus',process:event=>{
        if(!stopped&&!signal?.aborted)callbacks.onStatus(String((event.detail as {status?:unknown}|undefined)?.status??'TRACKING_STATUS_UNKNOWN'));
      }}],
      onCameraStatusChange:({status})=>{if(!stopped&&!signal?.aborted)callbacks.onStatus(status)},
      onException:()=>{if(!stopped&&!signal?.aborted)callbacks.onError('WORLD_TRACKING_RUNTIME_ERROR')},
      onUpdate:({processCpuResult})=>{
        if(stopped||signal?.aborted)return;
        const pose=parseTrustedWorldPose(processCpuResult?.reality,Date.now());
        if(pose)callbacks.onPose(pose);
      },
    };
    names=[renderer.name,controller.name,listener.name];
    runtime.addCameraPipelineModules([renderer,controller,listener]);
    runtime.run({canvas,cameraConfig:{direction:runtime.XrConfig.camera().BACK}});
    if(signal?.aborted){stop();throw new Error('CANCELLED')}
    return {stop};
  }catch(e){stop();throw e}
}
