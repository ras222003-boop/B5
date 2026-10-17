"""Standard-library tests; never train or fetch model weights."""
import importlib.util
import tempfile
import unittest
import json
import io
from unittest.mock import patch
import subprocess
from types import SimpleNamespace
from pathlib import Path

spec = importlib.util.spec_from_file_location("basira_train", Path(__file__).with_name("train.py"))
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)


class TrainingPreparationTests(unittest.TestCase):
    def test_data_preflight_cli_checks_data_without_run_approval_or_training(self):
        args=['train.py','data-preflight','--manifest','fixture.json','--data-root','fixture-root','--export','fixture-export','--pretrained','fixture-weights.json']
        with patch('sys.argv',args), patch('sys.stdout',new_callable=io.StringIO) as output, patch.object(training,'preflight',return_value=(None,{'datasetSha256':'fictional-only'})) as check:
            training.main()
        self.assertEqual(check.call_args.kwargs,{'require_approval':False})
        result=json.loads(output.getvalue())
        self.assertEqual(result['status'],'DATA_PREFLIGHT_ONLY')
        self.assertFalse(result['trainingPerformed'])
        self.assertTrue(result['requiresExplicitTrainingPermission'])

    def test_unknown_capture_motion_cannot_enter_other_training_tasks(self):
        data={'samples':[{'conditions':{'motion':'unknown_stairs_still'}}]}
        training.validate_capture_motion_task(data,{'task':'basira-stairs-v1'})
        for config in ({},{'task':'other'}):
            with self.assertRaisesRegex(ValueError,'restricted to stairs'):
                training.validate_capture_motion_task(data,config)
        training.validate_capture_motion_task({'samples':[{'conditions':{'motion':'static'}}]}, {})

    def test_gpu_check_reports_missing_or_incompatible_dependencies_without_training(self):
        for error in (ModuleNotFoundError("missing", name='torch'),
                      OSError("private path must not be included"), RuntimeError("operator mismatch")):
            def unavailable(_):
                raise error
            report = training.inspect_gpu(unavailable)
            self.assertFalse(report['ready'])
            self.assertFalse(report['trainingPerformed'])
            self.assertNotIn('private path', json.dumps(report))
        self.assertEqual(training.inspect_gpu(lambda _: (_ for _ in ()).throw(
            ModuleNotFoundError("missing", name='torch')))['missingModule'], 'torch')

    def test_training_approval_fails_closed_and_is_bound_to_inputs(self):
        binding = {'datasetSha256': 'test-hash'}
        approval = {'schemaVersion': 1, 'status': 'approved', 'scope': 'offline_object_and_ground_hazard_detection',
                    'reviewer': 'training-reviewer', 'dataReviewer': 'data-reviewer', 'at': '2020-01-01T00:00:00Z',
                    'contentKind': 'real', 'containsUserData': False, 'testSetSealed': True,
                    'productionActivation': False, 'binding': binding}
        training.validate_approval(approval, binding)
        for change in ({'status': 'pending'}, {'binding': {}}, {'containsUserData': True}, {'testSetSealed': False},
                       {'contentKind': 'synthetic'}, {'reviewer': 'data-reviewer'}, {'productionActivation': True},
                       {'at': '2999-01-01T00:00:00Z'}, {'at': '2020-01-01'}):
            with self.assertRaises(ValueError):
                training.validate_approval({**approval, **change}, binding)

    def test_gpu_readiness_does_not_silently_accept_cpu_or_wrong_versions(self):
        torch = SimpleNamespace(__version__='2.7.1+cpu', version=SimpleNamespace(cuda=None),
                                cuda=SimpleNamespace(is_available=lambda: False))
        report = training.gpu_environment(torch, SimpleNamespace(__version__='0.22.1'))
        self.assertFalse(report['ready'])
        self.assertFalse(report['trainingPerformed'])
        torch.cuda = SimpleNamespace(is_available=lambda: True,
            get_device_properties=lambda _: SimpleNamespace(name='TEST GPU', total_memory=123),
            get_device_capability=lambda _: (8, 0))
        self.assertTrue(training.gpu_environment(torch, SimpleNamespace(__version__='0.22.1'))['ready'])
        self.assertFalse(training.gpu_environment(torch, SimpleNamespace(__version__='0.20.1'))['ready'])

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
