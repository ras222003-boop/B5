"""Model box proposals for the human detection review. Proposals are NOT ground truth: they only save the reviewer
from drawing every box. Two official-family detectors (Tiny@416 and YOLOX-S@640) run at a low threshold and are merged.
Usage: make_proposals.py <cohort-dir> <splits> <tiny.onnx> <yolox_s.onnx> <out.json> [--min 0.25]
Refuses the sealed test split.
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_onnx import COCO, decode, iou_matrix, letterbox, nms  # noqa: E402


def main():
    cohort = Path(sys.argv[1])
    splits = sys.argv[2].split(",")
    if "test" in splits:
        raise SystemExit("refusing the sealed test split")
    models = [(sys.argv[3], 416, "tiny"), (sys.argv[4], 640, "yolox-s")]
    minimum = float(sys.argv[sys.argv.index("--min") + 1]) if "--min" in sys.argv else 0.25
    out_path = Path(sys.argv[5])
    sessions = [(ort.InferenceSession(p, providers=["CPUExecutionProvider"]), size, name) for p, size, name in models]
    manifest = json.loads((cohort / "manifest.json").read_text(encoding="utf-8"))
    images = []
    for sample in manifest["samples"]:
        if sample["split"] not in splits:
            continue
        image = Image.open(cohort / sample["path"]).convert("RGB")
        w, h = image.size
        boxes, scores, classes, sources = [], [], [], []
        for session, size, name in sessions:
            x, ratio = letterbox(image, size)
            out = session.run(None, {"images": x})[0]
            b, s, c = decode(out, size, ratio, minimum)
            boxes.append(b), scores.append(s), classes.append(c), sources.extend([name] * len(s))
        boxes, scores, classes = np.concatenate(boxes), np.concatenate(scores), np.concatenate(classes)
        sources = np.array(sources)
        keep = nms(boxes, scores, classes, 0.6)[:25]
        proposals = []
        for rank, i in enumerate(keep):
            x0, y0, x1, y1 = np.clip(boxes[i], [0, 0, 0, 0], [w, h, w, h])
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            proposals.append({
                "id": f"p{rank}",
                "class": COCO[classes[i]],
                "score": round(float(scores[i]), 3),
                "source": str(sources[i]),
                "box": [round(float(x0 / w), 4), round(float(y0 / h), 4), round(float((x1 - x0) / w), 4), round(float((y1 - y0) / h), 4)],
            })
        images.append({"id": sample["id"], "width": w, "height": h, "split": sample["split"], "proposals": proposals})
        print(sample["id"], len(proposals), flush=True)
    out_path.write_text(json.dumps({"schemaVersion": 1, "minimumScore": minimum, "note": "model proposals are not ground truth", "images": images}), encoding="utf-8")


main()
