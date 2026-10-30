"""Procedural synthetic colour cohort with exact labels. No external assets, fonts, photos or services.

Everything is generated from numpy/Pillow code in this repository, so there are no third-party asset licences.
Each object has a *true albedo colour class* chosen first, then rendered under controlled stress conditions:
exposure, white-balance tint, specular highlights, cast and contact shadows, background similar to the object,
distractors behind and an occluder in front, blur, noise and JPEG compression.

Output matches scripts/colour-quality-v4/dump_frames.py (frames.jsonl) so evaluate.mjs works unchanged, plus
per-object "tags" for breakdowns by stress condition.

Colour classes are sampled from prototypical cores (away from naming boundaries) on purpose: the benchmark asks
whether the engine survives shadows, highlights and similar backgrounds, NOT where a boundary like orange/brown
sits. Boundary definitions must be judged on real, independently labelled photos, never on this generator.

Usage: generate.py <split> <count> <out.jsonl> [--seed-base N]
Splits use disjoint seed ranges: development, calibration, test.
"""
from __future__ import annotations

import argparse
import base64
import colorsys
import hashlib
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

W, H, SS = 320, 240, 2  # app frame size and supersampling
SEED_BASE = {"development": 1_000_000, "calibration": 2_000_000, "test": 3_000_000}

# (hue deg lo, hi, sat lo, hi, value lo, hi) prototypical cores
CORES = {
    "red": (356, 366, 0.70, 0.95, 0.45, 0.85),
    "orange": (22, 32, 0.80, 1.00, 0.80, 1.00),
    "yellow": (50, 60, 0.75, 1.00, 0.80, 1.00),
    "green": (100, 140, 0.55, 0.95, 0.35, 0.80),
    "blue": (210, 235, 0.65, 1.00, 0.40, 0.90),
    "purple": (270, 290, 0.45, 0.85, 0.35, 0.75),
    "pink": (325, 340, 0.30, 0.50, 0.90, 1.00),
    "brown": (22, 30, 0.55, 0.80, 0.28, 0.40),
    "black": (0, 360, 0.00, 0.20, 0.03, 0.10),
    "white": (0, 360, 0.00, 0.05, 0.90, 0.98),
    "gray": (0, 360, 0.00, 0.04, 0.38, 0.62),
}
CHROMATIC = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "brown"]
SHAPES = ["circle", "ellipse", "rrect", "capsule", "lattice"]


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def sample_albedo(rng, name):
    h0, h1, s0, s1, v0, v1 = CORES[name]
    h = (rng.uniform(h0, h1) % 360) / 360
    s, v = rng.uniform(s0, s1), rng.uniform(v0, v1)
    return np.array(colorsys.hsv_to_rgb(h, s, v))


def sdf(shape, X, Y, cx, cy, size, angle, rng):
    c, s = math.cos(angle), math.sin(angle)
    x = (X - cx) * c + (Y - cy) * s
    y = -(X - cx) * s + (Y - cy) * c
    if shape == "circle":
        return np.hypot(x, y) - size
    if shape == "ellipse":
        a, b = size * rng.uniform(1.1, 1.6), size * rng.uniform(0.6, 0.9)
        return (np.sqrt((x / a) ** 2 + (y / b) ** 2) - 1) * min(a, b)
    if shape == "capsule":
        half = size * rng.uniform(0.7, 1.3)
        yy = np.clip(y, -half, half)
        return np.hypot(x, y - yy) - size * 0.45
    ax, ay = size * rng.uniform(0.9, 1.4), size * rng.uniform(0.6, 1.1)
    r = size * rng.uniform(0.1, 0.35)
    qx, qy = np.abs(x) - ax + r, np.abs(y) - ay + r
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
    if shape == "lattice":  # chair-back like: holes show the background through the object
        holes = np.full_like(d, 1e9)
        cols, rows = rng.integers(2, 5), rng.integers(1, 4)
        for i in range(cols):
            for j in range(rows):
                hx = -ax + (i + 0.5) * 2 * ax / cols
                hy = -ay + (j + 0.5) * 2 * ay / rows
                hd = np.hypot(x - hx, y - hy) - 0.28 * min(2 * ax / cols, 2 * ay / rows)
                holes = np.minimum(holes, hd)
        d = np.maximum(d, -holes)
    return d


def object_height(d, bevel):
    t = np.clip(-d / bevel, 0, 1)
    return np.sqrt(1 - (1 - t) ** 2) * bevel


def background(rng, X, Y, base_lin, kind):
    if kind == "flat":
        return np.ones((H * SS, W * SS, 3)) * base_lin
    if kind == "gradient":
        t = (Y / (H * SS))[..., None]
        other = np.clip(base_lin * rng.uniform(0.3, 1.6, 3), 0, 1)
        return base_lin * (1 - t) + other * t
    if kind == "horizon":
        ground = np.clip(base_lin * rng.uniform(0.4, 1.5, 3), 0, 1)
        return np.where((Y > H * SS * rng.uniform(0.4, 0.65))[..., None], ground, base_lin)
    noise = rng.normal(0, 1, (H * SS // 8 + 1, W * SS // 8 + 1))
    noise = np.asarray(Image.fromarray(noise.astype(np.float32)).resize((W * SS, H * SS), Image.BICUBIC))
    return np.clip(base_lin * (1 + 0.25 * noise[..., None]), 0, 1)


def render(seed):
    rng = np.random.default_rng(seed)
    Y, X = np.mgrid[0 : H * SS, 0 : W * SS].astype(np.float64)
    two_tone = rng.random() < 0.08
    classes = list(rng.choice(CHROMATIC, 2, replace=False)) if two_tone else [rng.choice(list(CORES))]
    albedos = [srgb_to_linear(sample_albedo(rng, c)) for c in classes]
    shape = rng.choice(SHAPES)
    size = rng.uniform(0.16, 0.42) * H * SS
    cx = rng.uniform(0.3, 0.7) * W * SS
    cy = rng.uniform(0.35, 0.65) * H * SS
    angle = rng.uniform(0, math.pi)
    d = sdf(shape, X, Y, cx, cy, size, angle, rng)
    cover = d < 0
    z = object_height(d, 0.5 * size)
    gy, gx = np.gradient(z)
    normal = np.dstack([-gx, -gy, np.ones_like(z)])
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)

    exposure = float(np.exp(rng.uniform(math.log(0.12), math.log(1.7))))
    tint = np.exp(rng.normal(0, rng.choice([0.03, 0.18]), 3))
    tint /= tint.mean()
    azimuth, elevation = rng.uniform(0, 2 * math.pi), rng.uniform(math.radians(25), math.radians(80))
    light = np.array([math.cos(elevation) * math.cos(azimuth), math.cos(elevation) * math.sin(azimuth), math.sin(elevation)])
    kd, ambient = rng.uniform(0.55, 1.0), rng.uniform(0.15, 0.5)
    ks = float(rng.choice([0.0, 0.1, 0.35, 0.8], p=[0.35, 0.25, 0.25, 0.15]))
    power = rng.uniform(10, 120)
    ndotl = np.clip(normal @ light, 0, 1)
    half = light + np.array([0, 0, 1.0])
    half /= np.linalg.norm(half)
    spec = ks * np.clip(normal @ half, 0, 1) ** power

    albedo_img = np.ones((H * SS, W * SS, 3)) * albedos[0]
    if two_tone:
        split_angle = rng.uniform(0, math.pi)
        # Dominant + secondary policy: the minor colour covers roughly 25-40% of the object, not half.
        offset = rng.uniform(0.15, 0.45) * size * rng.choice([-1, 1])
        side = ((X - cx) * math.cos(split_angle) + (Y - cy) * math.sin(split_angle)) > offset
        albedo_img = np.where(side[..., None], albedos[1], albedos[0])
    shade = (ambient + kd * ndotl)[..., None]
    obj_lin = albedo_img * shade * exposure * tint + (spec * exposure)[..., None] * tint

    similar_bg = rng.random() < 0.3
    if similar_bg:
        bg_base = np.clip(albedos[0] * np.exp(rng.normal(0, 0.12, 3)), 0, 1)
    else:
        bg_base = srgb_to_linear(sample_albedo(rng, rng.choice(list(CORES))))
    bg = background(rng, X, Y, bg_base, rng.choice(["flat", "gradient", "horizon", "texture"]))
    bg = bg * exposure * (ambient + kd * 0.6) * tint

    shadow_strength = rng.choice([0.0, 0.25, 0.55])
    shadow_len = size * rng.uniform(0.1, 0.5)
    sx, sy = int(-light[0] * shadow_len), int(-light[1] * shadow_len)
    shadow = Image.fromarray((cover * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(size * 0.08))
    shadow = np.roll(np.asarray(shadow, dtype=np.float64) / 255, (sy, sx), axis=(0, 1))
    bg = bg * (1 - shadow_strength * shadow)[..., None]

    # distractors behind, one occluder in front
    for _ in range(int(rng.integers(0, 3))):
        dd = sdf(rng.choice(SHAPES), X, Y, rng.uniform(0, W * SS), rng.uniform(0, H * SS), rng.uniform(0.08, 0.3) * H * SS, rng.uniform(0, 3), rng)
        col = srgb_to_linear(sample_albedo(rng, rng.choice(list(CORES)))) * exposure * (ambient + 0.5 * kd) * tint
        bg = np.where((dd < 0)[..., None], col, bg)
    img = np.where(cover[..., None], obj_lin, bg)
    visible = cover.copy()
    occluded = rng.random() < 0.25
    if occluded:
        od = sdf("rrect", X, Y, cx + rng.uniform(-0.8, 0.8) * size, cy + rng.uniform(-0.8, 0.8) * size, rng.uniform(0.2, 0.5) * size, rng.uniform(0, 3), rng)
        occ = od < 0
        col = srgb_to_linear(sample_albedo(rng, rng.choice(list(CORES)))) * exposure * (ambient + 0.5 * kd) * tint
        img = np.where(occ[..., None], col, img)
        visible &= ~occ

    srgb = linear_to_srgb(img)
    pil = Image.fromarray((srgb * 255 + 0.5).astype(np.uint8)).resize((W, H), Image.BOX)
    blur = float(rng.choice([0.0, 0.6, 1.2]))
    if blur:
        pil = pil.filter(ImageFilter.GaussianBlur(blur))
    arr = np.asarray(pil, dtype=np.float64)
    noise = float(rng.choice([0.0, 2.0, 5.0]))
    if noise:
        arr = np.clip(arr + rng.normal(0, noise, arr.shape), 0, 255)
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8)).save(buf, "JPEG", quality=int(rng.choice([95, 80, 60])))
    frame = np.asarray(Image.open(buf).convert("RGB"))
    mask = np.asarray(Image.fromarray((visible * 255).astype(np.uint8)).resize((W, H), Image.BOX)) > 127
    ys, xs = np.nonzero(mask)
    if not (0.02 * W * H <= len(xs) <= 0.7 * W * H):
        return None
    box = [xs.min() / W, ys.min() / H, (xs.max() + 1 - xs.min()) / W, (ys.max() + 1 - ys.min()) / H]
    # Primary = the class whose pixels cover more of the visible object (two-tone objects only differ by area).
    primary_label, secondary_label = classes[0], None
    if two_tone:
        covers = [float((visible & ((side) if k == 1 else ~side)).sum()) for k in (0, 1)]
        order = [0, 1] if covers[0] >= covers[1] else [1, 0]
        primary_label, secondary_label = classes[order[0]], classes[order[1]]
        minor = min(covers) / max(1.0, sum(covers))
        if minor < 0.12:
            secondary_label = None
    exposure_bucket = "low" if exposure < 0.35 else "high" if exposure > 1.2 else "normal"
    return dict(
        frame=frame,
        mask=mask,
        box=box,
        label=primary_label,
        components=[],
        secondary=secondary_label,
        tags=dict(
            exposure=exposure_bucket,
            specular="strong" if ks >= 0.8 else "some" if ks >= 0.1 else "none",
            shadow="strong" if shadow_strength >= 0.55 else "soft" if shadow_strength > 0 else "none",
            similarBackground=bool(similar_bg),
            occluded=bool(occluded),
            shape=str(shape),
            tint="strong" if np.abs(np.log(tint)).max() > 0.2 else "neutral",
            twoTone=bool(two_tone),
        ),
        params=dict(seed=int(seed), exposure=exposure, ks=ks, shadowStrength=float(shadow_strength), blur=blur, noise=noise),
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("split", choices=list(SEED_BASE))
    p.add_argument("count", type=int)
    p.add_argument("out")
    p.add_argument("--seed-base", type=int, default=None)
    args = p.parse_args()
    out = Path(args.out)
    if out.exists():
        sys.exit("refusing to overwrite " + str(out))
    base = SEED_BASE[args.split] if args.seed_base is None else args.seed_base
    made = 0
    seed = base
    with out.open("w", encoding="utf-8") as sink:
        while made < args.count:
            seed += 1
            r = render(seed)
            if r is None:
                continue
            rgba = np.dstack([r["frame"], np.full((H, W, 1), 255, np.uint8)]).tobytes()
            row = {
                "id": f"syn-{args.split}-{seed}",
                "groupId": f"syn-scene-{seed}",
                "width": W,
                "height": H,
                "rgba": base64.b64encode(rgba).decode(),
                "objects": [
                    {
                        "objectId": f"syn-{seed}",
                        "cocoClass": "synthetic",
                        "box": r["box"],
                        "referenceColor": r["label"],
                        "referenceSecondary": r["secondary"],
                        "referenceComponents": [],
                        "mask": base64.b64encode(r["mask"].astype(np.uint8).tobytes()).decode(),
                        "segMask": None,
                        "tags": r["tags"],
                        "params": r["params"],
                    }
                ],
            }
            sink.write(json.dumps(row) + "\n")
            made += 1
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(json.dumps({"split": args.split, "count": made, "seedBase": base, "sha256": digest}))


if __name__ == "__main__":
    main()
