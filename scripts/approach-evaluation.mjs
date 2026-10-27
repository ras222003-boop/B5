#!/usr/bin/env node
/** Event metrics for independently labelled approach trials. No sensor or model is run here. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const levels = { NONE: 0, CAUTION: 1, HIGH: 2, CRITICAL: 3 };
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const percentile = (values, fraction) => values.length
  ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;

function validate(input) {
  requireValue(input?.schemaVersion === 1, 'schemaVersion must be 1');
  const dataset = input.dataset;
  requireValue(dataset && typeof dataset.id === 'string' && dataset.id.trim() &&
    ['test', 'validation', 'synthetic'].includes(dataset.split), 'dataset id and split are required');
  if (dataset.split !== 'synthetic') requireValue(dataset.labelStatus === 'INDEPENDENT_ADJUDICATED' &&
    Array.isArray(dataset.annotatorIds) && new Set(dataset.annotatorIds).size >= 2,
  'field results require two independent annotators and adjudication');
  requireValue(Array.isArray(input.clips) && input.clips.length > 0, 'clips must be a nonempty array');
  const ids = new Set();
  for (const clip of input.clips) {
    requireValue(typeof clip.id === 'string' && clip.id.trim() && !ids.has(clip.id), 'clip ids must be unique');
    ids.add(clip.id);
    requireValue(finite(clip.durationMs) && clip.durationMs > 0, `${clip.id}: invalid durationMs`);
    for (const key of ['truth', 'alerts', 'haptics', 'levels'])
      requireValue(Array.isArray(clip[key]), `${clip.id}: ${key} must be an array, including negative clips`);
    for (const event of clip.truth) requireValue(typeof event.id === 'string' && event.id.trim() &&
      finite(event.onsetMs) && finite(event.offsetMs) && event.onsetMs >= 0 &&
      event.offsetMs > event.onsetMs && event.offsetMs <= clip.durationMs && levels[event.level] > 0,
    `${clip.id}: invalid truth event`);
    for (const item of clip.alerts) requireValue(finite(item.atMs) && item.atMs >= 0 &&
      item.atMs <= clip.durationMs && levels[item.level] > 0, `${clip.id}: invalid alert`);
    for (const item of clip.haptics) requireValue(finite(item.actualStartMs) && item.actualStartMs >= 0 &&
      item.actualStartMs <= clip.durationMs && finite(item.durationMs) && item.durationMs > 0 &&
      item.durationMs <= 250, `${clip.id}: haptic timing must be observed at the actuator`);
    for (const item of clip.levels) requireValue(finite(item.atMs) && item.atMs >= 0 &&
      item.atMs <= clip.durationMs && Object.hasOwn(levels, item.level), `${clip.id}: invalid level sample`);
    for (const item of clip.metricSamples ?? []) requireValue(finite(item.referenceMeters) &&
      finite(item.estimatedMeters) && item.referenceMeters > 0 && item.estimatedMeters > 0 &&
      ['ARKIT_DEPTH', 'LIDAR', 'ARCORE_DEPTH', 'DEPTH_SENSOR'].includes(item.source),
    `${clip.id}: invalid trusted metric sample`);
    for (const value of clip.inferenceMs ?? []) requireValue(finite(value) && value >= 0, `${clip.id}: invalid inference time`);
    for (const value of clip.memoryMb ?? []) requireValue(finite(value) && value >= 0, `${clip.id}: invalid memory sample`);
    if (clip.battery) requireValue(finite(clip.battery.startPercent) && finite(clip.battery.endPercent) &&
      clip.battery.startPercent >= 0 && clip.battery.startPercent <= 100 &&
      clip.battery.endPercent >= 0 && clip.battery.endPercent <= 100,
    `${clip.id}: invalid battery reading`);
  }
}

/** Alerts are matched to one human risk event by time and required severity. */
export function evaluateApproach(input) {
  validate(input);
  let totalMs = 0, falseAlerts = 0, alertCount = 0, missedEvents = 0, truthCount = 0;
  let falseHaptics = 0, hapticCount = 0, transitions = 0;
  const warningLatencies = [], hapticLatencies = [], absoluteErrors = [], inference = [], memory = [], batteryDrops = [];
  const perScenario = [];
  for (const clip of input.clips) {
    totalMs += clip.durationMs;
    alertCount += clip.alerts.length;
    hapticCount += clip.haptics.length;
    truthCount += clip.truth.length;
    const matched = new Set();
    let scenarioFalse = 0;
    for (const alert of clip.alerts) {
      const event = clip.truth.find(item => alert.atMs >= item.onsetMs && alert.atMs <= item.offsetMs &&
        levels[alert.level] >= levels[item.level]);
      if (!event) { falseAlerts++; scenarioFalse++; } else matched.add(event.id);
    }
    missedEvents += clip.truth.length - matched.size;
    for (const event of clip.truth) {
      const first = clip.alerts.filter(item => item.atMs >= event.onsetMs && item.atMs <= event.offsetMs &&
        levels[item.level] >= levels[event.level]).sort((a, b) => a.atMs - b.atMs)[0];
      if (first) warningLatencies.push(first.atMs - event.onsetMs);
      const pulse = clip.haptics.filter(item => item.actualStartMs >= event.onsetMs && item.actualStartMs <= event.offsetMs)
        .sort((a, b) => a.actualStartMs - b.actualStartMs)[0];
      if (pulse) hapticLatencies.push(pulse.actualStartMs - event.onsetMs);
    }
    for (const pulse of clip.haptics)
      if (!clip.truth.some(item => pulse.actualStartMs >= item.onsetMs && pulse.actualStartMs <= item.offsetMs)) falseHaptics++;
    const ordered = [...clip.levels].sort((a, b) => a.atMs - b.atMs);
    for (let index = 1; index < ordered.length; index++)
      if (ordered[index].level !== ordered[index - 1].level) transitions++;
    for (const sample of clip.metricSamples ?? []) absoluteErrors.push(Math.abs(sample.estimatedMeters - sample.referenceMeters));
    inference.push(...(clip.inferenceMs ?? []));
    memory.push(...(clip.memoryMb ?? []));
    if (clip.battery) batteryDrops.push(clip.battery.startPercent - clip.battery.endPercent);
    perScenario.push({ id: clip.id, scenario: clip.scenario ?? 'UNSPECIFIED', truthEvents: clip.truth.length,
      matchedEvents: matched.size, falseAlerts: scenarioFalse });
  }
  return {
    schemaVersion: 1, dataset: input.dataset,
    evidenceScope: input.dataset.split === 'synthetic' ? 'SYNTHETIC_ARITHMETIC_ONLY' :
      'INDEPENDENT_LABELS; DEVICE AND FIELD VALIDITY REQUIRE SEPARATE REVIEW',
    clipCount: input.clips.length, monitoredMinutes: totalMs / 60_000,
    falseAlertFraction: ratio(falseAlerts, alertCount), falseAlertsPerHour: falseAlerts * 3_600_000 / totalMs,
    missedRiskFraction: ratio(missedEvents, truthCount),
    warningLatencyMs: { count: warningLatencies.length, mean: mean(warningLatencies), p95: percentile(warningLatencies, .95) },
    riskLevelChangesPerMinute: transitions * 60_000 / totalMs,
    haptics: { count: hapticCount, falsePulses: falseHaptics,
      firstPulseLatencyMs: { count: hapticLatencies.length, mean: mean(hapticLatencies), p95: percentile(hapticLatencies, .95) } },
    trustedMetricMaeMeters: mean(absoluteErrors), metricSampleCount: absoluteErrors.length,
    inferenceP95Ms: percentile(inference, .95), peakMemoryMb: memory.length ? Math.max(...memory) : null,
    meanBatteryDropPercentagePoints: mean(batteryDrops), batteryClipCount: batteryDrops.length,
    perScenario,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath) throw new Error('Usage: node scripts/approach-evaluation.mjs labelled-run.json [report.json]');
    const report = `${JSON.stringify(evaluateApproach(JSON.parse(await readFile(inputPath, 'utf8'))), null, 2)}\n`;
    if (outputPath) await writeFile(outputPath, report);
    else process.stdout.write(report);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
