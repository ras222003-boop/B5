import { BASIRA_AR_FEATURES, type BasiraArFeatureId } from './featurePolicy';

export type ArBrowserPreflight = Readonly<{
  secureOrigin: boolean;
  cameraApi: boolean;
  webgl: boolean;
  mobileBrowser: boolean;
  readyForPermissionRequest: boolean;
}>;

export function basiraArPreflight(environment: {
  secureOrigin: boolean;
  cameraApi: boolean;
  webgl: boolean;
  mobileBrowser: boolean;
}): ArBrowserPreflight {
  return {
    ...environment,
    readyForPermissionRequest: environment.secureOrigin && environment.cameraApi && environment.webgl,
  };
}

export function readBasiraArPreflight(): ArBrowserPreflight {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return basiraArPreflight({secureOrigin:false, cameraApi:false, webgl:false, mobileBrowser:false});
  }
  let webgl = false;
  try {
    const canvas = document.createElement('canvas');
    webgl = Boolean(canvas.getContext('webgl') || canvas.getContext('webgl2'));
  } catch { webgl = false; }
  return basiraArPreflight({
    secureOrigin: window.isSecureContext,
    cameraApi: Boolean(navigator.mediaDevices?.getUserMedia),
    webgl,
    mobileBrowser: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  });
}

export type ArDisplayState = 'lab' | 'license-gated' | 'planned';
export function basiraArFeatureState(id: BasiraArFeatureId): ArDisplayState {
  const feature = BASIRA_AR_FEATURES.find(item => item.id === id);
  if (!feature) return 'planned';
  if (feature.license === 'XR_ENGINE_BINARY_RESTRICTED') return 'license-gated';
  return 'lab';
}
