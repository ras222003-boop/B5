import { BASIRA_IMAGE_TARGET_NAME, parseLandmarkEvent, type LandmarkDetection } from './imageTargetLandmarks';

/**
 * Experimental MIT engine: image targets only, NO SLAM/world tracking,
 * no depth measurement and no automatic walking guidance.
 *
 * 8th Wall 0.1.0 is a pre-release. Pin it and do not load until the user
 * explicitly starts the opt-in lab. Replace CDN with reviewed self-hosting
 * before production approval.
 *
 * API: https://8thwall.org/docs/engine/overview
 */
export const BASIRA_8THWALL_MIT_CDN =
  'https://cdn.jsdelivr.net/npm/@8thwall/engine@0.1.0/dist/xr.js';
export const BASIRA_MARKER_JSON_URL = '/ar/targets/basira-lab.json';

interface XrPipelineListenerEvent {
  name: string;
  detail?: unknown;
}
interface XrPipelineModule {
  name: string;
  listeners?: Array<{event: string; process: (event: XrPipelineListenerEvent) => void}>;
  onCameraStatusChange?: (event: { status: string }) => void;
  onException?: (error: unknown) => void;
}
interface XrRuntime {
  XrController: {
    configure: (settings: {disableWorldTracking: true; imageTargetData: unknown[]}) => void;
    pipelineModule: () => XrPipelineModule;
  };
  GlTextureRenderer: { pipelineModule: () => XrPipelineModule };
  XrConfig: { camera: () => { BACK: string } };
  addCameraPipelineModules: (modules: XrPipelineModule[]) => void;
  removeCameraPipelineModules: (names: string[]) => void;
  run: (options: {canvas: HTMLCanvasElement; cameraConfig: {direction: string}}) => void;
  stop: () => void;
}

declare global {
  interface Window { XR8?: XrRuntime }
}

let sdkLoading: Promise<XrRuntime> | null = null;
let activeSession = false;

export function loadBasiraImageTargetEngine(): Promise<XrRuntime> {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return Promise.reject(new Error('secure_origin_required'));
  }
  if (window.XR8) return Promise.resolve(window.XR8);
  if (sdkLoading) return sdkLoading;

  sdkLoading = new Promise<XrRuntime>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = BASIRA_8THWALL_MIT_CDN;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-preload-chunks', 'slam'); // MIT engine's compatibility label for image-target processing
    let finished = false;
    const clear = () => {
      window.removeEventListener('xrloaded', ready);
      window.clearTimeout(timeout);
    };
    const ready = () => {
      if (!window.XR8 || finished) return;
      finished = true;
      clear();
      resolve(window.XR8);
    };
    const fail = (reason: string) => {
      if (finished) return;
      finished = true;
      clear();
      script.remove();
      reject(new Error(reason));
    };
    const timeout = window.setTimeout(() => fail('engine_timeout'), 25000);
    window.addEventListener('xrloaded', ready);
    script.addEventListener('load', ready, {once:true});
    script.addEventListener('error', () => fail('engine_load_failed'), {once:true});
    document.head.appendChild(script);
  }).catch(error => {
    sdkLoading = null;
    throw error;
  });
  return sdkLoading;
}

interface ImageTargetManifest {
  name: string;
  type: string;
  imagePath: string;
  properties: {
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
  };
}

export function validateLabImageTargetManifest(input: unknown): input is ImageTargetManifest {
  if (!input || typeof input !== 'object') return false;
  const manifest = input as Partial<ImageTargetManifest>;
  const p = manifest.properties;
  return manifest.name === BASIRA_IMAGE_TARGET_NAME &&
    manifest.type === 'PLANAR' &&
    manifest.imagePath === '/ar/targets/basira-lab-marker.svg' &&
    Boolean(p && p.width === 480 && p.height === 640 &&
      p.originalWidth === 480 && p.originalHeight === 640);
}

export interface BasiraImageTargetCallbacks {
  onStatus: (status: 'requesting' | 'hasVideo' | 'scanning' | 'failed') => void;
  onDetection: (detection: LandmarkDetection) => void;
  onError: (message: string) => void;
}

export interface BasiraImageTargetSession {
  stop: () => void;
}

export async function startBasiraImageTargetSession(
  canvas: HTMLCanvasElement,
  callbacks: BasiraImageTargetCallbacks,
): Promise<BasiraImageTargetSession> {
  if (activeSession) throw new Error('camera_session_busy');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('camera_unavailable');
  }
  // Reserve the single shared browser XR engine before asynchronous startup.
  activeSession = true;
  let xr8: XrRuntime | null = null;
  let names: string[] = [];
  try {
    const response = await fetch(BASIRA_MARKER_JSON_URL, {cache:'no-store'});
    if (!response.ok) throw new Error('marker_manifest_unavailable');
    const manifest: unknown = await response.json();
    if (!validateLabImageTargetManifest(manifest)) throw new Error('marker_manifest_invalid');
    xr8 = await loadBasiraImageTargetEngine();

    const controller = xr8.XrController.pipelineModule();
    const renderer = xr8.GlTextureRenderer.pipelineModule();
    const listener: XrPipelineModule = {
      name: 'basira-image-target-lab',
      listeners: [
        {event:'reality.imagescanning',process:() => callbacks.onStatus('scanning')},
        {event:'reality.imagefound',process:event => {
          const detection = parseLandmarkEvent(event, 'found', Date.now());
          if (detection) callbacks.onDetection(detection);
        }},
        {event:'reality.imagelost',process:event => {
          const detection = parseLandmarkEvent(event, 'lost', Date.now());
          if (detection) callbacks.onDetection(detection);
        }},
      ],
      onCameraStatusChange: ({status}) => {
        if (status === 'failed') callbacks.onStatus('failed');
        else if (status === 'hasVideo' || status === 'requesting') callbacks.onStatus(status);
      },
      onException: () => callbacks.onError('engine_runtime_error'),
    };
    names = [controller.name, renderer.name, listener.name];
    xr8.XrController.configure({
      disableWorldTracking: true,
      imageTargetData: [manifest],
    });
    xr8.addCameraPipelineModules([controller, renderer, listener]);
    xr8.run({canvas, cameraConfig:{direction:xr8.XrConfig.camera().BACK}});
    return {
      stop: () => {
        if (!activeSession) return;
        activeSession = false;
        try { xr8?.stop(); } finally {
          try { xr8?.removeCameraPipelineModules(names); } catch { /* stopping is best effort */ }
        }
      },
    };
  } catch (error) {
    activeSession = false;
    try { xr8?.stop(); } catch { /* permission may have been denied */ }
    if (names.length) {
      try { xr8?.removeCameraPipelineModules(names); } catch { /* best effort */ }
    }
    throw error;
  }
}
