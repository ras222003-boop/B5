import { requireValue as check, finite, sha, nonempty, jsonHash, checkedFile } from './common.mjs';
import { validateDataset } from './data.mjs';
import { proximityPolicy, estimatedProximity } from './spatial.mjs';

/** Object IDs are manually matched to truth: isolates metric error, NOT end-to-end detection accuracy. */
export async function evaluateProximity(data, root, run) {
  await validateDataset(data, root);
  check(data.spatialPolicyVersion === proximityPolicy.version && run?.datasetSha256 === jsonHash(data) && run.split === 'test',
    'proximity evaluation requires the exact locked spatial test dataset');
  check(run.policyVersion === proximityPolicy.version && Array.isArray(run.observations) && nonempty(run.modelVersion), 'proximity run identity required');
  const calibration = run.calibration;
  check(calibration?.reviewStatus === 'approved' && nonempty(calibration.reviewer) && sha(calibration.datasetSha256) &&
    calibration.datasetSha256 !== run.datasetSha256, 'independent calibration evidence required; do not calibrate on this test release');
  check(Array.isArray(calibration.rangeMeters) && calibration.rangeMeters.length === 2 && calibration.rangeMeters.every(finite) &&
    calibration.rangeMeters[0] >= 0 && calibration.rangeMeters[1] > calibration.rangeMeters[0], 'calibration range required');
  await checkedFile(root, calibration.calibrationPath, calibration.calibrationSha256);
  await checkedFile(root, calibration.errorValidationPath, calibration.errorValidationSha256);
  const truth = new Map(data.samples.filter(s => s.split === 'test').flatMap(s => s.annotation.objects.map(o => [`${s.id}/${o.id}`, o])));
  const seen = new Set(), confusion = {}, errors = []; let certain = 0, comparable = 0, correct = 0, unjustified = 0;
  check(run.observations.length === truth.size && truth.size > 0, 'every held-out object needs an observation, including unavailable estimates');
  for (const observation of run.observations) {
    const key = `${observation.sampleId}/${observation.objectId}`;
    check(truth.has(key) && !seen.has(key) && finite(observation.evaluatedAtMs), 'unknown/duplicate object or evaluation time'); seen.add(key);
    const e = observation.estimate;
    if (e != null) check(e.calibrationSha256 === calibration.calibrationSha256 && e.errorValidationSha256 === calibration.errorValidationSha256 &&
      JSON.stringify(e.calibrationRangeMeters) === JSON.stringify(calibration.rangeMeters),
      'estimate calibration fingerprint mismatch');
    const actual = truth.get(key).spatial.proximity, predicted = estimatedProximity(e, observation.evaluatedAtMs);
    confusion[actual] ??= {}; confusion[actual][predicted] = (confusion[actual][predicted] ?? 0) + 1;
    if (predicted !== 'distance_uncertain') certain++;
    if (actual === 'distance_uncertain') { if (predicted !== actual) unjustified++; }
    else {
      comparable++; if (predicted === actual) correct++;
      if (predicted !== 'distance_uncertain') errors.push(Math.abs(e.meters - truth.get(key).spatial.distance.meters));
    }
  }
  return { scope: 'independent-test-manually-associated-proximity', datasetSha256: run.datasetSha256,
    policyVersion: proximityPolicy.version, modelVersion: run.modelVersion, objects: truth.size,
    coverage: certain / truth.size, measuredBandObjects: comparable, correctBands: correct,
    accuracyIncludingAbstentions: comparable ? correct / comparable : null,
    meanAbsoluteErrorMetersOnCertainComparable: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
    metricErrorSampleCount: errors.length, certainAgainstUncertainTruth: unjustified, confusion,
    productionEligible: false, safePathClaimAllowed: false, note: 'Human review of calibration provenance remains required; no end-to-end distance or safety claim.' };
}
