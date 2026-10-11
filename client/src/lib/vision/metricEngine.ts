import type { MetricDepthMap, MetricDepthProvider } from '@shared/vision';

/**
 * A metric source is usable ONLY if depth pixels are attested to be aligned to
 * the same RGB video frame used by Basira's detector. A WebXR world pose or
 * 8th Wall Absolute Scale cannot satisfy this camera-pixel contract.
 *
 * The bridge must be installed by a trusted native shell or an independently
 * validated same-camera implementation; ordinary iOS Safari/Chrome expose
 * neither ARKit LiDAR nor this bridge.
 */
export interface AlignedMetricFrame {
  width: number;
  height: number;
  values: number[];
  confidence: number;
  source: 'ARKIT_DEPTH' | 'LIDAR' | 'ARCORE_DEPTH' | 'DEPTH_SENSOR';
  frameTimestampMs: number;
  alignedToVideo: true;
}
export interface BasiraVerifiedMetricBridge {
  getAlignedDepth(videoFrameTimestampMs: number): Promise<AlignedMetricFrame | null>;
}

/** Never accept unchecked WebXR/SLAM scales as camera pixel-to-object depth. */
export function validateAlignedMetricFrame(raw: unknown, requestedTimestampMs: number): MetricDepthMap | null {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(requestedTimestampMs)) return null;
  const data = raw as Partial<AlignedMetricFrame>;
  const {width, height, confidence, frameTimestampMs, source, values} = data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! < 8 || height! < 8 ||
      width! * height! > 300_000 || !Array.isArray(values) || values.length !== width! * height! ||
      data.alignedToVideo !== true || typeof frameTimestampMs !== 'number' ||
      !Number.isFinite(frameTimestampMs) || Math.abs(frameTimestampMs - requestedTimestampMs) > 100 ||
      typeof confidence !== 'number' || confidence < .75 || confidence > 1 ||
      !['ARKIT_DEPTH', 'LIDAR', 'ARCORE_DEPTH', 'DEPTH_SENSOR'].includes(String(source))) return null;
  const pixels = new Float32Array(values.length);
  let valid = 0;
  for (let i = 0; i < values.length; i++) {
    const reading = values[i];
    if (typeof reading === 'number' && Number.isFinite(reading) && reading >= .2 && reading <= 10) {
      pixels[i] = reading;
      valid++;
    } else {
      pixels[i] = NaN;
    }
  }
  if (valid / values.length < .60) return null;
  return {
    width: width!, height: height!, values: pixels,
    confidence: confidence!, source: source as AlignedMetricFrame['source'],
    timestamp: frameTimestampMs, alignmentVerified: true,
  };
}

export class VerifiedMetricDepthProvider implements MetricDepthProvider {
  constructor(private readonly bridge: BasiraVerifiedMetricBridge) {}
  async capture(timestamp: number): Promise<MetricDepthMap | null> {
    return validateAlignedMetricFrame(await this.bridge.getAlignedDepth(timestamp), timestamp);
  }
  async close() { /* Underlying camera is owned by the native host. */ }
}

export type MetricStatus = 'UNAVAILABLE' | 'WAITING' | 'LIVE' | 'REJECTED';
export interface MetricDiagnostic {
  status: MetricStatus;
  source: MetricDepthMap['source'] | null;
}
export function metricDiagnostic(
  map: MetricDepthMap | null,
  now: number,
  providerPresent: boolean,
): MetricDiagnostic {
  if (!providerPresent) return {status: 'UNAVAILABLE', source: null};
  if (!map) return {status: 'WAITING', source: null};
  if (map.alignmentVerified !== true || map.confidence < .75 ||
      !Number.isFinite(now) || !Number.isFinite(map.timestamp) ||
      Math.abs(now - map.timestamp) > 500) return {status:'REJECTED',source:null};
  return {status:'LIVE',source:map.source};
}
