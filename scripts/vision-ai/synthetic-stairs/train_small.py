"""CPU-only, random-initialized single-stair research detector.

The input is a generated manifest, never the real Basira dataset. This model
predicts one fixed stair instance per image. Its synthetic test results cannot
establish real-camera accuracy or safe navigation.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes
import hashlib
import json
import math
import os
import random
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


CLASS_IDS = (2301, 2302, 2303)
CLASS_NAMES = {2301: "stairs_up", 2302: "stairs_down", 2303: "stairs_present_uncertain_direction"}
IMAGE_SIZE = 128
THRESHOLD = 0.5  # Fixed before the independent synthetic test is inspected.


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resident_memory_bytes() -> tuple[int, int] | None:
    """Current and peak process working set; fail closed on Windows API failure."""
    if sys.platform != "win32":
        return None
    size_t = ctypes.c_size_t
    dword = ctypes.wintypes.DWORD

    class ProcessMemoryCountersEx(ctypes.Structure):
        _fields_ = [("cb", dword), ("PageFaultCount", dword),
                    ("PeakWorkingSetSize", size_t), ("WorkingSetSize", size_t),
                    ("QuotaPeakPagedPoolUsage", size_t), ("QuotaPagedPoolUsage", size_t),
                    ("QuotaPeakNonPagedPoolUsage", size_t), ("QuotaNonPagedPoolUsage", size_t),
                    ("PagefileUsage", size_t), ("PeakPagefileUsage", size_t),
                    ("PrivateUsage", size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.GetCurrentProcess.restype = ctypes.wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.wintypes.HANDLE, ctypes.c_void_p, dword]
    psapi.GetProcessMemoryInfo.restype = ctypes.wintypes.BOOL
    counters = ProcessMemoryCountersEx()
    counters.cb = ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise OSError(ctypes.get_last_error(), "Cannot enforce Windows memory budget")
    return counters.WorkingSetSize, counters.PeakWorkingSetSize


def save_json(path: Path, value: dict | list) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temp, path)


def verify_resume_config(saved: dict, requested: dict) -> None:
    """An invocation gets a fresh wall clock budget; the experiment stays fixed."""
    if not isinstance(saved, dict) or not isinstance(requested, dict):
        raise ValueError("Resume config changed")
    fixed = lambda value: {key: item for key, item in value.items() if key != "maxMinutes"}
    if fixed(saved) != fixed(requested):
        raise ValueError("Resume config changed")


def record_invocation_budget(output: Path, args: argparse.Namespace) -> tuple[dict, list[dict]]:
    path = output / "budget-history.json"
    if path.exists():
        history = json.loads(path.read_text(encoding="utf-8"))
        if history.get("schemaVersion") != 1 or not isinstance(history.get("invocations"), list):
            raise ValueError("Invalid research budget history")
    else:
        history = {"schemaVersion": 1, "invocations": []}
    budget = {"invocation": len(history["invocations"]) + 1,
              "authorizedMinutes": args.minutes, "authorizedThreads": args.threads,
              "authorizedMemoryMB": args.memory_mb, "authorizedStorageMB": args.max_storage_mb,
              "startedUtc": datetime.now(timezone.utc).isoformat()}
    history["invocations"].append(budget)
    save_json(path, history)
    return budget, history["invocations"]


def resolve_image(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or "\\" in name or ":" in name or name.startswith("/"):
        raise ValueError("Generated image path must be relative to the private experiment")
    path = root.joinpath(*name.split("/"))
    if any(part in (".", "..", "") for part in name.split("/")) or root not in path.resolve().parents:
        raise ValueError("Generated image escapes private experiment")
    if not path.is_file() or path.is_symlink():
        raise ValueError("Generated image missing or linked: " + name)
    return path


def normalize_objects(sample: dict) -> list[dict]:
    objects = sample.get("objects", [])
    if not isinstance(objects, list) or len(objects) > 4:
        raise ValueError("Invalid generated object list")
    output = []
    for obj in objects:
        label = obj.get("classId", obj.get("category_id"))
        box = obj.get("box", obj.get("bbox"))
        if label not in CLASS_IDS or not isinstance(box, list) or len(box) != 4:
            raise ValueError("Invalid generated stair label")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in box):
            raise ValueError("Nonfinite generated box")
        x, y, width, height = box
        if min(x, y) < 0 or min(width, height) <= 0 or x + width > 1.00001 or y + height > 1.00001:
            raise ValueError("Generated box outside image")
        output.append({"classId": label, "box": [float(v) for v in box]})
    return output


def validate_manifest(manifest_path: Path, max_images: int) -> tuple[Path, dict, dict[str, list[dict]], str]:
    root = manifest_path.resolve().parent
    manifest_hash = sha256(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("excludedFromTraining") or manifest.get("contentKind") == "real_independent_test":
        raise ValueError("Independent real evaluation data is excluded from training")
    samples = manifest.get("samples")
    if not isinstance(samples, list) or not 3 <= len(samples) <= max_images:
        raise ValueError("Expected a bounded generated sample list")
    splits = {name: [] for name in ("train", "validation", "test")}
    groups: dict[str, str] = {}
    scenes: dict[str, str] = {}
    seeds: dict[str, str] = {}
    seen_paths: set[str] = set()
    hashes: dict[str, str] = {}
    for sample in samples:
        split = sample.get("split")
        if split not in splits:
            raise ValueError("Every synthetic sample needs a frozen train/validation/test split")
        name = sample.get("path")
        path = resolve_image(root, name)
        if name in seen_paths:
            raise ValueError("Repeated image path across splits")
        seen_paths.add(name)
        digest = sha256(path)
        if sample.get("sha256") and sample["sha256"].lower() != digest:
            raise ValueError("Generated image SHA-256 mismatch")
        if digest in hashes and hashes[digest] != split:
            raise ValueError("Byte-identical image crosses synthetic splits")
        hashes[digest] = split
        group = str(sample.get("group") or "")
        scene = str(sample.get("scene_id") or "")
        if not group or not scene:
            raise ValueError("Scene and motion leakage groups are required")
        for index, key, table in (("group", group, groups), ("scene", scene, scenes)):
            if key in table and table[key] != split:
                raise ValueError(f"Synthetic {index} leaks across splits: {key}")
            table[key] = split
        if sample.get("seed") is not None:
            seed = str(sample["seed"])
            if seed in seeds and seeds[seed] != split:
                raise ValueError("Generation seed leaks across splits")
            seeds[seed] = split
        normalized = dict(sample)
        normalized["objects"] = normalize_objects(sample)
        normalized["absolute_path"] = path
        normalized["verified_sha256"] = digest
        splits[split].append(normalized)
    if not all(splits.values()) or not any(s["objects"] for s in splits["train"]):
        raise ValueError("Train, validation and test need data; train needs stairs")
    if len(groups) < 3:
        raise ValueError("Three independent synthetic scene/motion groups required")
    return root, manifest, splits, manifest_hash


def iou_xywh(first: list[float], second: list[float]) -> float:
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0.0


def evaluate(rows: list[dict], predictions: list[dict]) -> dict:
    assert len(rows) == len(predictions)
    positive = negative = presence_tp = presence_fp = presence_fn = presence_tn = 0
    matched_class_iou50 = 0
    class_correct = 0
    ious = []
    confusion = Counter()
    multi_objects = 0
    for row, pred in zip(rows, predictions):
        objects = row["objects"]
        if len(objects) > 1:
            multi_objects += 1
        truth = max(objects, key=lambda o: o["box"][2] * o["box"][3]) if objects else None
        detected = pred["detection"] is not None
        if truth:
            positive += 1
            if detected:
                presence_tp += 1
                det = pred["detection"]
                overlap = iou_xywh(truth["box"], det["box"])
                ious.append(overlap)
                correct = det["classId"] == truth["classId"]
                class_correct += int(correct)
                matched_class_iou50 += int(correct and overlap >= 0.5)
                confusion[(CLASS_NAMES[truth["classId"]], CLASS_NAMES[det["classId"]])] += 1
            else:
                presence_fn += 1
                confusion[(CLASS_NAMES[truth["classId"]], "missed")] += 1
        else:
            negative += 1
            if detected:
                presence_fp += 1
                confusion[("background", CLASS_NAMES[pred["detection"]["classId"]])] += 1
            else:
                presence_tn += 1
    precision = presence_tp / (presence_tp + presence_fp) if presence_tp + presence_fp else None
    recall = presence_tp / (presence_tp + presence_fn) if presence_tp + presence_fn else None
    return {
        "images": len(rows), "positiveImages": positive, "negativeImages": negative,
        "presence": {"tp": presence_tp, "fp": presence_fp, "fn": presence_fn, "tn": presence_tn,
                     "precision": precision, "recall": recall},
        "correctClassAndIoU50": matched_class_iou50,
        "directionAccuracyOnDetectedPositives": class_correct / presence_tp if presence_tp else None,
        "meanIoUOnDetectedPositives": sum(ious) / len(ious) if ious else None,
        "multiObjectImagesEvaluatedAgainstLargestOnly": multi_objects,
        "confusion": [{"truth": truth, "prediction": predicted, "count": count}
                      for (truth, predicted), count in sorted(confusion.items())],
        "scope": "scene_disjoint_synthetic_only_no_real_camera_or_navigation_safety_claim",
    }


def run(args: argparse.Namespace) -> dict:
    import numpy as np
    import torch
    from PIL import Image
    from torch import nn
    from torch.nn import functional as F

    if (not 1 <= args.threads <= 4 or not 1 <= args.epochs <= 8 or
            not 1 <= args.minutes <= 30 or not 1 <= args.max_images <= 512 or
            not 1 <= args.max_storage_mb <= 2048 or not 256 <= args.memory_mb <= 4096):
        raise ValueError("CPU budget exceeds research bounds")
    if args.device != "cpu":
        raise ValueError("This research trainer is CPU-only")
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    random.seed(args.seed)
    deadline = time.monotonic() + 60 * args.minutes
    peak_rss = 0
    def memory_check():
        nonlocal peak_rss
        measured = resident_memory_bytes()
        if measured is None:
            return
        peak_rss = max(peak_rss, measured[1])
        if measured[0] > args.memory_mb * 1024 * 1024:
            raise MemoryError("Research CPU process exceeded authorized RAM budget")
    root, manifest, splits, manifest_hash = validate_manifest(args.manifest, args.max_images)
    output = args.output.resolve()
    if root == output or root not in output.parents:
        raise ValueError("Research output must stay inside its generated experiment root")
    if output.exists():
        if not args.resume:
            raise ValueError("Research output already exists; use --resume")
    else:
        if args.resume:
            raise ValueError("No saved run to resume")
        output.mkdir(parents=True, exist_ok=False)
    if output.is_symlink():
        raise ValueError("Linked research output forbidden")
    completed_report = output / "report.json"
    def storage_check():
        total = sum(file.stat().st_size for file in output.rglob("*") if file.is_file())
        if total > args.max_storage_mb * 1024 * 1024:
            raise ValueError("Research output storage budget reached")
    config = {"schemaVersion": 1, "architecture": "tiny_cnn_single_stair_detection_v1",
              "imageSize": IMAGE_SIZE, "classes": CLASS_NAMES, "epochs": args.epochs,
              "threads": args.threads, "seed": args.seed, "maxMinutes": args.minutes,
              "maxStorageMB": args.max_storage_mb,
              "maxMemoryMB": args.memory_mb,
              "fixedPresenceThreshold": THRESHOLD, "sourceWeights": "random_initialization",
              "device": "cpu", "productionEligible": False}
    config_path = output / "config.json"
    if config_path.exists():
        verify_resume_config(json.loads(config_path.read_text(encoding="utf-8")), config)
    else:
        if args.resume:
            raise ValueError("No saved run config to resume")
        save_json(config_path, config)
    if args.resume and completed_report.is_file():
        prior = json.loads(completed_report.read_text(encoding="utf-8"))
        if prior.get("manifestSha256") != manifest_hash or prior.get("status") != "completed":
            raise ValueError("Completed run binding changed")
        return prior

    class TinyDetector(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(3, 16, 3, 2, 1), nn.ReLU(),
                nn.Conv2d(16, 32, 3, 2, 1), nn.ReLU(),
                nn.Conv2d(32, 48, 3, 2, 1), nn.ReLU(),
                nn.Conv2d(48, 64, 3, 2, 1), nn.ReLU(),
                nn.AdaptiveAvgPool2d((4, 4)), nn.Flatten(),
                nn.Linear(64 * 4 * 4, 96), nn.ReLU(),
            )
            self.classifier = nn.Linear(96, 4)  # 0 background; 1..3 stairs directions
            self.box_head = nn.Linear(96, 4)

        def forward(self, images):
            feature = self.features(images)
            logits = self.classifier(feature)
            box_raw = torch.sigmoid(self.box_head(feature))
            # Keep all output boxes inside the normalized image.
            x, y, width, height = box_raw.unbind(dim=1)
            box = torch.stack((x, y, width * (1 - x), height * (1 - y)), dim=1)
            return logits, box

    def sample_tensor(row):
        with Image.open(row["absolute_path"]) as image:
            if image.width * image.height > 2_000_000:
                raise ValueError("Generated input exceeds two megapixels")
            image = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
            pixels = np.asarray(image, dtype=np.float32).transpose(2, 0, 1) / 255.0
        truth = max(row["objects"], key=lambda o: o["box"][2] * o["box"][3]) if row["objects"] else None
        return (torch.from_numpy(pixels),
                0 if truth is None else CLASS_IDS.index(truth["classId"]) + 1,
                [0.0] * 4 if truth is None else truth["box"])

    tensors = {name: [sample_tensor(row) for row in rows] for name, rows in splits.items()}
    memory_check()
    model = TinyDetector()
    memory_check()
    initial = {key: value.detach().clone() for key, value in model.state_dict().items()}
    optimizer = torch.optim.Adam(model.parameters(), lr=0.002)
    checkpoint_path = output / "checkpoint-last.pt"
    start_epoch = 0
    steps = 0
    history = []
    if args.resume:
        if not checkpoint_path.is_file():
            raise ValueError("No completed epoch checkpoint to resume; retain partial output and choose a new run directory")
        state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        if state.get("manifestSha256") != manifest_hash or state.get("seed") != args.seed:
            raise ValueError("Resume manifest or seed changed")
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        start_epoch, steps, history = state["epoch"], state["steps"], state["history"]
        initial = state["initial"]
    invocation_budget, budget_history = record_invocation_budget(output, args)
    save_json(output / "run-state.json", {"status": "training", "manifestSha256": manifest_hash,
                                          "completedEpochs": start_epoch, "optimizerSteps": steps,
                                          "currentInvocationBudget": invocation_budget})
    for epoch in range(start_epoch, args.epochs):
        if time.monotonic() >= deadline:
            raise TimeoutError("Authorized CPU duration expired before next epoch")
        model.train()
        losses = []
        order = torch.Generator().manual_seed(args.seed + epoch)
        indices = torch.randperm(len(tensors["train"]), generator=order).tolist()
        for offset in range(0, len(indices), 4):
            if time.monotonic() >= deadline:
                raise TimeoutError("Authorized CPU duration expired during training; last epoch checkpoint retained")
            memory_check()
            batch = [tensors["train"][index] for index in indices[offset:offset + 4]]
            images = torch.stack([entry[0] for entry in batch])
            labels = torch.tensor([entry[1] for entry in batch], dtype=torch.long)
            boxes = torch.tensor([entry[2] for entry in batch], dtype=torch.float32)
            optimizer.zero_grad(set_to_none=True)
            logits, predicted_boxes = model(images)
            classification = F.cross_entropy(logits, labels)
            positive = labels > 0
            regression = F.smooth_l1_loss(predicted_boxes[positive], boxes[positive]) if positive.any() else logits.sum() * 0
            loss = classification + 3.0 * regression
            if not torch.isfinite(loss):
                raise ValueError("Nonfinite training loss")
            loss.backward()
            if not all(parameter.grad is None or torch.isfinite(parameter.grad).all() for parameter in model.parameters()):
                raise ValueError("Nonfinite gradients")
            optimizer.step()
            memory_check()
            steps += 1
            losses.append(float(loss.detach()))
        row = {"epoch": epoch + 1, "meanTrainingLoss": sum(losses) / len(losses),
               "optimizerStepsCumulative": steps}
        history.append(row)
        state = {"model": model.state_dict(), "optimizer": optimizer.state_dict(), "initial": initial,
                 "epoch": epoch + 1, "steps": steps, "history": history,
                 "manifestSha256": manifest_hash, "seed": args.seed,
                 "currentInvocationBudget": invocation_budget}
        temporary = checkpoint_path.with_suffix(".tmp")
        torch.save(state, temporary)
        os.replace(temporary, checkpoint_path)
        save_json(output / f"epoch-{epoch + 1}.json", row)
        save_json(output / "run-state.json", {"status": "training", "manifestSha256": manifest_hash,
                                              "completedEpochs": epoch + 1, "optimizerSteps": steps,
                                              "currentInvocationBudget": invocation_budget})
        storage_check()
        memory_check()
        print(json.dumps(row), flush=True)
    weight_delta = max(float((current - initial[key]).abs().max())
                       for key, current in model.state_dict().items())
    if steps < 1 or weight_delta <= 0:
        raise ValueError("No verified optimizer update")
    model.eval()
    weights_path = output / "weights.pt"
    temporary = weights_path.with_suffix(".tmp")
    torch.save(model.state_dict(), temporary)
    os.replace(temporary, weights_path)
    reloaded = TinyDetector().eval()
    reloaded.load_state_dict(torch.load(weights_path, map_location="cpu", weights_only=True))

    def infer(tensor_rows, rows):
        predictions = []
        with torch.inference_mode():
            for row, (pixels, _, _) in zip(rows, tensor_rows):
                if time.monotonic() >= deadline:
                    raise TimeoutError("Authorized CPU duration expired before synthetic evaluation")
                memory_check()
                logits, box = reloaded(pixels.unsqueeze(0))
                scores = torch.softmax(logits[0], dim=0)
                confidence = float(1 - scores[0])
                index = int(torch.argmax(scores[1:])) + 1
                detection = None
                if confidence >= THRESHOLD:
                    detection = {"classId": CLASS_IDS[index - 1], "score": confidence,
                                 "box": [float(v) for v in box[0]]}
                predictions.append({"id": row.get("id"), "scene_id": row["scene_id"],
                                    "imageSha256": row["verified_sha256"], "detection": detection})
        return predictions

    validation_predictions = infer(tensors["validation"], splits["validation"])
    validation = evaluate(splits["validation"], validation_predictions)
    # The frozen synthetic test is evaluated once, after all weights/parameters are fixed.
    test_predictions = infer(tensors["test"], splits["test"])
    test = evaluate(splits["test"], test_predictions)
    save_json(output / "predictions-validation.json", {"predictions": validation_predictions})
    save_json(output / "predictions-test.json", {"predictions": test_predictions})

    if time.monotonic() >= deadline:
        raise TimeoutError("Authorized CPU duration expired before ONNX export; checkpoint retained")
    memory_check()
    import onnx
    import onnxruntime as ort

    onnx_path = output / "model.onnx"
    example = torch.zeros((1, 3, IMAGE_SIZE, IMAGE_SIZE), dtype=torch.float32)
    torch.onnx.export(reloaded, example, str(onnx_path), input_names=["image"],
                      output_names=["class_logits", "box_xywh"], opset_version=17,
                      dynamic_axes={"image": {0: "batch"}, "class_logits": {0: "batch"},
                                    "box_xywh": {0: "batch"}}, dynamo=False)
    onnx.checker.check_model(onnx.load(str(onnx_path)))
    memory_check()
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(onnx_path), sess_options=options, providers=["CPUExecutionProvider"])
    memory_check()
    parity_inputs = [example, tensors["test"][0][0].unsqueeze(0)]
    parity_max_error = 0.0
    with torch.inference_mode():
        for image in parity_inputs:
            expected = reloaded(image)
            actual = session.run(None, {"image": image.numpy()})
            for original, exported in zip(expected, actual):
                error = float(np.max(np.abs(original.numpy() - exported)))
                parity_max_error = max(parity_max_error, error)
                if error > 1e-4:
                    raise ValueError(f"ONNX/PyTorch output mismatch: {error}")
            memory_check()
    report = {
        "schemaVersion": 1, "status": "completed", "scope": "synthetic_research_only",
        "manifestSha256": manifest_hash, "trainingPerformed": True,
        "backwardPerformed": True, "optimizerSteps": steps, "weightChanged": True,
        "maxWeightChangeFromInitialization": weight_delta,
        "completedEpochs": len(history), "history": history,
        "checkpoint": str(checkpoint_path), "checkpointSha256": sha256(checkpoint_path),
        "weights": str(weights_path), "weightsSha256": sha256(weights_path),
        "checkpointReloadVerified": True,
        "onnx": str(onnx_path), "onnxSha256": sha256(onnx_path),
        "onnxCheckerPassed": True, "onnxRuntimeInferencePassed": True,
        "onnxParityMaxAbsoluteError": parity_max_error,
        "peakResidentMemoryMB": round(peak_rss / (1024 * 1024), 2) if peak_rss else None,
        "maxAuthorizedMemoryMB": args.memory_mb,
        "invocationBudgets": budget_history,
        "splitCounts": {name: len(rows) for name, rows in splits.items()},
        "splitGroupCounts": {name: len({row["group"] for row in rows}) for name, rows in splits.items()},
        "validation": validation, "syntheticIndependentTest": test,
        "realCameraEvaluation": "not_performed", "blindNavigationSafety": "not_established",
        "productionEligible": False, "pretrainedWeightsUsed": False,
        "limitations": ["Single stair instance per image; any additional objects are ignored by the detector.",
                        "Tiny synthetic cohort; performance does not transfer to real cameras by assumption.",
                        "No independent blind mobility test or production approval."],
    }
    save_json(output / "report.json", report)
    save_json(output / "run-state.json", {"status": "completed", "manifestSha256": manifest_hash,
                                          "completedEpochs": len(history), "optimizerSteps": steps,
                                          "currentInvocationBudget": invocation_budget,
                                          "report": "report.json"})
    storage_check()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=["cpu"], default="cpu")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--minutes", type=int, default=25)
    parser.add_argument("--max-images", type=int, default=256)
    parser.add_argument("--max-storage-mb", type=int, default=512)
    parser.add_argument("--memory-mb", type=int, default=4096)
    parser.add_argument("--seed", type=int, default=20261024)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    try:
        report = run(args)
        print(json.dumps({"status": report["status"], "trainingPerformed": report["trainingPerformed"],
                          "optimizerSteps": report["optimizerSteps"], "weights": report["weights"],
                          "onnx": report["onnx"]}), flush=True)
    except KeyboardInterrupt:
        output = args.output.resolve()
        if output.is_dir():
            save_json(output / "failure.json", {"status": "interrupted", "reason": "Stopped by local operator",
                                                "partialArtifactsRetained": True})
        raise SystemExit(130)
    except Exception as error:
        output = args.output.resolve()
        if output.is_dir():
            save_json(output / "failure.json", {"status": "failed", "reason": str(error),
                                                "partialArtifactsRetained": True})
        raise


if __name__ == "__main__":
    main()
