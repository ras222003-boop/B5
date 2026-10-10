export interface VisionConfig {
  frameAnalysisRate: number;
  maxFPS: number;
  inputResolution: { width: number; height: number };
  detectionThreshold: number;
  depthRefreshRate: number;
  OCRRefreshRate: number;
  alertCooldownMs: number;
  minDepthConfidence: number;
  distanceMeters: { veryClose: number; close: number; medium: number };
  /** Named-object alerts use this value only when a calibrated metric depth source is available. */
  alertDistanceMeters: number;
}

export const DEFAULT_VISION_CONFIG: VisionConfig = {
  frameAnalysisRate: 2,
  maxFPS: 15,
  inputResolution: { width: 640, height: 480 },
  detectionThreshold: 0.45,
  depthRefreshRate: 1000,
  OCRRefreshRate: 8000,
  alertCooldownMs: 5000,
  minDepthConfidence: 0.7,
  distanceMeters: { veryClose: 1, close: 2.5, medium: 5 },
  alertDistanceMeters: 3,
};

export const VISION_ALERT_DISTANCE_OPTIONS = [0.5, 1, 2, 3, 5, 8] as const;
const alertDistanceKey = 'basira-vision-alert-distance-meters-v1';

export function normalizeVisionAlertDistance(value: number) {
  return Number.isFinite(value) && value >= 0.5 && value <= 10 ? Math.round(value * 10) / 10 : DEFAULT_VISION_CONFIG.alertDistanceMeters;
}

export function getVisionAlertDistance() {
  if (typeof localStorage === 'undefined') return DEFAULT_VISION_CONFIG.alertDistanceMeters;
  try { const stored=localStorage.getItem(alertDistanceKey); return stored===null?DEFAULT_VISION_CONFIG.alertDistanceMeters:normalizeVisionAlertDistance(Number(stored)); }
  catch { return DEFAULT_VISION_CONFIG.alertDistanceMeters; }
}

export function saveVisionAlertDistance(value: number) {
  const normalized = normalizeVisionAlertDistance(value);
  try { localStorage.setItem(alertDistanceKey, String(normalized)); } catch { /* Storage may be disabled. */ }
  return normalized;
}

export function visionConfigForAlertDistance(value: number): VisionConfig {
  return { ...DEFAULT_VISION_CONFIG, alertDistanceMeters: normalizeVisionAlertDistance(value) };
}
