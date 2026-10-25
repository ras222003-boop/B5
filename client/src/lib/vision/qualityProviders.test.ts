import { describe, it, expect } from "vitest";
import { decodeYoloX, mergeDetections } from "./qualityProviders";
import { COCO_LABELS } from "./cocoLabels";
import { normalizeObjectDetections } from "./providers";
describe("YOLOX browser adapter", () => {
  it("decodes raw grid coordinates and objectness times class score without changing confidence", () => {
    const data = new Float32Array(3549 * 85),
      chair = Object.keys(COCO_LABELS).indexOf("chair");
    data.set([1, 1, Math.log(2), Math.log(2), 0.8], 0);
    data[5 + chair] = 0.75;
    const d = decodeYoloX(data, 416, 416, 100, 0.5)[0];
    expect(d.cocoClass).toBe("chair");
    expect(d.confidence).toBeCloseTo(0.6);
    expect(d.timestamp).toBe(100);
    expect(d.boundingBox.x).toBeCloseTo(0);
    expect(d.boundingBox.width).toBeCloseTo(16 / 416);
    expect(decodeYoloX(data, 416, 416, 100, 0.65)).toEqual([]);
  });
  it("class-aware merging removes duplicate crop detections and retains different or separate objects", () => {
    const make = (name: string, x: number) =>
      normalizeObjectDetections(
        [
          {
            categories: [{ categoryName: name, score: 0.9 }],
            boundingBox: { originX: x, originY: 10, width: 20, height: 20 },
          },
        ],
        100,
        100,
        1
      )[0];
    expect(
      mergeDetections([
        make("cup", 10),
        make("cup", 11),
        make("cup", 70),
        make("fork", 10),
      ])
    ).toHaveLength(3);
  });
});
