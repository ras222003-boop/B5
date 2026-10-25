import { afterEach, describe, it, expect, vi } from "vitest";
import { ObjectOnlyPipeline } from "./objectOnlyPipeline";
import { VisionPipeline, type VisionPipelineOptions } from "./pipeline";
import { DEFAULT_VISION_CONFIG } from "./config";
import { visionMessages } from "@/i18n/locales/vision";
import type { VisionDetection } from "@shared/vision";
const candidate = (at: number): VisionDetection => ({
  id: "cup-" + at,
  cocoClass: "cup",
  type: "UNKNOWN_OBSTACLE",
  confidence: 0.6,
  boundingBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
  horizontalDirection: "LEFT",
  verticalPosition: "MIDDLE",
  approximateDistance: null,
  timestamp: at,
  source: "OBJECT_DETECTOR",
});
function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("document", {
    createElement: () => {
      const c = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray(c.width * c.height * 4).fill(200),
          }),
        }),
      };
      return c;
    },
  });
  const video = {
    paused: false,
    ended: false,
    readyState: 2,
    currentTime: 1,
    videoWidth: 64,
    videoHeight: 48,
  };
  const callbacks = {
    scene: vi.fn(),
    alert: vi.fn(),
    objectSpeech: vi.fn(() => true),
    candidate: vi.fn(),
    recognized: vi.fn(),
    OCRFailure: vi.fn(),
    segmentationFailure: vi.fn(),
    depthFailure: vi.fn(),
    fatal: vi.fn(),
    perception: vi.fn(),
    detectionFrame: vi.fn(),
  };
  const options = {
    video,
    vision: {
      usagePolicy: "EXPERIMENTAL_OBJECTS_ONLY",
      detect: vi.fn(async (_frame, at) => {
        video.currentTime += 0.5;
        return [candidate(at)];
      }),
      close: vi.fn(async () => {}),
    },
    config: { ...DEFAULT_VISION_CONFIG, detectionThreshold: 0.5 },
    copy: visionMessages.ar,
    mode: "EXPLORATION",
    buildingId: null,
    floorId: null,
    autoMeterEnabled: true,
    experimentalApproachEnabled: true,
    announcement: { announce: vi.fn() },
    depth: { read: vi.fn(), close: vi.fn() },
    ocr: { recognize: vi.fn(), close: vi.fn() },
    callbacks,
  } as unknown as VisionPipelineOptions;
  return { options, callbacks, video };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("experimental objects never enter navigation", () => {
  it("rejects research providers in the original pipeline, and rejects navigation/stairs in the object session", () => {
    const { options } = setup();
    expect(() => new VisionPipeline(options)).toThrow("Research providers");
    expect(
      () => new ObjectOnlyPipeline({ ...options, mode: "NAVIGATION" })
    ).toThrow("object_only_policy");
    expect(
      () =>
        new ObjectOnlyPipeline({
          ...options,
          vision: {
            ...options.vision,
            usagePolicy: "EXPERIMENTAL_DISPLAY_ONLY",
          },
        })
    ).toThrow("object_only_policy");
  });
  it("tracks and speaks objects at the validated research threshold while all safety/depth/OCR routes stay unused", async () => {
    const { options, callbacks } = setup(),
      session = new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(1600);
    expect(
      callbacks.perception.mock.calls.some(
        ([p]) => p?.observations[0]?.detection.tracking?.state === "TRACKED"
      )
    ).toBe(true);
    expect(callbacks.objectSpeech).toHaveBeenCalledTimes(1);
    expect(callbacks.objectSpeech.mock.calls[0][0]).toContain("كوب");
    expect(options.announcement.announce).not.toHaveBeenCalled();
    expect(callbacks.alert).not.toHaveBeenCalled();
    expect(options.depth.read).not.toHaveBeenCalled();
    expect(options.ocr.recognize).not.toHaveBeenCalled();
    expect(await session.setAutoMeterEnabled(true)).toBe(false);
    expect(await session.requestMeterNow()).toEqual({
      snapshot: null,
      diagnostic: "OFF",
    });
    await session.stop();
    expect(options.vision.close).toHaveBeenCalledOnce();
    expect(callbacks.perception).toHaveBeenLastCalledWith(null);
  });
  it("rejects a stair detection even if a provider also supplies a COCO name", async () => {
    const { options, callbacks } = setup();
    vi.mocked(options.vision.detect).mockImplementation(async (_f, at) => [
      { ...candidate(at), type: "STAIRS_UP" },
    ]);
    const session = new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.fatal).toHaveBeenCalledOnce();
    expect(callbacks.objectSpeech).not.toHaveBeenCalled();
    expect(callbacks.alert).not.toHaveBeenCalled();
  });
});
