import { describe, it, expect, beforeEach, vi } from "vitest";
import type { VisionDetection } from "@shared/vision";
import type { ColorPixels } from "./objectColors";
import { analyzeColour, getColourEngine, saveColourEngine } from "./colourEngine";
import { COLOUR_SPEECH_QUALIFICATION, colourForSpeech } from "./colourAnnouncement";

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
function frame(rgb: number[]): ColorPixels {
  const size = 200,
    data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      data.set(x >= 40 && x < 160 && y >= 40 && y < 160 ? [...rgb, 255] : [120, 120, 120, 255], (y * size + x) * 4);
  return { width: size, height: size, data, timestamp: 1, frameId: "f" };
}

describe("colour engine switch", () => {
  beforeEach(() => {
    vi.resetModules();
    saveColourEngine("v3");
  });
  it("defaults to V3 and keeps V3 behaviour unchanged", () => {
    expect(getColourEngine()).toBe("v3");
    const out = analyzeColour(frame([200, 30, 30]), detection);
    expect(out.quality?.version).toBe("inset-grid-v2");
  });
  it("uses V4 only when explicitly selected, and reports its version", () => {
    saveColourEngine("v4-experimental");
    expect(getColourEngine()).toBe("v4-experimental");
    const out = analyzeColour(frame([30, 70, 210]), detection, [], undefined, undefined);
    expect(out.name).toBe("blue");
    expect(out.quality?.version).toBe("mask-lab-v4");
    expect(out.calibrated).toBe(false);
  });
  it("lets callers pick an engine explicitly, regardless of the saved choice", () => {
    saveColourEngine("v4-experimental");
    expect(analyzeColour(frame([200, 30, 30]), detection, [], undefined, "v3").quality?.version).toBe("inset-grid-v2");
  });
  it("never speaks a V4 colour while the gate is UNQUALIFIED", () => {
    saveColourEngine("v4-experimental");
    const color = analyzeColour(frame([30, 70, 210]), detection);
    const spoken = colourForSpeech({ ...detection, color: { ...color, timestamp: detection.timestamp } }, { now: detection.timestamp, live: false });
    expect(COLOUR_SPEECH_QUALIFICATION.status).toBe("UNQUALIFIED");
    expect(spoken).toBe("");
  });
});
