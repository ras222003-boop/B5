import { describe, expect, it } from 'vitest';
import type { MetricDepthMap, VisionDetection } from '@shared/vision';
import { SmartApproachRiskEngine, type ApproachRiskContext } from './approachRisk';
import type { VisualApproachObservation } from './visualApproach';

const detection = (at: number, id = 'chair-1', x = .4, size = .2): VisionDetection => ({
  id: `${id}-${at}`, trackId: id, type: 'CHAIR', confidence: .9,
  boundingBox: { x, y: .45, width: size, height: size }, horizontalDirection: 'FRONT', verticalPosition: 'MIDDLE',
  approximateDistance: { distanceMeters: .25, confidence: 1, source: 'MONOCULAR_ESTIMATE' },
  timestamp: at, source: 'OBJECT_DETECTOR',
  tracking: { state: 'TRACKED', observations: 8, firstSeenAt: 100, lastSeenAt: at, gapMs: 200 },
});
const approach = (at: number, id = 'chair-1', state: VisualApproachObservation['state'] = 'POSSIBLE_APPROACH',
  ttc = 3): VisualApproachObservation => ({ trackId: id, type: 'CHAIR', state, frameId: `f-${at}`,
  capturedAt: at, reasons: state === 'OBSERVED' ? ['NO_CORROBORATED_EXPANSION'] : [],
  evidence: state === 'OBSERVED' ? ['TRACKING'] : ['TRACKING', 'BOX_EXPANSION', 'COMPENSATED_OPTICAL_FLOW'],
  opticalTtcSeconds: state === 'OBSERVED' ? undefined : ttc, experimental: true });
const context = (at: number, more: Partial<ApproachRiskContext> = {}): ApproachRiskContext =>
  ({ frameId: `f-${at}`, capturedAt: at, now: at, ...more });
const map = (at: number, meters: number, aligned = true): MetricDepthMap => ({
  width: 64, height: 48, values: new Float32Array(64 * 48).fill(meters), confidence: .95,
  source: 'ARKIT_DEPTH', timestamp: at, alignmentVerified: aligned,
});

describe('smart approach risk', () => {
  it('does not alert for a far or close stationary detection, even with a claimed monocular distance', () => {
    const engine = new SmartApproachRiskEngine();
    for (const at of [1000, 1200, 1400]) {
      const result = engine.update([detection(at)], [approach(at, 'chair-1', 'OBSERVED')], context(at));
      expect(result.alert).toBeNull();
      expect(result.risks[0].level).toBe('NONE');
      expect(result.risks[0].metricMeters).toBeNull();
    }
  });

  it('raises once after stable visual evidence and escalates only on a substantial increase', () => {
    const engine = new SmartApproachRiskEngine();
    expect(engine.update([detection(1000)], [approach(1000)], context(1000)).alert).toBeNull();
    expect(engine.update([detection(1200)], [approach(1200)], context(1200)).alert?.level).toBe('ATTENTION');
    expect(engine.update([detection(1400)], [approach(1400)], context(1400)).alert).toBeNull();
    expect(engine.update([detection(1600)], [approach(1600, 'chair-1', 'STRONG_APPROACH')], context(1600)).alert).toBeNull();
    expect(engine.update([detection(1800)], [approach(1800, 'chair-1', 'STRONG_APPROACH')], context(1800)).alert?.level).toBe('HIGH');
    expect(engine.update([detection(2000)], [approach(2000, 'chair-1', 'STRONG_APPROACH')], context(2000)).alert).toBeNull();
  });

  it('suppresses a side passer and prioritizes the path-overlapping object in a multi-object frame', () => {
    const engine = new SmartApproachRiskEngine();
    for (const at of [1000, 1200]) {
      const outside = detection(at, 'side', .72), center = detection(at, 'chair-1', .4);
      const result = engine.update([outside, center], [approach(at, 'side'), approach(at)], context(at));
      expect(result.risks.find(r => r.trackId === 'side')?.level).toBe('NONE');
      if (at === 1200) expect(result.alert?.trackId).toBe('chair-1');
    }
  });

  it('rejects stale frames, interrupted tracking and motion evidence from another frame', () => {
    const engine = new SmartApproachRiskEngine();
    engine.update([detection(1000)], [approach(1000)], context(1000));
    expect(engine.update([detection(1200)], [approach(1000)], context(1200)).alert).toBeNull();
    expect(engine.update([detection(1400)], [approach(1400)], context(1400, { now: 2500 })).status).toBe('UNAVAILABLE');
    expect(engine.update([detection(1600)], [approach(1600)], context(1600)).alert).toBeNull();
    const lost = { ...detection(1800), tracking: { ...detection(1800).tracking!, state: 'AMBIGUOUS' as const } };
    expect(engine.update([lost], [approach(1800)], context(1800)).risks[0].level).toBe('UNAVAILABLE');
    expect(engine.update([], [], context(2000)).alert).toBeNull();
  });

  it('requires aligned hardware depth in metric mode and uses user thresholds only as alert gates', () => {
    const engine = new SmartApproachRiskEngine();
    const metric = { mode: 'TRUSTED_METRIC' as const,
      metricThresholdsMeters: { caution: 2.5, high: 1.5, critical: .8 } };
    expect(engine.update([detection(1000)], [approach(1000)], context(1000, metric)).risks[0].level).toBe('UNAVAILABLE');
    expect(engine.update([detection(1200)], [approach(1200)], context(1200, { ...metric, metricDepth: map(1200, .7, false) })).risks[0].level).toBe('UNAVAILABLE');
    expect(engine.update([detection(1400)], [approach(1400)], context(1400, { ...metric, metricDepth: map(1000, .7) })).risks[0].level).toBe('UNAVAILABLE');
    expect(engine.update([detection(1600)], [approach(1600)], context(1600, { ...metric, metricDepth: map(1600, 4) })).risks[0].level).toBe('NONE');
    const stationary = engine.update([detection(1800)], [approach(1800, 'chair-1', 'OBSERVED')],
      context(1800, { ...metric, metricDepth: map(1800, .5) }));
    expect(stationary.alert).toBeNull();
    expect(stationary.risks[0].metricMeters).toBe(.5);
  });

  it('requires matching visual and metric closing trends before urgent escalation', () => {
    const engine = new SmartApproachRiskEngine();
    const values = [1.3, 1.1, .9, .7, .6, .55];
    const alerts: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const at = 1000 + i * 200;
      const result = engine.update([detection(at)], [approach(at, 'chair-1', i < 2 ? 'POSSIBLE_APPROACH' : 'STRONG_APPROACH', 1.5)],
        context(at, { mode: 'TRUSTED_METRIC', metricDepth: map(at, values[i]) }));
      if (result.alert) alerts.push(result.alert.level);
    }
    expect(alerts).toContain('ATTENTION');
    expect(alerts).toContain('URGENT');
  });

  it('does not promote disagreement between optical and metric TTC or a monocular pseudo-metre', () => {
    const engine = new SmartApproachRiskEngine();
    let last;
    for (let i = 0; i < 6; i++) {
      const at = 1000 + i * 200;
      last = engine.update([detection(at)], [approach(at, 'chair-1', 'STRONG_APPROACH', .35)],
        context(at, { mode: 'TRUSTED_METRIC', metricDepth: map(at, 1.3 - i * .1) }));
    }
    expect(last!.risks[0].reasons).toContain('CONFLICTING_TTC');
    expect(last!.risks[0].level).not.toBe('URGENT');
  });
});
