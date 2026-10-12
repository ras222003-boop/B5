import assert from 'node:assert/strict';
import test from 'node:test';
import { makeReport, parseTrials } from './auto-meter-report.mjs';

const base = {
  sessionId: 'field-1', deviceModel: 'test-device', osVersion: 'test-os',
  source: 'ARKIT_DEPTH', objectType: 'CHAIR', referenceMeters: 1,
  condition: 'indoor', capturedAt: '2026-10-12T09:00:00Z',
};

test('reports measured absolute error, signed error, P95, and rejected attempts', () => {
  const rows = [
    {...base, frameId:'frame-1', readingMeters:1.1, rejectionReason:null},
    {...base, frameId:'frame-2', readingMeters:0.8, rejectionReason:null},
    {...base, frameId:'frame-3', readingMeters:null, rejectionReason:'MIXED_SURFACES'},
  ];
  const report = makeReport(parseTrials(rows.map(row => JSON.stringify(row)).join('\n')));
  assert.match(report, /test-device \/ test-os \/ ARKIT_DEPTH \/ 1 m \| 3 \| 2 \| 1 \| 33\.3% \| 0\.150 \| -0\.050 \| 0\.200/);
  assert.match(report, /Hidden exploratory sensor readings at 4 m and 5 m/);
});

test('does not accept imaginary or duplicated metric readings', () => {
  const row = {...base, frameId:'frame-1', readingMeters:1.1, rejectionReason:null};
  assert.throws(() => parseTrials(JSON.stringify({...row, source:'MONOCULAR_ESTIMATE'})), /unsupported metric source/);
  assert.throws(() => parseTrials([row,row].map(value => JSON.stringify(value)).join('\n')), /duplicate/);
  assert.match(makeReport(parseTrials('')), /Accuracy remains unverified/);
});

test('keeps outside-range values hidden but reports their exploratory error', () => {
  const row = {...base, frameId:'frame-4', referenceMeters:4, readingMeters:null,
    rejectionReason:'OUT_OF_RANGE', rawMeters:4.25};
  const report=makeReport(parseTrials(JSON.stringify(row)));
  assert.match(report, /4 m \| 1 \| 0 \| 1 \| 100\.0%/);
  assert.match(report, /4 m \| 1 \| 0\.250 \| 0\.250 \| 0\.250/);
  assert.throws(() => parseTrials(JSON.stringify({...row, referenceMeters:2})), /rawMeters is only/);
});

test('reports 1.5 m camera-AI trials separately from ARKit', () => {
  const rows=[
    {...base,source:'MONOCULAR_METRIC',referenceMeters:1.5,frameId:'ai-1',readingMeters:1.8,rejectionReason:null},
    {...base,source:'MONOCULAR_METRIC',referenceMeters:1.5,frameId:'ai-2',readingMeters:null,rejectionReason:'INVALID_MODEL_DEPTH'},
    {...base,frameId:'arkit-1',readingMeters:1.0,rejectionReason:null},
  ];
  const report=makeReport(parseTrials(rows.map(row=>JSON.stringify(row)).join('\n')));
  assert.match(report,/MONOCULAR_METRIC \/ 1\.5 m \| 2 \| 1 \| 1 \| 50\.0% \| 0\.300/);
  assert.match(report,/ARKIT_DEPTH \/ 1 m \| 1 \| 1 \| 0/);
});
