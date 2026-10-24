"""Small, offline pinhole-camera stairs dataset with geometry-derived labels.

All output is synthetic_ground_truth. This is an engineering simulation, not
real-camera evidence or a replacement for the official human review path.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import random
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


CATEGORIES = [
    {"id": 2301, "name": "stairs_up", "supercategory": "stairs"},
    {"id": 2302, "name": "stairs_down", "supercategory": "stairs"},
    {"id": 2303, "name": "stairs_present_uncertain_direction", "supercategory": "stairs"},
]
UP, DOWN, UNCERTAIN = (c["id"] for c in CATEGORIES)


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    length = np.linalg.norm(v)
    if length < 1e-9:
        raise ValueError("Degenerate camera or staircase vector")
    return v / length


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass(frozen=True)
class Camera:
    position: tuple[float, float, float]
    target: tuple[float, float, float]
    fov_degrees: float = 64.0

    def basis(self):
        forward = unit(np.subtract(self.target, self.position))
        right = unit(np.cross(forward, (0.0, 0.0, 1.0)))
        up = unit(np.cross(right, forward))
        return forward, right, up

    def project(self, point, width, height):
        forward, right, up = self.basis()
        delta = np.subtract(point, self.position)
        depth = float(np.dot(delta, forward))
        if depth <= 0.08:
            return None
        focal = (width / 2) / math.tan(math.radians(self.fov_degrees) / 2)
        return (width / 2 + focal * float(np.dot(delta, right)) / depth,
                height / 2 - focal * float(np.dot(delta, up)) / depth, depth)


def stair_direction(camera_position, camera_target, origin, ascent_xy, steps, run):
    """Class from stair ascent, camera position, and horizontal viewing direction."""
    axis = unit((ascent_xy[0], ascent_xy[1], 0.0))
    midpoint = np.asarray(origin) + axis * (steps * run / 2)
    ground_view = np.asarray(midpoint) - np.asarray(camera_position)
    ground_view[2] = 0
    gaze = np.asarray(camera_target) - np.asarray(camera_position)
    gaze[2] = 0
    side_alignment = float(np.dot(unit(ground_view), axis))
    gaze_alignment = float(np.dot(unit(gaze), axis))
    if side_alignment >= 0.35 and gaze_alignment >= 0.35:
        return UP, side_alignment, gaze_alignment
    if side_alignment <= -0.35 and gaze_alignment <= -0.35:
        return DOWN, side_alignment, gaze_alignment
    return UNCERTAIN, side_alignment, gaze_alignment


def scene_point(origin, axis, across, x, along, z):
    return tuple(np.asarray(origin) + np.asarray(across) * x + np.asarray(axis) * along + (0, 0, z))


def scene_specs():
    # Split by entire scene. Video frames stay in the originating scene group.
    return [
        ("train-up-concrete", "train", "up", "stairs", "concrete", 5, 0.0),
        ("train-down-wood", "train", "down", "stairs", "wood", 6, 0.2),
        ("train-up-stone", "train", "up", "stairs", "stone", 7, -0.25),
        ("train-down-metal", "train", "down", "stairs", "metal", 5, 0.35),
        ("train-ramp", "train", "up", "ramp", "concrete", 6, -0.1),
        ("train-empty", "train", "down", "empty", "stone", 5, 0.2),
        ("val-up-wood", "validation", "up", "stairs", "wood", 8, -0.3),
        ("val-down-concrete", "validation", "down", "stairs", "concrete", 7, 0.4),
        ("val-stripes", "validation", "up", "stripes", "stone", 5, 0.0),
        ("test-up-metal", "test", "up", "stairs", "metal", 9, 0.3),
        ("test-down-stone", "test", "down", "stairs", "stone", 6, -0.4),
        ("test-escalator", "test", "down", "escalator", "metal", 7, 0.15),
    ]


def geometry(spec, rng):
    scene_id, split, side, kind, material, steps, angle = spec
    axis = np.asarray((math.sin(angle), math.cos(angle), 0.0))
    across = np.asarray((math.cos(angle), -math.sin(angle), 0.0))
    return {"id": scene_id, "split": split, "side": side, "kind": kind,
            "material": material, "steps": steps, "angle": angle,
            "axis": axis, "across": across, "origin": np.asarray((0.0, 0.0, 0.0)),
            "run": rng.uniform(0.28, 0.34), "rise": rng.uniform(0.14, 0.19),
            "width": rng.uniform(1.75, 2.25), "seed": rng.randrange(2**31)}


def camera_for(scene, rng, frame=0, frames=1):
    steps, run, rise = scene["steps"], scene["run"], scene["rise"]
    axis, across = scene["axis"], scene["across"]
    travel = frame / max(1, frames - 1)
    distance = rng.uniform(2.6, 3.4) - (0.8 * travel if frames > 1 else 0)
    sideways = rng.uniform(-0.35, 0.35) + (0.08 * math.sin(frame * 0.8) if frames > 1 else 0)
    if scene["side"] == "up":
        position = -axis * distance + across * sideways + np.asarray((0, 0, 1.55))
        target = axis * (steps * run * 0.5) + np.asarray((0, 0, steps * rise * 0.55))
    else:
        # Observe from the upper landing and look down over its first edge.
        near = rng.uniform(0.9, 1.45) - (0.22 * travel if frames > 1 else 0)
        position = axis * (steps * run + near) + across * sideways + np.asarray((0, 0, steps * rise + 1.7))
        target = axis * (steps * run * 0.45) + np.asarray((0, 0, steps * rise * 0.35))
    return Camera(tuple(map(float, position)), tuple(map(float, target)), rng.uniform(61, 69))


def faces(scene):
    """Convex world faces: all stair treads and risers have physical 3D depth."""
    o, d, e = scene["origin"], scene["axis"], scene["across"]
    run, rise, half = scene["run"], scene["rise"], scene["width"] / 2
    point = lambda x, y, z: scene_point(o, d, e, x, y, z)
    result = []
    for i in range(scene["steps"]):
        y0, y1, z = i * run, (i + 1) * run, (i + 1) * rise
        left, right = -half, half
        result.extend([
            ([point(left, y0, z), point(right, y0, z), point(right, y1, z), point(left, y1, z)], (0, 0, 1), "tread", i),
            ([point(left, y0, 0), point(right, y0, 0), point(right, y0, z), point(left, y0, z)], -d, "riser", i),
            ([point(left, y1, 0), point(right, y1, 0), point(right, y1, z), point(left, y1, z)], d, "back", i),
            ([point(left, y0, 0), point(left, y1, 0), point(left, y1, z), point(left, y0, z)], -e, "side", i),
            ([point(right, y0, 0), point(right, y1, 0), point(right, y1, z), point(right, y0, z)], e, "side", i),
        ])
    return result


def render(scene, camera, width, height, seed):
    rng = random.Random(seed)
    background = (196, 211, 219) if scene["split"] != "test" else (184, 204, 210)
    image = Image.new("RGB", (width, height), background)
    mask = Image.new("L", (width, height), 0)
    tread_ids = Image.new("I", (width, height), 0)
    draw, mask_draw = ImageDraw.Draw(image), ImageDraw.Draw(mask)
    tread_draw = ImageDraw.Draw(tread_ids)
    draw.rectangle((0, height * 0.44, width, height), fill=(137, 145, 134))
    # Perspective ground joints and broad, stable lighting variation.
    for j in range(-5, 6):
        a = camera.project((j * 0.9, -8, 0), width, height)
        b = camera.project((j * 0.9, 12, 0), width, height)
        if a and b:
            draw.line((a[:2], b[:2]), fill=(120, 130, 121), width=1)
    for j in range(-4, 10):
        a = camera.project((-8, j * 0.75, 0), width, height)
        b = camera.project((8, j * 0.75, 0), width, height)
        if a and b:
            draw.line((a[:2], b[:2]), fill=(124, 135, 124), width=1)

    palette = {
        "concrete": (150, 152, 147), "wood": (143, 107, 75),
        "stone": (155, 148, 132), "metal": (136, 145, 151),
    }
    base = palette[scene["material"]]
    world_faces = []
    if scene["kind"] == "stairs":
        world_faces = faces(scene)
    elif scene["kind"] == "ramp":
        o, d, e, half = scene["origin"], scene["axis"], scene["across"], scene["width"] / 2
        end, top = scene["steps"] * scene["run"], scene["steps"] * scene["rise"]
        p = lambda x, y, z: scene_point(o, d, e, x, y, z)
        world_faces = [([p(-half, 0, 0), p(half, 0, 0), p(half, end, top), p(-half, end, top)], (0, 0, 1), "ramp", None)]
    elif scene["kind"] == "escalator":
        o, d, e, half = scene["origin"], scene["axis"], scene["across"], scene["width"] / 2
        end, top = scene["steps"] * scene["run"], scene["steps"] * scene["rise"]
        p = lambda x, y, z: scene_point(o, d, e, x, y, z)
        world_faces = [([p(-half, 0, 0), p(half, 0, 0), p(half, end, top), p(-half, end, top)], (0, 0, 1), "escalator", None)]

    polygons = []
    for vertices, normal, part, stair_index in world_faces:
        center = np.mean(vertices, axis=0)
        if np.dot(normal, np.subtract(camera.position, center)) <= 0:
            continue
        projected = [camera.project(v, width, height) for v in vertices]
        if any(p is None for p in projected):
            continue
        polygons.append((sum(p[2] for p in projected) / len(projected), [p[:2] for p in projected], part, stair_index))
    for _, polygon, part, stair_index in sorted(polygons, reverse=True):
        factor = {"tread": 1.1, "riser": 0.82, "back": 0.78, "side": 0.72,
                  "ramp": 0.95, "escalator": 0.48}[part] * rng.uniform(0.95, 1.05)
        color = tuple(max(0, min(255, int(v * factor))) for v in base)
        draw.polygon(polygon, fill=color)
        if scene["kind"] == "stairs":
            mask_draw.polygon(polygon, fill=1)
            tread_draw.polygon(polygon, fill=stair_index + 1 if part == "tread" else 0)
            if part == "tread":
                draw.line((polygon[0], polygon[1]), fill=tuple(max(0, c - 25) for c in color), width=2)
    if scene["kind"] in {"stripes", "escalator"}:
        o, d, e = scene["origin"], scene["axis"], scene["across"]
        p = lambda x, y, z: scene_point(o, d, e, x, y, z)
        for j in range(6):
            along = j * scene["run"]
            a = camera.project(p(-scene["width"] / 2, along, 0.012), width, height)
            b = camera.project(p(scene["width"] / 2, along, 0.012), width, height)
            if a and b:
                draw.line((a[:2], b[:2]), fill=(78, 78, 74), width=2)
    arr = np.asarray(image, dtype=np.int16).copy()
    noise = np.random.default_rng(seed).normal(0, 2.0, arr.shape)
    image = Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8), "RGB")
    tread_pixels = np.asarray(tread_ids)
    visible_treads = sum(int(np.count_nonzero(tread_pixels == i + 1) >= 12)
                         for i in range(scene["steps"])) if scene["kind"] == "stairs" else 0
    return image, mask, {"visibleTreads": visible_treads,
                         "visibleTreadPixels": int(np.count_nonzero(tread_pixels))}


def mask_box(mask):
    ys, xs = np.nonzero(np.asarray(mask) > 0)
    if len(xs) == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1, int(len(xs)))


def coco_rle(mask):
    values = np.asarray(mask, dtype=np.uint8).flatten(order="F")
    counts, current, length = [], 0, 0
    for value in values:
        value = int(value > 0)
        if value == current:
            length += 1
        else:
            counts.append(length)
            length, current = 1, value
    counts.append(length)
    return {"size": [mask.height, mask.width], "counts": counts}


def save_frame(root, scene, camera, frame_id, width, height, seed, video_id=None):
    image, mask, visibility = render(scene, camera, width, height, seed)
    group = scene["id"]
    name = f"{group}-{frame_id:03d}"
    if video_id:
        image_rel = f"videos/{video_id}/frame_{frame_id:03d}.png"
    else:
        image_rel = f"images/{name}.png"
    mask_rel = f"masks/{name}.png"
    image_path, mask_path = root / image_rel, root / mask_rel
    image_path.parent.mkdir(parents=True, exist_ok=True)
    mask_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(image_path)
    mask.save(mask_path)
    bbox = mask_box(mask)
    objects = []
    direction, alignment, gaze_alignment = (None, None, None)
    if scene["kind"] == "stairs":
        direction, alignment, gaze_alignment = stair_direction(
            camera.position, camera.target, scene["origin"], scene["axis"][:2],
            scene["steps"], scene["run"])
        if not bbox:
            raise ValueError(f"Stairs invisible in generated frame {name}; refusing false negative")
        x0, y0, x1, y1, area = bbox
        if area < 20:
            raise ValueError(f"Stair mask too small in {name}")
        if direction in (UP, DOWN) and visibility["visibleTreads"] < 2:
            raise ValueError(f"Only {visibility['visibleTreads']} treads visibly resolve in {name}; refusing directional label")
        box = [x0 / width, y0 / height, (x1 - x0) / width, (y1 - y0) / height]
        objects = [{"classId": direction, "box": box, "mask": mask_rel,
                    "areaPixels": area, "source": "synthetic_ground_truth"}]
    sample = {"id": name, "path": image_rel, "mask": mask_rel,
              "sha256": sha256(image_path), "maskSha256": sha256(mask_path),
              "scene_id": scene["id"], "group": group, "split": scene["split"],
              "frame_id": frame_id, "video_id": video_id,
              "camera_pose": {"position": camera.position, "target": camera.target,
                              "fov_degrees": camera.fov_degrees},
              "stair_direction": direction, "direction_alignment": alignment,
              "gaze_alignment": gaze_alignment,
              **visibility,
              "stairs_present": bool(objects), "objects": objects,
              "contentKind": "synthetic_ground_truth"}
    return sample, mask


def export_coco(root, samples, masks, width, height):
    for split in ("train", "validation", "test"):
        selected = [s for s in samples if s["split"] == split]
        images, annotations = [], []
        for index, sample in enumerate(selected, 1):
            images.append({"id": index, "file_name": sample["path"], "width": width,
                           "height": height, "sample_id": sample["id"], "sha256": sample["sha256"],
                           "scene_id": sample["scene_id"], "video_id": sample["video_id"]})
            for obj in sample["objects"]:
                x, y, w, h = obj["box"]
                annotations.append({"id": len(annotations) + 1, "image_id": index,
                    "category_id": obj["classId"], "bbox": [x * width, y * height, w * width, h * height],
                    "area": obj["areaPixels"], "segmentation": coco_rle(masks[sample["id"]]),
                    "iscrowd": 0, "source": "synthetic_ground_truth"})
        (root / f"coco-{split}.json").write_text(json.dumps({"images": images,
            "annotations": annotations, "categories": CATEGORIES,
            "info": {"description": "Geometric synthetic stair research only",
                     "contentKind": "synthetic_ground_truth"}}, indent=2), encoding="utf-8")


def validate(samples, masks, width, height):
    groups = {}
    for s in samples:
        assert s["group"] == s["scene_id"]
        groups.setdefault(s["group"], set()).add(s["split"])
        mask = masks[s["id"]]
        assert mask.size == (width, height)
        bbox = mask_box(mask)
        assert bool(bbox) == s["stairs_present"]
        if s["stairs_present"]:
            obj = s["objects"][0]
            x, y, w, h = obj["box"]
            assert 0 <= x < 1 and 0 <= y < 1 and 0 < w <= 1 - x and 0 < h <= 1 - y
            assert obj["classId"] in (UP, DOWN, UNCERTAIN)
            if obj["classId"] in (UP, DOWN):
                assert s["visibleTreads"] >= 2 and s["visibleTreadPixels"] >= 24
        else:
            assert not s["objects"] and s["stair_direction"] is None
    assert all(len(splits) == 1 for splits in groups.values()), "Scene crosses splits"
    for split in ("train", "validation", "test"):
        rows = [s for s in samples if s["split"] == split]
        assert any(s["stairs_present"] for s in rows)
        assert any(not s["stairs_present"] for s in rows)
    for video in {s["video_id"] for s in samples if s["video_id"]}:
        rows = [s for s in samples if s["video_id"] == video]
        assert len({s["group"] for s in rows}) == 1
        assert len({s["stair_direction"] for s in rows}) == 1, "Video direction changed unexpectedly"
    return groups


def encode_videos(output, videos, ffmpeg):
    """Pipe MJPEG input and encoded output; bundled FFmpeg cannot open Unicode paths."""
    ffmpeg = ffmpeg or shutil.which("ffmpeg")
    if not ffmpeg:
        return
    muxers = subprocess.run([str(ffmpeg), "-hide_banner", "-muxers"], capture_output=True, text=True, timeout=15).stdout
    for video in videos:
        if video.get("mp4") or video.get("webm"):
            continue
        folder = output / "videos" / video["id"]
        frames = sorted(folder.glob("frame_*.png"))
        if len(frames) != video["frames"]:
            video["ffmpegError"] = "Missing rendered frames"
            continue
        stream_parts = []
        for path in frames:
            with Image.open(path) as source:
                buf = io.BytesIO()
                source.convert("RGB").save(buf, format="JPEG", quality=90)
                stream_parts.append(buf.getvalue())
        stream = b"".join(stream_parts)
        has_mp4 = " mp4 " in muxers
        codec_args = (["-c:v", "mpeg4", "-q:v", "4", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov"]
                      if has_mp4 else ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8",
                                      "-b:v", "400k", "-f", "webm"])
        cmd = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-framerate", str(video["fps"]),
               "-f", "image2pipe", "-vcodec", "mjpeg", "-i", "pipe:0", "-frames:v", str(video["frames"]),
               *codec_args, "-pix_fmt", "yuv420p", "pipe:1"]
        result = subprocess.run(cmd, input=stream, capture_output=True, timeout=90)
        if result.returncode == 0 and len(result.stdout) > 100:
            extension = "mp4" if has_mp4 else "webm"
            clip = output / "videos" / (video["id"] + "." + extension)
            clip.write_bytes(result.stdout)
            video[extension] = str(clip.relative_to(output)).replace("\\", "/")
            video[extension + "Sha256"] = sha256(clip)
            if not has_mp4:
                video["mp4Unavailable"] = "Bundled FFmpeg has no MP4 muxer; WebM and original PNG sequence saved"
            video.pop("ffmpegError", None)
        else:
            video["ffmpegError"] = result.stderr.decode("utf-8", errors="replace")[-500:] or f"exit {result.returncode}"


def generate(output, seed=20261024, width=320, height=240, stills=3, video_frames=8, ffmpeg=None):
    if width < 128 or height < 96 or stills < 1 or video_frames < 2:
        raise ValueError("Invalid proof-of-work dimensions")
    output = Path(output).resolve()
    output.mkdir(parents=False, exist_ok=False)
    rng = random.Random(seed)
    scenes = [geometry(spec, rng) for spec in scene_specs()]
    samples, masks, video_records = [], {}, []
    for scene in scenes:
        for frame in range(stills):
            camera = camera_for(scene, random.Random(scene["seed"] + 100 + frame))
            sample, mask = save_frame(output, scene, camera, frame, width, height, scene["seed"] + frame)
            samples.append(sample)
            masks[sample["id"]] = mask
        if scene["id"] in {"train-up-concrete", "test-down-stone"}:
            video_id = "motion-" + scene["id"]
            for frame in range(video_frames):
                camera = camera_for(scene, random.Random(scene["seed"] + 500), frame, video_frames)
                sample, mask = save_frame(output, scene, camera, 100 + frame, width, height,
                                          scene["seed"] + 100 + frame, video_id)
                samples.append(sample)
                masks[sample["id"]] = mask
            video_records.append({"id": video_id, "scene_id": scene["id"],
                                  "group": scene["id"], "frames": video_frames,
                                  "fps": 6, "mp4": None, "webm": None})
    groups = validate(samples, masks, width, height)
    export_coco(output, samples, masks, width, height)
    encode_videos(output, video_records, ffmpeg)
    manifest = {"schemaVersion": 1, "task": "basira-stairs-v1",
                "contentKind": "synthetic_ground_truth", "generator": "pinhole-cuboid-stairs-v1",
                "seed": seed, "imageSize": [width, height], "categories": CATEGORIES,
                "scenes": [{"id": s["id"], "group": s["id"], "split": s["split"],
                            "kind": s["kind"], "material": s["material"],
                            "steps": s["steps"], "runMetres": s["run"], "riseMetres": s["rise"],
                            "yawRadians": s["angle"]} for s in scenes],
                "videos": video_records, "samples": samples,
                "splitPolicy": "scene-disjoint; all video frames remain in their scene group",
                "limitations": ["Simplified cuboid geometry and painter rendering, not real-camera data.",
                                "Direction is camera-relative geometry; side views are uncertain.",
                                "No real-world accuracy or mobility safety claim."]}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    counts = {split: {"images": sum(s["split"] == split for s in samples),
                      "positive": sum(s["split"] == split and s["stairs_present"] for s in samples),
                      "negative": sum(s["split"] == split and not s["stairs_present"] for s in samples)}
              for split in ("train", "validation", "test")}
    result = {"output": str(output), "images": len(samples), "scenes": len(groups),
              "videoSequences": len(video_records), "mp4Files": sum(bool(v["mp4"]) for v in video_records),
              "webmFiles": sum(bool(v.get("webm")) for v in video_records),
              "splits": counts, "manifestSha256": sha256(output / "manifest.json")}
    (output / "generation-report.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output")
    parser.add_argument("--resume-video", help="Existing generated dataset directory; only encode missing MP4s")
    parser.add_argument("--seed", type=int, default=20261024)
    parser.add_argument("--width", type=int, default=320)
    parser.add_argument("--height", type=int, default=240)
    parser.add_argument("--stills", type=int, default=3)
    parser.add_argument("--video-frames", type=int, default=8)
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    if args.resume_video:
        root = Path(args.resume_video).resolve()
        manifest_path = root / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("generator") != "pinhole-cuboid-stairs-v1":
            raise ValueError("Not a dataset from this generator")
        encode_videos(root, manifest["videos"], args.ffmpeg)
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        report_path = root / "generation-report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["mp4Files"] = sum(bool(v["mp4"]) for v in manifest["videos"])
        report["webmFiles"] = sum(bool(v.get("webm")) for v in manifest["videos"])
        report["manifestSha256"] = sha256(manifest_path)
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2))
    else:
        if not args.output:
            parser.error("--output is required unless --resume-video is used")
        print(json.dumps(generate(args.output, args.seed, args.width, args.height,
                                  args.stills, args.video_frames, args.ffmpeg), indent=2))
