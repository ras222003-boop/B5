"""Offline scene-balanced stair research cohort; never uses real Basira media."""
from __future__ import annotations

import argparse
import json
import math
import random
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from generate import (Camera, DOWN, UP, encode_videos, mask_box, scene_point,
                      sha256, stair_direction)


ESCALATOR = 2304
CATEGORIES = [
    {"id": UP, "name": "stairs_up", "supercategory": "fixed_stairs"},
    {"id": DOWN, "name": "stairs_down", "supercategory": "fixed_stairs"},
    {"id": 2303, "name": "stairs_present_uncertain_direction", "supercategory": "fixed_stairs"},
    {"id": ESCALATOR, "name": "escalator", "supercategory": "moving_stairs"},
]
MATERIALS = ("concrete", "stone", "wood", "metal")
NEGATIVE_KINDS = ("ramp", "stripes", "empty", "escalator")
SPLIT_SEEDS = {"train": 940291, "validation": 315779, "test": 1173383}
PALETTE = {"concrete": (153, 156, 152), "stone": (158, 149, 134),
           "wood": (144, 108, 78), "metal": (132, 144, 153)}


def specs(test_namespace='sealedtest2'):
    """Balance up, down and non-fixed-stair scenes, independent of frame counts."""
    rows = []
    for split, repeat in (("train", 2), ("validation", 1), ("test", 1)):
        scene_namespace = test_namespace if split == "test" else split
        for rep in range(repeat):
            for side in ("up", "down"):
                for material in MATERIALS:
                    rows.append((f"v2-{scene_namespace}-{side}-{material}-{rep}", split,
                                 "stairs", side, material, rep))
            for kind in NEGATIVE_KINDS:
                rows.append((f"v2-{scene_namespace}-{kind}-{rep}", split, kind,
                             "down" if (rep + len(kind)) % 2 else "up",
                             MATERIALS[(rep + len(kind)) % 4], rep))
    return rows


def make_scene(spec, index, split_seeds=None):
    scene_id, split, kind, side, material, rep = spec
    seed = (split_seeds or SPLIT_SEEDS)[split] + index * 104729
    rng = random.Random(seed)
    angle = rng.uniform(-0.55, 0.55)
    axis = np.array((math.sin(angle), math.cos(angle), 0.0))
    across = np.array((math.cos(angle), -math.sin(angle), 0.0))
    return {"id": scene_id, "group": scene_id, "split": split, "kind": kind,
            "side": side, "material": material, "environment":
            "indoor" if (index + rep) % 2 else "outdoor", "seed": seed,
            "steps": rng.randint(5, 9), "run": rng.uniform(.27, .35),
            "rise": rng.uniform(.145, .185), "width": rng.uniform(1.6, 2.3),
            "angle": angle, "axis": axis, "across": across,
            "origin": np.array((0., 0., 0.)), "lighting": rng.uniform(.78, 1.2)}


def camera_for(scene, frame, video=False):
    rng = random.Random(scene["seed"] + (1000 if video else 100) + frame)
    axis, across = scene["axis"], scene["across"]
    length, height = scene["steps"] * scene["run"], scene["steps"] * scene["rise"]
    travel = frame / 7 if video else 0
    sideways = rng.uniform(-.55, .55) + (.12 * math.sin(frame * .55) if video else 0)
    if scene["side"] == "up":
        distance = rng.uniform(2.4, 3.6) - .7 * travel
        position = -axis * distance + across * sideways + (0, 0, rng.uniform(1.4, 1.75))
        target = axis * (length * rng.uniform(.42, .62)) + (0, 0, height * .58)
    else:
        # The observer stands on the upper landing and looks into the stairwell.
        distance = rng.uniform(.82, 1.35) - .15 * travel
        position = axis * (length + distance) + across * sideways + (0, 0, height + rng.uniform(1.45, 1.75))
        target = axis * (length * rng.uniform(.30, .48)) + (0, 0, height * .30)
    return Camera(tuple(map(float, position)), tuple(map(float, target)), rng.uniform(57, 73))


def stair_faces(scene):
    """Thin treads and front risers, with no solid rear face toward a top observer."""
    o, d, e = scene["origin"], scene["axis"], scene["across"]
    run, rise, half = scene["run"], scene["rise"], scene["width"] / 2
    p = lambda x, y, z: scene_point(o, d, e, x, y, z)
    result = []
    for i in range(scene["steps"]):
        y0, y1, z0, z1 = i * run, (i + 1) * run, i * rise, (i + 1) * rise
        result.append(([p(-half, y0, z1), p(half, y0, z1), p(half, y1, z1), p(-half, y1, z1)],
                       np.array((0., 0., 1.)), "tread", i))
        result.append(([p(-half, y0, z0), p(half, y0, z0), p(half, y0, z1), p(-half, y0, z1)],
                       -d, "riser", i))
    return result


def _project_face(camera, vertices, normal, width, height):
    center = np.mean(vertices, axis=0)
    if float(np.dot(normal, np.asarray(camera.position) - center)) <= 0:
        return None
    projected = [camera.project(vertex, width, height) for vertex in vertices]
    if any(point is None for point in projected):
        return None
    return (sum(point[2] for point in projected) / len(projected),
            [point[:2] for point in projected])


def render(scene, camera, width=320, height=240, frame_seed=0):
    rng = random.Random(frame_seed)
    indoor = scene["environment"] == "indoor"
    wall = (183, 181, 171) if indoor else (182, 208, 224)
    floor = (130, 124, 115) if indoor else (126, 149, 124)
    looking_down = scene["side"] == "down"
    image = Image.new("RGB", (width, height), floor if looking_down else wall)
    mask = Image.new("L", (width, height), 0)
    treads = Image.new("I", (width, height), 0)
    draw, mask_draw, tread_draw = ImageDraw.Draw(image), ImageDraw.Draw(mask), ImageDraw.Draw(treads)
    if not looking_down:
        draw.rectangle((0, int(height * (.46 if indoor else .52)), width, height), fill=floor)
    # Only the floor lines use the same pinhole camera as the staircase.
    for j in range(-7, 8):
        a = camera.project((j * .7, -8, 0), width, height)
        b = camera.project((j * .7, 12, 0), width, height)
        if a and b:
            draw.line((a[:2], b[:2]), fill=(108, 105, 101) if indoor else (111, 132, 110), width=1)
    for j in range(-8, 14):
        a = camera.project((-8, j * .7, 0), width, height)
        b = camera.project((8, j * .7, 0), width, height)
        if a and b:
            draw.line((a[:2], b[:2]), fill=(110, 108, 103) if indoor else (113, 133, 111), width=1)
    if indoor and not looking_down:
        draw.line((0, int(height * .46), width, int(height * .46)), fill=(99, 96, 89), width=3)
        draw.rectangle((8, 12, 32, 67), outline=(114, 113, 108), width=2)
    elif not indoor and not looking_down:
        draw.ellipse((width - 58, 14, width - 28, 44), fill=(235, 225, 180))

    base = PALETTE[scene["material"]]
    polygons = []
    if scene["kind"] in ("stairs", "escalator"):
        faces = stair_faces(scene)
    elif scene["kind"] == "ramp":
        o, d, e = scene["origin"], scene["axis"], scene["across"]
        p = lambda x, y, z: scene_point(o, d, e, x, y, z)
        half = scene["width"] / 2
        length, top = scene["steps"] * scene["run"], scene["steps"] * scene["rise"]
        faces = [([p(-half, 0, 0), p(half, 0, 0), p(half, length, top), p(-half, length, top)],
                  np.array((0., 0., 1.)), "ramp", None)]
    else:
        faces = []
    for vertices, normal, part, index in faces:
        projected = _project_face(camera, vertices, normal, width, height)
        if projected:
            depth, points = projected
            polygons.append((depth, points, part, index))
    # Upper landing belongs to the surrounding floor, not to the stair mask.
    if scene["side"] == "down" and scene["kind"] in ("stairs", "escalator"):
        o, d, e = scene["origin"], scene["axis"], scene["across"]
        p = lambda x, y, z: scene_point(o, d, e, x, y, z)
        half = scene["width"] / 2
        length, top = scene["steps"] * scene["run"], scene["steps"] * scene["rise"]
        landing = [p(-half * 2, length, top), p(half * 2, length, top),
                   p(half * 2, length + .55, top), p(-half * 2, length + .55, top)]
        projected = _project_face(camera, landing, np.array((0., 0., 1.)), width, height)
        if projected:
            polygons.append((projected[0], projected[1], "landing", None))
    for _, points, part, index in sorted(polygons, key=lambda row: -row[0]):
        factor = {"tread": 1.08, "riser": .79, "ramp": .94,
                  "landing": .96}[part] * scene["lighting"] * rng.uniform(.97, 1.03)
        color = tuple(max(0, min(255, int(channel * factor))) for channel in base)
        if part == "landing":
            color = floor
        draw.polygon(points, fill=color)
        if part in ("tread", "riser"):
            mask_draw.polygon(points, fill=1)
            tread_draw.polygon(points, fill=index + 1 if part == "tread" else 0)
            if part == "tread":
                edge = (222, 184, 68) if scene["kind"] == "escalator" else tuple(max(0, c - 25) for c in color)
                draw.line((points[0], points[1]), fill=edge, width=3 if scene["kind"] == "escalator" else 2)
    if scene["kind"] == "escalator":
        o, d, e = scene["origin"], scene["axis"], scene["across"]
        p = lambda x, y, z: scene_point(o, d, e, x, y, z)
        length, top, half = scene["steps"] * scene["run"], scene["steps"] * scene["rise"], scene["width"] / 2
        for x in (-half * 1.15, half * 1.15):
            a, b = camera.project(p(x, 0, .45), width, height), camera.project(p(x, length, top + .45), width, height)
            if a and b:
                draw.line((a[:2], b[:2]), fill=(47, 51, 55), width=6)
                draw.line((a[:2], b[:2]), fill=(145, 150, 153), width=2)
    if scene["kind"] == "stripes":
        o, d, e = scene["origin"], scene["axis"], scene["across"]
        p = lambda x, y, z: scene_point(o, d, e, x, y, z)
        for j in range(7):
            a, b = camera.project(p(-scene["width"] / 2, j * .35, .02), width, height), camera.project(p(scene["width"] / 2, j * .35, .02), width, height)
            if a and b:
                draw.line((a[:2], b[:2]), fill=(75, 77, 72), width=3)
    values = np.asarray(image, dtype=np.int16)
    noise = np.random.default_rng(frame_seed).normal(0, 2.5 if indoor else 3.5, values.shape)
    image = Image.fromarray(np.clip(values + noise, 0, 255).astype(np.uint8), "RGB")
    ids = np.asarray(treads)
    visibility = {"visibleTreads": sum(int(np.count_nonzero(ids == i + 1) >= 12)
                                       for i in range(scene["steps"])),
                  "visibleTreadPixels": int(np.count_nonzero(ids))}
    return image, mask, visibility


def coco_rle(mask):
    pixels = np.asarray(mask, dtype=np.uint8).flatten(order="F")
    counts, current, run = [], 0, 0
    for pixel in pixels:
        pixel = int(pixel > 0)
        if pixel == current:
            run += 1
        else:
            counts.append(run)
            current, run = pixel, 1
    counts.append(run)
    return {"size": [mask.height, mask.width], "counts": counts}


def write_dataset(output: Path, ffmpeg=None, stills=3, video_frames=8,
                  test_seed=None, test_namespace='sealedtest2'):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', test_namespace) or test_namespace in ('train', 'validation'):
        raise ValueError('Test scene namespace must be unique and path-safe')
    if test_seed is not None and (test_seed < 0 or test_seed in SPLIT_SEEDS.values()):
        raise ValueError('A new nonnegative test seed distinct from earlier split seeds is required')
    output = output.resolve()
    repository = Path(__file__).resolve().parents[3]
    if output == repository or repository in output.parents:
        raise ValueError('Synthetic media must stay outside the Git repository')
    if {part.lower() for part in output.parts} & {'.git', 'basira-vision-datasets'}:
        raise ValueError('Synthetic output must stay separate from real/protected data')
    output.mkdir(parents=True, exist_ok=False)
    seed_map = {**SPLIT_SEEDS}
    if test_seed is not None:
        seed_map['test'] = test_seed
    scenes = [make_scene(spec, index, seed_map)
              for index, spec in enumerate(specs(test_namespace))]
    samples, masks, videos = [], {}, []
    width, height = 320, 240
    for scene in scenes:
        video_scene = scene["id"] in ("v2-train-up-concrete-0", "v2-train-down-stone-0")
        frames = list(range(stills)) + (list(range(100, 100 + video_frames)) if video_scene else [])
        video_id = "motion-" + scene["id"] if video_scene else None
        for frame in frames:
            moving = frame >= 100
            camera = camera_for(scene, frame - 100 if moving else frame, moving)
            image, mask, visibility = render(scene, camera, width, height, scene["seed"] + frame)
            name = f'{scene["id"]}-{frame:03d}'
            image_rel = f'videos/{video_id}/frame_{frame:03d}.png' if moving else f'images/{name}.png'
            mask_rel = f'masks/{name}.png'
            image_path, mask_path = output / image_rel, output / mask_rel
            image_path.parent.mkdir(parents=True, exist_ok=True)
            mask_path.parent.mkdir(parents=True, exist_ok=True)
            image.save(image_path)
            mask.save(mask_path)
            box = mask_box(mask)
            objects, direction, side_alignment, gaze_alignment = [], None, None, None
            if scene["kind"] in ("stairs", "escalator"):
                if not box or visibility["visibleTreads"] < 2:
                    raise ValueError(f'Visible stair treads missing in {name}')
                x0, y0, x1, y1, area = box
                computed, side_alignment, gaze_alignment = stair_direction(
                    camera.position, camera.target, scene["origin"], scene["axis"][:2],
                    scene["steps"], scene["run"])
                direction = ESCALATOR if scene["kind"] == "escalator" else computed
                if scene["kind"] == "stairs" and direction not in (UP, DOWN):
                    raise ValueError(f'Ambiguous fixed stair direction in {name}')
                objects = [{"classId": direction, "box": [x0 / width, y0 / height,
                            (x1 - x0) / width, (y1 - y0) / height],
                            "mask": mask_rel, "areaPixels": area,
                            "source": "synthetic_ground_truth"}]
            sample = {"id": name, "path": image_rel, "mask": mask_rel,
                      "sha256": sha256(image_path), "maskSha256": sha256(mask_path),
                      "scene_id": scene["id"], "group": scene["group"],
                      "split": scene["split"], "frame_id": frame,
                      "video_id": video_id if moving else None,
                      "camera_pose": {"position": camera.position, "target": camera.target,
                                      "fov_degrees": camera.fov_degrees},
                      "stair_direction": direction, "direction_alignment": side_alignment,
                      "gaze_alignment": gaze_alignment, **visibility,
                      "stairs_present": scene["kind"] == "stairs",
                      "escalator_present": scene["kind"] == "escalator",
                      "objects": objects, "contentKind": "synthetic_ground_truth"}
            samples.append(sample)
            masks[name] = mask
        if video_scene:
            videos.append({"id": video_id, "scene_id": scene["id"], "group": scene["group"],
                           "frames": video_frames, "fps": 6, "mp4": None, "webm": None})
    for split in ("train", "validation", "test"):
        selected = [sample for sample in samples if sample["split"] == split]
        images, annotations = [], []
        for image_id, sample in enumerate(selected, 1):
            images.append({"id": image_id, "file_name": sample["path"], "width": width,
                           "height": height, "sample_id": sample["id"],
                           "scene_id": sample["scene_id"], "sha256": sample["sha256"]})
            for obj in sample["objects"]:
                x, y, w, h = obj["box"]
                annotations.append({"id": len(annotations) + 1, "image_id": image_id,
                                    "category_id": obj["classId"],
                                    "bbox": [x * width, y * height, w * width, h * height],
                                    "area": obj["areaPixels"],
                                    "segmentation": coco_rle(masks[sample["id"]]),
                                    "iscrowd": 0, "source": "synthetic_ground_truth"})
        (output / f'coco-{split}.json').write_text(json.dumps({"images": images,
            "annotations": annotations, "categories": CATEGORIES,
            "info": {"contentKind": "synthetic_ground_truth"}}, indent=2), encoding="utf-8")
    encode_videos(output, videos, ffmpeg)
    records = [{"id": s["id"], "group": s["group"], "split": s["split"],
                "kind": s["kind"], "side": s["side"], "material": s["material"],
                "environment": s["environment"], "seed": s["seed"],
                "steps": s["steps"], "runMetres": s["run"], "riseMetres": s["rise"],
                "widthMetres": s["width"], "yawRadians": s["angle"],
                "lightingFactor": s["lighting"]} for s in scenes]
    manifest = {"schemaVersion": 2, "task": "basira-stairs-v2-research",
                "contentKind": "synthetic_ground_truth", "generator": "thin-tread-pinhole-v2",
                "imageSize": [width, height], "categories": CATEGORIES,
                "splitSeeds": seed_map, "scenes": records, "samples": samples,
                "videos": videos, "splitPolicy": "scene-disjoint; video frames stay with scene",
                "testPolicy": "Frozen before V2 training; V1 and V2 evaluated once after V2 selection",
                "limitations": ["Procedural rendering is not real-camera evidence.",
                                "Escalator motion is represented by rails and tread styling only.",
                                "No navigation-safety claim."]}
    manifest_path = output / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "sha256": sha256(manifest_path),
                      "scenes": len(scenes), "images": len(samples), "videos": len(videos)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path)
    parser.add_argument('--test-seed', type=int,
                        help='Use a new unique test seed for a later cohort')
    parser.add_argument('--test-namespace', default='sealedtest2',
                        help='Use a new unique test scene namespace for a later cohort')
    args = parser.parse_args()
    write_dataset(args.output, args.ffmpeg, test_seed=args.test_seed,
                  test_namespace=args.test_namespace)
