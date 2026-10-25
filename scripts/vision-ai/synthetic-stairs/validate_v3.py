"""Independent file/geometry/split audit of V3; performs no model inference."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

from validate import decode_rle


SPLITS = ('train', 'validation', 'test')
MATERIALS = ('concrete', 'stone', 'wood', 'metal')
CLASS_IDS = {2301, 2302, 2303, 2304}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_file(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Expected a private-root-relative media path')
    original = root / relative
    resolved = original.resolve()
    if root not in resolved.parents or original.is_symlink() or not resolved.is_file():
        raise ValueError('Media path is missing, linked, or escapes synthetic root')
    return resolved


def ensure_partition(records, key, name):
    membership = defaultdict(set)
    for record in records:
        membership[record[key]].add(record['split'])
    if any(len(values) > 1 for values in membership.values()):
        raise ValueError(f'{name} crosses split boundaries')


def geometric_direction(scene, sample):
    """Recompute using scene geometry and pose, independent of generator helpers."""
    pose = sample['camera_pose']
    position, target = pose['position'], pose['target']
    if (len(position) != 3 or len(target) != 3 or
            any(not math.isfinite(value) for value in position + target) or
            not 40 <= pose['fov_degrees'] <= 100):
        raise ValueError('Invalid pinhole camera pose')
    axis = (math.sin(scene['yaw']), math.cos(scene['yaw']))
    midpoint = scene['steps'] * scene['run'] / 2
    delta = (midpoint * axis[0] - position[0], midpoint * axis[1] - position[1])
    gaze = (target[0] - position[0], target[1] - position[1])
    norms = math.hypot(*delta), math.hypot(*gaze)
    if min(norms) <= 1e-9:
        raise ValueError('Degenerate geometric camera direction')
    side = sum(a * b for a, b in zip(delta, axis)) / norms[0]
    alignment = sum(a * b for a, b in zip(gaze, axis)) / norms[1]
    expected = 2303
    if side >= .35 and alignment >= .35:
        expected = 2301
    elif side <= -.35 and alignment <= -.35:
        expected = 2302
    if sample['visibleTreads'] < 3:
        expected = 2303
    return expected, side, alignment


def dhash(image):
    gray = np.asarray(image.convert('L').resize((9, 8), Image.Resampling.BILINEAR))
    value = 0
    for bit in (gray[:, 1:] > gray[:, :-1]).reshape(-1):
        value = (value << 1) | int(bit)
    return value


def perceptual_audit(samples, hashes, threshold=4):
    counts = Counter()
    examples = []
    for index, first in enumerate(samples):
        for second in samples[index + 1:]:
            if first['scene_id'] == second['scene_id']:
                continue
            distance = (hashes[first['id']] ^ hashes[second['id']]).bit_count()
            if distance > threshold:
                continue
            category = 'crossSplit' if first['split'] != second['split'] else 'sameSplit'
            counts[category] += 1
            if category == 'crossSplit':
                kind_pair = '/'.join(sorted((first['kind'], second['kind'])))
                counts['kind:' + kind_pair] += 1
                counts['crossSplitWithObject'] += int(bool(first['objects']) or bool(second['objects']))
                counts['crossSplitBothObjects'] += int(bool(first['objects']) and bool(second['objects']))
                if distance == 0:
                    counts['zeroKind:' + kind_pair] += 1
            counts['allCrossScene'] += 1
            counts['zeroDistance'] += int(distance == 0)
            split_pair = '/'.join(sorted((first['split'], second['split'])))
            counts['split:' + split_pair] += 1
            if len(examples) < 20:
                examples.append({'first': first['id'], 'second': second['id'],
                                 'distance': distance, 'splitPair': split_pair})
    return {'method': '64-bit grayscale dHash, 9x8 bilinear, Hamming distance <= 4',
            'threshold': threshold, 'crossSceneNearDuplicatePairs': counts['allCrossScene'],
            'crossSplitNearDuplicatePairs': counts['crossSplit'],
            'sameSplitCrossSceneNearDuplicatePairs': counts['sameSplit'],
            'zeroDistanceCrossScenePairs': counts['zeroDistance'],
            'splitPairCounts': {key[6:]: value for key, value in counts.items() if key.startswith('split:')},
            'crossSplitSubtypePairs': {key[5:]: value for key, value in counts.items() if key.startswith('kind:')},
            'crossSplitZeroDistanceSubtypePairs': {key[9:]: value for key, value in counts.items() if key.startswith('zeroKind:')},
            'crossSplitPairsWithAnyObject': counts['crossSplitWithObject'],
            'crossSplitPairsWithBothObjects': counts['crossSplitBothObjects'],
            'examples': examples,
            'interpretation': 'Coarse similarity audit, not identity proof; flat floors and repeated geometry can collide. No labels or model settings were changed from this audit.'}


def validate(manifest_path, previous_paths=()):
    root = manifest_path.resolve().parent
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    if (data.get('schemaVersion') != 3 or data.get('task') != 'basira-stairs-v3-research' or
            data.get('contentKind') != 'synthetic_ground_truth'):
        raise ValueError('V3 synthetic-only manifest required')
    scenes = {scene['id']: scene for scene in data['scenes']}
    if len(scenes) != len(data['scenes']) or len({scene['seed'] for scene in scenes.values()}) != len(scenes):
        raise ValueError('Scene IDs or generation seeds are repeated')
    ensure_partition(data['scenes'], 'id', 'Scene')
    ensure_partition(data['scenes'], 'seed', 'Seed')
    for split in SPLITS:
        selected = [scene for scene in scenes.values() if scene['split'] == split]
        for scene in selected:
            if (not isinstance(scene['steps'], int) or not 5 <= scene['steps'] <= 12 or
                    not .26 <= scene['run'] <= .36 or not .14 <= scene['rise'] <= .19 or
                    not 1.15 <= scene['width'] <= 2.4 or not -.7 <= scene['yaw'] <= .7):
                raise ValueError('Implausible stair geometry bounds')
        fixed = [scene for scene in selected if scene['kind'] == 'stairs']
        crossing = Counter((scene['material'], scene['environment']) for scene in fixed)
        if set(crossing) != {(material, environment) for material in MATERIALS
                             for environment in ('indoor', 'outdoor')} or len(set(crossing.values())) != 1:
            raise ValueError('Fixed-stair material/environment crossing is incomplete or unbalanced')
        if split == 'train':
            for kind in ('ramp', 'stripes', 'empty', 'escalator'):
                crossing = {(scene['material'], scene['environment']) for scene in selected if scene['kind'] == kind}
                if crossing != {(material, environment) for material in MATERIALS for environment in ('indoor', 'outdoor')}:
                    raise ValueError(f'Training subtype {kind} lacks material/environment crossing')
    ids, paths, raster_masks, dhashes = {}, set(), {}, {}
    grouped = defaultdict(list)
    exact = defaultdict(list)
    sample_counts = Counter()
    for sample in data['samples']:
        sid = sample['id']
        if sid in ids or sample['path'] in paths:
            raise ValueError('Duplicate sample ID or image path')
        ids[sid], _ = sample, paths.add(sample['path'])
        scene = scenes[sample['scene_id']]
        if (sample['split'] not in SPLITS or sample['split'] != scene['split'] or
                sample['group'] != scene['group'] or sample['kind'] != scene['kind'] or
                sample.get('contentKind') != 'synthetic_ground_truth'):
            raise ValueError('Scene/group/provenance mismatch')
        grouped[scene['id']].append(sample)
        image_path, mask_path = safe_file(root, sample['path']), safe_file(root, sample['mask'])
        if sha256(image_path) != sample['sha256'] or sha256(mask_path) != sample['maskSha256']:
            raise ValueError(f'Image or mask changed: {sid}')
        with Image.open(image_path) as image:
            image.verify()
        with Image.open(image_path) as image:
            if image.mode != 'RGB' or image.size != (320, 240):
                raise ValueError(f'Unexpected image mode/dimensions: {sid}')
            dhashes[sid] = dhash(image)
        with Image.open(mask_path) as image:
            if image.mode != 'L' or image.size != (320, 240):
                raise ValueError(f'Unexpected mask mode/dimensions: {sid}')
            mask = np.asarray(image).copy()
        if not np.isin(mask, (0, 1)).all():
            raise ValueError('Mask is not binary 0/1')
        raster_masks[sid] = mask
        exact[sample['sha256']].append(sample)
        if not isinstance(sample['visibleTreads'], int) or not 0 <= sample['visibleTreads'] <= scene['steps']:
            raise ValueError('Invalid visible tread count')
        object_kind = scene['kind'] in ('stairs', 'escalator')
        if bool(mask.any()) != object_kind or bool(sample['objects']) != object_kind:
            raise ValueError('Object mask/presence mismatch')
        if object_kind:
            expected, side, gaze = geometric_direction(scene, sample)
            if abs(side - sample['direction_alignment']) > 1e-6 or abs(gaze - sample['gaze_alignment']) > 1e-6:
                raise ValueError('Stored direction evidence differs from geometry')
            if scene['kind'] == 'escalator':
                expected = 2304
            obj = sample['objects'][0]
            ys, xs = np.where(mask == 1)
            box = [xs.min() / 320, ys.min() / 240,
                   (xs.max() - xs.min() + 1) / 320, (ys.max() - ys.min() + 1) / 240]
            if (len(sample['objects']) != 1 or obj['classId'] != expected or
                    obj['source'] != 'synthetic_ground_truth' or
                    obj['areaPixels'] != int(mask.sum()) or len(obj['box']) != 4 or
                    any(not math.isfinite(value) for value in obj['box']) or
                    max(abs(float(a) - float(b)) for a, b in zip(box, obj['box'])) > 1e-8):
                raise ValueError(f'Geometric label/box/area mismatch: {sid}')
        else:
            geometric_direction(scene, sample)  # also checks pose for nonobject views
            if sample['direction_alignment'] is not None or sample['gaze_alignment'] is not None:
                raise ValueError('Background has direction evidence')
        sample_counts[(sample['split'], sample['objects'][0]['classId'] if sample['objects'] else 0)] += 1
    ensure_partition(data['samples'], 'scene_id', 'Sample scene')
    ensure_partition(data['samples'], 'group', 'Sample group')
    exact_cross_scene = 0
    for same in exact.values():
        if len({sample['split'] for sample in same}) > 1:
            raise ValueError('Byte-identical image leaks across splits')
        exact_cross_scene += int(len({sample['scene_id'] for sample in same}) > 1)
    for scene_id, samples in grouped.items():
        expected = {('up', 0), ('up', 1), ('down', 0), ('down', 1)}
        if scenes[scene_id]['kind'] == 'stairs':
            expected.add(('side', 0))
        if {(sample['view'], sample['frame_id']) for sample in samples} != expected or len(samples) != len(expected):
            raise ValueError('Scene lacks paired up/down/side views or duplicates frames')
    if {category['id'] for category in data['categories']} != CLASS_IDS:
        raise ValueError('Task categories changed')
    for split in SPLITS:
        coco = json.loads((root / f'coco-{split}.json').read_text(encoding='utf-8'))
        if {category['id'] for category in coco['categories']} != CLASS_IDS:
            raise ValueError('COCO task categories changed')
        chosen = {sid: sample for sid, sample in ids.items() if sample['split'] == split}
        image_map = {image['id']: image for image in coco['images']}
        if len(image_map) != len(coco['images']) or len(image_map) != len(chosen):
            raise ValueError('COCO duplicate/missing image')
        ann_map = defaultdict(list)
        if len({ann['id'] for ann in coco['annotations']}) != len(coco['annotations']):
            raise ValueError('COCO duplicate annotation ID')
        for image in coco['images']:
            sample = chosen.get(image['sample_id'])
            if (not sample or image['file_name'] != sample['path'] or image['scene_id'] != sample['scene_id'] or
                    (image['width'], image['height']) != (320, 240)):
                raise ValueError('COCO image binding mismatch')
        for annotation in coco['annotations']:
            image = image_map[annotation['image_id']]
            sample = chosen[image['sample_id']]
            if not sample['objects']:
                raise ValueError('COCO annotation on background')
            obj = sample['objects'][0]
            decoded = decode_rle(annotation['segmentation'], 240, 320)
            expected_box = [value * scale for value, scale in zip(obj['box'], (320, 240, 320, 240))]
            if (annotation['category_id'] != obj['classId'] or annotation['source'] != 'synthetic_ground_truth' or
                    annotation['area'] != int(decoded.sum()) or
                    not np.array_equal(decoded, raster_masks[sample['id']]) or
                    len(annotation['bbox']) != 4 or
                    any(not math.isfinite(value) for value in annotation['bbox']) or
                    max(abs(a - b) for a, b in zip(expected_box, annotation['bbox'])) > 1e-6):
                raise ValueError('COCO RLE/box/category differs from geometric sample')
            ann_map[image['id']].append(annotation)
        if any(len(ann_map[image['id']]) != len(chosen[image['sample_id']]['objects']) for image in coco['images']):
            raise ValueError('COCO missing/extra annotation')
    freeze = json.loads((root / 'test-freeze.json').read_text(encoding='utf-8'))
    test = {'scenes': [scene for scene in data['scenes'] if scene['split'] == 'test'],
            'samples': [sample for sample in data['samples'] if sample['split'] == 'test']}
    fingerprint = hashlib.sha256(json.dumps(test, sort_keys=True).encode()).hexdigest()
    manifest_sha = sha256(manifest_path)
    if freeze['manifestSha256'] != manifest_sha or freeze['testFingerprint'] != fingerprint:
        raise ValueError('Frozen test or manifest changed')
    old_hashes, old_scenes = set(), set()
    previous_sha = []
    for previous in previous_paths:
        older = json.loads(previous.read_text(encoding='utf-8'))
        previous_sha.append(sha256(previous))
        old_hashes.update(sample['sha256'] for sample in older['samples'])
        old_scenes.update(sample['scene_id'] for sample in older['samples'])
    if not previous_paths or sorted(previous_sha) != sorted(freeze['priorManifests']):
        raise ValueError('Prior-manifest freshness evidence differs from freeze')
    if any(sample['sha256'] in old_hashes or sample['scene_id'] in old_scenes for sample in test['samples']):
        raise ValueError('V3 final test overlaps earlier V1/V2 data')
    return {'schemaVersion': 1, 'passed': True, 'scope': 'independent_synthetic_file_geometry_split_audit',
            'manifestSha256': manifest_sha, 'testFingerprint': fingerprint,
            'images': len(ids), 'scenes': len(scenes),
            'splits': {split: {'images': sum(sample['split'] == split for sample in ids.values()),
                               'scenes': sum(scene['split'] == split for scene in scenes.values()),
                               'classes': {str(label): sample_counts[(split, label)] for label in (0, 2301, 2302, 2303, 2304)}}
                       for split in SPLITS},
            'priorManifestsChecked': len(previous_paths),
            'exactDuplicateHashGroupsAcrossScenes': exact_cross_scene,
            'perceptualSimilarity': perceptual_audit(list(ids.values()), dhashes),
            'modelInferencePerformed': False, 'realCameraEvaluation': 'not_performed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--previous-manifest', type=Path, action='append', default=[])
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = validate(args.manifest, args.previous_manifest)
    if args.output:
        args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
