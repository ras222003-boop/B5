"""Evaluate locked V1/V2 weights once on a new sealed synthetic test cohort."""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from metrics_v2 import model_predictions, summarize
from models_v2 import (CLASS_IDS_V1, CLASS_IDS_V2, CLASS_NAMES,
                       TinyDetectorV1, TinyDetectorV2, image_tensor)
from train_small import save_json, sha256
from validate_v2 import test_fingerprint


def _direction_correct(metrics):
    return sum(entry['count'] for entry in metrics['directionConfusion']
               if entry['truth'] == entry['prediction'] and
               entry['truth'] in ('stairs_up', 'stairs_down',
                                  'stairs_present_uncertain_direction'))


def _predictions_once(path, model, rows, root, class_ids, threshold):
    if path.exists():
        value = json.loads(path.read_text(encoding='utf-8'))
        if [item['id'] for item in value['predictions']] != [item['id'] for item in rows]:
            raise ValueError('Previously sealed prediction order changed')
        return value['predictions'], value['latency']
    predictions, timing = model_predictions(model, rows, root, class_ids,
                                            threshold, measure_latency=True)
    save_json(path, {'predictions': predictions, 'latency': timing,
                     'scope': 'one_locked_model_on_new_synthetic_test'})
    return predictions, timing


def _example_page(root, rows, prior, current, output):
    candidates = []
    for row, old, new in zip(rows, prior, current):
        truth = row['objects'][0]['classId'] if row['objects'] else None
        improved = new['classId'] == truth and old['classId'] != truth
        unresolved = new['classId'] != truth
        if improved or unresolved:
            candidates.append((0 if improved else 1, row, old, new))
    def varied(items, limit):
        chosen, seen = [], set()
        for item in items:
            row, new = item[1], item[3]
            truth = row['objects'][0]['classId'] if row['objects'] else None
            key = (truth, new['classId'])
            if key not in seen:
                seen.add(key)
                chosen.append(item)
            if len(chosen) == limit:
                break
        return chosen

    improved = varied((item for item in candidates if item[0] == 0), 4)
    unresolved = varied((item for item in candidates if item[0] == 1), 4)
    cards = []
    for _, row, old, new in improved + unresolved:
        truth = row['objects'][0]['classId'] if row['objects'] else None
        boxes = []
        if row['objects']:
            x, y, w, h = row['objects'][0]['box']
            boxes.append(f'<rect x="{x*320:.2f}" y="{y*240:.2f}" width="{w*320:.2f}" height="{h*240:.2f}" stroke="#13a34a"/>')
        if new['box']:
            x, y, w, h = new['box']
            boxes.append(f'<rect x="{x*320:.2f}" y="{y*240:.2f}" width="{w*320:.2f}" height="{h*240:.2f}" stroke="#d43b39"/>')
        image_path = '../' + row['path']
        status = 'V2 improved' if new['classId'] == truth else 'V2 unresolved'
        cards.append(f'<article><h2>{html.escape(status)} · {html.escape(row["scene_id"])}</h2>'
                     f'<div class="picture"><img src="{html.escape(image_path)}" width="320" height="240"/>'
                     f'<svg viewBox="0 0 320 240">{"".join(boxes)}</svg></div>'
                     f'<p>Truth: {html.escape(CLASS_NAMES[truth])} · '
                     f'V1: {html.escape(CLASS_NAMES[old["classId"]])} · '
                     f'V2: {html.escape(CLASS_NAMES[new["classId"]])}</p></article>')
    page = ('<!doctype html><html lang="en"><meta charset="utf-8"><title>Basira V2 synthetic examples</title>'
            '<style>body{font:15px system-ui;background:#f4f6f5;color:#17201a;margin:28px}'
            'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px}'
            'article{background:white;padding:12px;border-radius:9px;box-shadow:0 1px 5px #bbb}'
            '.picture{position:relative;width:320px;height:240px}.picture svg{position:absolute;inset:0;'
            'width:320px;height:240px}.picture rect{fill:none;stroke-width:3}'
            '</style><h1>Scene-disjoint synthetic test examples</h1>'
            '<p>Green: geometric ground truth. Red: V2 box. These renderings are not real-camera evidence.</p>'
            '<main>' + ''.join(cards) + '</main></html>')
    path = output / 'examples.html'
    path.write_text(page, encoding='utf-8')
    return path


def compare(manifest_path, v1_report_path, output):
    torch.set_num_threads(2)
    root = manifest_path.resolve().parent
    output = output.resolve()
    if root not in output.parents:
        raise ValueError('Comparison must stay inside private synthetic cohort')
    output.mkdir(parents=True, exist_ok=True)
    complete = output / 'comparison.json'
    if complete.exists():
        return json.loads(complete.read_text(encoding='utf-8'))
    manifest_sha = sha256(manifest_path)
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    freeze = json.loads((root / 'test-freeze.json').read_text(encoding='utf-8'))
    lock = json.loads((root / 'selection-lock.json').read_text(encoding='utf-8'))
    if (freeze['manifestSha256'] != manifest_sha or lock['manifestSha256'] != manifest_sha
            or freeze['testFingerprint'] != test_fingerprint(data)
            or lock['testFingerprint'] != freeze['testFingerprint']
            or lock['status'] != 'selected_before_test'
            or lock['testModelResultsInspected'] is not False):
        raise ValueError('Test or validation-only selection lock changed')
    rows = [row for row in data['samples'] if row['split'] == 'test']
    if len(rows) != 36 or len({row['scene_id'] for row in rows}) != 12:
        raise ValueError('New held-out scene count changed')
    for row in rows:
        if sha256(root / row['path']) != row['sha256']:
            raise ValueError('Frozen test image changed')
    v1_report = json.loads(v1_report_path.read_text(encoding='utf-8'))
    if sha256(Path(v1_report['weights'])) != v1_report['weightsSha256']:
        raise ValueError('V1 baseline weights changed')
    if sha256(Path(lock['weights'])) != lock['weightsSha256'] or sha256(Path(lock['onnx'])) != lock['onnxSha256']:
        raise ValueError('Locked V2 weights or ONNX changed')
    old = TinyDetectorV1().eval()
    old.load_state_dict(torch.load(v1_report['weights'], map_location='cpu', weights_only=True))
    new = TinyDetectorV2(lock['selectedArchitecture']).eval()
    new.load_state_dict(torch.load(lock['weights'], map_location='cpu', weights_only=True))
    old_predictions, old_timing = _predictions_once(output / 'predictions-v1.json', old,
                                                   rows, root, CLASS_IDS_V1, .5)
    new_predictions, new_timing = _predictions_once(output / 'predictions-v2.json', new,
                                                   rows, root, CLASS_IDS_V2, lock['threshold'])
    old_metrics, new_metrics = (summarize(rows, old_predictions, old_timing),
                                summarize(rows, new_predictions, new_timing))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(lock['onnx'], sess_options=options,
                                   providers=['CPUExecutionProvider'])
    tensor = image_tensor(root / rows[0]['path'], new.input_size).unsqueeze(0)
    actual = session.run(None, {'image': tensor.numpy()})
    with torch.inference_mode():
        expected = new(tensor)
    parity = max(float(np.max(np.abs(a.numpy() - b))) for a, b in zip(expected, actual))
    if parity > 1e-4 or any(not np.isfinite(array).all() for array in actual):
        raise ValueError('Locked V2 ONNX failed fresh-scene inference')
    old_false = old_metrics['fixedStairDetection']['falseAlertsOnNonfixed']
    new_false = new_metrics['fixedStairDetection']['falseAlertsOnNonfixed']
    old_direction = _direction_correct(old_metrics)
    new_direction = _direction_correct(new_metrics)
    improved = (new_metrics['macroRecall'] > old_metrics['macroRecall'] and
                new_false < old_false and new_direction > old_direction)
    examples = _example_page(root, rows, old_predictions, new_predictions, output)
    result = {'schemaVersion': 2, 'status': 'compared_once_on_frozen_synthetic_test',
              'manifestSha256': manifest_sha, 'testFingerprint': freeze['testFingerprint'],
              'selectionLockSha256': sha256(root / 'selection-lock.json'),
              'selectedRun': lock['selectedRun'], 'threshold': lock['threshold'],
              'v1WeightsSha256': v1_report['weightsSha256'],
              'v2WeightsSha256': lock['weightsSha256'], 'v2OnnxSha256': lock['onnxSha256'],
              'v1': old_metrics, 'v2': new_metrics,
              'delta': {'macroRecall': new_metrics['macroRecall'] - old_metrics['macroRecall'],
                        'fixedFalseAlerts': new_false - old_false,
                        'correctFixedDirections': new_direction - old_direction,
                        'meanIoU': (new_metrics['meanIoUOnDetectedObjects'] or 0) -
                                   (old_metrics['meanIoUOnDetectedObjects'] or 0)},
              'researchImprovementOnSyntheticTest': improved,
              'onnxRuntimeFreshScenePassed': True,
              'onnxParityMaxAbsoluteError': parity,
              'examples': str(examples),
              'testUse': 'one comparison after validation-only model lock',
              'realCameraEvaluation': 'not_performed',
              'blindNavigationSafety': 'not_established',
              'productionEligible': False}
    save_json(complete, result)
    if improved:
        save_json(output / 'isolated-model-entry.json', {
            'schemaVersion': 1, 'name': 'basira-stairs-v2-synthetic-research',
            'model': lock['onnx'], 'sha256': lock['onnxSha256'],
            'input': {'name': 'image', 'shape': ['batch', 3, new.input_size, new.input_size],
                      'range': [0, 1], 'color': 'RGB'},
            'outputs': ['class_logits', 'box_xywh'],
            'classIds': list(CLASS_IDS_V2), 'threshold': lock['threshold'],
            'researchOnly': True, 'productionEnabled': False,
            'studioIntegrationEnabled': False,
            'manualSyntheticReplayAllowed': True,
            'isolatedRealCameraExperimentAllowed': False,
            'blockingFindings': {
                'ascendingRecall': new_metrics['classRecall']['stairs_up'],
                'falseFixedStairAlerts': new_false,
                'escalatorRecall': new_metrics['classRecall']['escalator']},
            'realCameraEvaluation': 'not_performed',
            'humanApprovalsGranted': False})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--v1-report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.manifest, args.v1_report, args.output)
    print(json.dumps({'status': result['status'],
                      'selectedRun': result['selectedRun'],
                      'v1MacroRecall': result['v1']['macroRecall'],
                      'v2MacroRecall': result['v2']['macroRecall'],
                      'v1FixedFalseAlerts': result['v1']['fixedStairDetection']['falseAlertsOnNonfixed'],
                      'v2FixedFalseAlerts': result['v2']['fixedStairDetection']['falseAlertsOnNonfixed'],
                      'researchImprovement': result['researchImprovementOnSyntheticTest']}))
