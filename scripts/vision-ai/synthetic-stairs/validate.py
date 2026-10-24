"""Independently verify generated RGB, geometry labels, masks, COCO, and split isolation."""
import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image


CLASSES = {2301: 'stairs_up', 2302: 'stairs_down',
           2303: 'stairs_present_uncertain_direction'}
SPLITS = ('train', 'validation', 'test')


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def inside(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Invalid relative media path')
    path = (root / relative).resolve()
    if root not in path.parents or path.is_symlink():
        raise ValueError('Media path escapes private synthetic root')
    return path


def decode_rle(rle, height, width):
    if rle.get('size') != [height, width]:
        raise ValueError('COCO mask size mismatch')
    counts = rle.get('counts')
    if not isinstance(counts, list) or not counts or any(not isinstance(x, int) or x < 0 for x in counts):
        raise ValueError('Invalid uncompressed COCO RLE')
    flat = np.zeros(height * width, dtype=np.uint8)
    offset, value = 0, 0
    for count in counts:
        if offset + count > flat.size:
            raise ValueError('COCO RLE overflow')
        if value:
            flat[offset:offset + count] = 1
        offset += count
        value = 1 - value
    if offset != flat.size:
        raise ValueError('COCO RLE underflow')
    return flat.reshape((height, width), order='F')


def validate(manifest_path):
    root = manifest_path.resolve().parent
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    if (data.get('schemaVersion') != 1 or data.get('task') != 'basira-stairs-v1' or
            data.get('contentKind') != 'synthetic_ground_truth'):
        raise ValueError('Synthetic-only task contract required')
    scenes = {s['id']: s for s in data['scenes']}
    if len(scenes) != len(data['scenes']):
        raise ValueError('Duplicate scene IDs')
    scene_splits = defaultdict(set)
    group_splits = defaultdict(set)
    samples = {}
    counts = Counter()
    video_samples = defaultdict(list)
    masks = {}
    for sample in data['samples']:
        sid = sample['id']
        if sid in samples:
            raise ValueError(f'Duplicate sample: {sid}')
        samples[sid] = sample
        scene = scenes[sample['scene_id']]
        split = sample['split']
        if split not in SPLITS or split != scene['split'] or sample['group'] != scene['group']:
            raise ValueError(f'Invalid scene/group split: {sid}')
        scene_splits[sample['scene_id']].add(split)
        group_splits[sample['group']].add(split)
        counts[(split, 'images')] += 1
        image_path = inside(root, sample['path'])
        mask_path = inside(root, sample['mask'])
        if sha256(image_path) != sample['sha256'] or sha256(mask_path) != sample['maskSha256']:
            raise ValueError(f'Image/mask SHA changed: {sid}')
        with Image.open(image_path) as image:
            image.verify()
        with Image.open(image_path) as image:
            width, height = image.size
            if image.mode != 'RGB':
                raise ValueError(f'RGB image required: {sid}')
        with Image.open(mask_path) as image:
            mask = np.asarray(image)
        if mask.shape != (height, width) or not np.isin(mask, [0, 1]).all():
            raise ValueError(f'Invalid binary mask: {sid}')
        masks[sid] = mask
        present = bool(mask.any())
        if present != sample['stairs_present'] or present != bool(sample['objects']):
            raise ValueError(f'Mask/presence mismatch: {sid}')
        if present:
            counts[(split, 'positive')] += 1
            ys, xs = np.where(mask == 1)
            pixel_box = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1),
                         int(ys.max() - ys.min() + 1)]
            if len(sample['objects']) != 1:
                raise ValueError(f'Only one synthetic staircase supported: {sid}')
            obj = sample['objects'][0]
            if obj.get('source') != 'synthetic_ground_truth' or obj['classId'] not in CLASSES:
                raise ValueError(f'Unsupported synthetic object: {sid}')
            box = obj['box']
            if (len(box) != 4 or any(not math.isfinite(x) for x in box) or
                    not all(0 <= x <= 1 for x in box) or box[2] <= 0 or box[3] <= 0 or
                    box[0] + box[2] > 1 + 1e-8 or box[1] + box[3] > 1 + 1e-8):
                raise ValueError(f'Invalid normalized box: {sid}')
            scaled = [box[0] * width, box[1] * height, box[2] * width, box[3] * height]
            if max(abs(a - b) for a, b in zip(scaled, pixel_box)) > 1.01:
                raise ValueError(f'Mask/bounding box disagreement: {sid}')
            if obj['areaPixels'] != int(mask.sum()) or obj['classId'] != sample['stair_direction']:
                raise ValueError(f'Area/direction mismatch: {sid}')
            if obj['classId'] in (2301, 2302) and (
                    not isinstance(sample.get('visibleTreads'), int) or sample['visibleTreads'] < 2 or
                    not isinstance(sample.get('visibleTreadPixels'), int) or
                    sample['visibleTreadPixels'] < 24 or
                    sample['visibleTreadPixels'] > int(mask.sum())):
                raise ValueError(f'Direction label lacks visible stair treads: {sid}')
            alignment = sample['direction_alignment']
            if not math.isfinite(alignment) or not -1 <= alignment <= 1:
                raise ValueError(f'Invalid camera/stair alignment: {sid}')
            pose = sample['camera_pose']
            angle = scene['yawRadians']
            axis_x, axis_y = math.sin(angle), math.cos(angle)
            midpoint = scene['steps'] * scene['runMetres'] / 2
            side_x = midpoint * axis_x - pose['position'][0]
            side_y = midpoint * axis_y - pose['position'][1]
            gaze_x = pose['target'][0] - pose['position'][0]
            gaze_y = pose['target'][1] - pose['position'][1]
            side_norm, gaze_norm = math.hypot(side_x, side_y), math.hypot(gaze_x, gaze_y)
            if not side_norm or not gaze_norm:
                raise ValueError(f'Degenerate camera/stair direction: {sid}')
            geometric_alignment = (side_x * axis_x + side_y * axis_y) / side_norm
            gaze_alignment = (gaze_x * axis_x + gaze_y * axis_y) / gaze_norm
            if abs(alignment - geometric_alignment) > 1e-6:
                raise ValueError(f'Direction alignment differs from scene geometry: {sid}')
            if sample.get('gaze_alignment') is not None and abs(sample['gaze_alignment'] - gaze_alignment) > 1e-6:
                raise ValueError(f'Gaze alignment differs from camera pose: {sid}')
            supports_up = alignment >= 0.35 and gaze_alignment >= 0.35
            supports_down = alignment <= -0.35 and gaze_alignment <= -0.35
            if (obj['classId'] == 2301 and not supports_up or
                    obj['classId'] == 2302 and not supports_down or
                    obj['classId'] == 2303 and (supports_up or supports_down)):
                raise ValueError(f'Stair direction not supported by camera position and gaze: {sid}')
            counts[(split, CLASSES[obj['classId']])] += 1
        elif sample['stair_direction'] is not None:
            raise ValueError(f'Negative frame has stairs direction: {sid}')
        pose = sample['camera_pose']
        if (len(pose['position']) != 3 or len(pose['target']) != 3 or
                any(not math.isfinite(x) for x in pose['position'] + pose['target']) or
                not 30 <= pose['fov_degrees'] <= 100):
            raise ValueError(f'Invalid perspective camera: {sid}')
        if sample['video_id']:
            video_samples[sample['video_id']].append(sample)
    if any(len(s) != 1 for s in scene_splits.values()) or any(len(s) != 1 for s in group_splits.values()):
        raise ValueError('Scene or motion group leaks across splits')
    if len(video_samples) < 2:
        raise ValueError('Two camera-motion sequences required')
    for video in data['videos']:
        frames = sorted(video_samples[video['id']], key=lambda x: x['frame_id'])
        frame_ids = [x['frame_id'] for x in frames]
        if (len(frames) != video['frames'] or not frame_ids or frame_ids[0] < 0 or
                frame_ids != list(range(frame_ids[0], frame_ids[0] + video['frames']))):
            raise ValueError('Video frame count/order mismatch')
        if (len({x['scene_id'] for x in frames}) != 1 or len({x['group'] for x in frames}) != 1 or
                len({x['split'] for x in frames}) != 1 or
                len({x['stair_direction'] for x in frames}) != 1):
            raise ValueError('Video scene/group/direction changes across frames')
        if video['scene_id'] != frames[0]['scene_id'] or video['group'] != frames[0]['group']:
            raise ValueError('Video manifest binding mismatch')
        if video.get('mp4') and not inside(root, video['mp4']).is_file():
            raise ValueError('Claimed MP4 is missing')
        if video.get('webm'):
            webm_path = inside(root, video['webm'])
            if not webm_path.is_file() or sha256(webm_path) != video.get('webmSha256'):
                raise ValueError('WebM missing or SHA changed')
    for split in SPLITS:
        coco = json.loads((root / f'coco-{split}.json').read_text(encoding='utf-8'))
        if {x['id'] for x in coco['categories']} != set(CLASSES):
            raise ValueError('COCO task categories mismatch')
        selected = {s['id']: s for s in data['samples'] if s['split'] == split}
        if len(coco['images']) != len(selected):
            raise ValueError('COCO image count mismatch')
        image_by_id = {}
        for image in coco['images']:
            sample = selected.get(image['sample_id'])
            if not sample or image['file_name'] != sample['path'] or image['sha256'] != sample['sha256']:
                raise ValueError('COCO image provenance mismatch')
            image_by_id[image['id']] = image
        annotations_by_image = defaultdict(list)
        for ann in coco['annotations']:
            image = image_by_id.get(ann['image_id'])
            if not image or ann['category_id'] not in CLASSES or ann.get('source') != 'synthetic_ground_truth':
                raise ValueError('Invalid COCO annotation')
            sample = selected[image['sample_id']]
            box = ann['bbox']
            if (len(box) != 4 or not all(math.isfinite(x) for x in box) or
                    box[0] < 0 or box[1] < 0 or box[2] <= 0 or box[3] <= 0 or
                    box[0] + box[2] > image['width'] + 1e-6 or
                    box[1] + box[3] > image['height'] + 1e-6):
                raise ValueError('COCO box outside image')
            rle_mask = decode_rle(ann['segmentation'], image['height'], image['width'])
            if not np.array_equal(rle_mask, masks[sample['id']]):
                raise ValueError('COCO RLE differs from raster mask')
            if ann['area'] != int(rle_mask.sum()) or ann['category_id'] != sample['stair_direction']:
                raise ValueError('COCO area/direction mismatch')
            annotations_by_image[ann['image_id']].append(ann)
        for image in coco['images']:
            sample = selected[image['sample_id']]
            if len(annotations_by_image[image['id']]) != len(sample['objects']):
                raise ValueError('COCO missing/extra object')
    return {'passed': True, 'scope': 'synthetic_only_geometry_and_file_validation',
            'images': len(samples), 'scenes': len(scenes), 'videoSequences': len(video_samples),
            'videoFiles': sum(bool(v.get('mp4') or v.get('webm')) for v in data['videos']),
            'videoFormats': {'mp4': sum(bool(v.get('mp4')) for v in data['videos']),
                             'webm': sum(bool(v.get('webm')) for v in data['videos'])},
            'splits': {split: {key: counts[(split, key)] for key in
                               ('images', 'positive', 'stairs_up', 'stairs_down',
                                'stairs_present_uncertain_direction')} for split in SPLITS},
            'realCameraEvaluation': 'not_performed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = validate(args.manifest)
    if args.output:
        args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
