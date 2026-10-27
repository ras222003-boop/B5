import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateApproach } from './approach-evaluation.mjs';

test('event matching, false alerts, haptic timing and metric error use independent event denominators', () => {
  const result = evaluateApproach({ schemaVersion: 1,
    dataset: { id: 'arithmetic-fixture', split: 'synthetic' }, clips: [
      { id: 'approach', scenario: 'approaching', durationMs: 10_000,
        truth: [{ id: 'one', onsetMs: 2000, offsetMs: 6000, level: 'HIGH' }],
        alerts: [{ atMs: 2500, level: 'HIGH' }, { atMs: 8000, level: 'CAUTION' }],
        haptics: [{ actualStartMs: 2800, durationMs: 100 }],
        levels: [{ atMs: 0, level: 'NONE' }, { atMs: 2400, level: 'HIGH' }],
        metricSamples: [{ source: 'ARKIT_DEPTH', referenceMeters: 1.5, estimatedMeters: 1.7 }],
        inferenceMs: [10, 20], memoryMb: [100, 110] },
      { id: 'still', scenario: 'distant-stationary', durationMs: 10_000,
        truth: [], alerts: [], haptics: [], levels: [{ atMs: 0, level: 'NONE' }] },
    ] });
  assert.equal(result.falseAlertFraction, .5);
  assert.equal(result.missedRiskFraction, 0);
  assert.equal(result.warningLatencyMs.mean, 500);
  assert.equal(result.haptics.firstPulseLatencyMs.mean, 800);
  assert.equal(result.riskLevelChangesPerMinute, 3);
  assert.ok(Math.abs(result.trustedMetricMaeMeters - .2) < 1e-9);
  assert.equal(result.inferenceP95Ms, 20);
});

test('unmeasured values stay null and field data without independent labels is rejected', () => {
  const sample = { schemaVersion: 1, dataset: { id: 'negative', split: 'synthetic' },
    clips: [{ id: 'negative', durationMs: 1000, truth: [], alerts: [], haptics: [], levels: [] }] };
  const result = evaluateApproach(sample);
  assert.equal(result.falseAlertFraction, null);
  assert.equal(result.missedRiskFraction, null);
  assert.equal(result.trustedMetricMaeMeters, null);
  assert.throws(() => evaluateApproach({ ...sample, dataset: { id: 'field', split: 'test' } }), /independent annotators/);
});
