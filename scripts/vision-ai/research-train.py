"""Bounded local CPU research trainer. Reads only the server's verified private plan.

This is separate from the official release trainer and never creates an approval.
"""
import json
import os
import random
import sys
import time
from pathlib import Path

from train import build_model, digest, read, write, export_onnx, REPO


def main(plan_path):
    if os.environ.get('CUDA_VISIBLE_DEVICES') != '':
        raise ValueError('CPU-only research environment required')
    plan = read(plan_path)
    if plan.get('schemaVersion') != 1 or plan.get('scope') != 'local_research_only' or plan.get('epochs') != 1:
        raise ValueError('Invalid private research plan')
    if not isinstance(plan.get('threads'), int) or not 1 <= plan['threads'] <= 4:
        raise ValueError('Invalid CPU thread limit')
    deadline = plan.get('deadlineEpochMs')
    if not isinstance(deadline, int) or deadline <= int(time.time() * 1000):
        raise ValueError('Research authorization expired')
    def time_check():
        if int(time.time() * 1000) >= deadline:
            raise ValueError('Authorized CPU time limit reached')
    images = plan['images']
    groups = {x['group'] for x in images if x.get('labels')}
    if len(groups) < 3 or len([x for x in images if x.get('labels')]) < 3:
        raise ValueError('Insufficient independent development groups')
    for item in images:
        path = Path(item['path'])
        if not path.is_file() or path.is_symlink() or digest(path) != item['sha256']:
            raise ValueError('Private image changed or unavailable')
        if any(o['classId'] not in (2301, 2302, 2303) or len(o['box']) != 4 or
               any(not isinstance(v, (float, int)) or v < 0 or v > 1 for v in o['box']) or
               o['box'][2] <= 0 or o['box'][3] <= 0 or
               o['box'][0] + o['box'][2] > 1 or o['box'][1] + o['box'][3] > 1
               for o in item['labels']):
            raise ValueError('Invalid stairs reference label')
    # Reserve one entire group for development validation. No final-test input exists.
    val_group = sorted(groups)[-1]
    training = [x for x in images if x['group'] != val_group and x['labels']]
    validation = [x for x in images if x['group'] == val_group and x['labels']]
    if len(training) < 2 or not validation:
        raise ValueError('Grouped train/validation split unavailable')

    import torch
    import torchvision
    from PIL import Image
    if torch.__version__.split('+')[0] != '2.7.1' or torchvision.__version__.split('+')[0] != '0.22.1':
        raise ValueError('Pinned local CPU training environment required')
    torch.set_num_threads(plan['threads'])
    torch.manual_seed(20261014)
    random.seed(20261014)
    cfg = read(REPO / 'ml/vision/experiment.stairs.json')
    cfg['epochs'] = 1
    cfg['batchSize'] = 2
    cfg['freezeBackboneEpochs'] = 0
    cfg['researchOnly'] = True
    model = build_model(torch, torchvision, 4, cfg)
    optimizer = torch.optim.SGD(model.parameters(), lr=cfg['learningRate'], momentum=.9)

    def example(item):
        with Image.open(item['path']) as image:
            tensor = torchvision.transforms.functional.to_tensor(image.convert('RGB'))
        width, height = tensor.shape[2], tensor.shape[1]
        boxes = [[o['box'][0] * width, o['box'][1] * height,
                  (o['box'][0] + o['box'][2]) * width, (o['box'][1] + o['box'][3]) * height]
                 for o in item['labels']]
        return tensor, {'boxes': torch.tensor(boxes, dtype=torch.float32),
                        'labels': torch.tensor([o['classId'] - 2300 for o in item['labels']], dtype=torch.int64)}

    model.train()
    for module in model.modules():
        if isinstance(module, torch.nn.BatchNorm2d):
            module.eval()
    losses = []
    for item in training:
        time_check()
        image, target = example(item)
        optimizer.zero_grad(set_to_none=True)
        loss = sum(model([image], [target]).values())
        if not torch.isfinite(loss):
            raise ValueError('Nonfinite training loss')
        loss.backward()
        optimizer.step()
        losses.append(float(loss.detach()))

    model.eval()
    validation_predictions = []
    with torch.inference_mode():
        for item in validation:
            time_check()
            image, _ = example(item)
            prediction = model([image])[0]
            validation_predictions.append({'imageSha256': item['sha256'],
                'detections': int(len(prediction['scores'])), 'scope': 'development_validation_only'})
    output = Path(plan['output'])
    output.mkdir(parents=False, exist_ok=False)
    torch.save(model.cpu().state_dict(), output / 'weights.pt')
    categories = read(REPO / 'ml/vision/stairs-task.v1.json')['categories']
    write(output / 'training-run.json', {
        'schemaVersion': 1, 'scope': 'local_research_only', 'config': cfg,
        'categories': categories, 'taxonomySha256': digest(REPO / 'ml/vision/taxonomy.v1.json'),
        'taskPolicySha256': digest(REPO / 'ml/vision/stairs-task.v1.json'),
        'weightsSha256': digest(output / 'weights.pt'), 'trainingPerformed': True,
        'source': 'random_initialization_no_external_weights', 'device': 'cpu',
        'meanTrainingLoss': sum(losses) / len(losses), 'validation': validation_predictions,
        'humanApproval': False, 'productionEligible': False,
        'independentTestPerformed': False, 'navigationSafetyEstablished': False,
    })
    class Args:
        run = str(output)
        output = str(output / 'onnx')
    time_check()
    export_onnx(Args())
    contract = read(output / 'onnx/browser-contract.json')
    write(output / 'report.json', {
        'trainingPerformed': True, 'onnxVerified': True,
        'weightsSha256': digest(output / 'weights.pt'),
        'onnxSha256': digest(output / 'onnx/model.onnx'),
        'exportParity': contract['exportParity'],
        'validationScope': 'small_development_holdout_not_accuracy_or_safety_evidence',
    })


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: research-train.py PRIVATE_PLAN_JSON')
    main(sys.argv[1])
