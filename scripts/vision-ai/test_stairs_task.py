"""Fictional metadata only: no models, real images, human attestations or training."""
import copy
import json
import unittest
from pathlib import Path
from stairs_task import project_stairs, LABELS


def fixture():
    policy = json.loads((Path(__file__).resolve().parents[2] / 'ml/vision/stairs-task.v1.json').read_text())
    data, splits, cohort = {'contentKind': 'real', 'samples': []}, {}, {'samples': []}
    for split, per_class in [('train', 4), ('validation', 2), ('test', 2)]:
        coco = {'images': [], 'annotations': [], 'categories': [{'id': 23, 'name': 'stairs_visible'}, {'id': 1, 'name': 'person'}]}
        labels = [k for k in LABELS for _ in range(per_class)] + [None, None]
        for n, label in enumerate(labels):
            sid = split+str(n)
            objects = [{'classId': 1, 'box': [.1, .2, .3, .4]}]
            if label:
                objects.append({'classId': 23, 'box': [.2, .1, .6, .8], 'stairsDirection': {'label': label, 'evidence': 'fictional test evidence'}})
            s = dict(id=sid, split=split, sha256=sid, width=100, height=80, leakageGroup=split+str(n % 2),
                     annotation={'objects': objects}, hardNegatives=[] if label else ['tile_pattern'])
            data['samples'].append(s)
            coco['images'].append(dict(id=n+1, sample_id=sid, sha256=sid))
            for obj in objects:
                coco['annotations'].append(dict(id=len(coco['annotations'])+1, image_id=n+1, category_id=obj['classId'],
                    bbox=[obj['box'][i]*(100 if i % 2 == 0 else 80) for i in range(4)]))
            if split == 'test':
                cohort['samples'].append(dict(imageSha256=sid, group=s['leakageGroup']))
        splits[split] = coco
    return data, splits, policy, cohort


class StairsProjectionTests(unittest.TestCase):
    def test_only_stairs_classes_train_and_original_incidental_labels_are_preserved(self):
        args = fixture()
        before = copy.deepcopy(args)
        result, counts = project_stairs(*args)
        self.assertEqual(args, before)
        for split in result.values():
            self.assertEqual([c['name'] for c in split['categories']], LABELS)
            self.assertEqual(set(a['category_id'] for a in split['annotations']), {2301,2302,2303})
        self.assertEqual(counts['train']['images'], 14)
        self.assertEqual(counts['test']['negativeImages'], 2)

    def test_generic_direction_pending_and_synthetic_never_pass(self):
        for change in ['missing_direction', 'synthetic', 'no_test', 'wrong_export', 'wrong_split', 'no_negative_evidence', 'no_down']:
            data, splits, policy, cohort = fixture()
            if change == 'missing_direction':
                del data['samples'][0]['annotation']['objects'][1]['stairsDirection']
            elif change == 'synthetic':
                data['contentKind'] = 'synthetic'
            elif change == 'no_test':
                cohort['samples'] = []
            elif change == 'wrong_export':
                splits['train']['annotations'][1]['bbox'][0] += 1
            elif change == 'wrong_split':
                data['samples'][0]['split'] = 'test'
            elif change == 'no_negative_evidence':
                data['samples'][12]['hardNegatives'] = []
            else:
                for s in data['samples']:
                    for o in s['annotation']['objects']:
                        if o.get('stairsDirection', {}).get('label') == 'stairs_down':
                            o['stairsDirection']['label'] = 'stairs_up'
            with self.subTest(change=change), self.assertRaises(ValueError):
                project_stairs(data, splits, policy, cohort)


if __name__ == '__main__':
    unittest.main()
