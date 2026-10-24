"""Resume checks must not accept a stale or corrupted training result."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from run_proof import resumable_partial_run, verified_completed_run


class ResumeChecks(unittest.TestCase):
    def test_completed_run_requires_matching_artifact_hashes(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            run = Path(folder)
            report = {'status': 'completed', 'manifestSha256': 'manifest',
                      'trainingPerformed': True, 'optimizerSteps': 1,
                      'onnxCheckerPassed': True, 'onnxRuntimeInferencePassed': True}
            for key, hash_key in (('checkpoint', 'checkpointSha256'),
                                  ('weights', 'weightsSha256'), ('onnx', 'onnxSha256')):
                path = run / (key + '.bin')
                path.write_bytes(key.encode())
                report[key] = str(path)
                report[hash_key] = hashlib.sha256(path.read_bytes()).hexdigest()
            (run / 'report.json').write_text(json.dumps(report), encoding='utf-8')
            self.assertTrue(verified_completed_run(run, 'manifest'))
            (run / 'onnx.bin').write_bytes(b'corrupt')
            self.assertFalse(verified_completed_run(run, 'manifest'))

    def test_partial_run_needs_checkpoint_bound_to_manifest(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            run = Path(folder)
            (run / 'run-state.json').write_text(json.dumps({'manifestSha256': 'manifest'}),
                                                encoding='utf-8')
            self.assertFalse(resumable_partial_run(run, 'manifest'))
            (run / 'checkpoint-last.pt').write_bytes(b'saved epoch')
            self.assertTrue(resumable_partial_run(run, 'manifest'))
            self.assertFalse(resumable_partial_run(run, 'other manifest'))


if __name__ == '__main__':
    unittest.main()
