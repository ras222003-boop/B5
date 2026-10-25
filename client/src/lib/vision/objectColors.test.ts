import { describe, it, expect } from "vitest";
import type { VisionDetection } from "@shared/vision";
import {
  analyzeObjectColor,
  hsvLabel,
  ObjectColorTracker,
  colorDescription,
  type ColorPixels,
} from "./objectColors";
import { COCO_LABELS } from "./cocoLabels";
const detection = {
  id: "one",
  type: "CHAIR",
  cocoClass: "chair",
  confidence: 0.9,
  boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  source: "OBJECT_DETECTOR",
  timestamp: 1,
  trackId: "stable-1",
  tracking: { state: "TRACKED", observations: 3 },
} as VisionDetection;
function pixels(fg: number[], background = [30, 180, 70]): ColorPixels {
  const width = 100,
    height = 100,
    data = new Uint8ClampedArray(40000);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = x >= 20 && x < 80 && y >= 20 && y < 80 ? fg : background;
      data.set([...p, 255], (y * width + x) * 4);
    }
  return { width, height, data, timestamp: 1, frameId: "frame-1" };
}
describe("conservative per-object pixel colour", () => {
  it("covers all 80 actual COCO labels without manufacturing unsupported categories", () => {
    expect(Object.keys(COCO_LABELS)).toHaveLength(80);
    expect(COCO_LABELS.cup.ar).toBe("كوب");
    expect(COCO_LABELS.stairs).toBeUndefined();
  });
  it("distinguishes the eleven basic colours from foreground pixels", () => {
    for (const [name, rgb] of Object.entries({
      red: [200, 20, 20],
      blue: [20, 40, 200],
      green: [20, 160, 40],
      yellow: [225, 225, 20],
      orange: [225, 110, 20],
      purple: [120, 20, 170],
      pink: [235, 130, 180],
      black: [25, 25, 25],
      white: [235, 235, 235],
      gray: [130, 130, 130],
      brown: [100, 60, 20],
    })) {
      expect(hsvLabel(...(rgb as [number, number, number]))).toBe(name);
      const result = analyzeObjectColor(
        pixels(rgb, name === "green" ? [200, 30, 30] : [30, 180, 70]),
        detection
      );
      expect(result.name).toBe(name);
      expect(result.status).toBe("ESTIMATED");
      expect(result.calibrated).toBe(false);
    }
  });
  it("abstains on low light, clipping, same-colour backgrounds and tiny targets", () => {
    expect(
      analyzeObjectColor(pixels([10, 10, 10], [15, 15, 15]), detection).reason
    ).toBe("LOW_LIGHT");
    expect(
      analyzeObjectColor(pixels([255, 255, 255]), detection).name
    ).toBeNull();
    expect(
      analyzeObjectColor(pixels([200, 20, 20], [200, 20, 20]), detection).reason
    ).toBe("BACKGROUND_AMBIGUOUS");
    expect(
      analyzeObjectColor(pixels([200, 20, 20]), {
        ...detection,
        boundingBox: { x: 0.1, y: 0.1, width: 0.02, height: 0.02 },
      }).reason
    ).toBe("TOO_SMALL");
  });
  it("treats neutral black under moderate illumination as black without erasing saturated dark blue", () => {
    for (const pixel of [
      [25, 25, 25],
      [45, 50, 58],
      [55, 56, 60],
    ])
      expect(hsvLabel(...(pixel as [number, number, number]))).toBe("black");
    expect(hsvLabel(20, 40, 120)).toBe("blue");
  });
  it("rejects occlusion, and only accepts a mask associated with the exact instance/frame", () => {
    const frame = pixels([210, 30, 30]);
    expect(
      analyzeObjectColor(frame, detection, [{ ...detection, id: "occluder" }])
        .name
    ).toBeNull();
    const mask = {
      objectId: "stable-1",
      frameId: "frame-1",
      width: 100,
      height: 100,
      data: new Uint8Array(10000).fill(1),
      source: "INSTANCE_SEGMENTATION" as const,
      alignmentVerified: true as const,
    };
    expect(
      analyzeObjectColor(frame, detection, [], { ...mask, frameId: "old" }).name
    ).toBeNull();
    // Mask selects only the known foreground, never the test background.
    mask.data.fill(0);
    for (let y = 20; y < 80; y++)
      for (let x = 20; x < 80; x++) mask.data[y * 100 + x] = 1;
    expect(analyzeObjectColor(frame, detection, [], mask).status).toBe(
      "MASK_SUPPORTED"
    );
  });
  it("reports multicolour for two strong foreground regions, but not specular glare", () => {
    const frame = pixels([210, 20, 20]);
    for (let y = 20; y < 80; y++)
      for (let x = 50; x < 80; x++)
        frame.data.set([20, 30, 210, 255], (y * 100 + x) * 4);
    expect(analyzeObjectColor(frame, detection).name).toBe("multicolor");
    for (let y = 20; y < 80; y++)
      for (let x = 50; x < 80; x++)
        frame.data.set([255, 255, 255, 255], (y * 100 + x) * 4);
    expect(analyzeObjectColor(frame, detection).reason).toBe(
      "CLIPPED_OR_REFLECTIVE"
    );
  });
  it("requires three new valid tracked frames and drops an invalid or genuinely changing colour", () => {
    const tracker = new ObjectColorTracker(),
      red = analyzeObjectColor(pixels([200, 20, 20]), detection);
    expect(tracker.update(detection, red).name).toBeNull();
    expect(
      tracker.update(detection, { ...red, timestamp: 200 }).name
    ).toBeNull();
    expect(tracker.update(detection, { ...red, timestamp: 400 }).name).toBe(
      "red"
    );
    const blue = { ...red, name: "blue" as const, timestamp: 600 };
    expect(tracker.update(detection, blue).reason).toBe("CHANGING");
    expect(
      tracker.update(detection, { ...blue, timestamp: 800 }).name
    ).toBeNull();
    expect(tracker.update(detection, { ...blue, timestamp: 1000 }).name).toBe(
      "blue"
    );
    expect(
      tracker.update(detection, {
        ...blue,
        name: null,
        status: "UNCLEAR",
        reason: "LOW_LIGHT",
        timestamp: 1200,
      }).name
    ).toBeNull();
    expect(
      tracker.update(
        {
          ...detection,
          tracking: { ...detection.tracking!, state: "AMBIGUOUS" },
        },
        { ...red, timestamp: 1400 }
      ).name
    ).toBeNull();
  });
  it("uses feminine Arabic colours and names uncertainty explicitly", () => {
    expect(
      colorDescription({
        ...detection,
        cocoClass: "handbag",
        color: { name: "red", status: "ESTIMATED" } as never,
      })
    ).toContain("حمراء");
    expect(
      colorDescription({
        ...detection,
        color: { name: null, reason: "LOW_LIGHT" } as never,
      })
    ).toContain("ضعف الإضاءة");
  });
});
