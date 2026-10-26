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
  const feminine = COCO_LABELS[detection.cocoClass ?? ""]?.feminine;
  const components =
    color.name === "multicolor" && color.components?.length
      ? ` (${color.components.map(c => colorWord(c)).join(" و")})`
      : "";
  const shade = color.shade
    ? color.shade === "LIGHT"
      ? feminine
        ? " فاتحة"
        : " فاتح"
      : feminine
        ? " داكنة"
        : " داكن"
    : "";
  return `${colorWord(color.name, feminine)}${shade}${components}${color.status === "ESTIMATED" ? " (تقدير من الصورة)" : color.status === "MASK_SUPPORTED" ? " (من قناع آلي تجريبي)" : ""}`;
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
  const canvas =
    typeof document === "undefined"
      ? new OffscreenCanvas(width, height)
      : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
      colorSpace: "srgb",
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data, timestamp, frameId };
  } catch {
    return null;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
export { hsvLabel } from "./objectColorSpaces";
export { analyzeObjectColor } from "./objectColorEstimator";

/** Four-observation identity-bound window. Repetition is temporal evidence, never calibration. */
export class ObjectColorTracker {
  private tracks = new Map<
    string,
    {
      identity: string;
      at: number;
      box: VisionDetection["boundingBox"];
      history: { name: string | null; shade?: "LIGHT" | "DARK"; at: number }[];
    }
  >();
  reset() {
    this.tracks.clear();
  }
  update(
    d: VisionDetection,
    o: ObjectColorObservation
  ): ObjectColorObservation {
    const id = d.trackId,
      unclear = (reason: ObjectColorObservation["reason"]) => ({
        ...o,
        name: null,
        status: "UNCLEAR" as const,
        reason,
        stableFrames: 0,
        calibrated: false as const,
      });
    if (
      !id ||
      d.tracking?.state !== "TRACKED" ||
      !Number.isFinite(o.timestamp) ||
      o.timestamp < d.timestamp
    ) {
      if (id) this.tracks.delete(id);
      return unclear(o.name ? "WARMING_UP" : o.reason);
    }
    for (const [key, t] of Array.from(this.tracks))
      if (o.timestamp - t.at > 1500) this.tracks.delete(key);
    const identity = d.cocoClass ?? d.type;
    let previous = this.tracks.get(id);
    if (previous && o.timestamp <= previous.at) return unclear("WARMING_UP");
    if (previous) {
      const a = previous.box,
        b = d.boundingBox,
        intersection =
          Math.max(
            0,
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          ) *
          Math.max(
            0,
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          ),
        union = a.width * a.height + b.width * b.height - intersection;
      if (
        previous.identity !== identity ||
        intersection / Math.max(0.00001, union) < 0.1
      )
        previous = undefined;
    }
    if (
      !o.name &&
      [
        "LOW_LIGHT",
        "CLIPPED_OR_REFLECTIVE",
        "TOO_SMALL",
        "MIXED_OR_OCCLUDED",
      ].includes(o.reason)
    ) {
      this.tracks.delete(id);
      return o;
    }
    const signature = o.name
      ? [o.name, ...(o.components ?? []).slice().sort()].join(":")
      : null;
    const history = [
      ...(previous?.history ?? []),
      { name: signature, shade: o.shade, at: o.timestamp },
    ].slice(-4);
    this.tracks.set(id, {
      identity,
      at: o.timestamp,
      box: { ...d.boundingBox },
      history,
    });
    while (this.tracks.size > 64)
      this.tracks.delete(this.tracks.keys().next().value!);
    const votes = signature ? history.filter(v => v.name === signature) : [],
      temporal = {
        windowSamples: history.length,
        agreeingSamples: votes.length,
        agreement: votes.length / history.length,
        spanMs: history.at(-1)!.at - history[0].at,
      };
    if (!signature) return { ...o, temporal };
    if (votes.length < 3 || temporal.agreement < 0.75 || temporal.spanMs < 250)
      return {
        ...unclear(
          previous?.history.some(v => v.name && v.name !== signature)
            ? "CHANGING"
            : "WARMING_UP"
        ),
        stableFrames: votes.length,
        temporal,
      };
    const result = { ...o, stableFrames: votes.length, temporal };
    if (votes.filter(v => v.shade === o.shade).length < 3) delete result.shade;
    return result;
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
