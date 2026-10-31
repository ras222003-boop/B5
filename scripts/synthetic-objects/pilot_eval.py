"""Feasibility pilot: do hand-drawn synthetic objects carry any signal for recognising REAL photos?
Embedding = global-average-pooled stride-32 backbone-end feature of the on-disk official YOLOX-S ONNX (fixed BEFORE
looking at any result, so the layer is not tuned on the test photos). Classifier = cosine nearest centroid trained on
the drawings ONLY. Test = the owner's own real photos, one per class, with the owner's annotation overlay removed.
This is a 14-item feasibility signal, not an accuracy measurement. A shuffled-label control must land near chance.
Usage: pilot_eval.py <synthetic-dir> <real-manifest.json> <real-images-dir> <extra-real-image> <out.json>
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import onnx
import onnxruntime as ort
from onnx import shape_inference
from PIL import Image

MODEL = "C:/Users/Asus/basira-ml/data/objects-v5/models/yolox_s.onnx"
# class -> index (0-based) in the owner's 28-photo manifest order; oil_heater comes from the separate attachment
REAL = {"air_fryer": 4, "kettle": 5, "trash_bin": 23, "microwave_oven": 6, "fridge": 7, "water_dispenser": 1, "split_ac": 17,
        "dishwasher": 2, "wardrobe": 9, "window_ac": 18, "bathroom_scale": 19, "robot_vacuum": 12, "pressure_cooker": 27}


def build_extractor():
    m = shape_inference.infer_shapes(onnx.load(MODEL))
    order = {n.output[0]: i for i, n in enumerate(m.graph.node) if n.output}
    cands = []
    for vi in m.graph.value_info:
        dims = [d.dim_value for d in vi.type.tensor_type.shape.dim]
        if len(dims) == 4 and dims[2] == 20 and dims[3] == 20 and dims[1] >= 256:
            cands.append((order.get(vi.name, -1), vi.name))
    cands.sort()
    name = cands[0][1]  # FIXED rule: the earliest stride-32 tensor with >=256 channels = end of the backbone
    m.graph.output.append(onnx.helper.make_tensor_value_info(name, onnx.TensorProto.FLOAT, None))
    return ort.InferenceSession(m.SerializeToString(), providers=["CPUExecutionProvider"]), name


def letterbox(img, size=640):
    w, h = img.size
    r = min(size / w, size / h)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(img.resize((int(w * r), int(h * r)), Image.BILINEAR), (0, 0))
    return np.asarray(canvas, dtype=np.float32)[:, :, ::-1].transpose(2, 0, 1)[None].copy()


def embed(session, name, img):
    out = session.run([name], {"images": letterbox(img)})[0]
    v = out[0].mean(axis=(1, 2))
    return v / (np.linalg.norm(v) + 1e-9)


DINO = "C:/Users/Asus/basira-ml/data/dinov2/model_uint8.onnx"


def dino_session():
    return ort.InferenceSession(DINO, providers=["CPUExecutionProvider"])


def dino_embed(session, img):
    """Per preprocessor_config.json: resize shortest edge to 256 (bicubic), centre crop 224, ImageNet mean/std.
    Embedding = the CLS token (fixed before any result was seen)."""
    w, h = img.size
    r = 256 / min(w, h)
    img = img.resize((max(224, round(w * r)), max(224, round(h * r))), Image.BICUBIC)
    w, h = img.size
    img = img.crop(((w - 224) // 2, (h - 224) // 2, (w - 224) // 2 + 224, (h - 224) // 2 + 224))
    x = (np.asarray(img, dtype=np.float32) / 255 - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    out = session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0]
    v = out[0, 0]
    return v / (np.linalg.norm(v) + 1e-9)


def remove_overlay(path):
    """Inpaint the owner's mint/red outline and white label pill so the model cannot read the annotation."""
    bgr = cv2.imread(str(path))
    b, g, r = [bgr[..., i].astype(np.int16) for i in range(3)]
    mask = (((r < 120) & (g > 200) & (b > 100) & (b < 200)) | ((r > 215) & (g < 60) & (b < 60)) | ((r > 246) & (g > 246) & (b > 246))).astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((9, 9), np.uint8), iterations=2)
    return Image.fromarray(cv2.cvtColor(cv2.inpaint(bgr, mask, 5, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB))


def main():
    syn_dir, manifest_path, images_dir, extra, out_path = sys.argv[1:6]
    use_dino = "--dino" in sys.argv
    if use_dino:
        session, name = dino_session(), "dinov2-small-uint8-cls"
        embed_fn = lambda im: dino_embed(session, im)
    else:
        session, name = build_extractor()
        embed_fn = lambda im: embed(session, name, im)
    meta = json.loads((Path(syn_dir) / "index.json").read_text(encoding="utf-8"))
    classes = sorted({m["class"] for m in meta})
    train_x, train_y = [], []
    for m in meta:
        train_x.append(embed_fn(Image.open(Path(syn_dir) / m["file"]).convert("RGB")))
        train_y.append(classes.index(m["class"]))
    train_x, train_y = np.array(train_x), np.array(train_y)
    samples = json.loads(Path(manifest_path).read_text(encoding="utf-8"))["samples"]
    test = []
    for cls, idx in REAL.items():
        test.append((cls, remove_overlay(Path(images_dir) / (samples[idx]["id"] + ".jpg"))))
    test.append(("oil_heater", Image.open(extra).convert("RGB")))
    centroids = np.array([train_x[train_y == k].mean(0) for k in range(len(classes))])
    centroids /= np.linalg.norm(centroids, axis=1, keepdims=True)
    rng = np.random.default_rng(0)
    shuffled = rng.permutation(train_y)
    ctrl = np.array([train_x[shuffled == k].mean(0) for k in range(len(classes))])
    ctrl /= np.linalg.norm(ctrl, axis=1, keepdims=True)
    rows, ok1, ok3, okc = [], 0, 0, 0
    for cls, img in test:
        e = embed_fn(img)
        sims = centroids @ e
        order = np.argsort(-sims)
        top = [classes[i] for i in order[:3]]
        ok1 += top[0] == cls
        ok3 += cls in top
        okc += classes[int(np.argmax(ctrl @ e))] == cls
        rows.append({"truth": cls, "top3": top, "bestSimilarity": round(float(sims[order[0]]), 3), "margin": round(float(sims[order[0]] - sims[order[1]]), 3)})
    result = {"feature": name, "trainImages": len(train_y), "classes": len(classes), "realTestItems": len(test),
              "top1": ok1, "top3": ok3, "shuffledLabelControlTop1": okc, "chanceTop1": round(len(test) / len(classes), 2), "items": rows,
              "meaning": "Feasibility signal on 14 real photos only; trained on unapproved drawings; not an accuracy measurement."}
    Path(out_path).write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "items"}, ensure_ascii=False))
    for r in rows:
        print(f"{r['truth']:16s} -> {r['top3']}  sim={r['bestSimilarity']} margin={r['margin']}")


if __name__ == "__main__":
    main()
