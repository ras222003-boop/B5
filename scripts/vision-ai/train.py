"""Offline transfer learning. Requires reviewed real data and a locally approved checkpoint.

No automatic download, API, user capture, production writes or test-set optimization.
Imports of ML libraries are deferred until all data and provenance checks pass.
"""
import argparse
import hashlib
import json
import math
import os
import platform
import random
import importlib
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)


def inside(root, relative):
    path = (root / relative).resolve()
    if path == root or root not in path.parents:
        raise ValueError("file escapes data root")
    return path


def approval_binding(args, lock):
    binding = {"datasetSha256": lock["datasetSha256"], "exportLockSha256": digest(Path(args.export) / "dataset.lock.json"),
            "configSha256": digest(args.config), "pretrainedDescriptorSha256": digest(args.pretrained),
            "taxonomySha256": digest(REPO / "ml/vision/taxonomy.v1.json"),
            "proximityPolicySha256": digest(REPO / "ml/vision/proximity-policy.v1.json")}
    if read(args.config).get('task') == 'basira-stairs-v1':
        binding.update(stairsTaskPolicySha256=digest(REPO / 'ml/vision/stairs-task.v1.json'),
                       stairsProjectionSha256=digest(Path(__file__).with_name('stairs_task.py')))
    return binding


def validate_approval(approval, expected):
    if (approval.get("schemaVersion") != 1 or approval.get("status") != "approved" or
            approval.get("scope") != "offline_object_and_ground_hazard_detection" or
            not approval.get("reviewer") or not approval.get("dataReviewer") or
            approval["reviewer"] == approval["dataReviewer"] or approval.get("containsUserData") is not False or
            approval.get("contentKind") != "real" or approval.get("testSetSealed") is not True or
            approval.get("productionActivation") is not False or approval.get("binding") != expected):
        raise ValueError("explicit independent dataset/training approval bound to these exact inputs required")
    at = datetime.fromisoformat(approval.get("at", "").replace("Z", "+00:00"))
    if at.tzinfo is None or at > datetime.now(timezone.utc):
        raise ValueError("approval requires a non-future timezone-aware timestamp")


def gpu_environment(torch, torchvision):
    available = torch.cuda.is_available()
    pinned = torch.__version__.split('+')[0] == '2.7.1' and torchvision.__version__.split('+')[0] == '0.22.1'
    result = {"torch": torch.__version__, "torchvision": torchvision.__version__, "cudaRuntime": torch.version.cuda,
              "cudaAvailable": available, "pinnedVersions": pinned, "ready": available and pinned,
              "trainingPerformed": False, "python": platform.python_version()}
    if available:
        props = torch.cuda.get_device_properties(0)
        result.update({"gpu": props.name, "totalMemoryBytes": props.total_memory,
                       "computeCapability": list(torch.cuda.get_device_capability(0))})
    return result


def inspect_gpu(import_module=importlib.import_module):
    """Report an unusable environment without installing packages or starting training."""
    try:
        torch = import_module('torch')
        torchvision = import_module('torchvision')
        return gpu_environment(torch, torchvision)
    except (ImportError, OSError, RuntimeError) as error:
        # No arbitrary exception text/paths in shareable environment reports.
        return {"ready": False, "cudaAvailable": False, "pinnedVersions": False,
                "trainingPerformed": False, "python": platform.python_version(),
                "status": "DEPENDENCIES_UNAVAILABLE_OR_INCOMPATIBLE",
                "errorType": type(error).__name__,
                "missingModule": getattr(error, 'name', None)}


def validate_capture_motion_task(data, config):
    if (config.get('task') != 'basira-stairs-v1' and
            any(s.get('conditions', {}).get('motion') == 'unknown_stairs_still' for s in data['samples'])):
        raise ValueError('unknown capture motion is restricted to stairs still-image detection, not motion or distance evaluation')


def preflight(args, require_approval=True):
    root, exports = Path(args.data_root).resolve(), Path(args.export).resolve()
    lock = read(exports / "dataset.lock.json")
    for name in ("train.json", "validation.json", "test.json"):
        if digest(exports / name) != lock["files"][name]:
            raise ValueError("export changed since validation: " + name)
    # Revalidate original manifest, actual media, reviews and split leakage immediately before training.
    validation = json.loads(subprocess.check_output(
        ["node", str(REPO / "scripts/vision-ai/cli.mjs"), "validate", str(Path(args.manifest).resolve())], text=True, encoding="utf-8"))
    if Path(args.manifest).resolve().parent != root or validation["datasetSha256"] != lock["datasetSha256"]:
        raise ValueError("manifest/root/export mismatch")
    if validation["taxonomySha256"] != digest(REPO / "ml/vision/taxonomy.v1.json"):
        raise ValueError("taxonomy mismatch")
    config = read(args.config)
    data = read(args.manifest)
    validate_capture_motion_task(data, config)
    if (config["architecture"] != "ssdlite320_mobilenet_v3_large" or config["inputSize"] != 320 or
            config["automaticDownload"] is not False or config["userDataAllowed"] is not False or
            config["autoLearning"] is not False or config["productionActivation"] is not False):
        raise ValueError("unsupported experiment or data policy")
    if (not isinstance(config["seed"], int) or not isinstance(config["epochs"], int) or config["epochs"] < 1 or
            not isinstance(config["batchSize"], int) or config["batchSize"] < 2 or
            not math.isfinite(config["learningRate"]) or config["learningRate"] <= 0 or
            not 0 <= config["freezeBackboneEpochs"] <= config["epochs"] or
            (config["scoreThreshold"], config["maxDetections"], config["nmsIoU"], config["onnxOpset"]) != (.45, 12, .6, 17)):
        raise ValueError("invalid experiment parameters")
    checkpoint = read(args.pretrained)
    checkpoint_path = inside(Path(args.pretrained).resolve().parent, checkpoint["path"])
    if (checkpoint.get("architecture") != config["architecture"] or checkpoint.get("reviewStatus") != "approved" or
            not checkpoint.get("reviewer") or not checkpoint.get("license") or checkpoint.get("trainingAllowed") is not True or
            not checkpoint.get("sourceUrl", "").startswith("https://") or digest(checkpoint_path) != checkpoint.get("sha256")):
        raise ValueError("approved local pretrained checkpoint and SHA-256 required")
    rights = inside(Path(args.pretrained).resolve().parent, checkpoint["rightsEvidence"])
    if digest(rights) != checkpoint.get("rightsSha256"):
        raise ValueError("pretrained rights evidence mismatch")
    train, val = read(exports / "train.json"), read(exports / "validation.json")
    if config.get('task') is not None:
        if config['task'] != 'basira-stairs-v1':
            raise ValueError('unsupported experimental task')
        from stairs_task import project_stairs
        data = read(args.manifest)
        cohort_path = inside(root, '.studio/batch-review/final-test.json')
        if digest(cohort_path) != data.get('splitPolicy', {}).get('finalTestCohortSha256'):
            raise ValueError('registered frozen independent stairs test binding required')
        projected, _ = project_stairs(data, {'train': train, 'validation': val, 'test': read(exports / 'test.json')},
                                      read(REPO / 'ml/vision/stairs-task.v1.json'), read(cohort_path))
        train, val = projected['train'], projected['validation']
    if len(train["images"]) < 2 or not train["annotations"] or not val["annotations"]:
        raise ValueError("at least two training images and positive train/validation labels required")
    categories = train["categories"]
    if categories != val["categories"]:
        raise ValueError("category mismatch")
    if require_approval:
        if not getattr(args, 'approval', None):
            raise ValueError("--approval is required; no real training without dataset release approval")
        validate_approval(read(args.approval), approval_binding(args, lock))
    return root, lock, config, checkpoint, checkpoint_path, train, val


def build_model(torch, torchvision, count, config, pretrained=None):
    model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(
        weights=None, weights_backbone=None, num_classes=91 if pretrained else count,
        score_thresh=config["scoreThreshold"], nms_thresh=config["nmsIoU"], detections_per_img=config["maxDetections"])
    if pretrained:
        model.load_state_dict(torch.load(pretrained, map_location="cpu", weights_only=True), strict=True)
        replacement = torchvision.models.detection.ssdlite320_mobilenet_v3_large(
            weights=None, weights_backbone=None, num_classes=count)
        model.head.classification_head = replacement.head.classification_head
        del replacement
    return model


def train(args):
    root, lock, cfg, provenance, pretrained, training, validation = preflight(args)
    if args.preflight_only:
        print(json.dumps({"status": "PREFLIGHT_ONLY", "trainingPerformed": False, "datasetSha256": lock["datasetSha256"]}))
        return
    # Must be configured before CUDA context creation. Unsupported deterministic kernels fail closed.
    os.environ['CUBLAS_WORKSPACE_CONFIG'] = ':4096:8'
    import numpy as np
    import torch
    import torchvision
    from PIL import Image
    if torch.__version__.split("+")[0] != "2.7.1" or torchvision.__version__.split("+")[0] != "0.22.1":
        raise ValueError("use pinned requirements-training.txt environment")
    environment = gpu_environment(torch, torchvision)
    if args.device == 'cuda' and not environment['ready']:
        raise ValueError("requested GPU unavailable or incompatible; refusing silent CPU fallback")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    write(output / 'run-start.json', {"status": "RUNNING", "startedAt": datetime.now(timezone.utc).isoformat(),
          "environment": environment, "binding": approval_binding(args, lock), "approvalSha256": digest(args.approval)})
    if cfg.get('task'):
        write(output / 'task-projection.json', {"task": cfg['task'], "categories": training['categories'],
              "binding": approval_binding(args, lock), "originalExportUnchanged": True, "metricDistance": False})
    args.started_output = output
    random.seed(cfg["seed"])
    np.random.seed(cfg["seed"])
    torch.manual_seed(cfg["seed"])
    if args.device == 'cuda':
        torch.cuda.manual_seed_all(cfg['seed'])
        torch.cuda.reset_peak_memory_stats()
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(args.threads)
    categories = training["categories"]
    label_map = {c["id"]: i + 1 for i, c in enumerate(categories)}
    inverse = {v: k for k, v in label_map.items()}

    class Dataset(torch.utils.data.Dataset):
        def __init__(self, coco):
            self.coco = coco
            self.annotations = {}
            for a in coco["annotations"]:
                self.annotations.setdefault(a["image_id"], []).append(a)

        def __len__(self):
            return len(self.coco["images"])

        def __getitem__(self, index):
            item = self.coco["images"][index]
            with Image.open(inside(root, item["file_name"])) as image:
                tensor = torchvision.transforms.functional.to_tensor(image.convert("RGB"))
            annotations = self.annotations.get(item["id"], [])
            boxes = [[a["bbox"][0], a["bbox"][1], a["bbox"][0] + a["bbox"][2], a["bbox"][1] + a["bbox"][3]] for a in annotations]
            return tensor, {"boxes": torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4),
                            "labels": torch.tensor([label_map[a["category_id"]] for a in annotations], dtype=torch.int64)}

    model = build_model(torch, torchvision, len(categories) + 1, cfg, pretrained).to(args.device)
    optimizer = torch.optim.SGD(model.parameters(), lr=cfg["learningRate"], momentum=.9, weight_decay=.0005)
    loader = torch.utils.data.DataLoader(Dataset(training), batch_size=cfg["batchSize"], shuffle=True,
                                       num_workers=0, collate_fn=lambda batch: tuple(zip(*batch)),
                                       generator=torch.Generator().manual_seed(cfg["seed"]))
    val_data, history = Dataset(validation), []
    for epoch in range(cfg["epochs"]):
        epoch_started = time.perf_counter()
        model.train()
        for parameter in model.backbone.parameters():
            parameter.requires_grad_(epoch >= cfg["freezeBackboneEpochs"])
        # SSDLite contains 1x1 feature maps. Fixed BatchNorm stats avoid batch-size-one failure
        # and keep frozen pretrained statistics fixed during the pilot.
        for module in model.modules():
            if isinstance(module, torch.nn.BatchNorm2d):
                module.eval()
        losses = []
        for images, targets in loader:
            images = [i.to(args.device) for i in images]
            targets = [{k: v.to(args.device) for k, v in t.items()} for t in targets]
            optimizer.zero_grad(set_to_none=True)
            loss = sum(model(images, targets).values())
            if not torch.isfinite(loss):
                raise ValueError("nonfinite training loss")
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        model.eval()
        samples = []
        with torch.inference_mode():
            for i in range(len(val_data)):
                image, target = val_data[i]
                pred = model([image.to(args.device)])[0]
                width, height = image.shape[2], image.shape[1]
                samples.append({"id": validation["images"][i]["sample_id"], "imageSha256": validation["images"][i]["sha256"],
                                "predictions": [{"classId": inverse[int(label)], "score": float(score),
                                    "box": [float(box[0]) / width, float(box[1]) / height,
                                            float(box[2] - box[0]) / width, float(box[3] - box[1]) / height]}
                                   for box, label, score in zip(pred["boxes"].cpu(), pred["labels"].cpu(), pred["scores"].cpu())]})
        write(output / f"validation-epoch-{epoch + 1}.json", {"scope": "validation-predictions-not-browser-benchmark", "samples": samples})
        torch.save(model.state_dict(), output / f'checkpoint-epoch-{epoch + 1}.pt')
        history.append({"epoch": epoch + 1, "meanTrainingLoss": sum(losses) / len(losses), "validationFrames": len(samples),
                        "elapsedSeconds": time.perf_counter() - epoch_started,
                        "peakCudaMemoryBytes": torch.cuda.max_memory_allocated() if args.device == 'cuda' else None,
                        "checkpointSha256": digest(output / f'checkpoint-epoch-{epoch + 1}.pt')})
        write(output / f'epoch-{epoch + 1}.json', history[-1])
        print(json.dumps(history[-1]), flush=True)
    # Fixed epoch count; no test-set feedback or automatic deployment.
    torch.save(model.cpu().state_dict(), output / "weights.pt")
    write(output / "training-run.json", {"schemaVersion": 1, "scope": "experimental-transfer-learning", "config": cfg,
          "datasetSha256": lock["datasetSha256"], "taxonomySha256": lock["taxonomySha256"],
          "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
          "trainingScriptSha256": digest(Path(__file__)), "configSha256": digest(args.config),
          "requirementsSha256": digest(REPO / "ml/vision/requirements-training.txt"),
          "pretrainedSha256": provenance["sha256"], "weightsSha256": digest(output / "weights.pt"),
          "approvalSha256": digest(args.approval), "environment": environment,
          "categories": categories, "history": history, "device": args.device, "python": platform.python_version(),
          "taskPolicySha256": digest(REPO / 'ml/vision/stairs-task.v1.json') if cfg.get('task') else None,
          "torch": torch.__version__, "torchvision": torchvision.__version__, "testUsedForOptimization": False,
          "browserCompatible": None, "productionEligible": False})


def export_onnx(args):
    import torch
    import torchvision
    import onnx
    import onnxruntime as ort
    import numpy as np
    run_dir, output = Path(args.run).resolve(), Path(args.output).resolve()
    run = read(run_dir / "training-run.json")
    if digest(run_dir / "weights.pt") != run["weightsSha256"]:
        raise ValueError("checkpoint SHA-256 mismatch")
    if torch.__version__.split("+")[0] != "2.7.1" or torchvision.__version__.split("+")[0] != "0.22.1":
        raise ValueError("use pinned training environment")
    model = build_model(torch, torchvision, len(run["categories"]) + 1, run["config"])
    model.load_state_dict(torch.load(run_dir / "weights.pt", map_location="cpu", weights_only=True), strict=True)
    model.eval()

    class BrowserModel(torch.nn.Module):
        def __init__(self, detector):
            super().__init__()
            self.detector = detector

        def forward(self, image):
            result = self.detector([image[0]])[0]
            return result["boxes"] / 320.0, result["labels"], result["scores"]

    wrapper = BrowserModel(model).eval()
    output.mkdir(parents=True, exist_ok=False)
    torch.manual_seed(20261014)
    example = torch.rand(1, 3, 320, 320)
    torch.onnx.export(wrapper, example, str(output / "model.onnx"), input_names=["image"],
                      output_names=["boxes", "labels", "scores"], opset_version=17, dynamo=False,
                      dynamic_axes={"boxes": {0: "detections"}, "labels": {0: "detections"}, "scores": {0: "detections"}})
    onnx.checker.check_model(onnx.load(str(output / "model.onnx")))
    session = ort.InferenceSession(str(output / "model.onnx"), providers=["CPUExecutionProvider"])
    # Arithmetic/export smoke only. Real-image browser parity is a separate required gate.
    max_error = 0.0
    for image in [example, torch.zeros_like(example), torch.ones_like(example)]:
        with torch.inference_mode():
            expected = [v.numpy() for v in wrapper(image)]
        actual = session.run(None, {"image": image.numpy()})
        for a, b in zip(expected, actual):
            np.testing.assert_allclose(a, b, rtol=1e-3, atol=1e-4)
            if a.size:
                max_error = max(max_error, float(np.max(np.abs(a - b))))
    write(output / "browser-contract.json", {"schemaVersion": 1, "architecture": "ssdlite320_mobilenet_v3_large",
          "modelSha256": digest(output / "model.onnx"), "input": {"name": "image", "shape": [1, 3, 320, 320],
          "dtype": "float32", "range": [0, 1], "color": "RGB", "resize": "stretch", "normalization": "inside graph"},
          "output": {"boxes": "normalized xyxy", "labels": "1-based contiguous categories", "scores": "float32"},
          "categories": run["categories"], "taxonomySha256": run["taxonomySha256"], "trainingRunSha256": digest(run_dir / "training-run.json"),
          "task": run['config'].get('task'),
          "taskPolicySha256": run.get('taskPolicySha256'),
          "scoreThreshold": .45, "maxDetections": 12, "nmsIoU": .6,
          "exportParity": {"scope": "three synthetic tensors on CPU", "maxAbsoluteError": max_error}, "webVerified": False})
    print(json.dumps({"status": "EXPORTED_REQUIRES_BROWSER_AND_PHONE_VALIDATION", "modelSha256": digest(output / "model.onnx")}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    training = sub.add_parser("train")
    for key in ("manifest", "data-root", "export", "pretrained", "output"):
        training.add_argument("--" + key, required=True)
    training.add_argument("--config", default=str(REPO / "ml/vision/experiment.json"))
    training.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    training.add_argument("--threads", type=int, default=2)
    training.add_argument("--preflight-only", action="store_true")
    training.add_argument("--approval", required=True)
    approval = sub.add_parser('approval-template')
    for key in ('manifest', 'data-root', 'export', 'pretrained', 'output'):
        approval.add_argument('--' + key, required=True)
    approval.add_argument('--config', default=str(REPO / 'ml/vision/experiment.json'))
    gpu = sub.add_parser('gpu-check')
    gpu.add_argument('--output', required=True)
    exporting = sub.add_parser("export")
    exporting.add_argument("--run", required=True)
    exporting.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "train":
        if args.threads < 1:
            parser.error("threads must be positive")
        try:
            train(args)
        except BaseException as error:
            if getattr(args, 'started_output', None):
                write(args.started_output / 'run-failure.json', {"status": "FAILED", "errorType": type(error).__name__,
                      "completedAt": datetime.now(timezone.utc).isoformat(), "productionEligible": False})
            raise
    elif args.command == 'approval-template':
        _, lock, *_ = preflight(args, require_approval=False)
        write(args.output, {"schemaVersion": 1, "status": "pending", "scope": "offline_object_and_ground_hazard_detection",
              "reviewer": "", "dataReviewer": "", "at": "", "contentKind": "real", "containsUserData": False,
              "testSetSealed": False, "productionActivation": False, "binding": approval_binding(args, lock)})
        print('PENDING_HUMAN_DATASET_AND_TRAINING_REVIEW; trainingPerformed=false')
    elif args.command == 'gpu-check':
        report = inspect_gpu()
        write(args.output, report)
        print(json.dumps(report))
        if not report['ready']:
            raise SystemExit(2)
    else:
        export_onnx(args)


if __name__ == "__main__":
    main()
