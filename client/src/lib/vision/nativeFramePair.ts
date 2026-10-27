import type { MetricDepthMap } from '@shared/vision';

export interface AtomicNativeFrame {
  frameId: string;
  nativeTimestampMs: number;
  /** Age at native bridge handoff, measured against the native frame arrival clock. */
  bridgeAgeMs?: number;
  source: 'ARKIT_DEPTH' | 'ARCORE_DEPTH';
  /** False when the native session is supplying RGB only. */
  depthEnabled?: boolean;
  capturedWithNativeSession: boolean;
  alignedToCameraFrame: boolean;
  rawDepthFresh: boolean;
  cameraWidth: number;
  cameraHeight: number;
  imageBase64: string;
  depthWidth: number;
  depthHeight: number;
  values: number[];
  validCoverage: number;
}
declare global {
  interface Window {
    /** Only installed by a native, allowed-origin WebKit wrapper. */
    BasiraNativeFrames?: {
      start(): Promise<void>;
      setMeterEnabled(enabled:boolean): Promise<void>;
      stop(): Promise<void>;
      nextFrame(): Promise<AtomicNativeFrame | null>;
    };
  }
}

/** RGB continues while the optional depth sensor is switched off. */
export function checkAtomicRgbFrame(frame: AtomicNativeFrame | null): string | null {
  if (!frame) return 'frame_unavailable';
  if (!['ARKIT_DEPTH','ARCORE_DEPTH'].includes(frame.source) || !frame.capturedWithNativeSession) return 'unverified_source';
  const prefix=frame.source==='ARKIT_DEPTH'?'arkit-':'arcore-';
  if (!frame.frameId.startsWith(prefix) || !/^[\d.]+$/.test(frame.frameId.slice(prefix.length)) ||
      !Number.isFinite(frame.nativeTimestampMs) || frame.nativeTimestampMs <= 0) return 'unverified_frame';
  // Frame identity is derived from the native ARFrame timestamp; reject tampered or
  // accidentally joined camera/depth frames even when both carry plausible metadata.
  const labelledFrameTimeMs=Number(frame.frameId.slice(prefix.length))*(prefix==='arkit-'?1000:1/1_000_000);
  if(!Number.isFinite(labelledFrameTimeMs) ||
      Math.abs(labelledFrameTimeMs-frame.nativeTimestampMs)>2) return 'unverified_frame';
  if (!Number.isInteger(frame.cameraWidth) || !Number.isInteger(frame.cameraHeight) ||
      frame.cameraWidth < 300 || frame.cameraHeight < 200 ||
      Math.abs(frame.cameraWidth / frame.cameraHeight - 4 / 3) > 0.03) return 'invalid_camera_geometry';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(frame.imageBase64) ||
      frame.imageBase64.length < 100 || frame.imageBase64.length > 3_000_000) return 'invalid_camera_frame';
  return null;
}

/** The native arrival clock is converted to the page monotonic clock only at handoff. */
export function nativeApproachCapturedAt(frame: AtomicNativeFrame | null, receivedAt: number): number | null {
  const age = frame?.bridgeAgeMs;
  if (checkAtomicRgbFrame(frame) || !Number.isFinite(receivedAt) ||
      !Number.isFinite(age) || age! < 0 || age! > 500) return null;
  return receivedAt - age!;
}

/** Fail closed unless depth belongs to the validated camera image. */
export function checkAtomicFrame(frame: AtomicNativeFrame | null): string | null {
  const rgbError=checkAtomicRgbFrame(frame);
  if(rgbError || !frame)return rgbError;
  if (frame.depthEnabled===false || !frame.alignedToCameraFrame || !frame.rawDepthFresh) return 'unverified_source';
  if (frame.depthWidth !== 64 || frame.depthHeight !== 48 ||
      frame.values?.length !== 64 * 48) return 'invalid_depth_geometry';
  if (!Number.isFinite(frame.validCoverage) || frame.validCoverage < 0.7 || frame.validCoverage > 1) return 'low_depth_coverage';
  if (frame.values.some(n => !Number.isFinite(n) || n < 0 || n > 10)) return 'invalid_depth_values';
  const actualValid = frame.values.filter(n => n > 0).length / frame.values.length;
  if (actualValid < 0.7 || Math.abs(actualValid - frame.validCoverage) > 0.02) return 'unverified_depth_coverage';
  return null;
}

/** Rotates raw sensor-aligned ARKit RGB and depth clockwise 90 degrees together.
 * Rotated canvas dimensions: 480x640; rotated depth dimensions: 48x64.
 * This is the ONLY image-space conversion; CSS must not add an independent crop.
 */
export function rotateNativeDepthClockwise(frame: AtomicNativeFrame, at: number): MetricDepthMap {
  const input = frame.values;
  const oldWidth = frame.depthWidth, oldHeight = frame.depthHeight;
  const values = new Float32Array(oldWidth * oldHeight);
  for (let y = 0; y < oldWidth; y++) {
    for (let x = 0; x < oldHeight; x++) {
      const nativeX = y;
      const nativeY = oldHeight - 1 - x;
      values[y * oldHeight + x] = input[nativeY * oldWidth + nativeX];
    }
  }
  return {
    width: oldHeight,
    height: oldWidth,
    values,
    timestamp: at,
    confidence: frame.validCoverage,
    source: frame.source,
    alignmentVerified: true,
  };
}
