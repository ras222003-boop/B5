"""Bundle the locked V2 artifacts locally for manual synthetic replay."""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from train_small import sha256


def package(root, output):
    root, output = root.resolve(), output.resolve()
    if root not in output.parents:
        raise ValueError('Research bundle must remain inside the private experiment')
    lock = json.loads((root / 'selection-lock.json').read_text(encoding='utf-8'))
    comparison_path = root / 'comparison-v2/comparison.json'
    comparison = json.loads(comparison_path.read_text(encoding='utf-8'))
    report_path = root / 'runs' / lock['selectedRun'] / 'training-report.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    input_size = 192 if report['selectedArchitecture'] == 'wide192' else 128
    metrics = comparison['v2']
    up_total = metrics['support']['stairs_up']
    up_correct = round((metrics['classRecall']['stairs_up'] or 0) * up_total)
    down_total = metrics['support']['stairs_down']
    down_correct = round((metrics['classRecall']['stairs_down'] or 0) * down_total)
    nonfixed = metrics['support']['background'] + metrics['support']['escalator']
    false_alerts = metrics['fixedStairDetection']['falseAlertsOnNonfixed']
    escalator_total = metrics['support']['escalator']
    escalator_correct = round((metrics['classRecall']['escalator'] or 0) * escalator_total)
    if (comparison['v2WeightsSha256'] != lock['weightsSha256'] or
            report['weightsSha256'] != lock['weightsSha256'] or
            report['manifestSha256'] != lock['manifestSha256']):
        raise ValueError('Package selection/data binding changed')
    artifacts = [('weights.pt', Path(report['weights']), report['weightsSha256']),
                 ('model.onnx', Path(report['onnx']), report['onnxSha256']),
                 ('checkpoint.pt', Path(report['checkpoint']), report['checkpointSha256'])]
    for _, source, expected in artifacts:
        if sha256(source) != expected:
            raise ValueError(f'Locked artifact changed: {source.name}')
    output.mkdir(parents=True, exist_ok=False)
    for name, source, _ in artifacts:
        shutil.copyfile(source, output / name)
    shutil.copyfile(report_path, output / 'training-report.json')
    shutil.copyfile(comparison_path, output / 'comparison.json')
    config = {'schemaVersion': 1, 'source': 'packaged_from_saved_training_report',
              'architecture': report['selectedArchitecture'], 'inputSize': input_size,
              'initialization': 'random', 'seed': 20261025, 'optimizer': 'Adam',
              'learningRate': .0015, 'classLossWeights': report['classLossWeights'],
              'boxLoss': report['boxLoss'], 'boxLossCoefficients': {'smoothL1': 3., 'oneMinusIoU': .5},
              'sampling': report['sceneBalancedSampling'], 'batchSize': 4,
              'epochExtension': 'three epochs only after validation-stage improvement',
              'bestEpoch': next(item['bestEpoch'] for item in report['candidates']
                                if item['architecture'] == report['selectedArchitecture']),
              'epochsActuallyRun': report['completedEpochs'],
              'manifestSha256': lock['manifestSha256'], 'testFingerprint': lock['testFingerprint'],
              'productionEligible': False}
    (output / 'config.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
    entry = {'schemaVersion': 1, 'name': 'basira-stairs-v2-synthetic-research',
             'model': 'model.onnx', 'sha256': report['onnxSha256'],
             'input': {'name': 'image', 'shape': ['batch', 3, input_size, input_size],
                       'range': [0, 1], 'color': 'RGB'},
             'outputs': ['class_logits', 'box_xywh'],
             'classIds': [None, 2301, 2302, 2303, 2304], 'threshold': lock['threshold'],
             'researchOnly': True, 'productionEnabled': False,
             'studioIntegrationEnabled': False, 'manualSyntheticReplayAllowed': True,
             'isolatedRealCameraExperimentAllowed': False,
             'blockingFindings': [f'{up_total-up_correct}/{up_total} ascending test images missed',
                                  f'{false_alerts}/{nonfixed} nonfixed test images caused fixed-stair alerts',
                                  f'{escalator_correct}/{escalator_total} escalator test images recognized'],
             'realCameraEvaluation': 'not_performed', 'humanApprovalsGranted': False}
    (output / 'entry.json').write_text(json.dumps(entry, indent=2), encoding='utf-8')
    (output / 'README.md').write_text(
        '# Basira V2 research bundle\n\n'
        'Valid PyTorch checkpoint, weights and ONNX for manual synthetic replay.\n'
        f'V2 recognized {down_correct}/{down_total} descending and {up_correct}/{up_total} ascending test images; it caused\n'
        f'{false_alerts} false fixed-stair alerts on {nonfixed} nonfixed images. Improvement is partial.\n'
        'Studio integration, real-camera use and production are disabled.\n'
        'Use infer_v2.py with this entry and a synthetic train/validation sample ID.\n'
        'The sealed test has been consumed; do not tune against its results.\n', encoding='utf-8')
    hashes = {path.name: sha256(path) for path in output.iterdir() if path.is_file()}
    (output / 'artifact-manifest.json').write_text(json.dumps({
        'schemaVersion': 1, 'scope': 'local_synthetic_research_bundle', 'files': hashes,
        'productionEligible': False}, indent=2), encoding='utf-8')
    return {'bundle': str(output), 'files': len(hashes) + 1,
            'bytes': sum(path.stat().st_size for path in output.iterdir() if path.is_file()),
            'manualSyntheticReplayOnly': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.root, args.output)))
