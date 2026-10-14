import { describe, expect, it } from 'vitest';
import type { VisionDetection } from '@shared/vision';
import { SparseOpticalFlow } from './opticalFlow';
const width = 160, height = 120;
const base = new Uint8Array(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) base[y * width + x] =
  Math.round(125 + 35 * Math.sin(x * .71 + y * .17) + 35 * Math.sin(y * .67 - x * .11) + 30 * Math.sin(x * .31 + y * .47));
const d = (at: number, size = .36, dx = 0): VisionDetection => ({ id: `${at}`, trackId: 'one', type: 'CHAIR', confidence: .9,
  boundingBox: { x: .5 - size / 2 + dx / width, y: .5 - size / 2, width: size, height: size }, horizontalDirection: 'FRONT', verticalPosition: 'MIDDLE',
  approximateDistance: null, timestamp: at, source: 'OBJECT_DETECTOR' });
const image = (at: number, pixels = base) => ({ frameId: `f-${at}`, capturedAt: at, width, height, pixels });
const warped = (mapping: (x: number, y: number) => [number, number]) => {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [sx, sy] = mapping(x, y), a = Math.floor(sx), b = Math.floor(sy), fx = sx - a, fy = sy - b;
    if (a >= 0 && b >= 0 && a < width - 1 && b < height - 1) pixels[y * width + x] =
      (1 - fy) * ((1 - fx) * base[b * width + a] + fx * base[b * width + a + 1]) +
      fy * ((1 - fx) * base[(b + 1) * width + a] + fx * base[(b + 1) * width + a + 1]);
  }
  return pixels;
};
describe('sparse optical flow from actual pixel pairs', () => {
  it('compensates whole-camera translation without inventing expansion', () => {
    const flow = new SparseOpticalFlow(); expect(flow.update(image(1000), [d(1000)])).toEqual([]);
    const evidence = flow.update(image(1200, warped((x, y) => [x - 3, y + 2])), [d(1200, .36, 3)])[0];
    expect(evidence.quality).toBe('VALID'); expect(evidence.compensated).toBe(true);
    expect(evidence.backgroundPointCount).toBeGreaterThanOrEqual(12); expect(Math.abs(evidence.expansionPerSecond)).toBeLessThan(.03);
    expect(evidence.outwardFraction).toBeLessThan(.5);
  });
  it('finds object expansion against an unchanged background', () => {
    const flow = new SparseOpticalFlow(); flow.update(image(1000), [d(1000)]);
    const enlarged = warped((x, y) => Math.abs(x - 80) <= 32 && Math.abs(y - 60) <= 24 ? [80 + (x - 80) / 1.12, 60 + (y - 60) / 1.12] : [x, y]);
    const evidence = flow.update(image(1200, enlarged), [d(1200, .36 * 1.12)])[0];
    expect(evidence.quality).toBe('VALID'); expect(evidence.expansionPerSecond).toBeGreaterThan(.2);
    expect(evidence.outwardFraction).toBeGreaterThan(.75); expect(Math.abs(evidence.globalScaleChange)).toBeLessThan(.01);
  });
  it('reports global zoom and rotation so the approach estimator can reject them', () => {
    const flow = new SparseOpticalFlow(); flow.update(image(1000), [d(1000)]);
    const angle = 3 * Math.PI / 180, scale = 1.04;
    const pixels = warped((x, y) => [80 + ((x - 80) * Math.cos(angle) + (y - 60) * Math.sin(angle)) / scale,
      60 + (-(x - 80) * Math.sin(angle) + (y - 60) * Math.cos(angle)) / scale]);
    const evidence = flow.update(image(1200, pixels), [d(1200, .38)])[0];
    expect(evidence.compensated).toBe(true); expect(evidence.globalScaleChange).toBeGreaterThan(.015);
    expect(Math.abs(evidence.globalRotationDegrees)).toBeGreaterThan(1);
  });
  it('declines flat imagery, stale pairs, repeated frames, resize and reset', () => {
    const flow = new SparseOpticalFlow(), blank = new Uint8Array(width * height).fill(100);
    flow.update(image(1000, blank), [d(1000)]);
    expect(flow.update(image(1200, blank), [d(1200)])[0].quality).toBe('INSUFFICIENT');
    expect(flow.update(image(1200, blank), [d(1200)])).toEqual([]);
    expect(flow.update(image(2000, blank), [d(2000)])).toEqual([]);
    expect(flow.update({ ...image(2200), width: 80, height: 60, pixels: new Uint8Array(4800) }, [d(2200)])).toEqual([]);
    flow.reset(); expect(flow.update(image(2400), [d(2400)])).toEqual([]);
    expect(flow.update({ ...image(2600), pixels: new Uint8Array(5) }, [d(2600)])).toEqual([]);
  });
  it('copies incoming pixels and accepts RGBA without DOM globals', () => {
    const flow = new SparseOpticalFlow(), pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < base.length; i++) pixels.set([base[i], base[i], base[i], 255], i * 4);
    flow.update(image(1000, pixels), [d(1000)]); pixels.fill(0);
    expect(flow.update(image(1200), [d(1200)])[0].quality).toBe('VALID');
  });
});
