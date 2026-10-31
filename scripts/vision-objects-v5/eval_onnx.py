"""Offline detector evaluation that replays the app's YOLOX pipeline exactly (top-left letterbox 114, BGR 0..255,
raw-grid decode, class-wise NMS) on a licensed real-photo cohort, so threshold / input-size questions are answered
with the same numbers the phone would produce.

Usage: eval_onnx.py <model.onnx> <cohort-dir> <splits comma list> <out.json> [--sizes 416,640] [--tile]
Reference = every non-crowd COCO box in the photo for classes the app supports (all 80), matched by class and IoU>=0.5.
The photos come from COCO and the official Tiny was trained on COCO train2017, so absolute numbers on train2017 photos
are optimistic for the original weights; the comparison between thresholds/sizes/models is what this is for.
Never run on a split that is meant to stay sealed.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

COCO = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"]


def letterbox(image, size):
    w, h = image.size
    ratio = min(size / w, size / h)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(image.resize((int(w * ratio), int(h * ratio)), Image.BILINEAR), (0, 0))
    arr = np.asarray(canvas, dtype=np.float32)[:, :, ::-1].transpose(2, 0, 1)[None].copy()
    return arr, ratio


def decode(out, size, ratio, minimum):
    grids, strides = [], []
    for s in (8, 16, 32):
        n = size // s
        yy, xx = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
        grids.append(np.stack([xx, yy], -1).reshape(-1, 2))
        strides.append(np.full((n * n, 1), s))
    grid, stride = np.concatenate(grids), np.concatenate(strides)
    v = out[0]
    scores_all = v[:, 4:5] * v[:, 5:]
    classes = scores_all.argmax(1)
    scores = scores_all.max(1)
    keep = (scores >= minimum) & (scores <= 1) & np.isfinite(scores)
    v, grid, stride, scores, classes = v[keep], grid[keep], stride[keep], scores[keep], classes[keep]
    centres = (v[:, :2] + grid) * stride / ratio
    sizes = np.exp(v[:, 2:4]) * stride / ratio
    boxes = np.concatenate([centres - sizes / 2, centres + sizes / 2], 1)
    return boxes, scores, classes


def iou_matrix(a, b):
    ix = np.maximum(0, np.minimum(a[:, None, 2], b[None, :, 2]) - np.maximum(a[:, None, 0], b[None, :, 0]))
    iy = np.maximum(0, np.minimum(a[:, None, 3], b[None, :, 3]) - np.maximum(a[:, None, 1], b[None, :, 1]))
    inter = ix * iy
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(1e-9, area_a[:, None] + area_b[None, :] - inter)


def nms(boxes, scores, classes, thr=0.55):
    keep = []
    for c in np.unique(classes):
        idx = np.where(classes == c)[0]
        idx = idx[np.argsort(-scores[idx])]
        while len(idx):
            i = idx[0]
            keep.append(i)
            if len(idx) == 1:
                break
            rest = idx[1:]
            idx = rest[iou_matrix(boxes[i : i + 1], boxes[rest])[0] < thr]
    return np.array(sorted(keep, key=lambda i: -scores[i]), dtype=int)


def main():
    model_path, cohort_arg, splits_arg, out_path = sys.argv[1:5]
    sizes = [416]
    if "--sizes" in sys.argv:
        sizes = [int(s) for s in sys.argv[sys.argv.index("--sizes") + 1].split(",")]
    cohort = Path(cohort_arg)
    splits = splits_arg.split(",")
    if "test" in splits:
        raise SystemExit("refusing to evaluate a sealed test split")
    manifest = json.loads((cohort / "manifest.json").read_text(encoding="utf-8"))
    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    thresholds = [0.65, 0.5, 0.35, 0.25, 0.15, 0.1]
    result = {}
    for size in sizes:
        stats = {t: {"tp": 0, "fp": 0, "fn": 0, "refTp": 0, "refN": 0} for t in thresholds}
        times = []
        byClass = {t: {} for t in thresholds}
        for sample in manifest["samples"]:
            if sample["split"] not in splits:
                continue
            doc = json.loads((cohort / sample["referenceDocument"]).read_text(encoding="utf-8"))
            image = Image.open(cohort / sample["path"]).convert("RGB")
            w, h = image.size
            # category ids in COCO are sparse (1..90); map them through the official list of 80 names
            ids = sorted({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 67, 70, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 84, 85, 86, 87, 88, 89, 90})
            assert len(ids) == 80
            cat = {i: COCO[k] for k, i in enumerate(ids)}
            truth = [([a["bbox"][0], a["bbox"][1], a["bbox"][0] + a["bbox"][2], a["bbox"][1] + a["bbox"][3]], cat[a["category_id"]], str(a["id"])) for a in doc["annotations"] if not a.get("iscrowd") and a["category_id"] in cat]
            refs = {o["objectId"] for o in sample["objects"]}
            t0 = time.perf_counter()

            def run(img, ox=0, oy=0):
                xx, rr = letterbox(img, size)
                o = session.run(None, {"images": xx})[0]
                b, sc, cl = decode(o, size, rr, min(thresholds))
                b = b + np.array([ox, oy, ox, oy])
                return b, sc, cl

            boxes, scores, classes = run(image)
            if "--tile" in sys.argv:
                # same layout as the app's detectTiled: full image + four 62% crops, edge-touching crop boxes dropped
                parts = [(boxes, scores, classes)]
                for top in (0, 0.38):
                    for left in (0, 0.38):
                        cx, cy = round(left * w), round(top * h)
                        cw = w - cx if w - cx < 0.62 * w else round(0.62 * w)
                        ch = h - cy if h - cy < 0.62 * h else round(0.62 * h)
                        b, sc, cl = run(image.crop((cx, cy, cx + cw, cy + ch)), cx, cy)
                        edge = np.zeros(len(b), dtype=bool)
                        if cx > 0:
                            edge |= (b[:, 0] - cx) < 0.008 * cw
                        if cy > 0:
                            edge |= (b[:, 1] - cy) < 0.008 * ch
                        if cx + cw < w:
                            edge |= (b[:, 2] - cx) > 0.992 * cw
                        if cy + ch < h:
                            edge |= (b[:, 3] - cy) > 0.992 * ch
                        parts.append((b[~edge], sc[~edge], cl[~edge]))
                boxes = np.concatenate([p[0] for p in parts])
                scores = np.concatenate([p[1] for p in parts])
                classes = np.concatenate([p[2] for p in parts])
            times.append((time.perf_counter() - t0) * 1000)
            keep = nms(boxes, scores, classes)
            boxes, scores, classes = boxes[keep], scores[keep], classes[keep]
            tb = np.array([t[0] for t in truth], dtype=float).reshape(-1, 4)
            for thr in thresholds:
                m = scores >= thr
                db, dc, ds = boxes[m], classes[m], scores[m]
                used = set()
                tp = 0
                for i in np.argsort(-ds):
                    best, bj = 0.0, -1
                    if len(tb):
                        ious = iou_matrix(db[i : i + 1], tb)[0]
                        for j in np.argsort(-ious):
                            if ious[j] < 0.5:
                                break
                            if j in used or truth[j][1] != COCO[dc[i]]:
                                continue
                            best, bj = ious[j], j
                            break
                    if bj >= 0:
                        used.add(bj)
                        tp += 1
                S = stats[thr]
                S["tp"] += tp
                S["fp"] += int(len(db) - tp)
                S["fn"] += int(len(truth) - tp)
                for j, t in enumerate(truth):
                    c = byClass[thr].setdefault(t[1], {"n": 0, "hit": 0})
                    c["n"] += 1
                    c["hit"] += int(j in used)
                    if t[2] in refs:
                        S["refN"] += 1
                        S["refTp"] += int(j in used)
        result[str(size)] = {
            "medianMs": float(np.median(times)),
            "thresholds": {
                str(t): {
                    "precision": s["tp"] / max(1, s["tp"] + s["fp"]),
                    "recall": s["tp"] / max(1, s["tp"] + s["fn"]),
                    "tp": s["tp"], "fp": s["fp"], "fn": s["fn"],
                    "humanReviewedObjectRecall": s["refTp"] / max(1, s["refN"]),
                    "humanReviewedObjects": s["refN"],
                }
                for t, s in stats.items()
            },
            "perClassRecallAt035": {k: v["hit"] / v["n"] for k, v in byClass[0.35].items() if v["n"] >= 5},
        }
        print(json.dumps({"size": size, "medianMs": result[str(size)]["medianMs"], **{str(t): (round(result[str(size)]["thresholds"][str(t)]["precision"], 3), round(result[str(size)]["thresholds"][str(t)]["recall"], 3), round(result[str(size)]["thresholds"][str(t)]["humanReviewedObjectRecall"], 3)) for t in thresholds}}))
    Path(out_path).write_text(json.dumps({"model": model_path, "splits": splits, "result": result}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
