import {CameraServiceError,type CameraFailure} from './camera';

/** Native permission/session errors must not be presented as model failures. */
export function visionStartupFailure(error:unknown):{
  code:CameraFailure|'MODEL';source:'WEB_CAMERA'|'NATIVE_CAMERA'|'MODEL';retry:boolean;
}{
  if(error instanceof CameraServiceError)return{code:error.code,source:'WEB_CAMERA',retry:false};
  const message=error instanceof Error?error.message:typeof error==='string'?error:'';
  if(/\bcamera_denied\b/.test(message))return{code:'DENIED',source:'NATIVE_CAMERA',retry:false};
  if(/\b(camera_stopped|camera_permission_required)\b/.test(message))return{code:'FAILED',source:'NATIVE_CAMERA',retry:true};
  if(/\b(camera_unavailable|arkit_unsupported)\b/.test(message))return{code:'UNAVAILABLE',source:'NATIVE_CAMERA',retry:false};
  return{code:'MODEL',source:'MODEL',retry:false};
}
