"""Scene-aware synthetic metrics shared by validation and sealed comparison."""
from __future__ import annotations

import math
import statistics
import time
from collections import Counter

import torch

from models_v2 import CLASS_IDS_V2, CLASS_NAMES, classify, image_tensor


def iou_xywh(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    overlap = max(0., min(ax + aw, bx + bw) - max(ax, bx)) * max(
        0., min(ay + ah, by + bh) - max(ay, by))
    union = aw * ah + bw * bh - overlap
    return overlap / union if union > 0 else 0.


def model_predictions(model, rows, root, class_ids, threshold=.5, measure_latency=False):
    model.eval()
    predictions = []
    durations = []
    with torch.inference_mode():
        if measure_latency and rows:
            warm = image_tensor(root / rows[0]['path'], getattr(model, 'input_size', 128)).unsqueeze(0)
            for _ in range(4):
                model(warm)
        for row in rows:
            tensor = image_tensor(root / row['path'], getattr(model, 'input_size', 128)).unsqueeze(0)
            started = time.perf_counter()
            logits, box = model(tensor)
            if measure_latency:
                durations.append((time.perf_counter() - started) * 1000)
            result = classify(logits[0], box[0], class_ids, threshold)
            predictions.append({'id': row['id'], 'scene_id': row['scene_id'],
                                'imageSha256': row['sha256'], **result})
    timing = None
    if durations:
        ordered = sorted(durations)
        timing = {'medianMs': statistics.median(durations),
                  'p95Ms': ordered[min(len(ordered) - 1, math.ceil(.95 * len(ordered)) - 1)],
                  'images': len(durations), 'scope': 'forward_only_cpu_single_image'}
    return predictions, timing


def summarize(rows, predictions, timing=None):
    if len(rows) != len(predictions):
        raise ValueError('Prediction/image count mismatch')
    confusion = Counter()
    direction = Counter()
    support = Counter()
    correct = Counter()
    false_fixed = false_escalator = fixed_tp = fixed_fn = 0
    overlaps, correct_iou = [], 0
    examples = []
    for row, prediction in zip(rows, predictions):
        if row['id'] != prediction['id'] or row['sha256'] != prediction['imageSha256']:
            raise ValueError('Prediction/image binding mismatch')
        truth = row['objects'][0]['classId'] if row['objects'] else None
        guess = prediction['classId']
        confusion[(CLASS_NAMES[truth], CLASS_NAMES[guess])] += 1
        support[truth] += 1
        correct[truth] += int(truth == guess)
        if truth in (2301, 2302, 2303):
            direction[(CLASS_NAMES[truth], CLASS_NAMES[guess])] += 1
            fixed_tp += int(guess in (2301, 2302, 2303))
            fixed_fn += int(guess not in (2301, 2302, 2303))
        if truth in (None, 2304) and guess in (2301, 2302, 2303):
            false_fixed += 1
        if truth != 2304 and guess == 2304:
            false_escalator += 1
        overlap = None
        if truth is not None and guess is not None and prediction['box'] is not None:
            overlap = iou_xywh(row['objects'][0]['box'], prediction['box'])
            overlaps.append(overlap)
            correct_iou += int(truth == guess and overlap >= .5)
        examples.append({'id': row['id'], 'scene_id': row['scene_id'],
                         'image': row['path'], 'truth': CLASS_NAMES[truth],
                         'prediction': CLASS_NAMES[guess], 'score': prediction['score'],
                         'iou': overlap, 'correct': truth == guess})
    reported_classes = (None, 2301, 2302, 2304)
    macro_recall = sum(correct[key] / support[key] for key in reported_classes
                       if support[key]) / sum(bool(support[key]) for key in reported_classes)
    return {'images': len(rows), 'sceneCount': len({row['scene_id'] for row in rows}),
            'support': {CLASS_NAMES[key]: support[key] for key in CLASS_IDS_V2},
            'classRecall': {CLASS_NAMES[key]: correct[key] / support[key] if support[key] else None
                            for key in CLASS_IDS_V2},
            'macroRecall': macro_recall,
            'confusion': [{'truth': truth, 'prediction': predicted, 'count': count}
                          for (truth, predicted), count in sorted(confusion.items())],
            'directionConfusion': [{'truth': truth, 'prediction': predicted, 'count': count}
                                   for (truth, predicted), count in sorted(direction.items())],
            'fixedStairDetection': {'tp': fixed_tp, 'fn': fixed_fn,
                                    'falseAlertsOnNonfixed': false_fixed},
            'falseEscalatorAlerts': false_escalator,
            'meanIoUOnDetectedObjects': sum(overlaps) / len(overlaps) if overlaps else None,
            'correctClassAndIoU50': correct_iou,
            'latency': timing,
            'examples': examples,
            'scope': 'scene_disjoint_synthetic_only_real_camera_unproven'}


def validation_score(summary):
    """Predeclared selection rule; test data must not enter this function."""
    return summary['macroRecall'] + .15 * (summary['meanIoUOnDetectedObjects'] or 0.)
