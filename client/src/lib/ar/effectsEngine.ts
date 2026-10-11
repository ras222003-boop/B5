import { loadBasiraImageTargetEngine } from './imageTargetEngine';
import { reserveBasiraArCamera, releaseBasiraArCamera } from './cameraOwnership';
import {
  BASIRA_EFFECT_EVENT_MAP, parseBasiraEffectEvent,
  type EffectKind, type BasiraEffectObservation,
} from './effectEvents';

/**
 * Adds 8th Wall MIT FaceController / LayersController to a sandbox.
 * This is NOT identity recognition, obstacle detection, depth measurement,
 * a camera feed recording, or an automatic mobility guide.
 *
 * FaceController and LayersController are mutually exclusive.
 * SDK remains unloaded until a user explicitly taps Start.
 */
interface PipelineEvent {name: string; detail?: unknown}
interface PipelineModule {
  name: string;
  listeners?: Array<{event: string; process: (event: PipelineEvent) => void}>;
  onCameraStatusChange?: (event: {status: string}) => void;
  onException?: (error: unknown) => void;
}
interface ArEffectsRuntime {
  FaceController: {
    configure: (settings: {maxDetections: number; enableEars: boolean}) => void;
    pipelineModule: () => PipelineModule;
  };
  LayersController: {
    configure: (settings: {layers: {sky: {invertLayerMask: boolean; edgeSmoothness: number}}}) => void;
    pipelineModule: () => PipelineModule;
  };
  GlTextureRenderer: {pipelineModule: () => PipelineModule};
  XrConfig: {camera: () => {FRONT: string; BACK: string}};
  addCameraPipelineModules: (modules: PipelineModule[]) => void;
  removeCameraPipelineModules: (names: string[]) => void;
  run: (options: {canvas: HTMLCanvasElement; cameraConfig: {direction: string}}) => void;
  stop: () => void;
}

export interface BasiraEffectsCallbacks {
  onObservation: (event: BasiraEffectObservation) => void;
  onCameraStatus: (status: string) => void;
  onError: (error: string) => void;
}

export interface BasiraEffectsSession {stop: () => void}

export async function startBasiraEffectsSession(
  kind: EffectKind,
  canvas: HTMLCanvasElement,
  callbacks: BasiraEffectsCallbacks,
  signal?: AbortSignal,
): Promise<BasiraEffectsSession> {
  if (!window.isSecureContext) throw new Error('HTTPS_REQUIRED');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNAVAILABLE');
  if (signal?.aborted) throw new Error('CANCELLED');

  const owner = 'basira-effect-' + kind;
  if (!reserveBasiraArCamera(owner)) throw new Error('CAMERA_IN_USE');
  let xr: ArEffectsRuntime | null = null;
  let moduleNames: string[] = [];
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    releaseBasiraArCamera(owner);
    try { xr?.stop(); } catch { /* camera may have been denied */ }
    if (moduleNames.length) {
      try { xr?.removeCameraPipelineModules(moduleNames); } catch { /* best effort */ }
    }
  };

  try {
    const engine = await loadBasiraImageTargetEngine();
    if (signal?.aborted) throw new Error('CANCELLED');
    xr = engine as unknown as ArEffectsRuntime;
    const renderer = xr.GlTextureRenderer.pipelineModule();
    const controller = kind === 'face'
      ? xr.FaceController.pipelineModule()
      : xr.LayersController.pipelineModule();

    if (kind === 'face') {
      xr.FaceController.configure({maxDetections: 1, enableEars: false});
    } else {
      xr.LayersController.configure({layers: {sky: {invertLayerMask: false, edgeSmoothness: 0.5}}});
    }

    const listener: PipelineModule = {
      name: owner + '-listener',
      listeners: Object.keys(BASIRA_EFFECT_EVENT_MAP[kind]).map(event => ({
        event,
        process: incoming => {
          if (stopped || signal?.aborted) return;
          const observation = parseBasiraEffectEvent(kind, incoming.name, incoming.detail, Date.now());
          if (observation) callbacks.onObservation(observation);
        },
      })),
      onCameraStatusChange: event => {
        if (!stopped && !signal?.aborted) callbacks.onCameraStatus(event.status);
      },
      onException: () => {
        if (!stopped && !signal?.aborted) callbacks.onError('XR_ENGINE_RUNTIME_FAILURE');
      },
    };
    moduleNames = [renderer.name, controller.name, listener.name];

    if (signal?.aborted) throw new Error('CANCELLED');
    xr.addCameraPipelineModules([renderer, controller, listener]);
    xr.run({
      canvas,
      cameraConfig: {direction: kind === 'face' ? xr.XrConfig.camera().FRONT : xr.XrConfig.camera().BACK},
    });
    if (signal?.aborted) {
      stop();
      throw new Error('CANCELLED');
    }
    return {stop};
  } catch (error) {
    stop();
    throw error;
  }
}
