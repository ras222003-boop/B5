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
};
