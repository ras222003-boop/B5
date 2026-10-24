"""Manually replay the V2 ONNX model on synthetic train/validation images only."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from models_v2 import classify, image_tensor
from train_small import sha256


def infer(manifest_path, entry_path, sample_id):
    root = manifest_path.resolve().parent
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    entry = json.loads(entry_path.read_text(encoding='utf-8'))
    if (manifest.get('contentKind') != 'synthetic_ground_truth' or
            entry.get('researchOnly') is not True or
            entry.get('productionEnabled') is not False or
            entry.get('studioIntegrationEnabled') is not False or
            entry.get('manualSyntheticReplayAllowed') is not True):
        raise ValueError('Isolated synthetic-only replay contract required')
    model_path = Path(entry['model'])
    if not model_path.is_absolute():
        model_path = entry_path.resolve().parent / model_path
    model_path = model_path.resolve()
    if root not in model_path.parents or sha256(model_path) != entry['sha256']:
        raise ValueError('Isolated ONNX path/hash changed')
    matches = [row for row in manifest['samples'] if row['id'] == sample_id]
    if len(matches) != 1 or matches[0]['split'] not in ('train', 'validation'):
        raise ValueError('Replay accepts only synthetic train/validation sample IDs')
    row = matches[0]
    image_path = (root / row['path']).resolve()
    if root not in image_path.parents or sha256(image_path) != row['sha256']:
        raise ValueError('Synthetic replay image changed')
    tensor = image_tensor(image_path, entry['input']['shape'][2]).unsqueeze(0)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(model_path), sess_options=options,
                                   providers=['CPUExecutionProvider'])
    logits, box = session.run(None, {'image': tensor.numpy()})
    if not np.isfinite(logits).all() or not np.isfinite(box).all():
        raise ValueError('Nonfinite isolated inference')
    prediction = classify(torch.from_numpy(logits[0]), torch.from_numpy(box[0]),
                          tuple(entry['classIds']), entry['threshold'])
    return {'sampleId': sample_id, 'split': row['split'], 'prediction': prediction,
            'modelSha256': entry['sha256'], 'source': 'synthetic_ground_truth',
            'productionUsed': False, 'realCameraEvaluation': 'not_performed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--entry', type=Path, required=True)
    parser.add_argument('--sample-id', required=True)
    args = parser.parse_args()
    print(json.dumps(infer(args.manifest, args.entry, args.sample_id)))
