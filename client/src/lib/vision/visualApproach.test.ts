import { describe, expect, it } from 'vitest';
import type { VisionDetection } from '@shared/vision';
import { VisualApproachEstimator, type MotionEvidence } from './visualApproach';
const detection = (at: number, size: number): VisionDetection => ({ id: `d-${at}`, trackId: 'chair-1', type: 'CHAIR', confidence: .9,
  boundingBox: { x: .5 - size / 2, y: .5 - size / 2, width: size, height: size }, horizontalDirection: 'FRONT', verticalPosition: 'MIDDLE',
  approximateDistance: null, timestamp: at, source: 'OBJECT_DETECTOR', tracking: { state: 'TRACKED', observations: 8, firstSeenAt: 0, lastSeenAt: at, gapMs: 200 } });
const motion = (at: number, overrides: Partial<MotionEvidence> = {}): MotionEvidence => ({ source: 'SPARSE_OPTICAL_FLOW', trackId: 'chair-1', frameId: `f-${at}`,
  previousFrameId: `f-${at - 200}`, capturedAt: at, previousCapturedAt: at - 200, pointCount: 16, outwardFraction: .94, backgroundPointCount: 30,
  backgroundInlierRatio: .95, expansionPerSecond: .6, globalScaleChange: 0, globalRotationDegrees: 0, compensated: true, quality: 'VALID', ...overrides });
const frame = (at: number, overrides: Partial<MotionEvidence> = {}) => ({ frameId: `f-${at}`, capturedAt: at, now: at, motion: [motion(at, overrides)] });
describe('corroborated visual approach', () => {
  it('requires timed repeated box expansion plus independent compensated flow', () => {
    const engine = new VisualApproachEstimator();
    let result;
    for (let i = 0; i < 5; i++) result = engine.update([detection(1000 + i * 200, .2 * 1.12 ** i)], frame(1000 + i * 200))[0];
    expect(result!.state).toBe('STRONG_APPROACH'); expect(result!.evidence).toContain('COMPENSATED_OPTICAL_FLOW');
  });
  it('never upgrades box growth without flow', () => {
    const engine = new VisualApproachEstimator();
    for (let i = 0; i < 5; i++) {
      const at = 1000 + i * 200;
      expect(engine.update([detection(at, .2 * 1.12 ** i)], { ...frame(at), motion: [] })[0].state).toBe('UNAVAILABLE');
    }
  });
  it.each([
    ['GLOBAL_EXPANSION', { globalScaleChange: .05 }], ['CAMERA_ROTATION', { globalRotationDegrees: 3 }],
    ['MOTION_UNRELIABLE', { compensated: false }], ['MOTION_UNRELIABLE', { previousFrameId: 'unrelated' }],
    ['MOTION_UNRELIABLE', { backgroundInlierRatio: NaN }], ['MOTION_UNRELIABLE', { pointCount: Infinity }],
  ] as const)('rejects %s', (reason, overrides) => {
    const engine = new VisualApproachEstimator(); engine.update([detection(1000, .2)], frame(1000));
    const next = engine.update([detection(1200, .24)], frame(1200, overrides))[0];
    expect(next.state).toBe('UNAVAILABLE'); expect(next.reasons).toContain(reason);
  });
  it('rejects measured zoom, hardware rotation, slow frames, stale frames and repeated frames', () => {
    const engine = new VisualApproachEstimator(); engine.update([detection(1000, .2)], { ...frame(1000), zoom: 1, rotationDegrees: 0 });
    const next = engine.update([detection(1200, .24)], { ...frame(1200), zoom: 1.1, rotationDegrees: 5 })[0];
    expect(next.reasons).toContain('ZOOM'); expect(next.reasons).toContain('CAMERA_ROTATION');
    expect(engine.update([detection(1200, .24)], frame(1200))[0].reasons).toContain('REPEATED_FRAME');
    expect(engine.update([detection(2000, .25)], frame(2000))[0].reasons).toContain('LOW_FPS');
    expect(engine.update([detection(2200, .3)], { ...frame(2200), now: 4000 })[0].reasons).toContain('STALE_FRAME');
  });
  it('does not mistake retreat, sideways movement or lost tracking for approach', () => {
    const engine = new VisualApproachEstimator(); engine.update([detection(1000, .3)], frame(1000));
    expect(engine.update([detection(1200, .25)], frame(1200, { expansionPerSecond: -.3, outwardFraction: .1 }))[0].state).toBe('OBSERVED');
    expect(engine.update([detection(1400, .25)], frame(1400, { expansionPerSecond: 0, outwardFraction: .5 }))[0].state).toBe('OBSERVED');
    const unstable = { ...detection(1600, .3), tracking: { ...detection(1600, .3).tracking!, state: 'AMBIGUOUS' as const } };
    expect(engine.update([unstable], frame(1600))[0].reasons).toContain('TRACK_UNSTABLE');
    engine.update([], frame(1800));
    expect(engine.update([detection(2000, .4)], frame(2000))[0].state).toBe('UNAVAILABLE');
  });
});
