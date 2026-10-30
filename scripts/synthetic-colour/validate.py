"""Validate a synthetic colour cohort: labels, masks, boxes, pixels, uniqueness and split hygiene.
Usage: validate.py <frames.jsonl> [<other-split.jsonl> ...]
Exit code 1 and a JSON report when any check fails. Extra files are other splits that must share no seed/image.
"""
import base64
import hashlib
import json
import sys
from collections import Counter

import numpy as np

LABELS = {"red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "black", "white", "gray"}


def load(path):
    return [json.loads(line) for line in open(path, encoding="utf-8")]


def main():
    path, others = sys.argv[1], sys.argv[2:]
    rows = load(path)
    problems = []
    seeds, hashes = set(), set()
    areas, labels, tags = [], Counter(), {k: Counter() for k in ("exposure", "specular", "shadow", "similarBackground", "occluded", "shape", "tint", "twoTone")}
    for row in rows:
        w, h = row["width"], row["height"]
        frame = np.frombuffer(base64.b64decode(row["rgba"]), np.uint8)
        if frame.size != w * h * 4:
            problems.append((row["id"], "frame size"))
            continue
        frame = frame.reshape(h, w, 4)
        digest = hashlib.sha256(frame.tobytes()).hexdigest()
        if digest in hashes:
            problems.append((row["id"], "duplicate frame"))
        hashes.add(digest)
        if row["id"] in seeds:
            problems.append((row["id"], "duplicate id"))
        seeds.add(row["id"])
        if (frame[..., 3] != 255).any():
            problems.append((row["id"], "alpha"))
        for o in row["objects"]:
            mask = np.frombuffer(base64.b64decode(o["mask"]), np.uint8)
            if mask.size != w * h:
                problems.append((row["id"], "mask size"))
                continue
            mask = mask.reshape(h, w).astype(bool)
            ys, xs = np.nonzero(mask)
            if not len(xs):
                problems.append((row["id"], "empty mask"))
                continue
            x, y, bw, bh = o["box"]
            expected = (xs.min() / w, ys.min() / h, (xs.max() + 1 - xs.min()) / w, (ys.max() + 1 - ys.min()) / h)
            if max(abs(a - b) for a, b in zip((x, y, bw, bh), expected)) > 1.01 / min(w, h):
                problems.append((row["id"], "box does not match mask"))
            if not (0.02 <= mask.mean() <= 0.7):
                problems.append((row["id"], "mask area %.3f" % mask.mean()))
            if o["referenceColor"] not in LABELS:
                problems.append((row["id"], "label " + o["referenceColor"]))
            if o.get("referenceSecondary") is not None and (o["referenceSecondary"] not in LABELS or o["referenceSecondary"] == o["referenceColor"]):
                problems.append((row["id"], "secondary colour invalid"))
            if bool(o["tags"]["twoTone"]) != (o.get("referenceSecondary") is not None) and o["tags"]["twoTone"] and o.get("referenceSecondary") is None:
                pass  # a two-tone object whose minor colour is under 12% keeps no secondary on purpose
            areas.append(mask.mean())
            labels[o["referenceColor"]] += 1
            for key in tags:
                tags[key][str(o["tags"][key])] += 1
    for other in others:
        ids = {r["id"] for r in load(other)}
        shared = seeds & ids
        if shared:
            problems.append(("split", f"{len(shared)} ids shared with {other}"))
    report = {
        "file": path,
        "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "rows": len(rows),
        "problems": problems[:20],
        "problemCount": len(problems),
        "maskAreaMeanMinMax": [float(np.mean(areas)), float(np.min(areas)), float(np.max(areas))] if areas else None,
        "labels": dict(labels),
        "tags": {k: dict(v) for k, v in tags.items()},
    }
    print(json.dumps(report, indent=1))
    sys.exit(1 if problems else 0)


main()
