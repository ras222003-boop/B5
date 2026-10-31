import type { VisionDetection, VisionProvider } from "@shared/vision";
import {
  validObjectQualityProfile,
  type ObjectQualityProfile,
} from "@shared/objectQuality";
import { YoloXProvider } from "./qualityProviders";
import { SlimSamObjectMasks } from "./objectMasks";
import { sampleColorFrame, analyzeObjectColor } from "./objectColors";
export async function availableObjectQuality(
  signal?: AbortSignal
): Promise<ObjectQualityProfile | null> {
  const response = await fetch("/api/vision/object-quality/manifest", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  const result = await response.json();
  return result.enabled && validObjectQualityProfile(result.profile)
    ? result.profile
    : null;
}
export async function availableObjectQualityProfiles(
  signal?: AbortSignal
): Promise<ObjectQualityProfile[]> {
  const response = await fetch("/api/vision/object-quality/manifest", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) return [];
  const result = await response.json();
  if (!result.enabled) return [];
  const profiles = Array.isArray(result.profiles)
    ? result.profiles
    : [result.profile];
  return profiles.filter(validObjectQualityProfile);
}
export class ObjectQualityProvider implements VisionProvider {
  readonly usagePolicy = "EXPERIMENTAL_OBJECTS_ONLY" as const;
  private constructor(
    private detector: YoloXProvider,
    private masks: SlimSamObjectMasks | null
  ) {}
  static async open(profile: ObjectQualityProfile, withMasks = false) {
    if (!validObjectQualityProfile(profile))
      throw new Error("object_quality_contract");
    const response = await fetch(
      (profile.id !== "objects-yolox-tiny"
        ? "/api/vision/object-quality/models/" + profile.id
        : "/api/vision/object-quality") +
        (profile.model === "yolox-s"
          ? "/assets/yolox/yolox_s.onnx"
          : "/assets/yolox/yolox_tiny.onnx"),
      { cache: "no-store" }
    );
    if (!response.ok) throw new Error("object_quality_model_unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer()),
      hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        b => b.toString(16).padStart(2, "0")
      ).join("");
    if (hash !== profile.modelSha256)
      throw new Error("object_quality_hash_mismatch");
    const detector = await YoloXProvider.open(bytes, profile.threshold, profile.inputSize ?? 416);
    try {
      // Compile/cache the stateless WASM graph before timestamping a real camera observation.
      // Warm-up outputs are discarded; they are never detections, labels, training or telemetry frames.
      const size=profile.inputSize??416,warmup=new OffscreenCanvas(size,size);
      warmup.getContext('2d')!.fillRect(0,0,size,size);
      try{for(let pass=0;pass<3;pass++)await detector.detect(warmup,performance.now());}
      finally{warmup.width=warmup.height=0;}
      return new ObjectQualityProvider(
        detector,
        withMasks && profile.maskForStills
          ? await SlimSamObjectMasks.open()
          : null
      );
    } catch (error) {
      await detector.close();
      throw error;
    }
  }
  async detect(
    frame: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas,
    timestamp: number
  ): Promise<VisionDetection[]> {
    const pixels = this.masks
        ? sampleColorFrame(frame, timestamp, `quality-${timestamp}`)
        : null,
      detections = await this.detector.detect(frame, timestamp);
    if (!this.masks || !pixels) return detections;
    const masks = await this.masks.segment(pixels, detections);
    return detections.map(d => {
      const proposed = masks.find(m => m.objectId === (d.trackId ?? d.id));
      const color = proposed?.accepted
        ? analyzeObjectColor(pixels, d, detections, proposed.mask)
        : proposed
          ? {
              name: null,
              status: "UNCLEAR" as const,
              reason: "MIXED_OR_OCCLUDED" as const,
              samples: 0,
              supportFraction: 0,
              timestamp,
              stableFrames: 0,
              calibrated: false as const,
            }
          : analyzeObjectColor(pixels, d, detections);
      return {
        ...d,
        color,
        ...(proposed
          ? {
              objectMask: {
                model: "slimsam-q8" as const,
                accepted: proposed.accepted,
                predictedIoU: proposed.score,
                calibrated: false as const,
              },
            }
          : {}),
      };
    });
  }
  async close() {
    await Promise.allSettled([this.detector.close(), this.masks?.close()]);
  }
}
