import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const REFERENCE_METERS = [0.5, 1, 1.5, 2, 3, 4, 5];
const SOURCES = new Set(['ARKIT_DEPTH', 'LIDAR', 'ARCORE_DEPTH', 'DEPTH_SENSOR', 'MONOCULAR_METRIC']);

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(rows) {
  const accepted = rows.filter(row => row.readingMeters !== null);
  const absoluteErrors = accepted.map(row => Math.abs(row.readingMeters - row.referenceMeters)).sort((a, b) => a - b);
  const signedErrors = accepted.map(row => row.readingMeters - row.referenceMeters);
  return {
    total: rows.length,
    accepted: accepted.length,
    rejected: rows.length - accepted.length,
    rejectionRate: rows.length ? (rows.length - accepted.length) / rows.length : null,
    meanAbsoluteError: absoluteErrors.length ? absoluteErrors.reduce((a, b) => a + b, 0) / absoluteErrors.length : null,
    meanSignedError: signedErrors.length ? signedErrors.reduce((a, b) => a + b, 0) / signedErrors.length : null,
    p95AbsoluteError: percentile(absoluteErrors, 0.95),
  };
}

export function parseTrials(input) {
  const seen = new Set();
  return input.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let row;
    try { row = JSON.parse(line); }
    catch { throw new Error(`Line ${index + 1}: invalid JSON`); }
    const prefix = `Line ${index + 1}`;
    for (const key of ['sessionId', 'deviceModel', 'osVersion', 'frameId', 'objectType', 'condition', 'capturedAt']) {
      if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error(`${prefix}: missing ${key}`);
    }
    if (!SOURCES.has(row.source)) throw new Error(`${prefix}: unsupported metric source`);
    if (!REFERENCE_METERS.includes(row.referenceMeters)) throw new Error(`${prefix}: referenceMeters must be 0.5, 1, 1.5, 2, 3, 4, or 5`);
    if (!Number.isFinite(Date.parse(row.capturedAt))) throw new Error(`${prefix}: invalid capturedAt`);
    const accepted = typeof row.readingMeters === 'number' && Number.isFinite(row.readingMeters);
    if (accepted && (row.readingMeters < 0.2 || row.readingMeters > 10)) throw new Error(`${prefix}: invalid readingMeters`);
    if (!accepted && (row.readingMeters !== null || typeof row.rejectionReason !== 'string' || !row.rejectionReason.trim())) {
      throw new Error(`${prefix}: rejected trial needs null readingMeters and a rejectionReason`);
    }
    if (accepted && row.rejectionReason !== null) throw new Error(`${prefix}: accepted trial needs null rejectionReason`);
    if (row.rawMeters !== undefined) {
      if (!Number.isFinite(row.rawMeters) || row.rawMeters < 0.2 || row.rawMeters > (row.source === 'MONOCULAR_METRIC' ? 20 : 10) ||
          ![4, 5].includes(row.referenceMeters) || accepted ||
          !['OUT_OF_RANGE', 'OUT_OF_TARGET_RANGE'].includes(row.rejectionReason)) {
        throw new Error(`${prefix}: rawMeters is only for withheld 4 m or 5 m observations`);
      }
    }
    const identity = [row.sessionId, row.frameId, row.objectType, row.referenceMeters].join('|');
    if (seen.has(identity)) throw new Error(`${prefix}: duplicate frame/object/reference trial`);
    seen.add(identity);
    return [row];
  });
}

const number = value => value === null ? '—' : value.toFixed(3);
const percent = value => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const summaryRow = (label, stats) =>
  `| ${label} | ${stats.total} | ${stats.accepted} | ${stats.rejected} | ${percent(stats.rejectionRate)} | ${number(stats.meanAbsoluteError)} | ${number(stats.meanSignedError)} | ${number(stats.p95AbsoluteError)} |`;

export function makeReport(rows) {
  const lines = [
    '# Basira Auto Meter — real-device accuracy report',
    '',
    'Input: device observations from a measured reference. No simulated results are included.',
    'Error units are metres. P95 uses the nearest-rank 95th percentile of absolute errors. Unavailable percentage includes every rejected or missing reading among all attempts.',
    'MONOCULAR_METRIC is an unverified camera-AI estimate; ARKit/LiDAR/ARCore/depth-sensor rows are separate device-depth observations. Neither category is a collision or stair safety validation.',
    '',
    '| Device / source / reference | Attempts | Accepted | Unavailable | Unavailable % | Mean absolute error | Mean signed error | P95 absolute error |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  if (!rows.length) {
    lines.push(summaryRow('All devices', summarize([])));
    lines.push('', '**No device observations supplied. Accuracy remains unverified.**');
    return lines.join('\n') + '\n';
  }
  for (const device of [...new Set(rows.map(row => `${row.deviceModel} / ${row.osVersion} / ${row.source}`))].sort()) {
    const deviceRows = rows.filter(row => `${row.deviceModel} / ${row.osVersion} / ${row.source}` === device);
    for (const reference of REFERENCE_METERS) {
      lines.push(summaryRow(`${device} / ${reference} m`, summarize(deviceRows.filter(row => row.referenceMeters === reference))));
    }
    lines.push(summaryRow(`${device} / all`, summarize(deviceRows)));
  }
  for (const source of [...new Set(rows.map(row => row.source))].sort()) {
    lines.push(summaryRow(`${source} / all devices`, summarize(rows.filter(row => row.source === source))));
  }
  lines.push('', '## Hidden exploratory sensor readings at 4 m and 5 m', '',
    'These raw metres were withheld from the user interface as out of range. They do not count as accepted Auto Meter readings.', '',
    '| Device / source / reference | Raw observations | Mean absolute error | Mean signed error | P95 absolute error |',
    '| --- | ---: | ---: | ---: | ---: |');
  for (const device of [...new Set(rows.map(row => `${row.deviceModel} / ${row.osVersion} / ${row.source}`))].sort()) {
    const deviceRows = rows.filter(row => `${row.deviceModel} / ${row.osVersion} / ${row.source}` === device);
    for (const reference of [4, 5]) {
      const rawRows = deviceRows.filter(row => row.referenceMeters === reference && row.rawMeters !== undefined)
        .map(row => ({...row, readingMeters: row.rawMeters}));
      const stats = summarize(rawRows);
      lines.push(`| ${device} / ${reference} m | ${stats.total} | ${number(stats.meanAbsoluteError)} | ${number(stats.meanSignedError)} | ${number(stats.p95AbsoluteError)} |`);
    }
  }
  lines.push('', 'Exploratory readings do not extend the 0.5–3 m target range. This report alone does not approve collision or stair guidance.');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error('Usage: node scripts/auto-meter-report.mjs <device-trials.jsonl> [report.md]');
    process.exitCode = 2;
  } else {
    try {
      const report = makeReport(parseTrials(await readFile(inputPath, 'utf8')));
      if (outputPath) await writeFile(outputPath, report, 'utf8');
      else process.stdout.write(report);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
