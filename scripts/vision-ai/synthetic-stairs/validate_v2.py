"""Validate and freeze the V2 synthetic cohort before model selection."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

from generate_v2 import DOWN, ESCALATOR, MATERIALS, UP
from validate import decode_rle, inside, sha256


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode('utf-8')).hexdigest()


def test_fingerprint(data):
    scenes = sorted((scene for scene in data['scenes'] if scene['split'] == 'test'),
                    key=lambda scene: scene['id'])
    samples = sorted((sample for sample in data['samples'] if sample['split'] == 'test'),
                     key=lambda sample: sample['id'])
    return canonical_sha({'scenes': scenes, 'samples': samples,
                          'categories': data['categories']})


def validate(manifest_path, previous_manifests=()):
    root = manifest_path.resolve().parent
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    if (data.get('schemaVersion') != 2 or data.get('task') != 'basira-stairs-v2-research'
            or data.get('contentKind') != 'synthetic_ground_truth'):
        raise ValueError('V2 synthetic-only manifest required')
    scenes = {scene['id']: scene for scene in data['scenes']}
    if len(scenes) != 48 or len(set(scene['seed'] for scene in scenes.values())) != 48:
        raise ValueError('Expected 48 distinct scene IDs and seeds')
    scene_splits, group_splits = defaultdict(set), defaultdict(set)
    scene_counts = Counter()
    material_counts = Counter()
    for scene in scenes.values():
        split = scene['split']
        if split not in ('train', 'validation', 'test'):
            raise ValueError('Unknown split')
        category = scene['side'] if scene['kind'] == 'stairs' else 'nonfixed'
        scene_counts[(split, category)] += 1
        if scene['kind'] == 'stairs':
            material_counts[(split, scene['side'], scene['material'])] += 1
    for split, repeats in (('train', 2), ('validation', 1), ('test', 1)):
        if any(scene_counts[(split, category)] != 4 * repeats
               for category in ('up', 'down', 'nonfixed')):
            raise ValueError('Scene-level up/down/nonfixed balance failed')
        if any(material_counts[(split, direction, material)] != repeats
               for direction in ('up', 'down') for material in MATERIALS):
            raise ValueError('Materials not crossed with both stair directions')
    sample_by_id = {}
    masks = {}
    video_samples = defaultdict(list)
    counts = Counter()
    for sample in data['samples']:
        sid = sample['id']
        if sid in sample_by_id:
            raise ValueError('Duplicate sample ID')
        sample_by_id[sid] = sample
        scene = scenes[sample['scene_id']]
        split = sample['split']
        if split != scene['split'] or sample['group'] != scene['group']:
            raise ValueError('Scene/group split mismatch')
        scene_splits[scene['id']].add(split)
        group_splits[sample['group']].add(split)
        image_path, mask_path = inside(root, sample['path']), inside(root, sample['mask'])
        if sha256(image_path) != sample['sha256'] or sha256(mask_path) != sample['maskSha256']:
            raise ValueError(f'Image or mask changed: {sid}')
        with Image.open(image_path) as image:
            image.verify()
        with Image.open(image_path) as image:
            width, height = image.size
            if image.mode != 'RGB' or (width, height) != (320, 240):
                raise ValueError(f'Unexpected RGB image: {sid}')
        with Image.open(mask_path) as image:
            mask = np.asarray(image)
        if mask.shape != (height, width) or not np.isin(mask, [0, 1]).all():
            raise ValueError(f'Invalid mask: {sid}')
        masks[sid] = mask
        kind = scene['kind']
        expected_class = (UP if scene['side'] == 'up' else DOWN) if kind == 'stairs' else (
            ESCALATOR if kind == 'escalator' else None)
        if (sample['stairs_present'] != (kind == 'stairs') or
                sample['escalator_present'] != (kind == 'escalator') or
                sample['stair_direction'] != expected_class or
                bool(sample['objects']) != (expected_class is not None) or
                bool(mask.any()) != (expected_class is not None)):
            raise ValueError(f'Presence/category mismatch: {sid}')
        if expected_class is not None:
            obj = sample['objects'][0]
            ys, xs = np.where(mask == 1)
            box = [xs.min() / width, ys.min() / height,
                   (xs.max() - xs.min() + 1) / width,
                   (ys.max() - ys.min() + 1) / height]
            if (len(sample['objects']) != 1 or obj['classId'] != expected_class or
                    obj['source'] != 'synthetic_ground_truth' or
                    max(abs(a - b) for a, b in zip(box, obj['box'])) > 1 / width or
                    obj['areaPixels'] != int(mask.sum()) or
                    sample['visibleTreads'] < 2 or sample['visibleTreadPixels'] < 24):
                raise ValueError(f'Geometry box/treads mismatch: {sid}')
            pose = sample['camera_pose']
            axis_x, axis_y = math.sin(scene['yawRadians']), math.cos(scene['yawRadians'])
            middle = scene['steps'] * scene['runMetres'] / 2
            side_x = middle * axis_x - pose['position'][0]
            side_y = middle * axis_y - pose['position'][1]
            gaze_x = pose['target'][0] - pose['position'][0]
            gaze_y = pose['target'][1] - pose['position'][1]
            side = (side_x * axis_x + side_y * axis_y) / math.hypot(side_x, side_y)
            gaze = (gaze_x * axis_x + gaze_y * axis_y) / math.hypot(gaze_x, gaze_y)
            if (abs(side - sample['direction_alignment']) > 1e-6 or
                    abs(gaze - sample['gaze_alignment']) > 1e-6):
                raise ValueError(f'Camera pose disagrees with geometric direction: {sid}')
            if kind == 'stairs' and not ((side >= .35 and gaze >= .35) if expected_class == UP
                                         else (side <= -.35 and gaze <= -.35)):
                raise ValueError(f'Fixed stair direction not camera-relative: {sid}')
        counts[(split, kind, scene['side'])] += 1
        if sample['video_id']:
            video_samples[sample['video_id']].append(sample)
    if any(len(parts) != 1 for parts in scene_splits.values()) or any(len(parts) != 1 for parts in group_splits.values()):
        raise ValueError('Scene or video group crosses data splits')
    if len(video_samples) != 2:
        raise ValueError('Two train-only camera-motion sequences expected')
    for video in data['videos']:
        frames = sorted(video_samples[video['id']], key=lambda item: item['frame_id'])
        if (len(frames) != 8 or [item['frame_id'] for item in frames] != list(range(100, 108)) or
                {item['split'] for item in frames} != {'train'} or
                len({item['scene_id'] for item in frames}) != 1):
            raise ValueError('Video group/frame leakage or missing frames')
        if video.get('webm') and sha256(inside(root, video['webm'])) != video['webmSha256']:
            raise ValueError('Encoded video changed')
    category_ids = {category['id'] for category in data['categories']}
    if category_ids != {UP, DOWN, 2303, ESCALATOR}:
        raise ValueError('Escalator must be a distinct category')
    for split in ('train', 'validation', 'test'):
        coco = json.loads((root / f'coco-{split}.json').read_text(encoding='utf-8'))
        chosen = {sample['id']: sample for sample in data['samples'] if sample['split'] == split}
        if len(coco['images']) != len(chosen):
            raise ValueError('COCO image count mismatch')
        image_by_id = {image['id']: image for image in coco['images']}
        annotations = defaultdict(list)
        for ann in coco['annotations']:
            image = image_by_id[ann['image_id']]
            sample = chosen[image['sample_id']]
            mask = decode_rle(ann['segmentation'], image['height'], image['width'])
            box = ann['bbox']
            expected_box = [sample['objects'][0]['box'][0] * image['width'],
                            sample['objects'][0]['box'][1] * image['height'],
                            sample['objects'][0]['box'][2] * image['width'],
                            sample['objects'][0]['box'][3] * image['height']]
            if (len(box) != 4 or any(not math.isfinite(value) for value in box) or
                    box[0] < 0 or box[1] < 0 or box[2] <= 0 or box[3] <= 0 or
                    box[0] + box[2] > image['width'] + 1e-6 or
                    box[1] + box[3] > image['height'] + 1e-6 or
                    max(abs(a - b) for a, b in zip(box, expected_box)) > 1e-6):
                raise ValueError('COCO box differs from geometric mask')
            if (ann['source'] != 'synthetic_ground_truth' or
                    ann['category_id'] != sample['stair_direction'] or
                    not np.array_equal(mask, masks[sample['id']]) or
                    ann['area'] != int(mask.sum())):
                raise ValueError('COCO mask/category mismatch')
            annotations[image['id']].append(ann)
        if any(len(annotations[image['id']]) != len(chosen[image['sample_id']]['objects'])
               for image in coco['images']):
            raise ValueError('COCO missing/extra annotation')
    previous_hashes, previous_scenes = set(), set()
    for previous in previous_manifests:
        older = json.loads(Path(previous).read_text(encoding='utf-8'))
        previous_hashes.update(sample['sha256'] for sample in older['samples'])
        previous_scenes.update(scene['id'] for scene in older['scenes'])
    test = [sample for sample in data['samples'] if sample['split'] == 'test']
    if any(sample['sha256'] in previous_hashes or sample['scene_id'] in previous_scenes
           for sample in test):
        raise ValueError('Fresh synthetic test reuses a prior attempt')
    return {"passed": True, "manifestSha256": sha256(manifest_path),
            "testFingerprint": test_fingerprint(data), "scenes": len(scenes),
            "images": len(sample_by_id), "videos": len(video_samples),
            "sceneCounts": {split: {kind: scene_counts[(split, kind)] for kind in
                                    ('up', 'down', 'nonfixed')} for split in
                            ('train', 'validation', 'test')},
            "imageCounts": {split: sum(sample['split'] == split for sample in data['samples'])
                            for split in ('train', 'validation', 'test')},
            "priorManifestCount": len(previous_manifests),
            "realCameraEvaluation": "not_performed"}


def freeze(manifest_path, result):
    path = manifest_path.resolve().parent / 'test-freeze.json'
    value = {"schemaVersion": 1, "scope": "new_scene_disjoint_synthetic_test",
             "manifestSha256": result['manifestSha256'],
             "testFingerprint": result['testFingerprint'],
             "testSceneCount": result['sceneCounts']['test'],
             "rule": "Do not inspect test model results before validation-only selection"}
    if path.exists():
        if json.loads(path.read_text(encoding='utf-8')) != value:
            raise ValueError('Frozen test fingerprint changed')
    else:
        path.write_text(json.dumps(value, indent=2), encoding='utf-8')
    return path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--previous-manifest', type=Path, action='append', default=[])
    parser.add_argument('--freeze-test', action='store_true')
    args = parser.parse_args()
    report = validate(args.manifest, args.previous_manifest)
    if args.freeze_test:
        report['freezePath'] = str(freeze(args.manifest, report))
    print(json.dumps(report))
