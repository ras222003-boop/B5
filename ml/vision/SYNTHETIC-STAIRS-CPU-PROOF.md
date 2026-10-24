# Local synthetic stairs CPU proof

This is a separate research experiment. It does not read Basira's real dataset,
grant human approval, modify production vision, or establish safe navigation.
Generated media, checkpoints, and ONNX files remain in a private output folder
outside this repository; only the generator, validator, trainer, tests, and this
report belong in Git.

## Reproduce or resume

Use the already installed Python environment with Pillow, NumPy, PyTorch CPU,
ONNX, and ONNX Runtime. Blender, OpenCV, and pretrained weights are not needed.
The runner reuses a completed manifest and a matching training report only after
checking the checkpoint, weights, and ONNX hashes. An interrupted attempt is
retained. Use a new output folder for a new cohort.

```powershell
$python = Join-Path $env:USERPROFILE 'Basira-Private-Backup\tools\basira-training-cpu-py312\Scripts\python.exe'
$output = Join-Path $env:USERPROFILE 'Documents\Basira-Synthetic-Stairs-Proof'
& $python scripts/vision-ai/synthetic-stairs/run_proof.py --output $output --minutes 30 --threads 2 --memory-mb 4096 --storage-mb 2048
```

The runner records a journal, checks child working set and output size, and
stops at the authorized wall-time limit. The trainer separately checks its own
memory, time, and storage bounds and supports `--resume`. To stop, interrupt the
runner; rerun the same command to resume without deleting prior output. The
bundled FFmpeg supports VP8/WebM but lacks MP4 output; both WebM clips and the
original PNG frame sequences are saved. If that binary is unavailable, the
frame sequences and camera poses remain and no video file is claimed.

## What actually ran on 2026-10-24

The final frozen synthetic manifest has SHA-256
`336d265a86c0ff157ee32992f0ae5649d471d36c5ee10a1ecbc4587c6edbd6cc`.
All outputs below bind to that exact manifest. Earlier technical attempts were
retained separately and are not the final result. The final run was made from
the generator and validator in this change.

| Output | Verified result |
| --- | --- |
| Scenes | 12 distinct scene groups: 6 train, 3 validation, 3 synthetic test |
| Images and masks | 52 RGB PNGs and 52 binary masks; 26/9/17 train/validation/test images |
| Motion | Two eight-frame camera paths; both actual WebM clips decoded to eight frames |
| Labels | Camera-relative up/down from 3D stair axis, camera position and gaze; normalized boxes, binary masks, COCO uncompressed RLE, poses and frame IDs |
| Data checks | SHA, RGB/mask shape, area, box, RLE equality, visible treads, independent camera position/gaze alignment, video frame order, and scene/group split isolation passed |
| Training | Random initialization, 3 epochs, 21 real backward/optimizer steps, max parameter change 0.03510388 |
| Resource use | Two CPU threads; measured peak working set 339.53 MB against a 4096 MB bound; complete private proof output about 10 MB |
| Checkpoint | Saved and reloaded; a fresh inference passed. SHA-256 `454eaa3718673bc3c442fc75b64d96b70fa8152c73c98f1bb3c0a85164360a66` |
| Weights | Saved SHA-256 `41bf150688feeeb83dff3e21e29bb3832a190d6b43cc8764c00373b540fc6152` |
| ONNX | Exported SHA-256 `2881e22e46fd3f31958eb0c0f0574369f47e7ca7cf382c922933d2bb2a2424a9`; checker and ONNX Runtime inference passed; max PyTorch parity error `2.38e-7` |

The synthetic scene-disjoint test contained 17 images, including 14 positives
and three negatives. Stair-presence precision was **0.824** and recall **1.0**,
but every negative was a false alert. Direction was correct on only **3 of 14**
positive images (0.214): all 11 descending images were called ascending. Only
three of 17 test images had both the right class and IoU at least 0.5. These
numbers are a diagnosis of a weak tiny model on a tiny stylized cohort, not a
claim of accuracy. The test scenes are disjoint from the training scenes, but
the same rendered images were evaluated in an earlier technical attempt; this
is not an untouched final test across iterations. No model tuning used those
test scores. No real-camera evaluation or independent mobility test has been
performed.

## Boundaries and next iteration

The 3D renderer uses cuboid treads and risers, a pinhole camera, procedural
colors and lighting, and a depth-ordered polygon pass. At least two treads must
be visible for an up/down label; the final cohort has at least five visible
treads on each positive. Descending views still show an oversized terminal
face, and scene style is far from phone footage. The small detector predicts
one object per image and does not model multiple staircases or escalator motion.
Synthetic masks are ground truth from this renderer, not human-reviewed real
annotations. They never enter a real final test set.

Before expanding toward thousands of images, improve geometry and occlusion,
add indoor/outdoor layouts, straight and multi-flight stairs, varied materials,
railings, realistic camera heights and paths, and harder ramp/escalator/shadow
negatives. Randomize each **scene** within plausible physical bounds and keep
all related stills and video frames in one group. Choose model changes using
only train and validation scenes; keep a newly generated synthetic test sealed
for each comparison. Compare checkpoint versions with fixed thresholds and
report false alerts, direction confusion, IoU, and CPU latency. A larger model
or more scenes may help, but this proof alone does not establish that.

For real-world evaluation, collect separately permitted images and videos from
independent locations and capture sessions, obtain the existing rights/privacy
reviews and reference labels, freeze a real test cohort, and measure performance
without tuning against it. The official human approval and production gates
remain unchanged. No claim about guiding blind users or preventing falls is
permitted from synthetic results alone.
