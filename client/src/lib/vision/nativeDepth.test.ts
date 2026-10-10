import { describe, expect, it, vi } from "vitest";
import { NativeMetricDepthProvider } from "./modelProviders";

describe("native metric depth contract", () => {
  const valid = {
    width: 4,
    height: 4,
    values: Array(16).fill(1.25),
    confidence: 0.9,
    source: "LIDAR" as const,
    frameTimestampMs: 1000,
    alignedToVideo: true,
  };
  it("accepts only an aligned current metric map", async () => {
    const bridge = { getAlignedDepth: vi.fn().mockResolvedValue(valid) };
    expect(
      (await new NativeMetricDepthProvider(bridge).capture(1000))?.values[0]
    ).toBe(1.25);
    bridge.getAlignedDepth.mockResolvedValueOnce({
      ...valid,
      frameTimestampMs: 600,
    });
    expect(
      await new NativeMetricDepthProvider(bridge).capture(1000)
    ).toBeNull();
    bridge.getAlignedDepth.mockResolvedValueOnce({
      ...valid,
      alignedToVideo: false,
    });
    expect(
      await new NativeMetricDepthProvider(bridge).capture(1000)
    ).toBeNull();
  });
});
