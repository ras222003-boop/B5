export type NavigationPermission = 'location' | 'camera' | 'microphone' | 'bluetooth' | 'motion' | 'nfc' | 'notifications';
export type PermissionState = 'not_requested' | 'allowed' | 'denied' | 'device_settings' | 'unavailable';

/** Browser implementation; native wrappers can supply the same contract later. */
export interface PermissionService {
  status(permission: NavigationPermission): Promise<PermissionState>;
  currentLocation(): Promise<{ latitude: number; longitude: number; accuracy: number }>;
}

const browserName: Partial<Record<NavigationPermission, PermissionName>> = {
  location: 'geolocation', camera: 'camera' as PermissionName,
  microphone: 'microphone' as PermissionName, notifications: 'notifications',
};
const deniedThisSession = new Set<NavigationPermission>();

export const permissionService: PermissionService = {
  async status(permission) {
    if (permission === 'location' && !navigator.geolocation) return 'unavailable';
    if (permission === 'camera' && !navigator.mediaDevices?.getUserMedia) return 'unavailable';
    if (permission === 'microphone' && !navigator.mediaDevices?.getUserMedia) return 'unavailable';
    if (permission === 'bluetooth' && !('bluetooth' in navigator)) return 'unavailable';
    if (permission === 'motion' && typeof DeviceMotionEvent === 'undefined') return 'unavailable';
    if (permission === 'nfc' && !('NDEFReader' in window)) return 'unavailable';
    const key = browserName[permission];
    if (!key || !navigator.permissions?.query) return 'not_requested';
    try {
      const result = await navigator.permissions.query({ name: key });
      return result.state === 'granted' ? 'allowed' : result.state === 'denied' ? (deniedThisSession.has(permission) ? 'denied' : 'device_settings') : 'not_requested';
    } catch { return 'not_requested'; }
  },
  currentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('unavailable')); return; }
      navigator.geolocation.getCurrentPosition(
        position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
        error => { if (error.code === 1) deniedThisSession.add('location'); reject(new Error(error.code === 1 ? 'denied' : 'unavailable')); },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
      );
    });
  },
};
