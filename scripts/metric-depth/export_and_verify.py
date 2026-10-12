"""Export the official Hypersim ViT-S checkpoint and compare PyTorch/ONNX.

Run with the pinned conversion environment described in docs/metric-depth.md.
The original repository is supplied with --upstream; no relative-depth weights
or third-party ONNX files are accepted by this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from PIL import Image

EXPECTED_SHA256 = "b782898d8a3e8be1f639de33837ed85e9b4b73e40f8f5e5cd99067588d722545"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, default=Path('.metric-temp'))
    args = parser.parse_args()
    scratch = args.scratch.resolve()
    scratch.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(scratch)
    digest = hashlib.sha256(args.checkpoint.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"Unexpected metric checkpoint SHA256: {digest}")
    sys.path.insert(0, str(args.upstream / "metric_depth"))
    from depth_anything_v2.dpt import DepthAnythingV2  # noqa: E402

    torch.set_num_threads(4)
    model = DepthAnythingV2(encoder="vits", features=64,
                            out_channels=[48, 96, 192, 384], max_depth=20)
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True)
    model.eval()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 3, 392, 392, dtype=torch.float32)
    with torch.inference_mode():
        torch.onnx.export(model, dummy, args.output, opset_version=17,
                          input_names=["pixel_values"], output_names=["depth_meters"],
                          do_constant_folding=True)

    fp32 = ort.InferenceSession(str(args.output), providers=["CPUExecutionProvider"])
    quantized = args.output.with_name("model_quantized.onnx")
    scratch_fp32 = scratch / 'metric-fp32.onnx'
    scratch_q8 = scratch / 'metric-q8.onnx'
    shutil.copyfile(args.output, scratch_fp32)
    quantize_dynamic(scratch_fp32, scratch_q8, weight_type=QuantType.QUInt8)
    shutil.copyfile(scratch_q8, quantized)
    q8 = ort.InferenceSession(str(quantized), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(2203)
    samples = [
        ("horizontal_gradient", np.broadcast_to(np.linspace(-1, 1, 392, dtype=np.float32)[None, None, None, :],
                        (1, 3, 392, 392)).copy()),
        ("noise", rng.normal(0, .7, size=(1, 3, 392, 392)).astype(np.float32)),
    ]
    for name in ("demo01.jpg", "demo03.jpg", "demo08.jpg"):
        path = args.upstream / "assets" / "examples" / name
        if not path.exists():
            continue
        image = Image.open(path).convert("RGB")
        scale = min(392 / image.width, 392 / image.height)
        width, height = round(image.width * scale), round(image.height * scale)
        canvas = Image.new("RGB", (392, 392), (0, 0, 0))
        canvas.paste(image.resize((width, height), Image.Resampling.BILINEAR),
                     ((392 - width) // 2, (392 - height) // 2))
        rgb = np.asarray(canvas, dtype=np.float32) / 255
        normalized = (rgb - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
        samples.append((name, normalized.transpose(2, 0, 1)[None].copy()))
    results = []
    for name, pixels in samples:
        with torch.inference_mode():
            reference = model(torch.from_numpy(pixels)).numpy()
        converted = fp32.run(None, {"pixel_values": pixels})[0]
        compressed = q8.run(None, {"pixel_values": pixels})[0]
        def difference(other: np.ndarray) -> dict[str, float]:
            errors = np.abs(reference - other)
            return {"mean_m": float(errors.mean()),
                    "p95_m": float(np.quantile(errors, .95)),
                    "max_m": float(errors.max())}
        results.append({"sample": name, "reference_range_m": [float(reference.min()), float(reference.max())],
                        "fp32": difference(converted), "q8": difference(compressed)})
    upstream_commit = subprocess.check_output(["git", "-C", str(args.upstream), "rev-parse", "HEAD"], text=True).strip()
    report = {"checkpoint_sha256": digest, "upstream_commit": upstream_commit,
              "input_shape": [1, 3, 392, 392], "samples": results,
              "fp32_sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
              "q8_sha256": hashlib.sha256(quantized.read_bytes()).hexdigest()}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if any(row["fp32"]["max_m"] > .05 for row in results):
        raise SystemExit("FP32 ONNX model exceeded parity threshold")


if __name__ == "__main__":
    main()
