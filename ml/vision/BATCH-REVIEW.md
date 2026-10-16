# Basira Studio: inspected batch review

This extends the existing Studio, local prereview, immutable label history, rights/privacy validators, similarity grouping, COCO exporter and training approval tools. It does not change the production EfficientDet model or start training.

## Windows

From the repository:

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/vision-ai/studio/server.mjs --data-root "$env:USERPROFILE\Documents\Basira-Vision-Datasets" --port 4318
```

Open <http://127.0.0.1:4318/> and select **مراجعة الدفعات**. Before starting, check `Get-NetTCPConnection -LocalPort 4318 -State Listen`; reuse the verified server or stop only that verified Studio process before restarting it. Never run competing servers against this storage. Restart invalidates in-memory login sessions and inspection receipts. No password reset is required for this feature. The existing `--reset-password` command remains available for the local administrator.

## Human workflow

1. The actual annotator logs in with their own account and opens each image's original, proposed metadata-free derivative, boxes, machine findings and saved source evidence. No models rerun when this view opens. Existing current reports are reused; stale reports are not applied.
2. Keep original labels or explicitly accept/reject each machine candidate. Unmatched original objects stay present. For a straightforward image, **راجعت هذه الصورة وكل أدلتها: أبقِ الوسوم الحالية ولا توجد بيانات شخصية** fills this image's inspection assertions and absent-privacy choices only after an explicit human click. It never runs for the batch or from navigation. Choose other privacy outcomes or use the existing editor to correct boxes/masks where needed.
3. Check uncertain conditions against capture evidence. Unknown lighting, scene or camera motion remain exceptions; a still picture does not establish camera motion. Reasons are prefilled but editable. Add this inspected image to the queue.
4. **تأكيد تجهيز الدفعة** saves only the inspected images visible under the current filters. It creates one immutable revision per image, combining selected labels and a separate metadata-free derivative. It resets prior approvals. Originals are untouched. The operation reports individual failures; a stale image does not overwrite somebody else's work or stop unrelated saves.
5. The actual independent reviewer logs in, opens each prepared image and all its evidence, checks source entitlement to commercial training, labels and privacy, then adds that image to their own queue. Preparer privacy choices are shown as evidence; they are not preselected reviewer votes.
6. **اعتماد الدفعة المؤهلة** records rights, privacy and labels as three distinct decisions in one atomic image revision. Each contains sample key, active SHA, source evidence SHA, actor, timestamp, reason and revision. The enclosing audit binds the inspected version/report, proposal choices and operation ID. No machine approvals and no decisions under another person's identity are created.

Readiness is not approval. Missing/changed evidence, rejected rights, unresolved similarity or splits, unresolved model candidates, inadequate privacy redaction, incomplete scene/capture evidence and pending preparer inspection remain exceptions. Roles and independence from **all historical contributors** are checked again by the existing validators at write time. The UI cannot prove attention or legal truth; these remain human responsibilities. One account per real person remains an administrator trust boundary.

## Concurrency and recovery

Inspection receipts are bound to the authenticated session, actor, image/version, base manifest hash, media SHA, source evidence and report SHA, with a two-hour expiry. Both original and preview must have been requested before an image inspection can be queued. Receipts and unfinished image choices stay local in memory; refreshing warns about pending work, and restarting requires fresh inspection.

Buttons suppress repeated submits; server operation IDs are idempotent. Private job journals are in `.studio/batch-review/jobs/`. A repeated completed operation returns the same result. An interrupted operation is **not** automatically replayed: inspect immutable image history and reopen outstanding images. Each image revision is durably written to a unique temporary file and published with an exclusive hard link, so existing versions cannot be replaced. Batch operations intentionally permit partial success across images, but each image's three approval decisions are all-or-nothing.

The individual editor also preserves drafts on 400/409, displays the actual server reason, requests fresh items before writing, merges only disjoint edits, and requires explicit resolution for overlapping edits. Its automatic catalog refresh cannot replace a newly saved version with an older response.

All journals, derivatives, reports, identity records and actual datasets stay outside Git. Only code and this generic documentation are part of this change. No external requests or cloud analysis are added. The existing same-origin, loopback, CSRF, role, SHA and path/symlink protections remain enforced. Keep the dataset folder excluded from external filesystem sync.

## Frozen data and first GPU experiment

After a real eligible selection is approved, Studio automatically calls the existing reviewed-subset exporter. Synthetic data remain separate and cannot enter real training/evaluation exports. Existing development images are recorded in a private exposure ledger; future quality/model analysis records exposure before inference. They cannot be relabeled as an independent final test.

The training section lets an independent reviewer register an already approved real cohort from **new capture sessions**, with a local capture/session evidence file, SHA and explicit non-use-for-tuning assertion. Registration refuses observed samples, related development sessions, prior model reports, unresolved similarity and self-review. The cohort is immutable. Registered images/sessions/video identities are protected from development analysis, edits, and train/validation assignment. A trusted administrator must not remove the private policy or move data to a new root to bypass it. Human inspection and final evaluation are still necessary; this is not proof of representativeness.

Once sufficient approved development groups and that new test cohort exist, the existing group splitter assigns development validation; its provisional test reservation returns to train, and **only** the registered new sessions become final test. Existing validation and `exportCoco` produce an immutable frozen manifest, train/validation/test JSON and SHA-bound lock. Existing frozen assignments are never cleared or re-split. Fewer than three development groups, missing classes/coverage or export failures are reported rather than claiming training readiness. Coverage must be reviewed before training approval.

Until then the honest status is `WAITING_NEW_INDEPENDENT_TEST_SESSIONS`. The reviewed snapshot is useful progress but is not an approved GPU run.

Use the existing [phase-two commands](PHASE2.md) and `ml/vision/experiment.json`: SSDLite320 MobileNet V3 Large transfer learning, 320 pixels, five epochs, batch 4, seed 20261014 and ONNX opset 17. The experiment is a candidate alongside EfficientDet, not a production replacement. Official pretrained weights need their existing local license/SHA descriptor and separate human approval.

Provisional resource plan, **not measured on this dataset**: NVIDIA CUDA GPU with at least 8 GB VRAM (12–16 GB preferred), 16 GB host RAM, and 100 GB free private disk. Start with a CPU preflight only; after explicit resource/price approval measure one epoch and project the remaining time before extending the run. Record the provider's actual hourly quote, storage/transfer costs, maximum runtime and spending cap for owner approval. No paid resource is requested or started here.

After data and separate training approval exist:

```powershell
# Set these paths from the Studio export result and the independently approved files.
$datasets = Join-Path $env:USERPROFILE 'Documents\Basira-Vision-Datasets'
$manifest = '<absolute path to studio-frozen-UUID.json>'
$export = '<absolute path to exports\pilot-UUID>'
$pretrained = "$datasets\pretrained\approved-checkpoint.json"
$approval = "$datasets\runs\approval.approved.json"
$python = '<approved training venv python.exe>'
& $python scripts/vision-ai/train.py approval-template --manifest $manifest --data-root $datasets --export $export --pretrained $pretrained --output "$datasets\runs\approval.pending.json"
# Independent humans review the pending approval and price/resource plan.
& $python scripts/vision-ai/train.py train --manifest $manifest --data-root $datasets --export $export --pretrained $pretrained --approval $approval --output "$datasets\runs\pilot-001" --device cuda --preflight-only
# Run ONLY after separate explicit approval:
& $python scripts/vision-ai/train.py train --manifest $manifest --data-root $datasets --export $export --pretrained $pretrained --approval $approval --output "$datasets\runs\pilot-001" --device cuda
& $python scripts/vision-ai/train.py export --run "$datasets\runs\pilot-001" --output "$datasets\runs\pilot-001-onnx"
```

Use the same sealed test manifest for baseline and candidate through the existing benchmark/evaluate/compare commands. Validation supports tuning; final test does not. Compare per-class AP/recall and false alerts on hard negatives, plus matched-device latency/FPS and phone tracking performance. Test ONNX in the existing isolated comparison interface, verify SHA and rollback registration, and retain EfficientDet until independently demonstrated benefit and separate release approval. No metric distance or reliable collision-prevention claim follows from object boxes or synthetic scenes.

## Verification

```powershell
npm run test:vision-studio
npm run test:vision-ai
npm run test:vision-batch
npm run test:vision-label-save-browser
npm run test:vision-batch-browser
```

The Chrome tests use fictional images and separate test identities only. They cover repeated clicks, persistence after reopen/restart, actual 400/409 responses and retained drafts, independent combined review, unchanged originals/credentials, no unexpected Console/Network errors and no external requests. Backend tests additionally cover missing inspection/evidence, stale versions, failed combined approval without partial votes, similarity exclusions, idempotency, protected new-session final tests and existing frozen COCO export. Synthetic fixture approvals are test assertions, never real dataset approvals.
