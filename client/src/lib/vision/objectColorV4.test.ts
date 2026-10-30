import { describe, it, expect } from "vitest";
import type { VisionDetection } from "@shared/vision";
import type { AlignedObjectMask, ColorPixels } from "./objectColors";
import {
  analyzeObjectColorV4,
  COLOUR_V4_DEFAULTS,
  groupName,
  hueGroup,
} from "./objectColorV4";

const detection = {
  id: "one",
  type: "CHAIR",
  cocoClass: "chair",
  confidence: 0.9,
  boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  source: "OBJECT_DETECTOR",
  timestamp: 1,
  trackId: "t1",
} as VisionDetection;
const size = 200;
function frame(paint: (x: number, y: number) => number[]): ColorPixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      data.set([...paint(x, y), 255], (y * size + x) * 4);
  return { width: size, height: size, data, timestamp: 1, frameId: "f" };
}
const inside = (x: number, y: number) =>
  x >= 40 && x < 160 && y >= 40 && y < 160;
const maskOf = (test: (x: number, y: number) => boolean): AlignedObjectMask => {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data[y * size + x] = test(x, y) ? 1 : 0;
  return {
    objectId: "t1",
    frameId: "f",
    width: size,
    height: size,
    data,
    alignmentVerified: true,
    source: "INSTANCE_SEGMENTATION",
  };
};

describe("colour V4", () => {
  it("names canonical colours from Lab hue anchors, not from guessed angles", () => {
    for (const [rgb, name] of [
      [[210, 30, 40], "red"],
      [[40, 90, 220], "blue"],
      [[30, 160, 60], "green"],
      [[255, 225, 0], "yellow"],
      [[255, 140, 0], "orange"],
      [[150, 70, 150], "purple"],
    ] as const) {
      const out = analyzeObjectColorV4(
        frame((x, y) => (inside(x, y) ? [...rgb] : [120, 120, 120])),
        detection,
        [],
        undefined,
        { ...COLOUR_V4_DEFAULTS, minEvidence: 40 }
      );
      expect(out.name, name).toBe(name);
      expect(out.calibrated).toBe(false);
    }
  });
  it("uses the mask so a same-named backdrop cannot decide the object colour", () => {
    const mask = maskOf(inside);
    const out = analyzeObjectColorV4(
      frame((x, y) => (inside(x, y) ? [200, 30, 30] : [30, 60, 200])),
      detection,
      [],
      mask,
      { ...COLOUR_V4_DEFAULTS, minEvidence: 40 }
    );
    expect(out.name).toBe("red");
    expect(out.status).toBe("MASK_SUPPORTED");
  });
  it("does not turn a lit-and-shaded single material into multicolor", () => {
    const out = analyzeObjectColorV4(
      frame((x, y) =>
        inside(x, y) ? (x < 100 ? [30, 70, 210] : [10, 25, 90]) : [200, 200, 200]
      ),
      detection,
      [],
      maskOf(inside),
      { ...COLOUR_V4_DEFAULTS, minEvidence: 40 }
    );
    expect(out.name).toBe("blue");
  });
  it("keeps a white object in partial shade white via its lit reference", () => {
    const out = analyzeObjectColorV4(
      frame((x, y) =>
        inside(x, y) ? (x < 100 ? [235, 235, 235] : [130, 130, 130]) : [40, 90, 40]
      ),
      detection,
      [],
      maskOf(inside),
      { ...COLOUR_V4_DEFAULTS, minEvidence: 40 }
    );
    expect(out.name).toBe("white");
  });
  it("abstains for tiny objects, dark scenes and clipped patches rather than guessing", () => {
    const tiny = analyzeObjectColorV4(
      frame((x, y) =>
        x >= 98 && x < 104 && y >= 98 && y < 104 ? [200, 30, 30] : [90, 90, 90]
      ),
      { ...detection, boundingBox: { x: 0.49, y: 0.49, width: 0.03, height: 0.03 } }
    );
    expect(tiny.name).toBeNull();
    const dark = analyzeObjectColorV4(
      frame(() => [4, 4, 6]),
      detection,
      [],
      undefined,
      { ...COLOUR_V4_DEFAULTS, minEvidence: 40 }
    );
    expect(dark.name).toBeNull();
    const clipped = analyzeObjectColorV4(
      frame(() => [255, 255, 255]),
      detection,
      [],
      undefined,
      { ...COLOUR_V4_DEFAULTS, minEvidence: 40 }
    );
    expect(clipped.name).toBeNull();
  });
  it("resolves lightness-dependent names once per object", () => {
    const p = COLOUR_V4_DEFAULTS;
    expect(groupName("orange", 62, 30, p)).toBe("brown");
    expect(groupName("orange", 62, 75, p)).toBe("orange");
    expect(groupName("red", 5, 80, p)).toBe("pink");
    expect(groupName("red", 35, 80, p)).toBe("red");
    expect(hueGroup(301)).toBe("blue");
    expect(hueGroup(40)).toBe("red");
  });
  it("rejects a mask that is not verified for this frame and object", () => {
    const mask = { ...maskOf(inside), objectId: "other" };
    const out = analyzeObjectColorV4(
      frame(() => [200, 30, 30]),
      detection,
      [],
      mask
    );
    expect(out.name).toBeNull();
  });
  it("reports a secondary colour only for a verified mask and a real region", () => {
    const twoTone = (x: number, y: number) =>
      inside(x, y) ? (x < 125 ? [30, 70, 210] : [235, 235, 235]) : [60, 130, 60];
    const params = { ...COLOUR_V4_DEFAULTS, minEvidence: 40 };
    const masked = analyzeObjectColorV4(frame(twoTone), detection, [], maskOf(inside), params);
    expect(masked.name).toBe("blue");
    expect(masked.secondary).toBe("white");
    const boxed = analyzeObjectColorV4(frame(twoTone), detection, [], undefined, params);
    expect(boxed.secondary).toBeUndefined();
    const scattered = analyzeObjectColorV4(
      frame((x, y) =>
        inside(x, y) ? ((x * 7 + y * 13) % 11 === 0 ? [235, 235, 235] : [30, 70, 210]) : [60, 130, 60]
      ),
      detection,
      [],
      maskOf(inside),
      params
    );
    expect(scattered.secondary).toBeUndefined();
  });
});
