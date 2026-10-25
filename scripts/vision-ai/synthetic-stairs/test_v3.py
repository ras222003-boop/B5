"""V3 preprocessing/abstention/split checks; no model or test-image inference."""
import math
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from model_v3 import Pool4, decode, letterbox, original_box, padded_box
from train_v3 import metrics
from validate_v3 import dhash, ensure_partition, geometric_direction


class V3ContractTests(unittest.TestCase):
    def test_export_pool_matches_trained_adaptive_pool(self):
        tensor=torch.randn(2,96,10,10)
        torch.testing.assert_close(Pool4()(tensor),torch.nn.functional.adaptive_avg_pool2d(tensor,(4,4)),atol=1e-6,rtol=1e-5)

    def test_numpy_outputs_can_be_persisted_as_json(self):
        result=decode(np.array([0,3,0],dtype=np.float32),np.array([3,0,0],dtype=np.float32),
            np.array([.1,.2,.5,.5],dtype=np.float32),
            dict(resizedWidth=160,resizedHeight=120,left=0,top=20),
            dict(presenceMin=.35,directionMin=.45,directionMargin=.1))
        self.assertEqual(json.loads(json.dumps(result))['classId'],2301)

    def test_letterbox_uses_rgb_nchw_gray_padding_and_matching_mask(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            root = Path(folder)
            Image.new('RGB', (320, 240), (255, 64, 0)).save(root / 'rgb.png')
            Image.new('L', (320, 240), 1).save(root / 'mask.png')
            tensor, mask, meta = letterbox(root / 'rgb.png', root / 'mask.png')
            self.assertEqual(tuple(tensor.shape), (3, 160, 160))
            self.assertEqual(tuple(mask.shape), (1, 20, 20))
            self.assertEqual((meta['resizedWidth'], meta['resizedHeight'], meta['left'], meta['top']),
                             (160, 120, 0, 20))
            np.testing.assert_allclose(tensor[:, 0, 0].numpy(), [127 / 255] * 3, atol=1e-7)
            np.testing.assert_allclose(tensor[:, 80, 80].numpy(), [1, 64 / 255, 0], atol=1e-7)
            self.assertEqual(float(mask[0, 0, 0]), 0)
            self.assertEqual(float(mask[0, 10, 10]), 1)

    def test_box_round_trip_for_landscape_and_portrait(self):
        for meta in ({'resizedWidth': 160, 'resizedHeight': 120, 'left': 0, 'top': 20},
                     {'resizedWidth': 80, 'resizedHeight': 160, 'left': 40, 'top': 0}):
            box = [.125, .2, .5, .6]
            np.testing.assert_allclose(original_box(padded_box(box, meta), meta), box, atol=1e-8)
            np.testing.assert_allclose(original_box([0, 0, 1, 1], meta), [0, 0, 1, 1])

    def test_background_argmax_never_forces_nonbackground_class(self):
        meta = {'resizedWidth': 160, 'resizedHeight': 120, 'left': 0, 'top': 20}
        thresholds = {'presenceMin': .3, 'directionMin': .55, 'directionMargin': .1}
        result = decode(np.log([.45, .35, .20]), np.log([.95, .03, .02]),
                        [.1, .2, .6, .5], meta, thresholds)
        self.assertIsNone(result['classId'])
        self.assertIsNone(result['box'])

    def test_fixed_detection_can_abstain_on_direction_without_disappearing(self):
        meta = {'resizedWidth': 160, 'resizedHeight': 120, 'left': 0, 'top': 20}
        thresholds = {'presenceMin': .45, 'directionMin': .55, 'directionMargin': .1}
        result = decode(np.log([.05, .9, .05]), np.log([.48, .47, .05]),
                        [.1, .2, .6, .5], meta, thresholds)
        self.assertEqual(result['classId'], 2303)
        self.assertTrue(result['directionAbstained'])
        self.assertAlmostEqual(result['score'], .9)
        self.assertIsNotNone(result['box'])
        certain = decode(np.log([.05, .9, .05]), np.log([.9, .05, .05]),
                         [.1, .2, .6, .5], meta, thresholds)
        self.assertEqual(certain['classId'], 2301)
        self.assertFalse(certain['directionAbstained'])

    def test_escalator_presence_is_independent_of_direction_head(self):
        meta = {'resizedWidth': 160, 'resizedHeight': 120, 'left': 0, 'top': 20}
        result = decode(np.log([.05, .1, .85]), np.log([.95, .03, .02]),
                        [.1, .2, .6, .5], meta,
                        {'presenceMin': .45, 'directionMin': .55, 'directionMargin': .1})
        self.assertEqual(result['classId'], 2304)
        self.assertFalse(result['directionAbstained'])

    def test_direction_is_geometric_and_limited_by_visible_treads(self):
        scene = {'yaw': 0., 'steps': 6, 'run': .3}
        def sample(position, target, visible=5):
            return {'camera_pose': {'position': list(position), 'target': list(target), 'fov_degrees': 64},
                    'visibleTreads': visible}
        self.assertEqual(geometric_direction(scene, sample((0, -3, 1.6), (0, .9, .6)))[0], 2301)
        self.assertEqual(geometric_direction(scene, sample((0, 3, 2.6), (0, .9, .6)))[0], 2302)
        self.assertEqual(geometric_direction(scene, sample((3, .9, 1.6), (0, .9, .6)))[0], 2303)
        self.assertEqual(geometric_direction(scene, sample((0, -3, 1.6), (0, .9, .6), 2))[0], 2303)

    def test_scene_or_seed_must_not_cross_splits(self):
        with self.assertRaisesRegex(ValueError, 'crosses split'):
            ensure_partition([{'group': 'same', 'split': 'train'},
                              {'group': 'same', 'split': 'test'}], 'group', 'Group')

    def test_dhash_collisions_on_flat_colors_are_reported_not_identity_proof(self):
        self.assertEqual(dhash(Image.new('RGB', (320, 240), 'gray')),
                         dhash(Image.new('RGB', (320, 240), 'white')))

    def test_selection_prefers_balanced_detection_to_background_or_direction_collapse(self):
        truths = (2301, 2302, None, 2304)
        rows = [{'scene_id': str(index), 'kind': 'escalator' if label == 2304 else 'stairs',
                 'objects': [{'classId': label, 'box': [.1, .2, .6, .5]}] if label else []}
                for index, label in enumerate(truths)]
        def predictions(labels):
            return [{'classId': label, 'box': [.1, .2, .6, .5] if label else None}
                    for label in labels]
        balanced = metrics(rows, predictions(truths))
        all_background = metrics(rows, predictions((None, None, None, None)))
        one_direction = metrics(rows, predictions((2301, 2301, None, 2304)))
        self.assertGreater(balanced['selectionScore'], all_background['selectionScore'])
        self.assertGreater(balanced['selectionScore'], one_direction['selectionScore'])
        self.assertEqual(balanced['fixedDetection']['f1'], 1)
        self.assertEqual(all_background['meanIoUAllObjects'], 0)
        self.assertEqual(one_direction['classRecall']['2302'], 0)

    def test_metrics_count_escalator_false_alert_and_direction_abstention_coverage(self):
        truths = (2301, 2302, 2303, 2304, None)
        guesses = (2301, 2303, 2303, 2302, None)
        rows = [{'scene_id': str(index), 'kind': 'escalator' if label == 2304 else 'stairs',
                 'objects': [{'classId': label, 'box': [.1, .2, .6, .5]}] if label else []}
                for index, label in enumerate(truths)]
        predictions = [{'classId': label, 'box': [.1, .2, .6, .5] if label else None}
                       for label in guesses]
        report = metrics(rows, predictions)
        self.assertEqual(report['fixedDetection']['fp'], 1)
        self.assertEqual(report['falseAlertsByKind']['escalator'], 1)
        self.assertEqual(report['directionAbstentions'], 2)
        self.assertAlmostEqual(report['directionDecidedCoverage'], 1 / 3)
        self.assertEqual(report['directionAccuracyAmongDecisions'], 1)
        self.assertAlmostEqual(report['directionAccuracyAllFixed'], 2 / 3)


if __name__ == '__main__':
    unittest.main()
