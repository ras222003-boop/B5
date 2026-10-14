"""Standard-library tests; never train or fetch model weights."""
import importlib.util
import tempfile
import unittest
import json
import subprocess
from types import SimpleNamespace
from pathlib import Path

spec = importlib.util.spec_from_file_location("basira_train", Path(__file__).with_name("train.py"))
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)


class TrainingPreparationTests(unittest.TestCase):
    def test_relative_paths_cannot_escape_data_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.assertEqual(training.inside(root, "media/frame.png"), root / "media/frame.png")
            with self.assertRaises(ValueError):
                training.inside(root, "../outside.png")

    def test_json_evidence_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.json"
            training.write(path, {"trainingPerformed": False})
            with self.assertRaises(FileExistsError):
                training.write(path, {"trainingPerformed": True})
            self.assertFalse(training.read(path)["trainingPerformed"])

    def test_checksum_detects_changed_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.bin"
            path.write_bytes(b"before")
            before = training.digest(path)
            path.write_bytes(b"after")
            self.assertNotEqual(before, training.digest(path))

    def test_preflight_rejects_synthetic_data_before_importing_ml_or_training(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            manifest = root / "dataset.json"
            training.write(manifest, {"schemaVersion": 1, "id": "synthetic-test", "annotationRevision": "test",
                "taxonomyVersion": training.read(training.REPO / "ml/vision/taxonomy.v1.json")["version"],
                "contentKind": "synthetic", "sources": [], "samples": []})
            for name in ("train.json", "validation.json", "test.json"):
                training.write(root / name, {})
            training.write(root / "dataset.lock.json", {"files": {name: training.digest(root / name)
                for name in ("train.json", "validation.json", "test.json")}})
            args = SimpleNamespace(data_root=str(root), export=str(root), manifest=str(manifest))
            with self.assertRaises(subprocess.CalledProcessError):
                training.preflight(args)


if __name__ == "__main__":
    unittest.main()
