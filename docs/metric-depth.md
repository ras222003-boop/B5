# Indoor camera-only metric depth in Basira

## Implementation and provenance

Basira Vision now loads **Depth Anything V2 Metric Hypersim Small** when the user
turns on Auto Meter in an ordinary browser. The original metric checkpoint is
`depth_anything_v2_metric_hypersim_vits.pth`, SHA-256
`b782898d8a3e8be1f639de33837ed85e9b4b73e40f8f5e5cd99067588d722545`.
It comes from the [authors' model repository](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small).
The [upstream code](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth)
and Small model carry Apache-2.0 terms; the redistributed ONNX file includes
the upstream [license](../client/public/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/LICENSE)
and [notice](../client/public/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/NOTICE.md).
The existing `onnx-community/depth-anything-v2-small` file remains a **relative**
depth model. Its weights are never used for metre readings.

The repository source `model-assets/metric-depth/model_fp32.onnx` was exported from the official metric `.pth`
with a fixed 392 × 392 RGB input and an output in metres. The original `.pth`
is fetched for conversion and ignored by Git. The identical FP32 ONNX bytes
are split into six public files of at most 16 MiB by
`node scripts/metric-depth/split-artifact.mjs`. The browser assembles the files
after validating the manifest, content types, sizes, and SHA-256. The build gate hashes
the original and all parts together. This avoids the hosted platform's observed
failure to serve the 99 MB single file, without replacing the metric weights.
Ordinary users do not need Python or a Hugging Face connection. At runtime ONNX Runtime Web tries WebGPU if available, then uses
the locally served WASM backend. Model loading begins only after Auto Meter is
enabled. The AI output uses `MONOCULAR_METRIC`, separate from `ARKIT_DEPTH`,
`LIDAR`, `ARCORE_DEPTH`, and `DEPTH_SENSOR`.

## Conversion and parity

Reproduce with Python 3.12, PyTorch 2.5.1, torchvision 0.20.1, NumPy 1.26.4,
OpenCV 4.11, ONNX 1.19, ONNX Runtime 1.23.2, and Pillow 11.3. Clone upstream
at commit `a561b849ebae10a6f5ef49e26c83cbbcd36c71bf`, download the original
checkpoint linked above, then run
`python scripts/metric-depth/export_and_verify.py --upstream <clone> --checkpoint <pth> --output model-assets/metric-depth/model_fp32.onnx --report docs/metric-depth-parity.json --scratch <ASCII-path>`.
The scratch path is needed on this Windows host because ONNX shape inference
could not write intermediate files under a Unicode path.

The [parity report](metric-depth-parity.json) records two deterministic inputs
and three upstream example photographs. Across these five inputs, the largest
FP32 ONNX versus original PyTorch pixel difference was **0.000118 m**. This
only establishes conversion parity, not physical distance accuracy. An INT8
trial reached **0.657 m P95 difference** on an example photograph; its output
is explicitly excluded from the app.

The model preserves image aspect ratio by padding to a 392 × 392 canvas, then
projects output pixels back to the detector frame. A 5 × 5 central sample of
each confident detection rejects invalid pixels, missing centers, mixed-depth
boxes, outputs older than six seconds, and values outside the 0.5–3 m display range. A single
copied RGB frame is passed to both object detection and model inference. A
separate centre-surface reading samples a narrow patch of the same metric map
even when the detector finds no named object. It requires valid, consistent
pixels and the same 0.5–3 m range, and is labelled as a surface rather than
as an object. AI
readings are displayed and spoken only in the opt-in Auto Meter panel; they are
never turned into trusted `DepthReading`, scene metric fusion, collision alarms,
stair/drop-off alerts, or movement commands. Low-light and unknown-quality
frames are withheld. A displayed reading also expires after six seconds. The
browser releases per-frame ONNX tensors and does not retain an extra 99 MB copy
of the model after session creation.

## Verification performed and remaining device work

Run `node scripts/metric-depth/verify-artifact.mjs` to check the FP32 source and
deployed slices against the pinned SHA-256 and parity report; CI performs this check before
building. The Vite production build succeeded. Unit tests cover channel normalization,
portrait/landscape projection, invalid outputs, object association, stale and
mixed depths, and the native safety/fusion path. A local headless Chrome run
loaded and checked the six FP32 parts through ONNX Runtime Web and produced
19,200 finite depth pixels for a 640 × 480 synthetic frame. The centre-surface
extractor returned 1.93 m for that synthetic image; this number has **no real
distance reference**. Repeat with `node scripts/metric-depth/browser-smoke.mjs`
against a running Vite development server. This is a functional browser test, **not** an
iPhone performance or physical accuracy measurement. WebGPU availability and
fallback behavior still need testing on the target phone/browser.

## iPhone field test before any accuracy claim

Use an iPhone on HTTPS in a stationary, supervised indoor setup. Select
`MONOCULAR_METRIC` in the Auto Meter trial panel; if an ARKit/LiDAR native
wrapper is also tested, collect a separate session and source. Measure from
the rear camera lens to the visible object surface with a tape or calibrated
laser at **0.5, 1, 1.5, 2, and 3 m**. Record at least 30 independent attempts
at each distance, including unavailable readings and detector misses. Repeat
across good/dim light, textured/flat/reflective surfaces, and slow hand motion.
Do not select only successful readings. The visible object, frame ID, device,
OS, reference, condition, and rejection reason are exported as JSONL without
images or location.

Run `node scripts/auto-meter-report.mjs <trials.jsonl> <report.md>`. The report
calculates mean absolute error, P95 absolute error, and unavailable percentage
per reference distance and source. Record load latency, inference rate, 15-minute
battery change, and thermal behavior alongside the JSONL. No real iPhone trial
data is present in this repository; Basira must continue to label these values
as **experimental estimates**. Device testing cannot make them a sole basis
for collision or stair warnings.

| iPhone AI reference | Attempts | Mean absolute error | P95 absolute error | Unavailable |
| --- | ---: | ---: | ---: | ---: |
| 0.5 m | — | — | — | — |
| 1 m | — | — | — | — |
| 1.5 m | — | — | — | — |
| 2 m | — | — | — | — |
| 3 m | — | — | — | — |

The dashes mean **not measured on a physical iPhone**, not zero error.

## Hosted failure found on 12 October 2026

At `https://www.aurum-nexus.com.aurum-nexus-basira.lol`, the old
`/vision/models/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/onnx/model_fp32.onnx`
URL returned HTTP **200**, `Content-Type: text/html; charset=UTF-8`, and the
Basira HTML shell, rather than the 98,940,415-byte ONNX model. A range request
also returned HTTP 200 HTML rather than 206 binary. This proves the hosted
single-file model was unavailable, even though the UI loaded. The four runtime
assets (`ort-wasm-simd-threaded.wasm`, `.mjs`, `.jsep.wasm`, `.jsep.mjs`) returned
HTTP 200 with the correct WASM or JavaScript MIME types and sizes 11,133,407,
20,856, 21,596,019, and 44,484 bytes respectively; range requests returned
206 with 256 binary/script bytes. The single-model endpoint did not provide a
usable `Content-Length` header. The UI previously collapsed the resulting
size error into “المسافة غير متاحة”.

The deployment fix is the verified six-part delivery above. After deploying
this branch, check the new manifest and six parts with
`node scripts/metric-depth/check-hosted-assets.mjs <site-origin>` and run an
actual Safari/iPhone 14 Pro camera trial. Neither deployment nor a physical
iPhone trial is performed by this pull request.
