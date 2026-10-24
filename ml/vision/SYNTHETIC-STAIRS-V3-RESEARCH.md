# Basira stairs V3 and isolated camera lab — 2026-10-25

This branch adds a synthetic research model and a separate local camera lab.
It does not modify the production vision engine, approve real labels, or grant
navigation validity. All training media and model files remain outside Git.

## Changes driven by V2 errors

V2 missed eight ascending images, mostly low-contrast concrete/stone/metal, and
called down-looking empty floors, stripes and escalators descending stairs.
Its decoder summed all non-background probabilities and could announce stairs
even when background was the largest individual class. Its renderer also tied
background appearance to camera side; negative subtype camera views were fixed.

V3 changes the mechanism rather than just the number of epochs:

- Independent presence logits `{background, fixed_stair, escalator}` select
  their full argmax, then a separate direction head selects up/down/uncertain.
  A direction confidence/margin rule can abstain while retaining stair presence.
- A small GroupNorm CNN uses an auxiliary geometric mask loss to learn local
  stair evidence, with Smooth L1 and IoU box losses. The input is RGB NCHW160,
  letterboxed with byte127 padding. Model confidence remains **uncalibrated**;
  validation threshold selection is not probability calibration.
- Every fixed-stair family has ascending, descending and side views in the
  same split. Each material is crossed with indoor/outdoor environments.
  Every negative subtype has both level and downward-looking views. Escalators
  have mechanical side panels and tread ribs; markings and rails also occur on
  fixed stairs to reduce a simple color/rail shortcut.
- A depth-tested pinhole rasterizer handles landing occlusion and removes the
  solid rear-wall defect. Geometry is still stylized and not photorealistic.

The cohort contains 504 RGB images and masks from 112 independent scene groups:
train 288/64 groups, validation 72/16 groups, test 144/32 groups. The 64 training groups
are 32 fixed-stair families and 32 nonfixed families, with 8 families each of ramp,
stripes, empty floor and escalator. Five samples per scene per epoch keep extra
views from dominating. Direction-uncertain side views are present and measured.

The independent validator checked file hashes, RGB/mask shapes, mask-derived
boxes, COCO RLE, camera-relative labels, scene/seed/hash split isolation, material
crossing and test freshness against V1/V2. No byte-identical cross-scene images
were found. Coarse dHash still found 183 cross-split near pairs: 123 empty/empty,
38 stairs/stairs, 4 escalator/stairs and 18 others. This is a synthetic diversity
limitation; independent seeds do not prove visual independence or real transfer.

Manifest SHA-256:
`9b6bcca2a7c39cbe05b272b07e8ed24e168ac6e4829179458850925ab96c435c`.
Frozen-test fingerprint:
`d3551ee8c1c0d5bd150f71446a012c49b3d25d4dd843ccb8e430ea3dcc067f2c`.

## Actual CPU training and selection

Two candidates ran for 12 epochs/480 optimizer steps each: one copied compatible
V2 convolution/embed/box tensors and one started randomly. Both used two CPU
threads within 30 minutes, 4 GB RAM and 2 GB run storage. Peak measured working set
was 481.48 MB across candidates. Checkpoints were saved per epoch. The warmstart
candidate won on validation; the selected checkpoint is epoch 8 (320 steps).
The selected parameters changed by a maximum 0.23884 from initialization.

Validation selection rewards detection F1, presence macro recall, minimum
ascending/descending recall, all-direction accuracy and IoU including misses,
and penalizes fixed-stair false alerts. Epochs extend in blocks of three only
when the previous validation stage improves. Presence and direction thresholds
were selected on validation only and locked before test: presenceMin 0.35,
directionMin 0.45, directionMargin 0.10. No test score selected weights or settings.

Weights SHA-256:
`bc7a299b65b62b9923c56bb76cfb563eb86841cc39b7e543ee4026612c3cf279`.
ONNX SHA-256:
`a16132720922738e2cc3d248b84af5c1d92c6c9d97bc757d07867b3861ef0061`.
ONNX checker, reload inference and ONNX Runtime parity passed. The installed
exporter rejected adaptive 10x10-to-4x4 pooling; an equivalent slice/mean operation
preserved trained weights (random-tensor difference 1.79e-7). The final fresh-test
ONNX/PyTorch maximum error was 1.71e-5, below the 1e-4 check bound.

## Locked comparison on the new synthetic test

The 144 images comprise 32 up, 32 down, 16 uncertain, 48 background and 16 escalator views.
Frames from the same scene are correlated; the independent unit is 32 scenes.

| Metric | V2 | V3 |
| --- | ---: | ---: |
| Fixed-stair precision | 0.550 | 0.721 |
| Fixed-stair recall | 0.888 | 0.775 |
| Fixed-stair F1 | 0.679 | 0.747 |
| Fixed-stair false alerts on 64 nonfixed images | 58 | 24 |
| Missed fixed stairs out of 80 | 9 | 18 |
| Correct ascending out of 32 | 8 | 22 |
| Correct descending out of 32 | 31 | 23 |
| Correct uncertain direction out of 16 | 0 | 10 |
| Correct escalator out of 16 | 0 | 4 |
| Correct class and IoU at least 0.5 | 30/144 | 41/144 |
| Mean IoU over all objects, misses included | 0.482 | 0.489 |
| CPU forward median / p95, no preprocessing | 2.47/5.59 ms | 6.08/16.99 ms |

V3 eliminated empty-floor and stripe false alerts in this cohort; 12 ramp and
12 escalator views still caused fixed-stair alerts. Direction accuracy among
decisions was 90% at 62.5% coverage of all fixed-stair views; 12 detected views
abstained. These conditional numbers must be read with the 18 missed stairs.
Full class/presence confusion tables and examples are in the private comparison.

One technical evaluation retry occurred: V2 predictions were persisted, then
V3 result serialization failed on NumPy float32 box coordinates. V3 was inferred
again with unchanged locked weights/thresholds after converting box scalars to
Python floats. No model selection or tuning used either attempt's test results.
The test is now consumed; later model changes require another untouched test.

## Reproducing the pipeline

Use the existing Python environment with PyTorch CPU, NumPy, Pillow, ONNX and
ONNX Runtime. Run from B5. `$experiment` is a new private folder outside Git;
`$v2Report` points to the saved V2 training report, and `$oldV1`/`$oldV2` to the
prior synthetic manifests. These scripts do not download models or use cloud APIs.

```powershell
& $python scripts/vision-ai/synthetic-stairs/generate_v3.py --output $experiment --cohort research3b-20261025 --previous-manifest $oldV2 --previous-manifest $oldV1
& $python scripts/vision-ai/synthetic-stairs/validate_v3.py --manifest "$experiment/manifest.json" --previous-manifest $oldV2 --previous-manifest $oldV1 --output "$experiment/validation.json"
& $python scripts/vision-ai/synthetic-stairs/train_v3.py --root $experiment --output "$experiment/training" --v2-report $v2Report --minutes 30 --threads 2 --memory-mb 4096 --storage-mb 2048
& $python scripts/vision-ai/synthetic-stairs/compare_v3.py --root $experiment --run "$experiment/training" --v2-report $v2Report --output "$experiment/comparison"
```

The cohort tag above reproduces this experiment. Use a new cohort tag and include
this manifest among `--previous-manifest` inputs for any later final test. Stop
CPU training with Ctrl+C; rerunning the same command resumes saved epochs and
retains completed candidate outputs. A completed comparison is returned from
saved predictions/reports after hash checks, without redoing test inference.

## Camera lab and remaining limits

`scripts/vision-ai/camera-lab/server.mjs` serves a standalone Arabic lab with
locally installed ONNX Runtime Web assets. A strict adapter checks actual names
and output shapes for V2 and V3, including letterbox box reversal and direction
abstention. Images/video remain browser-local; the server accepts no media
payloads. Camera capture requests no audio; there is no speech/navigation path.
Metrics export contains predictions, latency and skipped/dropped frames, not media.

Desktop Chrome tests ran the actual V3 ONNX: image inference, a local synthetic
video, a synthetic fake-camera stream, camera-track shutdown and 390 px viewport.
There were no page errors or external requests. This verifies the desktop
pipeline, not real-camera accuracy or actual iPhone speed. Local HTTPS certificate
and token-gated private-LAN instructions are in `CAMERA-LAB.md`; physical iPhone
testing has not occurred. A strict HTTPS probe encountered Norton interception,
so certificate verification was kept enabled and the issue remains documented.

The model has a useful synthetic improvement with detection/descending-recall
tradeoffs, substantial remaining ramp/escalator errors and uncalibrated scores.
It is suitable for isolated research inspection only. Real media still requires
rights/privacy review and an independent real test; synthetic performance does
not establish navigation or fall-prevention safety.
