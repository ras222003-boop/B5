"""Train V2 on CPU, select by validation, and leave the sealed test unopened."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from metrics_v2 import model_predictions, summarize, validation_score
from models_v2 import CLASS_IDS_V1, CLASS_IDS_V2, TinyDetectorV1, TinyDetectorV2, image_tensor
from train_small import resident_memory_bytes, save_json as _atomic_save_json, sha256
from validate_v2 import test_fingerprint


CLASS_INDEX = {value: index for index, value in enumerate(CLASS_IDS_V2)}
WEIGHTS = [2.0, 1.0, 1.0, 1.0, 3.0]
FACTORIZED_PRESENCE_WEIGHTS = [2.5, 1.0, 8.0]


def save_json(path, value):
    # Windows indexing can hold a just-replaced JSON file briefly.
    for attempt in range(6):
        try:
            _atomic_save_json(path, value)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(.25 * (attempt + 1))


def tensor_iou(first, second):
    x0 = torch.maximum(first[:, 0], second[:, 0])
    y0 = torch.maximum(first[:, 1], second[:, 1])
    x1 = torch.minimum(first[:, 0] + first[:, 2], second[:, 0] + second[:, 2])
    y1 = torch.minimum(first[:, 1] + first[:, 3], second[:, 1] + second[:, 3])
    intersection = (x1 - x0).clamp(min=0) * (y1 - y0).clamp(min=0)
    union = first[:, 2] * first[:, 3] + second[:, 2] * second[:, 3] - intersection
    return intersection / union.clamp(min=1e-6)


def fixed_scene_sampler(rows, scene_seeds, epoch):
    """Exactly three images per scene; video frames cannot dominate an epoch."""
    grouped = defaultdict(list)
    for row in rows:
        grouped[row['scene_id']].append(row)
    selected = []
    for scene_id in sorted(grouped):
        choices = grouped[scene_id]
        randomizer = random.Random(scene_seeds[scene_id] + epoch * 15485863)
        selected.extend(randomizer.sample(choices, 3))
    random.Random(712361 + epoch).shuffle(selected)
    return selected


def read_contract(manifest_path):
    root = manifest_path.resolve().parent
    manifest_sha = sha256(manifest_path)
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    freeze = json.loads((root / 'test-freeze.json').read_text(encoding='utf-8'))
    if (data.get('schemaVersion') != 2 or data.get('contentKind') != 'synthetic_ground_truth'
            or freeze.get('manifestSha256') != manifest_sha
            or freeze.get('testFingerprint') != test_fingerprint(data)):
        raise ValueError('Sealed V2 synthetic cohort changed')
    train = [row for row in data['samples'] if row['split'] == 'train']
    validation = [row for row in data['samples'] if row['split'] == 'validation']
    if len(train) != 88 or len(validation) != 36:
        raise ValueError('V2 training/validation size changed')
    return root, data, train, validation, manifest_sha, freeze


def evaluate_v1_validation(report_path, rows, root):
    report = json.loads(report_path.read_text(encoding='utf-8'))
    weights = Path(report['weights']).resolve()
    if sha256(weights) != report['weightsSha256']:
        raise ValueError('V1 baseline weights changed')
    model = TinyDetectorV1().eval()
    model.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True))
    predictions, _ = model_predictions(model, rows, root, CLASS_IDS_V1, .5)
    return {'weightsSha256': report['weightsSha256'],
            'sourceManifestSha256': report['manifestSha256'],
            'metrics': summarize(rows, predictions)}


def train_candidate(name, root, rows, validation, scenes, output, manifest_sha,
                    deadline, memory_limit_mb, storage_limit_mb):
    run = output / name
    run.mkdir(parents=True, exist_ok=True)
    summary_path = run / 'candidate-summary.json'
    if summary_path.is_file():
        summary = json.loads(summary_path.read_text(encoding='utf-8'))
        if summary.get('manifestSha256') != manifest_sha or summary.get('architecture') != name:
            raise ValueError('Completed candidate belongs to another experiment')
        return summary
    torch.manual_seed(20261025)
    np.random.seed(20261025)
    model = TinyDetectorV2(name)
    optimizer = torch.optim.Adam(model.parameters(), lr=.0015)
    initial = {key: value.detach().clone() for key, value in model.state_dict().items()}
    prior_checkpoints = sorted(run.glob('epoch-??.pt'))
    history = []
    steps = 0
    start_epoch = 0
    best_score = float('-inf')
    if prior_checkpoints:
        state = torch.load(prior_checkpoints[-1], map_location='cpu', weights_only=True)
        if state['manifestSha256'] != manifest_sha or state['architecture'] != name:
            raise ValueError('Candidate checkpoint belongs to a different experiment')
        expected_weights = FACTORIZED_PRESENCE_WEIGHTS if name == 'factorized' else WEIGHTS
        if state['classLossWeights'] != expected_weights:
            raise ValueError('Candidate loss weights changed across resume')
        model.load_state_dict(state['model'])
        optimizer.load_state_dict(state['optimizer'])
        initial = state['initial']
        history, steps, start_epoch = state['history'], state['steps'], state['epoch']
        best_score = max((item['selectionScore'] for item in history), default=float('-inf'))
    tensors = {row['id']: image_tensor(root / row['path'], model.input_size) for row in rows}
    scene_seeds = {scene['id']: scene['seed'] for scene in scenes}
    class_weights = torch.tensor(WEIGHTS, dtype=torch.float32)
    presence_weights = torch.tensor(FACTORIZED_PRESENCE_WEIGHTS, dtype=torch.float32)
    peak_mb = 0.

    def bounds():
        nonlocal peak_mb
        if time.monotonic() >= deadline:
            raise TimeoutError('30-minute local CPU authorization expired; checkpoint retained')
        memory = resident_memory_bytes()
        if memory:
            peak_mb = max(peak_mb, memory[1] / (1024 * 1024))
            if memory[0] > memory_limit_mb * 1024**2:
                raise MemoryError('Local CPU memory budget exceeded')
        total = sum(path.stat().st_size for path in output.rglob('*') if path.is_file())
        if total > storage_limit_mb * 1024**2:
            raise OSError('Local research output storage budget exceeded')

    def stage_improved(entries):
        if len(entries) < 3:
            return True
        if len(entries) == 3:
            return entries[-1]['selectionScore'] > entries[0]['selectionScore'] + .001
        previous = max(item['selectionScore'] for item in entries[:-3])
        current = max(item['selectionScore'] for item in entries[-3:])
        return current > previous + .001

    stopped_before_resume = start_epoch >= 3 and start_epoch % 3 == 0 and not stage_improved(history)
    for epoch in range(start_epoch if not stopped_before_resume else 18, 18):
        bounds()
        selected = fixed_scene_sampler(rows, scene_seeds, epoch)
        if len(selected) != 72:
            raise ValueError('Scene-balanced epoch must contain 72 images')
        model.train()
        losses = []
        for offset in range(0, len(selected), 4):
            bounds()
            batch = selected[offset:offset + 4]
            images = torch.stack([tensors[row['id']] for row in batch])
            labels = torch.tensor([CLASS_INDEX[row['objects'][0]['classId']]
                                   if row['objects'] else 0 for row in batch])
            target_boxes = torch.tensor([row['objects'][0]['box'] if row['objects']
                                         else [0., 0., 0., 0.] for row in batch],
                                        dtype=torch.float32)
            optimizer.zero_grad(set_to_none=True)
            logits, boxes, presence_logits, direction_logits = model.forward_components(images)
            if name == 'factorized':
                presence_labels = torch.where(labels == 4, 2, torch.where(labels == 0, 0, 1))
                fixed = (labels >= 1) & (labels <= 3)
                classification = F.cross_entropy(presence_logits, presence_labels,
                                                 weight=presence_weights)
                if fixed.any():
                    classification = classification + .7 * F.cross_entropy(
                        direction_logits[fixed], labels[fixed] - 1)
            else:
                classification = F.cross_entropy(logits, labels, weight=class_weights)
            positive = labels > 0
            if positive.any():
                box_loss = F.smooth_l1_loss(boxes[positive], target_boxes[positive])
                overlap_loss = (1 - tensor_iou(boxes[positive], target_boxes[positive])).mean()
            else:
                box_loss = logits.sum() * 0
                overlap_loss = logits.sum() * 0
            loss = classification + 3 * box_loss + .5 * overlap_loss
            if not torch.isfinite(loss):
                raise ValueError('Nonfinite V2 loss')
            loss.backward()
            optimizer.step()
            steps += 1
            losses.append(float(loss.detach()))
        model.eval()
        predictions, _ = model_predictions(model, validation, root, CLASS_IDS_V2, .5)
        metrics = summarize(validation, predictions)
        score = validation_score(metrics)
        improved = score > best_score + 1e-6
        previous_best = best_score
        if improved:
            best_score = score
        row = {'epoch': epoch + 1, 'meanLoss': sum(losses) / len(losses),
               'optimizerSteps': steps, 'selectionScore': score,
               'validationMacroRecall': metrics['macroRecall'],
               'validationFalseFixedAlerts': metrics['fixedStairDetection']['falseAlertsOnNonfixed'],
               'validationDirectionConfusion': metrics['directionConfusion'],
               'validationMeanIoU': metrics['meanIoUOnDetectedObjects'],
               'bestSoFar': improved}
        history.append(row)
        state = {'model': model.state_dict(), 'optimizer': optimizer.state_dict(),
                 'initial': initial, 'history': history, 'steps': steps,
                 'epoch': epoch + 1, 'manifestSha256': manifest_sha,
                 'architecture': name, 'seed': 20261025,
                 'classLossWeights': FACTORIZED_PRESENCE_WEIGHTS if name == 'factorized' else WEIGHTS}
        checkpoint = run / f'epoch-{epoch + 1:02d}.pt'
        temp = checkpoint.with_suffix('.pt.tmp')
        torch.save(state, temp)
        os.replace(temp, checkpoint)
        save_json(run / f'validation-epoch-{epoch + 1:02d}.json', metrics)
        print(json.dumps({'candidate': name, **row}), flush=True)
        # Add three epochs only when the previous validation stage improved.
        if (epoch + 1) % 3 == 0 and not stage_improved(history):
            break
    if not history:
        raise ValueError('No selected validation checkpoint')
    best_epoch = max(history, key=lambda item: item['selectionScore'])['epoch']
    best_checkpoint = run / f'epoch-{best_epoch:02d}.pt'
    if not best_checkpoint.exists():
        raise ValueError('Selected validation checkpoint missing')
    state = torch.load(best_checkpoint, map_location='cpu', weights_only=True)
    best_model = TinyDetectorV2(name).eval()
    best_model.load_state_dict(state['model'])
    weight_delta = max(float((state['model'][key] - state['initial'][key]).abs().max())
                       for key in state['model'])
    if steps < 1 or weight_delta <= 0:
        raise ValueError('V2 optimizer did not change model weights')
    summary = {'architecture': name, 'manifestSha256': manifest_sha,
               'bestCheckpoint': str(best_checkpoint),
               'bestCheckpointSha256': sha256(best_checkpoint),
               'bestEpoch': state['epoch'], 'epochsActuallyRun': len(history),
               'optimizerSteps': steps, 'maxParameterChange': weight_delta,
               'validationScore': best_score,
               'validation': json.loads((run / f'validation-epoch-{best_epoch:02d}.json').read_text(encoding='utf-8')),
               'classLossWeights': FACTORIZED_PRESENCE_WEIGHTS if name == 'factorized' else WEIGHTS,
               'history': history, 'peakResidentMemoryMB': round(peak_mb, 2)}
    save_json(summary_path, summary)
    return summary


def export_selected(architecture, checkpoint_path, output, validation, root, manifest_sha):
    import onnx
    import onnxruntime as ort

    state = torch.load(checkpoint_path, map_location='cpu', weights_only=True)
    model = TinyDetectorV2(architecture).eval()
    model.load_state_dict(state['model'])
    weights = output / 'weights.pt'
    temp = weights.with_suffix('.tmp')
    torch.save(model.state_dict(), temp)
    os.replace(temp, weights)
    loaded = TinyDetectorV2(architecture).eval()
    loaded.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True))
    with torch.inference_mode():
        sample = image_tensor(root / validation[0]['path'], loaded.input_size).unsqueeze(0)
        logits, box = loaded(sample)
        if not torch.isfinite(logits).all() or not torch.isfinite(box).all():
            raise ValueError('Reloaded V2 inference is nonfinite')
    model_path = output / 'model.onnx'
    dummy = torch.zeros((1, 3, loaded.input_size, loaded.input_size), dtype=torch.float32)
    torch.onnx.export(loaded, dummy, str(model_path), input_names=['image'],
                      output_names=['class_logits', 'box_xywh'], opset_version=17,
                      dynamic_axes={'image': {0: 'batch'}, 'class_logits': {0: 'batch'},
                                    'box_xywh': {0: 'batch'}}, dynamo=False)
    onnx.checker.check_model(onnx.load(str(model_path)))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(model_path), sess_options=options,
                                   providers=['CPUExecutionProvider'])
    with torch.inference_mode():
        expected = loaded(sample)
    actual = session.run(None, {'image': sample.numpy()})
    parity = max(float(np.max(np.abs(original.numpy() - exported)))
                 for original, exported in zip(expected, actual))
    if parity > 1e-4 or any(not np.isfinite(array).all() for array in actual):
        raise ValueError('V2 ONNX output/parity check failed')
    return {'weights': str(weights), 'weightsSha256': sha256(weights),
            'onnx': str(model_path), 'onnxSha256': sha256(model_path),
            'checkpoint': str(checkpoint_path), 'checkpointSha256': sha256(checkpoint_path),
            'reloadInferencePassed': True, 'onnxCheckerPassed': True,
            'onnxRuntimeInferencePassed': True, 'onnxParityMaxAbsoluteError': parity,
            'manifestSha256': manifest_sha}


def run(args):
    if (not 1 <= args.minutes <= 30 or not 1 <= args.threads <= 4 or
            not 512 <= args.memory_mb <= 4096 or not 128 <= args.storage_mb <= 2048):
        raise ValueError('V2 CPU run exceeds locally authorized bounds')
    os.environ['CUDA_VISIBLE_DEVICES'] = ''
    torch.set_num_threads(args.threads)
    deadline = time.monotonic() + args.minutes * 60
    root, data, train, validation, manifest_sha, freeze = read_contract(args.manifest)
    output = args.output.resolve()
    if root not in output.parents or output == root:
        raise ValueError('V2 training output must stay inside the private cohort')
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / 'training-report.json'
    if report_path.exists():
        prior = json.loads(report_path.read_text(encoding='utf-8'))
        if prior.get('manifestSha256') != manifest_sha:
            raise ValueError('Existing V2 report belongs to another cohort')
        return prior
    baseline = evaluate_v1_validation(args.v1_report, validation, root)
    save_json(output / 'baseline-validation.json', baseline)
    if args.variant == 'factorized':
        candidates = [train_candidate('factorized', root, train, validation,
                                      data['scenes'], output, manifest_sha,
                                      deadline, args.memory_mb, args.storage_mb)]
    elif args.variant == 'wide_only':
        candidates = [train_candidate('wide', root, train, validation,
                                      data['scenes'], output, manifest_sha,
                                      deadline, args.memory_mb, args.storage_mb)]
    elif args.variant == 'wide192_only':
        candidates = [train_candidate('wide192', root, train, validation,
                                      data['scenes'], output, manifest_sha,
                                      deadline, args.memory_mb, args.storage_mb)]
    else:
        base = train_candidate('base', root, train, validation, data['scenes'], output,
                               manifest_sha, deadline, args.memory_mb, args.storage_mb)
        candidates = [base]
        if (base['validation']['macroRecall'] < .8 or
                base['validation']['fixedStairDetection']['falseAlertsOnNonfixed'] > 0):
            candidates.append(train_candidate('wide', root, train, validation,
                                              data['scenes'], output, manifest_sha,
                                              deadline, args.memory_mb, args.storage_mb))
    selected = max(candidates, key=lambda item: item['validationScore'])
    exported = export_selected(selected['architecture'], Path(selected['bestCheckpoint']),
                               output, validation, root, manifest_sha)
    report = {'schemaVersion': 2, 'status': 'trained_and_validation_selected',
              'scope': 'isolated_synthetic_research', 'manifestSha256': manifest_sha,
              'testFingerprint': freeze['testFingerprint'],
              'trainingPerformed': True, 'backwardPerformed': True,
              'sourceWeights': 'random_initialization',
              'sceneBalancedSampling': 'three frames per scene per epoch',
              'classLossWeights': selected['classLossWeights'],
              'classificationLoss': ('presence_plus_conditional_direction' if
                                     selected['architecture'] == 'factorized' else 'weighted_softmax'),
              'boxLoss': 'smooth_l1_plus_iou',
              'baselineV1Validation': baseline, 'candidates': candidates,
              'selectedArchitecture': selected['architecture'],
              'selectionRule': 'highest validation macro recall + 0.15 mean IoU',
              'selectedValidationScore': selected['validationScore'],
              'optimizerSteps': selected['optimizerSteps'],
              'maxParameterChange': selected['maxParameterChange'],
              'completedEpochs': selected['epochsActuallyRun'],
              'peakResidentMemoryMB': max(candidate['peakResidentMemoryMB'] for candidate in candidates),
              'authorizedBounds': {'minutes': args.minutes, 'threads': args.threads,
                                   'memoryMB': args.memory_mb, 'storageMB': args.storage_mb},
              **exported,
              'sealedTestEvaluated': False,
              'productionEligible': False, 'realCameraEvaluation': 'not_performed',
              'blindNavigationSafety': 'not_established'}
    save_json(report_path, report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--v1-report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--minutes', type=int, default=30)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--memory-mb', type=int, default=4096)
    parser.add_argument('--storage-mb', type=int, default=2048)
    parser.add_argument('--variant', choices=('standard', 'wide_only', 'wide192_only', 'factorized'), default='standard')
    args = parser.parse_args()
    try:
        result = run(args)
        print(json.dumps({'status': result['status'], 'selected': result['selectedArchitecture'],
                          'epochs': result['completedEpochs'], 'steps': result['optimizerSteps'],
                          'testEvaluated': result['sealedTestEvaluated']}), flush=True)
    except Exception as error:
        if args.output.is_dir():
            save_json(args.output / 'failure.json', {'status': 'failed', 'reason': str(error),
                                                    'partialResultsRetained': True})
        raise
