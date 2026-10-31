"""Evaluate detectors against the HUMAN detection review (complete images only, target classes only).
Truth = proposals the reviewer accepted (or re-classed) + boxes the reviewer drew. Precision/recall are per class,
IoU>=0.5, same ONNX replay as eval_onnx.py. Images the reviewer did not mark complete are ignored.
Usage: eval_against_human.py <cohort-dir> <reviews.jsonl> <out.json> --model name=path:size [--model ...]
Targets must match scripts/vision-objects-v5/review/server.mjs TARGETS.
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_onnx import decode, iou_matrix, letterbox, nms  # noqa: E402
from eval_onnx import COCO  # noqa: E402

TARGETS = {"person", "chair", "couch", "bed", "dining table", "tv", "laptop", "cup", "bottle", "bowl", "vase", "book", "backpack", "handbag", "suitcase", "umbrella", "car", "bus", "truck", "bicycle", "motorcycle", "bench", "traffic light", "potted plant", "refrigerator"}
THRESHOLDS = [0.65, 0.5, 0.35, 0.25]


def main():
    cohort, reviews_path, out_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    models = []
    for i, a in enumerate(sys.argv):
        if a == "--model":
            name, rest = sys.argv[i + 1].split("=", 1)
            path, size = rest.rsplit(":", 1)
            models.append((name, path, int(size)))
    manifest = json.loads((cohort / "manifest.json").read_text(encoding="utf-8"))
    paths = {s["id"]: cohort / s["path"] for s in manifest["samples"] if s["split"] != "test"}
    from_proposals = {}
    latest = {}
    for line in reviews_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            latest[r["imageId"]] = r
    # proposals file sits next to the reviews by convention
    proposals = {i["id"]: i for i in json.loads((reviews_path.parent / "proposals.json").read_text(encoding="utf-8"))["images"]}
    truth = {}
    for image_id, r in latest.items():
        if not r["complete"] or image_id not in paths:
            continue
        info = proposals[image_id]
        boxes = []
        for p in info["proposals"]:
            d = r["decisions"].get(p["id"])
            cls = p["class"] if d == "ok" else d[6:] if d and d.startswith("class:") else None
            if cls in TARGETS:
                boxes.append((p["box"], cls))
        for a in r["added"]:
            if a["class"] in TARGETS:
                boxes.append((a["box"], a["class"]))
        truth[image_id] = (info, boxes)
    if not truth:
        raise SystemExit("no complete reviewed images yet")
    result = {"completeImages": len(truth), "truthObjects": sum(len(b) for _, b in truth.values()), "models": {}}
    for name, path, size in models:
        session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        stats = {t: {"tp": 0, "fp": 0, "fn": 0} for t in THRESHOLDS}
        byclass = {}
        for image_id, (info, boxes) in truth.items():
            image = Image.open(paths[image_id]).convert("RGB")
            w, h = image.size
            x, ratio = letterbox(image, size)
            b, s, c = decode(session.run(None, {"images": x})[0], size, ratio, min(THRESHOLDS))
            keep = nms(b, s, c)
            b, s, c = b[keep], s[keep], c[keep]
            tb = np.array([[bx[0] * w, bx[1] * h, (bx[0] + bx[2]) * w, (bx[1] + bx[3]) * h] for bx, _ in boxes], dtype=float).reshape(-1, 4)
            tc = [cls for _, cls in boxes]
            for thr in THRESHOLDS:
                m = (s >= thr) & np.array([COCO[k] in TARGETS for k in c], dtype=bool)
                db, dc, ds = b[m], c[m], s[m]
                used = set()
                tp = 0
                for i in np.argsort(-ds):
                    hit = -1
                    if len(tb):
                        ious = iou_matrix(db[i : i + 1], tb)[0]
                        for j in np.argsort(-ious):
                            if ious[j] < 0.5:
                                break
                            if j not in used and tc[j] == COCO[dc[i]]:
                                hit = j
                                break
                    if hit >= 0:
                        used.add(hit)
                        tp += 1
                st = stats[thr]
                st["tp"] += tp
                st["fp"] += len(db) - tp
                st["fn"] += len(tb) - tp
                if thr == 0.35:
                    for j, cl in enumerate(tc):
                        e = byclass.setdefault(cl, {"n": 0, "hit": 0})
                        e["n"] += 1
                        e["hit"] += int(j in used)
        result["models"][name] = {
            "thresholds": {str(t): {"precision": v["tp"] / max(1, v["tp"] + v["fp"]), "recall": v["tp"] / max(1, v["tp"] + v["fn"]), **v} for t, v in stats.items()},
            "perClassRecallAt035": {k: v["hit"] / v["n"] for k, v in byclass.items()},
        }
        print(name, json.dumps({str(t): (round(result["models"][name]["thresholds"][str(t)]["precision"], 2), round(result["models"][name]["thresholds"][str(t)]["recall"], 2)) for t in THRESHOLDS}))
    out_path.write_text(json.dumps(result, indent=1), encoding="utf-8")


main()
