"""Decode a frozen colour cohort into the same <=320px sRGB frames the app samples, plus COCO polygon masks.
Usage: dump_frames.py <cohort-root> <stage> <out.jsonl> [--segformer <model_quantized.onnx>]
With --segformer, each object also gets "segMask": the pixels inside its box that the app's shipped SegFormer-B0
(ADE20K) labels as the object's class family. This is the runtime-feasible mask; objects whose class has no ADE
equivalent get segMask=null and are evaluated without a mask.
Masks are published human COCO polygons: an *oracle* used only to measure how much a good mask would help.
Resizing uses Pillow BILINEAR with reducing_gap; Chrome's canvas resampler differs slightly, so absolute numbers
are an offline estimate, not a browser measurement.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ADE = {
    "car": {20, 102}, "chair": {19, 30, 75}, "couch": {23, 30}, "bed": {7}, "bus": {80}, "bicycle": {127},
    "bottle": {98}, "backpack": {115}, "handbag": {115}, "suitcase": {115}, "book": {67}, "bench": {69},
    "truck": {83}, "motorcycle": {116}, "vase": {135},
}
segmenter = None
if "--segformer" in sys.argv:
    import numpy as np
    import onnxruntime as ort
    import torch
    segmenter = ort.InferenceSession(sys.argv[sys.argv.index("--segformer") + 1], providers=["CPUExecutionProvider"])
    SEG_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    SEG_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def segment(frame_image):
    small = frame_image.resize((512, 512), Image.BILINEAR)
    arr = ((np.asarray(small, dtype=np.float32) / 255.0 - SEG_MEAN) / SEG_STD).transpose(2, 0, 1)[None]
    logits = segmenter.run(None, {segmenter.get_inputs()[0].name: arr})[0]
    up = torch.nn.functional.interpolate(torch.from_numpy(logits), size=(frame_image.height, frame_image.width), mode="bilinear", align_corners=False)
    return up.argmax(1)[0].numpy().astype(np.uint8)


root = Path(sys.argv[1]).resolve()
stage = sys.argv[2]
out = Path(sys.argv[3])
manifest_bytes = (root / "manifest.json").read_bytes()
lock = json.loads((root / "cohort-lock.json").read_text())
assert hashlib.sha256(manifest_bytes).hexdigest() == lock["manifestSha256"], "cohort changed after freezing"
manifest = json.loads(manifest_bytes)
if out.exists():
    raise SystemExit("refusing to overwrite " + str(out))
rows = 0
with out.open("w", encoding="utf-8") as sink:
    for sample in manifest["samples"]:
        if sample["split"] != stage:
            continue
        raw = (root / sample["path"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == sample["sha256"]
        image = Image.open(root / sample["path"]).convert("RGB")
        w, h = image.size
        scale = min(1.0, 320 / max(w, h))
        fw, fh = max(1, round(w * scale)), max(1, round(h * scale))
        frame = image.resize((fw, fh), Image.BILINEAR, reducing_gap=2.0) if scale < 1 else image
        rgba = frame.convert("RGBA").tobytes()
        reference = json.loads((root / sample["referenceDocument"]).read_text())
        annotations = {str(a["id"]): a for a in reference["annotations"]}
        labels = segment(frame) if segmenter else None
        objects = []
        for obj in sample["objects"]:
            ann = annotations.get(obj["objectId"])
            mask_b64 = None
            if ann and isinstance(ann.get("segmentation"), list) and ann["segmentation"]:
                layer = Image.new("L", (fw, fh), 0)
                draw = ImageDraw.Draw(layer)
                for poly in ann["segmentation"]:
                    pts = [(poly[i] * fw / w, poly[i + 1] * fh / h) for i in range(0, len(poly) - 1, 2)]
                    if len(pts) >= 3:
                        draw.polygon(pts, fill=1)
                mask_b64 = base64.b64encode(layer.tobytes()).decode()
            seg_b64 = None
            if labels is not None and obj["cocoClass"] in ADE:
                x, y, bw, bh = obj["box"]
                x0, x1 = max(0, int(x * fw)), min(fw, int(np.ceil((x + bw) * fw)))
                y0, y1 = max(0, int(y * fh)), min(fh, int(np.ceil((y + bh) * fh)))
                layer = np.zeros((fh, fw), dtype=np.uint8)
                region = np.isin(labels[y0:y1, x0:x1], list(ADE[obj["cocoClass"]]))
                layer[y0:y1, x0:x1] = region
                seg_b64 = base64.b64encode(layer.tobytes()).decode()
            objects.append(
                {
                    "objectId": obj["objectId"],
                    "cocoClass": obj["cocoClass"],
                    "box": obj["box"],
                    "referenceColor": obj["referenceColor"],
                    "referenceComponents": obj.get("referenceComponents", []),
                    "mask": mask_b64,
                    "segMask": seg_b64,
                }
            )
        sink.write(
            json.dumps(
                {
                    "id": sample["id"],
                    "groupId": sample["groupId"],
                    "width": fw,
                    "height": fh,
                    "rgba": base64.b64encode(rgba).decode(),
                    "objects": objects,
                }
            )
            + "\n"
        )
        rows += 1
print(json.dumps({"stage": stage, "images": rows, "out": str(out)}))
