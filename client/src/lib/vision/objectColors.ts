import type {
  ObjectColorName,
  ObjectColorObservation,
  VisionDetection,
} from "@shared/vision";
import { COCO_LABELS } from "./cocoLabels";
export interface ColorPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  timestamp: number;
  frameId: string;
}
export interface AlignedObjectMask {
  objectId: string;
  frameId: string;
  width: number;
  height: number;
  data: Uint8Array;
  alignmentVerified: true;
  source: "INSTANCE_SEGMENTATION";
}
export const COLOR_NAMES: Record<ObjectColorName, [string, string]> = {
  red: ["أحمر", "حمراء"],
  blue: ["أزرق", "زرقاء"],
  green: ["أخضر", "خضراء"],
  yellow: ["أصفر", "صفراء"],
  orange: ["برتقالي", "برتقالية"],
  purple: ["بنفسجي", "بنفسجية"],
  pink: ["وردي", "وردية"],
  black: ["أسود", "سوداء"],
  white: ["أبيض", "بيضاء"],
  gray: ["رمادي", "رمادية"],
  brown: ["بني", "بنية"],
  multicolor: ["متعدد الألوان", "متعددة الألوان"],
};
export function colorWord(color: ObjectColorName, feminine = false) {
  return COLOR_NAMES[color][feminine ? 1 : 0];
}
export function colorDescription(detection: VisionDetection) {
  const color = detection.color;
  if (!color) return "";
  if (!color.name)
    return color.reason === "LOW_LIGHT"
      ? "اللون غير واضح بسبب ضعف الإضاءة"
      : color.reason === "CHANGING"
        ? "اللون غير واضح؛ يجري التحقق من تغيره"
        : "اللون غير واضح";
  return `${colorWord(color.name, COCO_LABELS[detection.cocoClass ?? ""]?.feminine)}${color.status === "ESTIMATED" ? " (تقدير من الصورة)" : ""}`;
}
export function sampleColorFrame(
  source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas,
  timestamp: number,
  frameId: string
): ColorPixels | null {
  const w = "videoWidth" in source ? source.videoWidth : source.width,
    h = "videoHeight" in source ? source.videoHeight : source.height;
  if (!w || !h) return null;
  const scale = Math.min(1, 320 / Math.max(w, h)),
    width = Math.max(1, Math.round(w * scale)),
    height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 0;
  return { width, height, data, timestamp, frameId };
}
export function hsvLabel(r: number, g: number, b: number): ObjectColorName {
  // Separate dark neutral surfaces from saturated dark colours in perceptual space.
  const [lightness, a, z] = lab([r, g, b]),
    chroma = Math.hypot(a, z);
  if (chroma < 18 && lightness < 30) return "black";
  if (chroma < 12) return lightness > 85 ? "white" : "gray";
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min,
    s = max ? delta / max : 0;
  let h =
    delta === 0
      ? 0
      : max === r
        ? 60 * (((g - b) / delta) % 6)
        : max === g
          ? 60 * ((b - r) / delta + 2)
          : 60 * ((r - g) / delta + 4);
  if (h < 0) h += 360;
  if (max < 0.2) return "black";
  if (s < 0.16) return max > 0.84 ? "white" : "gray";
  if (h >= 15 && h < 65 && max < 0.65) return "brown";
  if (h < 15 || h >= 345) return max > 0.7 && s < 0.55 ? "pink" : "red";
  if (h < 42) return "orange";
  if (h < 68) return "yellow";
  if (h < 170) return "green";
  if (h < 260) return "blue";
  if (h < 300) return "purple";
  return "pink";
}
/** CIELAB distance is used for contamination checks, not as calibrated confidence. */
function lab(rgb: number[]): number[] {
  const c = rgb.map(v => {
      v /= 255;
      return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
    }),
    [r, g, b] = c;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047),
    y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b),
    z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const mean = (pixels: number[][]) =>
  pixels.reduce((v, p) => v.map((n, i) => n + p[i] / pixels.length), [0, 0, 0]);
const unclear = (
  frame: ColorPixels,
  reason: ObjectColorObservation["reason"],
  samples = 0
): ObjectColorObservation => ({
  name: null,
  status: "UNCLEAR",
  reason,
  samples,
  supportFraction: 0,
  timestamp: frame.timestamp,
  stableFrames: 0,
  calibrated: false,
});
export function analyzeObjectColor(
  frame: ColorPixels,
  detection: VisionDetection,
  others: readonly VisionDetection[] = [],
  mask?: AlignedObjectMask
): ObjectColorObservation {
  const { width, height, data } = frame,
    b = detection.boundingBox;
  if (
    !width ||
    !height ||
    data.length !== width * height * 4 ||
    ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
    b.width <= 0 ||
    b.height <= 0
  )
    return unclear(frame, "TOO_SMALL");
  const aligned =
    mask?.alignmentVerified === true &&
    mask.source === "INSTANCE_SEGMENTATION" &&
    mask.frameId === frame.frameId &&
    mask.objectId === (detection.trackId ?? detection.id) &&
    mask.width === width &&
    mask.height === height &&
    mask.data.length === width * height;
  if (mask && !aligned) return unclear(frame, "MIXED_OR_OCCLUDED");
  let bright = 0,
    total = 0;
  for (let i = 0; i < data.length; i += 4 * 17) {
    if (Math.max(data[i], data[i + 1], data[i + 2]) > 60) bright++;
    total++;
  }
  if (!total || bright / total < 0.08) return unclear(frame, "LOW_LIGHT");
  const inside = (x: number, y: number, box: VisionDetection["boundingBox"]) =>
    x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  const core: number[][] = [],
    ring: number[][] = [];
  let blocked = 0,
    attempted = 0;
  const pad = aligned ? 0 : 0.2,
    x0 = Math.max(0, Math.floor((b.x + pad * b.width) * width)),
    x1 = Math.min(width, Math.ceil((b.x + (1 - pad) * b.width) * width));
  const y0 = Math.max(0, Math.floor((b.y + pad * b.height) * height)),
    y1 = Math.min(height, Math.ceil((b.y + (1 - pad) * b.height) * height));
  if (x1 - x0 < 5 || y1 - y0 < 5) return unclear(frame, "TOO_SMALL");
  const stride = Math.max(
    1,
    Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / 1500))
  );
  for (let y = y0; y < y1; y += stride)
    for (let x = x0; x < x1; x += stride) {
      if (aligned && !mask!.data[y * width + x]) continue;
      attempted++;
      if (
        !aligned &&
        others.some(
          other =>
            other.id !== detection.id &&
            inside((x + 0.5) / width, (y + 0.5) / height, other.boundingBox)
        )
      ) {
        blocked++;
        continue;
      }
      const i = (y * width + x) * 4;
      if (data[i + 3] < 250) continue;
      core.push([data[i], data[i + 1], data[i + 2]]);
    }
  if (core.length < 24)
    return unclear(
      frame,
      blocked ? "MIXED_OR_OCCLUDED" : "TOO_SMALL",
      core.length
    );
  if (blocked / attempted > 0.45)
    return unclear(frame, "MIXED_OR_OCCLUDED", core.length);
  let clipped = 0,
    dark = 0;
  const counts = new Map<ObjectColorName, number>();
  for (const p of core) {
    const max = Math.max(...p),
      min = Math.min(...p);
    clipped += Number(max >= 250 && max - min < 12);
    dark += Number(max < 8);
    const name = hsvLabel(...(p as [number, number, number]));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (clipped / core.length > 0.2 || dark / core.length > 0.65)
    return unclear(frame, "CLIPPED_OR_REFLECTIVE", core.length);
  const ranked = Array.from(counts).sort((a, b) => b[1] - a[1]),
    support = ranked[0][1] / core.length;
  // Compare to pixels outside the box. Same-colour backgrounds invalidate the box-only estimate.
  if (!aligned) {
    for (
      let y = Math.max(0, Math.floor((b.y - 0.08 * b.height) * height));
      y < Math.min(height, Math.ceil((b.y + 1.08 * b.height) * height));
      y += 3
    )
      for (
        let x = Math.max(0, Math.floor((b.x - 0.08 * b.width) * width));
        x < Math.min(width, Math.ceil((b.x + 1.08 * b.width) * width));
        x += 3
      ) {
        if (inside(x / width, y / height, b)) continue;
        const i = (y * width + x) * 4;
        ring.push([data[i], data[i + 1], data[i + 2]]);
      }
    if (ring.length < 12)
      return unclear(frame, "BACKGROUND_AMBIGUOUS", core.length);
    const a = lab(mean(core)),
      r = lab(mean(ring)),
      distance = Math.hypot(...a.map((n, i) => n - r[i]));
    const same =
      ring.filter(
        p => hsvLabel(...(p as [number, number, number])) === ranked[0][0]
      ).length / ring.length;
    if (distance < 15 || same > 0.65)
      return unclear(frame, "BACKGROUND_AMBIGUOUS", core.length);
  }
  let name = ranked[0][0];
  if (support < 0.72) {
    if (
      ranked.length >= 2 &&
      ranked[0][1] / core.length >= 0.28 &&
      ranked[1][1] / core.length >= 0.28 &&
      ranked[0][1] + ranked[1][1] >= core.length * 0.82
    )
      name = "multicolor";
    else return unclear(frame, "MIXED_OR_OCCLUDED", core.length);
  }
  return {
    name,
    status: aligned ? "MASK_SUPPORTED" : "ESTIMATED",
    reason: aligned ? "ALIGNED_INSTANCE_MASK" : "BOX_ESTIMATE",
    supportFraction: support,
    samples: core.length,
    timestamp: frame.timestamp,
    stableFrames: 1,
    calibrated: false,
  };
}
/** No stale colour survives invalid pixels or ambiguous identity; changes require three new frames. */
export class ObjectColorTracker {
  private tracks = new Map<
    string,
    { name: ObjectColorName | null; count: number; at: number }
  >();
  reset() {
    this.tracks.clear();
  }
  update(
    detection: VisionDetection,
    observation: ObjectColorObservation
  ): ObjectColorObservation {
    const id = detection.trackId;
    if (!id || detection.tracking?.state !== "TRACKED") {
      if (id) this.tracks.delete(id);
      return {
        ...observation,
        name: null,
        status: "UNCLEAR",
        reason: observation.name ? "WARMING_UP" : observation.reason,
        stableFrames: 0,
      };
    }
    for (const [key, value] of Array.from(this.tracks))
      if (observation.timestamp - value.at > 1500) this.tracks.delete(key);
    const previous = this.tracks.get(id);
    if (!observation.name) {
      this.tracks.delete(id);
      return observation;
    }
    if (previous && observation.timestamp <= previous.at)
      return {
        ...observation,
        name: null,
        status: "UNCLEAR",
        reason: "WARMING_UP",
        stableFrames: 0,
      };
    const count = previous?.name === observation.name ? previous.count + 1 : 1;
    this.tracks.set(id, {
      name: observation.name,
      count,
      at: observation.timestamp,
    });
    return count >= 3
      ? { ...observation, stableFrames: count }
      : {
          ...observation,
          name: null,
          status: "UNCLEAR",
          reason:
            previous && previous.name !== observation.name
              ? "CHANGING"
              : "WARMING_UP",
          stableFrames: count,
        };
  }
}
const colorSpeechKey = "basira-object-color-speech-v1";
export function getColorSpeechEnabled() {
  try {
    return localStorage.getItem(colorSpeechKey) !== "false";
  } catch {
    return true;
  }
}
export function saveColorSpeechEnabled(value: boolean) {
  try {
    localStorage.setItem(colorSpeechKey, String(value));
  } catch {}
  return value;
}
