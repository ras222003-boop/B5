# First real Basira training: execute the existing pipeline

This change finishes technical preparation rather than adding a new review interface or trainer. It reuses the Studio review plan, batch approvals, local detector/OCR/privacy tooling, grouped split, locked COCO export, `train.py`, ONNX exporter and isolated browser comparison.

The existing batch board now honors the current, version/SHA-bound advisory review plan. Old plan entries are ignored after an image changes. Sorting never grants approval. The existing local prereview runner accepts an explicit key selection so only stale, unapproved development reports need refreshing:

```powershell
node scripts/vision-ai/studio/prereview-run.mjs --data-root "$env:USERPROFILE\Documents\Basira-Vision-Datasets" --keys-json '<private JSON array of sample keys>'
```

Unknown/duplicate keys, wrong content kind and approved images are rejected. The existing final-test exposure guard runs before model inference. The default development run skips already approved images. Reports and metadata-free masked drafts remain proposals; label edits and privacy/rights decisions still require actual humans.

## Small pilot and unresolved data gates

The proposed first engineering pilot focuses on chairs and tables because these were weak in the current-engine diagnostic. Use a small selection of development images from different photographer/session groups, preserving **all** exhaustive object labels, including other classes that occur in those images. For the current local selection the planning target is 16 development candidates plus eight new independent real test images, four containing chairs and four containing tables. This is an execution experiment, not a statistically sufficient accuracy or navigation-safety study.

Declared photographer groups are conservative grouping aids, not proof of independent capture sessions. Independently review scene/session identity, dates, same-location series, similar pictures, privacy, source attribution and actual commercial training rights. Do not infer camera motion from a still picture or metric distance from a box. The current validator requires reviewed lighting, scene and capture-motion fields. Where evidence is missing, keep the image unresolved or use a documented alternative. This change deliberately does not weaken those gates or invent condition values.

Select development validation using development data only, then verify positive coverage for each focus class in train and validation. The existing splitter can produce inadequate small-class coverage; a technical split alone does not establish suitable coverage. Do not drop incidental objects to make class counts look balanced. Do not use a final test to choose a split seed, threshold, epoch count or model.

Fresh test candidates must remain separate and receive no detector/OCR/scene/proximity inference for development. Source/rights checks and independent manual reference annotation are still required. Internet metadata can support provenance, but cannot certify actual session independence or privacy. Quarantined acquisitions are not an approved or registered test cohort. Stop collection when the source returns 403/429; do not circumvent access limits.

Use [the existing batch workflow](BATCH-REVIEW.md) to register approved new sessions, freeze the grouped dataset and export the locked COCO files. A single approved image can pass canonical unsplit validation, but cannot provide disjoint train/validation/test or adequate class coverage. Never manufacture empty exports or approvals to make the real training preflight pass.

## Environment and pretrained weights

An isolated CPU environment is a useful zero-rental-cost option when the computer has no NVIDIA CUDA device. Use the existing pinned requirements, without changing application or privacy-tool dependencies:

```powershell
$trainingEnv = Join-Path $env:USERPROFILE 'Basira-Private-Backup\tools\basira-training-cpu-py312'
# Only create a new environment; inspect before reusing an existing directory.
python -m venv $trainingEnv
$python = Join-Path $trainingEnv 'Scripts\python.exe'
& $python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.7.1+cpu torchvision==0.22.1+cpu
& $python -m pip install -r ml/vision/requirements-training.txt
& $python -m pip check
& $python scripts/vision-ai/train.py gpu-check --output '<new private environment report.json>'
```

Python 3.12 is supported by this verified CPU setup. `gpu-check` reports `ready=false` and exits 2 without CUDA even if CPU imports work correctly. Missing libraries or incompatible binary/operator imports now produce a structured failure report instead of failing before the report exists. No packages or GPU resources are provisioned by `gpu-check` itself. Import/forward/library smoke tests do not constitute training, checkpoint approval or a real SSDLite ONNX export.

The official checkpoint is `ssdlite320_mobilenet_v3_large_coco-a79551df.pth`, linked from [torchvision v0.22.1](https://github.com/pytorch/vision/blob/v0.22.1/torchvision/models/detection/ssdlite.py). Preserve original bytes and record the full SHA-256; the official filename prefix is only a partial checksum. Keep a local snapshot of the versioned source, LICENSE and README and an input-bound pending descriptor.

The torchvision code license is BSD-3-Clause. Its [pretrained-model notice](https://github.com/pytorch/vision/blob/v0.22.1/README.md#pre-trained-model-license) says pretrained weights may have separate dataset-derived terms. Do not mark the checkpoint approved merely because the code is BSD-licensed. An actual independent reviewer must assess intended commercial use and record permission before setting `reviewStatus=approved` and `trainingAllowed=true`. No pretrained weight execution is needed to download/hash/review the evidence.

## Resource proposal, not a purchase

- Local CPU: no GPU rental charge. For a tiny five-epoch pilot, reserve up to 30 minutes for training/export/checks as an initial planning window; actual training time is unmeasured. Synthetic forward latency does not measure training or phone performance. Prefer this route when it avoids unnecessary cloud transfer of sensitive data.
- Optional GPU: the [Runpod Pods pricing page](https://www.runpod.io/pricing), checked 2026-10-16, lists an RTX A5000 with 24 GB VRAM / 25 GB host RAM at $0.27 per GPU-hour. A provisional two-hour compute allocation is $0.54. A proposed total ceiling of $2 is **not approved or provisioned**; first confirm availability, region, actual checkout price, disk, retention, transfer and taxes. Persistent idle storage can continue to incur charges. Obtain explicit resource start/stop and retention instructions with owner approval.
- Colab's [free GPU access](https://research.google.com/colaboratory/faq.html) is availability-limited. Free compute still requires separate approval for the exact cloud-transferred files and their rights/privacy. Do not mount or upload the dataset automatically.

The project experiment remains SSDLite320 MobileNetV3 Large, seed 20261014, five epochs, batch four, one frozen-backbone epoch, 320-pixel input and ONNX opset 17. Do not start a CPU or GPU training run until the dataset gates, checkpoint review and explicit owner run approval are complete. Existing input-bound approval additionally requires different actual dataset and training-plan reviewers; do not invent IDs or sign on their behalf.

## Commands after the real approvals exist

Use paths returned by the existing Studio frozen exporter. These are placeholders, not claims that such an export/approval currently exists.

```powershell
$datasets = Join-Path $env:USERPROFILE 'Documents\Basira-Vision-Datasets'
$manifest = '<absolute path to approved studio-frozen-UUID.json>'
$export = '<absolute path to exports\pilot-UUID>'
$pretrained = '<absolute path to independently approved checkpoint descriptor.json>'
$approval = '<absolute path to approved input-bound training approval.json>'
$run = Join-Path $datasets 'runs\pilot-001'
& $python scripts/vision-ai/train.py approval-template --manifest $manifest --data-root $datasets --export $export --pretrained $pretrained --output "$datasets\runs\approval.pending.json"
# Actual reviewers inspect/sign the pending approval. The owner separately authorizes the run.
& $python scripts/vision-ai/train.py train --manifest $manifest --data-root $datasets --export $export --pretrained $pretrained --approval $approval --output $run --device cpu --preflight-only
# ONLY after explicit run permission, remove --preflight-only:
& $python scripts/vision-ai/train.py train --manifest $manifest --data-root $datasets --export $export --pretrained $pretrained --approval $approval --output $run --device cpu
& $python scripts/vision-ai/train.py export --run $run --output "$run-onnx"
```

Use `--device cuda` only on an approved CUDA host with the pinned environment. It refuses silent CPU fallback. Record configuration, resolved requirements, actual device, source commit, logs, weights and SHA-256 using the existing trainer.

The existing ONNX exporter must pass graph checking and tensor parity; only then test the actual candidate in the existing isolated comparison path, preserving EfficientDet as baseline. Benchmark the same sealed test for both models without tuning against it. Measure class precision/recall/AP, false alerts and matched-device speed; perform phone and real-camera tests only with the actual exported model and appropriate local permissions. No trained candidate, live camera result, phone FPS or metric accuracy may be claimed before those tests exist. Production remains unchanged.

## Encrypted retention

Keep originals, previous revisions and existing recovery identities. Use the existing verified age executable/recipient and private backup root. Encrypt and SHA-verify local copies of the eventual weights, configuration, logs, export contract and evaluation results; test decryption to a new local directory. Do not include identity registries, passwords, secrets or the recovery key in a data/model backup. An encrypted local readiness-report restore test verifies that local key pairing works; it is not a trained-model backup or proof of an independently stored recovery key.

Keep all Drive transfers pending until per-file rights/privacy, intended cloud-storage permission, target account, isolation, quota, exact encrypted file list, offline recovery and explicit owner transfer approval are satisfied. No current approval for a prior report extends to these new reports, media or weights. Nothing is deleted or uploaded by these preparation steps.
