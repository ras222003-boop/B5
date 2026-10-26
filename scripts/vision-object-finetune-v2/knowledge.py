"""معرفة بصيرة: measured vocabulary/training/evaluation, never a safety approval.

Pure API: evaluate_rows(rows, predictions, names, threshold=.5, compute_ap=True).
Rows must explicitly declare completeLabels=True or annotatedClasses. Unknown
source classes are ignored, not background. Predictions are never references.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import argparse
import contextlib
import hashlib
import io
import json
import math
import re
import tempfile
from datetime import datetime, timezone


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _box(value):
    if isinstance(value, dict):
        value = [value[k] for k in ("x", "y", "width", "height")]
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError("A normalized xywh box is required")
    x, y, w, h = map(float, value)
    if (not all(math.isfinite(v) for v in (x, y, w, h)) or w <= 0 or h <= 0
            or x < -1e-7 or y < -1e-7 or x + w > 1 + 1e-7 or y + h > 1 + 1e-7):
        raise ValueError("Invalid or out-of-image reference/prediction box")
    return [x, y, w, h]


def _iou(a, b, crowd=False):
    intersection = max(0., min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])) * max(
        0., min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    denominator = b[2] * b[3] if crowd else a[2] * a[3] + b[2] * b[3] - intersection
    return intersection / denominator if denominator > 0 else 0.


def _scope(row, names):
    if row.get("completeLabels") is True:
        return set(names)
    scope = row.get("annotatedClasses")
    if not isinstance(scope, list) or not all(isinstance(c, str) for c in scope):
        raise ValueError(f"Explicit annotation scope missing for image {row.get('id')}")
    if set(scope) - set(names):
        raise ValueError("Annotation scope contains unsupported canonical classes")
    return set(scope)


def _rate(tp, fp, fn, references):
    # With no positive references, FP is useful but positive-class accuracy is unknown.
    if not references:
        return dict(precision=None, recall=None, f1=None)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / references
    f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
    return dict(precision=precision, recall=recall, f1=f1)


def _prepare(rows, predictions, names, max_dets):
    if len(set(names)) != len(names) or not names:
        raise ValueError("Unique canonical model vocabulary required")
    ids = [str(r["id"]) for r in rows]
    if len(set(ids)) != len(ids) or set(ids) != {str(k) for k in predictions}:
        raise ValueError("Missing, duplicate or extra prediction image IDs")
    predictions = {str(k): v for k, v in predictions.items()}
    prepared = []
    for row in rows:
        width, height = int(row["width"]), int(row["height"])
        if width <= 0 or height <= 0 or not isinstance(row.get("objects"), list):
            raise ValueError("Positive dimensions and independently annotated objects list required; null is unlabelled")
        scope = _scope(row, names)
        refs = []
        for index, obj in enumerate(row["objects"]):
            name = obj["class"]
            if name not in scope:
                raise ValueError("Reference class outside declared independent annotation scope")
            b = _box(obj["box"])
            area = float(obj.get("area", b[2] * b[3] * width * height))
            if not math.isfinite(area) or area <= 0:
                raise ValueError("Invalid reference area")
            refs.append(dict(id=str(obj.get("id", index)), label=name, box=b, area=area,
                             crowd=bool(obj.get("iscrowd") or obj.get("ignoreForEvaluation"))))
        record = predictions[str(row["id"])]
        items = record.get("detections") if isinstance(record, dict) else record
        if not isinstance(items, list):
            raise ValueError("Prediction detections must be a list")
        candidates = []
        for p in items:
            name = p.get("cocoClass", p.get("class"))
            score = float(p["confidence"])
            if not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError("Invalid uncalibrated model score")
            candidates.append(dict(label=name, score=score, box=_box(p.get("boundingBox", p.get("box")))))
        candidates.sort(key=lambda p: -p["score"])
        prepared.append(dict(row=row, scope=scope, refs=refs, predictions=candidates[:max_dets]))
    return prepared


def _ap(prepared, names, max_dets):
    import numpy as np
    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval
    # COCO accumulates quantized score ties using stable mergesort across sorted
    # image IDs. Preserve published/frozen IDs rather than acquisition ordering.
    # Mixed corpora should assign every row a frozen numeric cocoId/evaluationImageId.
    for field in ("evaluationImageId", "cocoId"):
        values = [item["row"].get(field) for item in prepared]
        if all(isinstance(value, int) and not isinstance(value, bool) for value in values):
            if len(set(values)) != len(values):
                raise ValueError("AP evaluation image IDs must be unique")
            prepared = sorted(prepared, key=lambda item: item["row"][field])
            break
    categories = {name: i + 1 for i, name in enumerate(names)}
    dataset = dict(info={"description": "Basira scoped independent references"},
                   images=[], annotations=[], categories=[dict(id=i, name=n) for n, i in categories.items()])
    results = []
    for image_id, item in enumerate(prepared, 1):
        row = item["row"]; w, h = row["width"], row["height"]
        dataset["images"].append(dict(id=image_id, width=w, height=h))
        for ref in item["refs"]:
            x, y, bw, bh = ref["box"]
            dataset["annotations"].append(dict(id=len(dataset["annotations"]) + 1,
                image_id=image_id, category_id=categories[ref["label"]],
                bbox=[x*w, y*h, bw*w, bh*h], area=ref["area"], iscrowd=int(ref["crowd"])))
        for p in item["predictions"]:
            if p["label"] not in item["scope"]:
                continue
            x, y, bw, bh = p["box"]
            results.append(dict(image_id=image_id, category_id=categories[p["label"]],
                                bbox=[x*w, y*h, bw*w, bh*h], score=p["score"]))
    with contextlib.redirect_stdout(io.StringIO()):
        gt = COCO(); gt.dataset = dataset; gt.createIndex()
        if results:
            dt = gt.loadRes(results)
        else:
            dt = COCO(); dt.dataset = {**dataset, "annotations": []}; dt.createIndex()
        ev = COCOeval(gt, dt, "bbox")
        ev.params.imgIds = list(range(1, len(prepared) + 1))
        ev.params.catIds = list(categories.values())
        ev.params.maxDets = [1, 10, max_dets]
        ev.evaluate(); ev.accumulate()
    precision = ev.eval["precision"]
    result = {}
    for k, name in enumerate(names):
        values = precision[:, :, k, 0, -1]
        present = values[values > -1]
        result[name] = float(np.mean(present)) if present.size else None
    measured = [v for v in result.values() if v is not None]
    return (sum(measured)/len(measured) if measured else None), result


def _evaluate_prepared(prepared, names, threshold, iou_threshold, max_dets, compute_ap):
    by_class = {name: dict(referenceCount=0, tp=0, fp=0, fn=0, ignoredCrowdDetections=0,
        knownScopeImages=0, positiveReferenceImages=0, missedExamples=[], falsePositiveExamples=[]) for name in names}
    outside = outside_operating = 0
    for item in prepared:
        row = item["row"]; scope = item["scope"]
        for name in scope:
            by_class[name]["knownScopeImages"] += 1
        refs = [r for r in item["refs"] if not r["crowd"]]
        crowd = [r for r in item["refs"] if r["crowd"]]
        for name in {r["label"] for r in refs}:
            by_class[name]["positiveReferenceImages"] += 1
        for ref in refs:
            by_class[ref["label"]]["referenceCount"] += 1
        outside += sum(p["label"] not in scope for p in item["predictions"])
        outside_operating += sum(p["label"] not in scope and p["score"] >= threshold for p in item["predictions"])
        chosen = [p for p in item["predictions"] if p["label"] in scope and p["score"] >= threshold]
        used = set()
        for p in chosen:
            options = [(_iou(ref["box"], p["box"]), i) for i, ref in enumerate(refs)
                       if i not in used and ref["label"] == p["label"]]
            overlap, index = max(options, default=(0., -1))
            metric = by_class[p["label"]]
            if overlap >= iou_threshold:
                metric["tp"] += 1; used.add(index)
            elif any(r["label"] == p["label"] and _iou(r["box"], p["box"], True) >= iou_threshold for r in crowd):
                metric["ignoredCrowdDetections"] += 1
            else:
                metric["fp"] += 1
                if len(metric["falsePositiveExamples"]) < 8:
                    metric["falsePositiveExamples"].append(dict(imageId=str(row["id"]), groupId=row.get("groupId", row.get("sceneId")),
                        box=p["box"], score=p["score"]))
        for index, ref in enumerate(refs):
            if index not in used:
                metric = by_class[ref["label"]]; metric["fn"] += 1
                if len(metric["missedExamples"]) < 8:
                    same = [p for p in item["predictions"] if p["label"] == ref["label"]]
                    matching = [p for p in same if _iou(ref["box"], p["box"]) >= iou_threshold]
                    reason = ("below_threshold" if matching and max(p["score"] for p in matching) < threshold
                              else "localization" if any(_iou(ref["box"], p["box"]) >= .1 for p in same)
                              else "no_matching_proposal")
                    metric["missedExamples"].append(dict(imageId=str(row["id"]), objectId=ref["id"],
                        groupId=row.get("groupId", row.get("sceneId")), box=ref["box"], reason=reason))
    mean_ap, aps = _ap(prepared, names, max_dets) if compute_ap else (None, {n: None for n in names})
    for name, metric in by_class.items():
        metric.update(_rate(metric["tp"], metric["fp"], metric["fn"], metric["referenceCount"]))
        metric["ap"] = aps[name] if metric["referenceCount"] else None
        metric["evaluationStatus"] = ("MEASURED_ON_THIS_SPLIT" if metric["referenceCount"] else
            "KNOWN_NEGATIVE_SCOPE_ONLY" if metric["knownScopeImages"] else "NO_ANNOTATION_SCOPE")
    overall = {k: sum(m[k] for m in by_class.values()) for k in ["tp", "fp", "fn", "referenceCount", "ignoredCrowdDetections"]}
    overall.update(_rate(overall["tp"], overall["fp"], overall["fn"], overall["referenceCount"]))
    overall["ignoredOutOfScopePredictions"] = outside
    overall["ignoredOutOfScopeAtThreshold"] = outside_operating
    return dict(overall=overall, operating=overall, map=mean_ap, perClass=by_class,
        coverage=dict(images=len(prepared), groups=len({_group(p["row"]) for p in prepared}),
                      completeImages=sum(p["row"].get("completeLabels") is True for p in prepared),
                      independentlyAnnotatedImageClassPairs=sum(len(p["scope"]) for p in prepared),
                      possibleImageClassPairs=len(prepared)*len(names)))


def evaluate_rows(rows, predictions, names, threshold=.5, *, iou_threshold=.5, max_dets=100, compute_ap=True):
    """Pure validation/final metrics, scoped to independently annotated classes.

    Returns overall/operating TP/FP/FN/P/R/F1, map, perClass and perSource.
    A no-positive-reference class has null precision, recall and AP even when
    its known-negative scenes expose false positives. Frames are not scenes.
    """
    if not 0 <= threshold <= 1 or not 0 < iou_threshold <= 1 or max_dets < 10:
        raise ValueError("Invalid operating point")
    prepared = _prepare(list(rows), predictions, list(names), max_dets)
    if not prepared:
        raise ValueError("Evaluation rows cannot be empty")
    output = _evaluate_prepared(prepared, names, threshold, iou_threshold, max_dets, compute_ap)
    sources = defaultdict(list)
    for item in prepared:
        source = item["row"].get("source", "unspecified")
        if not isinstance(source, str):
            raise ValueError("A canonical source string is required")
        sources[source].append(item)
    output["perSource"] = {s: _evaluate_prepared(items, names, threshold, iou_threshold, max_dets, compute_ap)
                           for s, items in sorted(sources.items())}
    output["threshold"] = threshold; output["iouThreshold"] = iou_threshold
    output["methodology"] = f"pycocotools bbox AP IoU .50:.95/101 recall/maxDets{max_dets}, explicit partial-label class scopes"
    output["apTieOrder"] = "Sorted frozen numeric evaluationImageId/cocoId when all present; otherwise supplied manifest image order. Quantized score ties can change AP under a different image order."
    output["limitations"] = ["Output vocabulary is not proof of detection accuracy or navigation safety.",
        "Unknown source classes are ignored, not counted as negatives.",
        "Video frames are correlated; scene groups and repeated physical instances limit independence."]
    return output


def canonical_labels(path):
    source = Path(path).read_text(encoding="utf-8")
    pairs = re.findall(r'^\s*\[\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*,', source, re.M)
    result = [(json.loads(name), json.loads(arabic)) for name, arabic in pairs]
    if len(result) != 80 or len({p[0] for p in result}) != 80:
        raise ValueError("Installed COCO vocabulary must contain exactly 80 unique labels")
    return dict(result)


def _relative(root, name):
    path = Path(name)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def _group(row, default_source="unspecified"):
    source = row.get("source", default_source)
    group = row.get("groupId", row.get("siteId", row.get("sceneId", row["id"])))
    return str(source), str(group)


def _training(root, model, names, final_rows):
    known = "trainingStages" in model or "trainingEvidence" in model
    stages = model.get("trainingStages")
    if stages is None:
        evidence = model.get("trainingEvidence")
        stages = [evidence] if evidence is not None else []
    if not isinstance(stages, list):
        raise ValueError("trainingStages must be an explicit list")
    per_class = {n: dict(uniqueImages=None if not known else 0, uniqueInstances=None if not known else 0) for n in names}
    final_hashes = {r["sha256"] for r in final_rows}
    final_groups = {_group(r) for r in final_rows}
    image_classes = set(); instance_keys = set(); all_images = set(); evidence = []
    restrictions = set(model.get("usageRestrictions", []))
    research_only = model.get("researchOnly") is True
    for stage in stages:
        if stage.get("selectedOnlyOnValidation") is not True or stage.get("referencesIndependent") is not True:
            raise ValueError("Additional training requires validation-only selection and independent references")
        ids = stage.get("trainedImageIds")
        if not isinstance(ids, list) or not ids or len(set(map(str, ids))) != len(ids):
            raise ValueError("Explicit unique selected-checkpoint trainedImageIds required; candidate dataset counts are insufficient")
        if not isinstance(stage.get("checkpointSha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", stage["checkpointSha256"]):
            raise ValueError("Selected checkpoint identity required")
        if stage.get("checkpointPath") and sha(_relative(root, stage["checkpointPath"])) != stage["checkpointSha256"]:
            raise ValueError("Selected training checkpoint changed")
        path = _relative(root, stage["manifestPath"]); manifest = read(path)
        if stage.get("manifestSha256") and sha(path) != stage["manifestSha256"]:
            raise ValueError("Training manifest changed")
        rows = {str(r["id"]): r for r in manifest["samples"]}
        if set(map(str, ids)) - set(rows):
            raise ValueError("Selected checkpoint refers to unknown training image IDs")
        stage_counts = Counter(); source_counts = Counter()
        for image_id in map(str, ids):
            row = rows[image_id]
            if row.get("split") != "train":
                raise ValueError("Selected training metadata includes validation/final media")
            if row["sha256"] in final_hashes or _group(row, stage.get("source", "unspecified")) in final_groups:
                raise ValueError("Training image/source-scene leaks into independent final evaluation")
            if not isinstance(row.get("objects"), list):
                raise ValueError("Unlabelled frames cannot be counted as independently labelled training data")
            all_images.add(row["sha256"]); source_counts[str(row.get("source", stage.get("source", "unspecified")))] += 1
            for obj in row["objects"]:
                if obj.get("iscrowd") or obj.get("ignoreForEvaluation"):
                    continue
                name = obj["class"]
                if name not in names:
                    raise ValueError("Training cannot add unsupported classes to the inherited output vocabulary")
                b = _box(obj["box"])
                image_classes.add((row["sha256"], name))
                instance_keys.add((row["sha256"], name, tuple(round(x, 8) for x in b)))
                stage_counts[name] += 1
        restrictions.update(stage.get("usageRestrictions", []))
        restrictions.update(manifest.get("usageRestrictions", []))
        research_only = research_only or stage.get("researchOnly") is True or manifest.get("researchOnly") is True
        evidence.append(dict(manifestSha256=sha(path), checkpointSha256=stage["checkpointSha256"],
            selectedCheckpointImages=len(ids), positiveInstancesByClass=dict(stage_counts), imageCountsBySource=dict(source_counts),
            selectionBasis="EXPLICIT_SELECTED_CHECKPOINT_IMAGE_IDS", referencesIndependent=True))
    if known:
        for name in names:
            per_class[name] = dict(uniqueImages=sum(n == name for _, n in image_classes),
                                   uniqueInstances=sum(n == name for _, n, _ in instance_keys))
    return dict(metadataKnown=known, selectedTrainingUniqueImages=len(all_images) if known else None,
                perClass=per_class, stages=evidence, usageRestrictions=sorted(restrictions), researchOnly=research_only,
                deduplication="Image SHA256; instance key=image SHA256, canonical class, normalized reference box")


def _scoped_rows(manifest, policy):
    rows = []
    for source in manifest["samples"]:
        if source["split"] != "test":
            continue
        row = dict(source)
        if "completeLabels" not in row and "annotatedClasses" not in row:
            if "defaultCompleteLabels" not in policy:
                raise ValueError("Legacy reference completeness must be explicitly declared, never assumed")
            row["completeLabels"] = policy["defaultCompleteLabels"] is True
        if "source" not in row and policy.get("defaultSource"):
            row["source"] = policy["defaultSource"]
        rows.append(row)
    if not rows:
        raise ValueError("Independent final test rows missing")
    return rows


def generate_registry(root, config_path, labels_path):
    """Read measured final predictions and explicit training metadata; never edits originals."""
    root = Path(root).resolve(); config_path = Path(config_path).resolve()
    labels = canonical_labels(labels_path); names = list(labels)
    manifest_path = root / "manifest.json"; manifest = read(manifest_path)
    lock_path = root / "cohort-lock.json"; lock = read(lock_path)
    if sha(manifest_path) != lock.get("manifestSha256"):
        raise ValueError("Independent corpus changed after its freeze")
    config = read(config_path)
    selection_path = _relative(root, config.get("selectionLockPath", "selection-lock.json"))
    selection = read(selection_path)
    if selection.get("finalUsedForSelection") is True or not (
            selection.get("finalUsedForSelection") is False or selection.get("finalTestOpened") is False):
        raise ValueError("Independent final predictions must not select models/settings")
    bound = selection.get("cohortSha256", selection.get("manifestSha256"))
    if bound is not None and bound != sha(manifest_path):
        raise ValueError("Selection is bound to another corpus")
    rows = _scoped_rows(manifest, config.get("referencePolicy", {}))
    # The prepared corpus itself must keep every source scene in one split.
    assignments = {}
    for row in manifest["samples"]:
        group = _group(row, config.get("referencePolicy", {}).get("defaultSource", "unspecified"))
        if group in assignments and assignments[group] != row["split"]:
            raise ValueError("Source scene appears in multiple splits")
        assignments[group] = row["split"]
    models = config.get("models")
    if not isinstance(models, list) or not models or len({m["id"] for m in models}) != len(models):
        raise ValueError("Unique model descriptors required")
    outputs = []; fingerprints = []
    for model in models:
        if not isinstance(model.get("modelSha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", model["modelSha256"]):
            raise ValueError("Actual model SHA256 required")
        report_path = _relative(root, model["predictionsPath"]); report = read(report_path)
        if report.get("referencesUsedInInference") is not False or report.get("modelSha256") != model["modelSha256"]:
            raise ValueError("Predictions must bind model identity and must not use reference labels during inference")
        if report.get("cohortSha256") is not None and report["cohortSha256"] != sha(manifest_path):
            raise ValueError("Predictions refer to another corpus")
        predictions = {str(p["id"]): p for p in report["predictions"]}
        if len(predictions) != len(report["predictions"]):
            raise ValueError("Repeated final prediction image")
        for row in rows:
            if str(row["id"]) not in predictions or predictions[str(row["id"])].get("sha256") != row["sha256"]:
                raise ValueError("Final prediction image identity changed")
            if sha(root / row["path"]) != row["sha256"]:
                raise ValueError("Final source image changed")
        inherited = names if model.get("inheritedClasses", "coco80") == "coco80" else model["inheritedClasses"]
        if not isinstance(inherited, list) or set(inherited) - set(names):
            raise ValueError("Inherited model vocabulary is not the canonical output contract")
        training = _training(root, model, names, rows)
        measured = evaluate_rows(rows, predictions, names, model.get("threshold", .5))
        entries = []
        for index, name in enumerate(names):
            count = training["perClass"][name]; metric = measured["perClass"][name]
            entries.append(dict(outputIndex=index, canonicalName=name, arabicName=labels[name],
                outputAvailable=True, inheritedFromOriginalWeights=name in inherited,
                pretrainedImageCount=None, pretrainedInstanceCount=None,
                furtherTrained=(count["uniqueInstances"] > 0) if count["uniqueInstances"] is not None else None,
                additionalTraining=count, independentFinal=metric,
                status="EVALUATED_ON_THIS_SAMPLE" if metric["referenceCount"] else "NO_POSITIVE_FINAL_REFERENCE",
                navigationEligible=False))
        outputs.append(dict(id=model["id"], name=model.get("name", model["id"]), modelSha256=model["modelSha256"],
            outputVocabulary=list(labels), inheritedClassCount=len(inherited),
            furtherTrainedClasses=[e["canonicalName"] for e in entries if e["furtherTrained"] is True],
            evaluatedClasses=[e["canonicalName"] for e in entries if e["independentFinal"]["referenceCount"]],
            classesWithoutPositiveFinalReference=[e["canonicalName"] for e in entries if not e["independentFinal"]["referenceCount"]],
            classesStillMissed=[dict(canonicalName=e["canonicalName"], arabicName=e["arabicName"],
                missed=e["independentFinal"]["fn"], referenceCount=e["independentFinal"]["referenceCount"],
                examples=e["independentFinal"]["missedExamples"]) for e in entries if e["independentFinal"]["fn"]],
            training=training, finalEvaluation=measured, objects=entries, calibration="UNPROVEN",
            navigationEligible=False, productionEligible=False, humanApproval=False,
            licenceEligibility="RESEARCH_ONLY_FROM_SOURCE_RECORDS" if training["researchOnly"] else "NOT_ASSESSED"))
        fingerprints.append(dict(modelId=model["id"], predictionsSha256=sha(report_path),
                                 modelSha256=model["modelSha256"], trainingEvidence=training["stages"]))
    provenance = dict(generatorSourceSha256=sha(Path(__file__)), manifestSha256=sha(manifest_path), cohortLockSha256=sha(lock_path),
        selectionLockSha256=sha(selection_path), descriptorsSha256=sha(config_path),
        labelsSourceSha256=sha(labels_path), models=fingerprints)
    fingerprint = hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest()
    return dict(schemaVersion=1, title="معرفة بصيرة", generatedAtUtc=datetime.now(timezone.utc).isoformat(),
        inputFingerprint=fingerprint, provenance=provenance, models=outputs,
        policy=dict(predictionsAreReferences=False, outputVocabularyIsProvenAccuracy=False,
                    finalUsedForSelection=False, navigationEligible=False, productionEligible=False,
                    framesAreIndependentScenes=False, physicalInstanceGeneralizationProven=False),
        caveats=["الفئات الثمانون الموروثة تصف عقد الإخراج؛ لا تثبت دقة كشف ثمانين فئة.",
            "الفئة بلا مرجع إيجابي مستقل لها Precision وRecall وAP بقيمة null؛ قد تسجل إنذارات كاذبة في نطاق سلبي موثق.",
            "الإطارات داخل المشهد مترابطة، وقد تتكرر الأجسام الفيزيائية نفسها عبر مشاهد الفيديو.",
            "بيانات المصدر ذات الوسوم الجزئية تقيم فئاتها الموثقة فقط؛ لا تحول الفئات الأخرى إلى خلفية.",
            "لا تمثل النتائج معايرة أو اعتمادًا بشريًا أو إثبات سلامة ملاحة."])


def markdown(registry):
    def number(value):
        return "غير مقاس" if value is None else f"{value:.3f}"
    lines = ["# معرفة بصيرة", "", *registry["caveats"], "",
             f"بصمة المدخلات: `{registry['inputFingerprint']}`", ""]
    for model in registry["models"]:
        lines += [f"## {model['name']}", "", f"معرف النموذج: `{model['id']}`؛ بصمة الأوزان: `{model['modelSha256']}`.", "",
            f"الفئات الموروثة: {model['inheritedClassCount']}؛ صور التدريب الإضافي الفريدة المثبتة: {model['training']['selectedTrainingUniqueImages'] if model['training']['metadataKnown'] else 'غير معروفة'}؛ أهلية الترخيص: {model['licenceEligibility']}.", "",
            "| المصدر | الصور/المجموعات | TP | FP | FN | Precision | Recall | mAP |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for source, result in model["finalEvaluation"]["perSource"].items():
            op = result["overall"]; coverage = result["coverage"]
            lines.append(f"| {source} | {coverage['images']}/{coverage['groups']} | {op['tp']} | {op['fp']} | {op['fn']} | {number(op['precision'])} | {number(op['recall'])} | {number(result['map'])} |")
        lines += ["", "| الجسم | الفئة | موروث | تدريب إضافي صور/مثيلات | مرجع مستقل | TP/FP/FN | Precision | Recall | AP |",
                  "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for item in model["objects"]:
            t=item["additionalTraining"]; e=item["independentFinal"]
            count = "غير معروف" if t["uniqueImages"] is None else f"{t['uniqueImages']}/{t['uniqueInstances']}"
            lines.append(f"| {item['arabicName']} | {item['canonicalName']} | {'نعم' if item['inheritedFromOriginalWeights'] else 'لا'} | {count} | {e['referenceCount']} | {e['tp']}/{e['fp']}/{e['fn']} | {number(e['precision'])} | {number(e['recall'])} | {number(e['ap'])} |")
        lines += [""]
        if model["training"]["usageRestrictions"]:
            lines += ["قيود المصادر: " + "؛ ".join(model["training"]["usageRestrictions"]), ""]
    return "\n".join(lines)


def save_registry(registry, output):
    output = Path(output).resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    snapshot = output.with_name(output.stem + ".snapshot-" + registry["inputFingerprint"][:16] + ".json")
    if snapshot.exists():
        previous = read(snapshot)
        if previous["inputFingerprint"] != registry["inputFingerprint"]:
            raise ValueError("Knowledge snapshot identity conflict")
        registry = previous
    else:
        with snapshot.open("x", encoding="utf-8") as target:
            json.dump(registry, target, ensure_ascii=False, indent=2)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent,
                                     prefix=output.name + ".", suffix=".tmp", delete=False) as handle:
        json.dump(registry, handle, ensure_ascii=False, indent=2); temporary=Path(handle.name)
    temporary.replace(output)
    output.with_suffix(".md").write_text(markdown(registry), encoding="utf-8")
    return snapshot


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--models", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--labels", type=Path, default=Path(__file__).resolve().parents[2]/"client/src/lib/vision/cocoLabels.ts")
    args=parser.parse_args(argv);root=args.root.resolve()
    registry=generate_registry(root,args.models or root/"knowledge-models.json",args.labels)
    output=args.output or root/"basira-knowledge.json";snapshot=save_registry(registry,output)
    print(json.dumps(dict(output=str(output), snapshot=str(snapshot), models=len(registry["models"]),
                         independentEvaluation=True, navigationEligible=False, productionEligible=False)))


if __name__ == "__main__":
    main()
