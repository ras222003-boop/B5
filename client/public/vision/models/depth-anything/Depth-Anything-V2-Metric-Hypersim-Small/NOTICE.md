Depth Anything V2 Metric Hypersim Small is by Lihe Yang and the Depth Anything V2 contributors.

Source checkpoint: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small

The `onnx/model_fp32.onnx` file is a fixed 392 × 392 ONNX conversion of
`depth_anything_v2_metric_hypersim_vits.pth` from that repository. It contains
the metric indoor fine-tuned weights, not the relative-depth checkpoint.
Original checkpoint SHA-256:
`b782898d8a3e8be1f639de33837ed85e9b4b73e40f8f5e5cd99067588d722545`.

The repository code and Small model are licensed under Apache-2.0. The
accompanying `LICENSE` is copied from the upstream Depth Anything V2 repository.
The ONNX conversion is verified against the original PyTorch implementation in
`docs/metric-depth-parity.json`. See `docs/metric-depth.md` for reproduction.
