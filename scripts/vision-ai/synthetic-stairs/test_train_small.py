import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

from PIL import Image

from train_small import (evaluate, record_invocation_budget, resident_memory_bytes,
                         validate_manifest, verify_resume_config)


class ResearchTrainerTests(unittest.TestCase):
    def test_resume_renews_only_wall_budget_and_records_each_invocation(self):
        saved = {"architecture": "tiny_cnn_single_stair_detection_v1", "epochs": 3,
                 "seed": 42, "maxMinutes": 5, "imageSize": 128}
        requested = dict(saved, maxMinutes=12)
        verify_resume_config(saved, requested)
        for changed in ({"seed": 43}, {"architecture": "another_model"}, {"epochs": 4}):
            with self.assertRaisesRegex(ValueError, "Resume config changed"):
                verify_resume_config(saved, dict(requested, **changed))
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            output = Path(directory)
            first = Namespace(minutes=5, threads=2, memory_mb=4096, max_storage_mb=512)
            second = Namespace(minutes=12, threads=2, memory_mb=4096, max_storage_mb=512)
            _, first_history = record_invocation_budget(output, first)
            current, second_history = record_invocation_budget(output, second)
            logged = json.loads((output / "budget-history.json").read_text(encoding="utf-8"))
            self.assertEqual([entry["authorizedMinutes"] for entry in first_history], [5])
            self.assertEqual([entry["authorizedMinutes"] for entry in second_history], [5, 12])
            self.assertEqual(logged["invocations"], second_history)
            self.assertEqual(current["invocation"], 2)

    def test_windows_process_memory_counter_is_available(self):
        value = resident_memory_bytes()
        if value is not None:
            self.assertGreater(value[0], 0)
            self.assertGreaterEqual(value[1], value[0])

    def test_rejects_scene_leakage_across_splits(self):
        parent = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(dir=parent) as directory:
            root = Path(directory)
            self.assertEqual(root.resolve().parent, parent)
            samples = []
            for index, split in enumerate(("train", "validation", "test")):
                name = f"image-{index}.png"
                Image.new("RGB", (16, 16), (index * 40, 0, 0)).save(root / name)
                samples.append({"id": index, "path": name, "scene_id": "same-scene" if index < 2 else "third",
                                "group": f"group-{index}", "split": split,
                                "objects": [{"classId": 2301, "box": [0.2, 0.2, 0.5, 0.5]}]})
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"samples": samples}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "scene leaks"):
                validate_manifest(manifest, 256)

    def test_metrics_keep_false_alerts_and_missing_detections(self):
        rows = [{"objects": [{"classId": 2301, "box": [0.1, 0.1, 0.5, 0.5]}]},
                {"objects": []}]
        predictions = [{"detection": None},
                       {"detection": {"classId": 2302, "box": [0.1, 0.1, 0.5, 0.5], "score": 0.8}}]
        metrics = evaluate(rows, predictions)
        self.assertEqual(metrics["presence"], {"tp": 0, "fp": 1, "fn": 1, "tn": 0,
                                               "precision": 0.0, "recall": 0.0})
        self.assertEqual(metrics["correctClassAndIoU50"], 0)


if __name__ == "__main__":
    unittest.main()
