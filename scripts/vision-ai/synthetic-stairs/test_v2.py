"""Checks for the V2 geometry, grouping, frozen test, and false-alert metrics."""
import copy
import unittest
from collections import Counter

from generate_v2 import MATERIALS, make_scene, specs, stair_faces
from metrics_v2 import summarize
from train_v2 import fixed_scene_sampler
from validate_v2 import test_fingerprint as fingerprint


class V2ResearchTests(unittest.TestCase):
    def test_descending_geometry_has_no_solid_rear_wall(self):
        scene = make_scene(next(row for row in specs() if row[1] == 'train' and
                                row[2] == 'stairs' and row[3] == 'down'), 4)
        faces = stair_faces(scene)
        self.assertEqual(len(faces), scene['steps'] * 2)
        self.assertEqual({part for _, _, part, _ in faces}, {'tread', 'riser'})
        for vertices, _, part, index in faces:
            if part == 'riser':
                heights = [vertex[2] for vertex in vertices]
                self.assertAlmostEqual(max(heights) - min(heights), scene['rise'])

    def test_scene_balance_and_material_crossing(self):
        rows = specs()
        for split, expected in (('train', 8), ('validation', 4), ('test', 4)):
            selected = [row for row in rows if row[1] == split]
            counts = Counter(row[3] if row[2] == 'stairs' else 'nonfixed' for row in selected)
            self.assertEqual(counts, {'up': expected, 'down': expected, 'nonfixed': expected})
            for direction in ('up', 'down'):
                self.assertEqual({row[4] for row in selected if row[2] == 'stairs' and row[3] == direction},
                                 set(MATERIALS))

    def test_epoch_sampling_prevents_video_frames_dominating(self):
        rows = ([{'scene_id': 'still', 'id': f's{i}'} for i in range(3)] +
                [{'scene_id': 'video', 'id': f'v{i}'} for i in range(11)])
        selected = fixed_scene_sampler(rows, {'still': 41, 'video': 43}, 0)
        self.assertEqual(Counter(row['scene_id'] for row in selected), {'still': 3, 'video': 3})

    def test_test_fingerprint_ignores_train_but_detects_test_change(self):
        data = {'scenes': [{'id': 'a', 'split': 'train'}, {'id': 'b', 'split': 'test'}],
                'samples': [{'id': 'a', 'split': 'train', 'sha256': 'one'},
                            {'id': 'b', 'split': 'test', 'sha256': 'two'}],
                'categories': [{'id': 2301}]}
        original = fingerprint(data)
        altered = copy.deepcopy(data)
        altered['samples'][0]['sha256'] = 'changed'
        self.assertEqual(original, fingerprint(altered))
        altered['samples'][1]['sha256'] = 'changed'
        self.assertNotEqual(original, fingerprint(altered))

    def test_escalator_predicted_as_fixed_is_counted_as_false_alert(self):
        rows = [{'id': 'e', 'scene_id': 'one', 'sha256': 'hash', 'path': 'e.png',
                 'objects': [{'classId': 2304, 'box': [.1, .1, .5, .5]}]}]
        predictions = [{'id': 'e', 'scene_id': 'one', 'imageSha256': 'hash',
                        'classId': 2302, 'score': .9, 'box': [.1, .1, .5, .5]}]
        report = summarize(rows, predictions)
        self.assertEqual(report['fixedStairDetection']['falseAlertsOnNonfixed'], 1)
        self.assertEqual(report['confusion'][0]['truth'], 'escalator')


if __name__ == '__main__':
    unittest.main()
