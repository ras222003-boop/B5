"""Lock a V2 checkpoint from validation reports before opening the new test."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from train_small import sha256
from validate_v2 import test_fingerprint


def select(manifest_path, runs_dir):
    root = manifest_path.resolve().parent
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest_sha = sha256(manifest_path)
    freeze = json.loads((root / 'test-freeze.json').read_text(encoding='utf-8'))
    if freeze['manifestSha256'] != manifest_sha or freeze['testFingerprint'] != test_fingerprint(data):
        raise ValueError('Sealed synthetic test changed before selection')
    candidates = []
    for path in sorted(runs_dir.glob('v2-*/training-report.json')):
        report = json.loads(path.read_text(encoding='utf-8'))
        if report['manifestSha256'] != manifest_sha or report['sealedTestEvaluated'] is not False:
            raise ValueError(f'Invalid candidate test/data state: {path}')
        if sha256(Path(report['weights'])) != report['weightsSha256']:
            raise ValueError(f'Candidate weights changed: {path}')
        if sha256(Path(report['onnx'])) != report['onnxSha256']:
            raise ValueError(f'Candidate ONNX changed: {path}')
        selected_candidate = next(item for item in report['candidates']
                                  if item['architecture'] == report['selectedArchitecture'])
        candidates.append({'run': path.parent.name,
                           'report': str(path.resolve()),
                           'validationScore': report['selectedValidationScore'],
                           'architecture': report['selectedArchitecture'],
                           'validationFalseFixedAlerts': selected_candidate['validation']
                               ['fixedStairDetection']['falseAlertsOnNonfixed']})
    if len(candidates) < 2:
        raise ValueError('Expected multiple completed validation-only candidates')
    chosen = max(candidates, key=lambda item: item['validationScore'])
    report = json.loads(Path(chosen['report']).read_text(encoding='utf-8'))
    value = {'schemaVersion': 1, 'status': 'selected_before_test',
             'manifestSha256': manifest_sha, 'testFingerprint': freeze['testFingerprint'],
             'selectionMetric': 'validation_macro_recall_plus_0.15_mean_IoU',
             'threshold': .5, 'selectedRun': chosen['run'],
             'selectedArchitecture': chosen['architecture'],
             'selectedValidationScore': chosen['validationScore'],
             'weights': report['weights'], 'weightsSha256': report['weightsSha256'],
             'onnx': report['onnx'], 'onnxSha256': report['onnxSha256'],
             'candidates': candidates, 'testModelResultsInspected': False}
    lock_path = root / 'selection-lock.json'
    if lock_path.exists():
        if json.loads(lock_path.read_text(encoding='utf-8')) != value:
            raise ValueError('Existing pre-test model selection changed')
    else:
        lock_path.write_text(json.dumps(value, indent=2), encoding='utf-8')
    return lock_path, value


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--runs-dir', type=Path, required=True)
    args = parser.parse_args()
    path, selected = select(args.manifest, args.runs_dir)
    print(json.dumps({'selectionLock': str(path), 'selectedRun': selected['selectedRun'],
                      'validationScore': selected['selectedValidationScore'],
                      'testModelResultsInspected': False}))
