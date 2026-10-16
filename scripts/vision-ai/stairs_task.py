"""Task projection of an already validated/frozen Studio export. No ML or approvals."""
import copy
import math

TASK_ID = 'basira-stairs-v1'
LABELS = ['stairs_up', 'stairs_down', 'stairs_present_uncertain_direction']


def project_stairs(data, splits, policy, cohort):
    if (policy.get('id') != TASK_ID or policy.get('sourceClassId') != 23 or
            policy.get('realOnly') is not True or policy.get('metricDistance') is not False or
            policy.get('navigationSafetyClaim') is not False or policy.get('productionActivation') is not False or
            policy.get('categories') != [dict(id=2301+i, name=k, supercategory='stairs') for i, k in enumerate(LABELS)]):
        raise ValueError('unsupported stairs policy')
    if data.get('contentKind') != 'real' or not cohort or not cohort.get('samples'):
        raise ValueError('real data and registered independent stairs test required')
    samples = {s['id']: s for s in data['samples']}
    if len(samples) != len(data['samples']):
        raise ValueError('duplicate stairs samples')
    result, summary = {}, {}
    for split in ('train', 'validation', 'test'):
        coco = copy.deepcopy(splits[split])
        coco['categories'] = policy['categories']
        projected, counts, negatives, groups, ids = [], {k: 0 for k in LABELS}, 0, set(), set()
        for image in coco['images']:
            s = samples[image['sample_id']]
            if (s['id'] in ids or s['split'] != split or s['sha256'] != image['sha256'] or
                    s.get('generation') or s.get('originKind') == 'synthetic'):
                raise ValueError('stairs split/image binding mismatch')
            ids.add(s['id'])
            if split == 'test' and not any(t['imageSha256'] == s['sha256'] and t['group'] == s['leakageGroup'] for t in cohort['samples']):
                raise ValueError('unregistered stairs test sample')
            groups.add(s['leakageGroup'])
            originals = s['annotation']['objects']
            anns = [a for a in coco['annotations'] if a['image_id'] == image['id']]
            if len(anns) != len(originals):
                raise ValueError('export/source labels mismatch')
            present = set()
            for obj, ann in zip(originals, anns):
                expected = [obj['box'][i] * (s['width'] if i % 2 == 0 else s['height']) for i in range(4)]
                if ann['category_id'] != obj['classId'] or any(not math.isclose(x, y, abs_tol=1e-6) for x, y in zip(ann['bbox'], expected)):
                    raise ValueError('export/source geometry mismatch')
                if obj['classId'] != 23:
                    continue  # Retain original records; other classes are not trained by this task.
                d = obj.get('stairsDirection') or {}
                if d.get('label') not in LABELS or not isinstance(d.get('evidence'), str) or not d['evidence'].strip():
                    raise ValueError('new independently reviewed stairs direction/evidence required; generic approval is insufficient')
                present.add(d['label'])
                projected.append({**ann, 'id': len(projected)+1, 'category_id': 2301+LABELS.index(d['label'])})
            if not present:
                if not s.get('hardNegatives'):
                    raise ValueError('unrelated chair/table image is not a reviewed stairs hard negative')
                negatives += 1
            for label in present:
                counts[label] += 1
        minimum = policy['minimumEngineeringCohort']
        if (any(n < minimum['positiveImagesPerClass'][split] for n in counts.values()) or
                negatives < minimum['negativeImages'][split] or len(groups) < minimum['independentGroups'][split]):
            raise ValueError('insufficient reviewed stairs class/negative/session coverage: ' + split)
        coco['annotations'] = projected
        result[split] = coco
        summary[split] = dict(positiveImages=counts, negativeImages=negatives, groups=len(groups), images=len(coco['images']))
    if set(samples) != {i['sample_id'] for c in result.values() for i in c['images']}:
        raise ValueError('every frozen sample must occur exactly once')
    return result, summary
