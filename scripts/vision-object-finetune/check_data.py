"""Independent reference/rights/group audit, not a model-generated annotation approval."""
from pathlib import Path
from collections import Counter
import json,re,sys
import numpy as np
from PIL import Image
from common import corpus,read,sha
root=Path(sys.argv[1]).resolve();manifest,names=corpus(root)
annotations=read(root/'assets/instances_val2017.json');refs={str(a['id']):a for a in annotations['annotations']};cats={c['id']:c['name'] for c in annotations['categories']}
source_images={im['id']:im for im in annotations['images']}
authors=set();digests=set();scene_groups={};photos=set();signatures=[]
def dhash(path):
    a=np.asarray(Image.open(path).convert('L').resize((9,8)));return (a[:,1:]>a[:,:-1]).flatten()
previous_authors=set();previous_photos=set();previous_signatures=[]
prior_names=['object-colors-001','object-colors-development-001','object-quality-002']
prior_names += [p.name for p in root.parent.glob('object-finetune-*') if p.resolve()!=root and (p/'manifest.json').exists()]
for name in prior_names:
    old=root.parent/name
    for row in read(old/'manifest.json')['samples']:
        if row.get('siteId'):previous_authors.add(row['siteId'].removeprefix('flickr-'))
        previous_signatures.append(dhash(old/row['path']))
    for folder in ['rights','license-evidence']:
        for p in (old/folder).glob('*.json'):
            value=read(p);match=re.search(r'/photos/([^/]+)/(\d+)',value.get('source',''))
            if match:previous_authors.add(match[1]);previous_photos.add(match[2])
            if value.get('authorId'):previous_authors.add(value['authorId'])
by_split={}
for row in manifest['samples']:
    assert sha(root/row['path'])==row['sha256'] and row['sha256'] not in digests
    assert row['siteId'] not in authors and row['siteId'] not in previous_authors
    evidence=read(root/row['rights']);match=re.search(r'/photos/([^/]+)/(\d+)',evidence['source']);assert match
    expected_photo=re.search(r'/(\d+)_',source_images[row['cocoId']]['flickr_url']).group(1)
    assert match[2]==expected_photo,'Rights refer to a different source photograph'
    assert match[2] not in photos and match[2] not in previous_photos and match[1] not in previous_authors
    assert evidence['license']=='https://creativecommons.org/licenses/by/2.0/' and evidence['humanApproval'] is False
    photos.add(match[2]);authors.add(row['siteId']);digests.add(row['sha256'])
    assert scene_groups.setdefault(row['sceneId'],row['split'])==row['split']
    sig=dhash(root/row['path']);assert not any(int((sig!=other).sum())<=4 for other in signatures+previous_signatures);signatures.append(sig)
    for obj in row['objects']:
        ref=refs[obj['id']];assert ref['image_id']==row['cocoId'] and cats[ref['category_id']]==obj['class']
        expected=[ref['bbox'][0]/row['width'],ref['bbox'][1]/row['height'],ref['bbox'][2]/row['width'],ref['bbox'][3]/row['height']]
        assert all(abs(x-y)<1e-9 for x,y in zip(expected,obj['box']))
    by_split.setdefault(row['split'],dict(images=0,objects=0,classes=Counter()))
    by_split[row['split']]['images']+=1;by_split[row['split']]['objects']+=len(row['objects']);by_split[row['split']]['classes'].update(o['class'] for o in row['objects'])
result=dict(passed=True,manifestSha256=sha(root/'manifest.json'),images=len(authors),groupsSourceSeparated=True,priorEvaluationSourceOverlap=False,nearDuplicatesAtHamming4=False,categoryAndBoxReferencesVerified=True,annotationsDerivedFromModel=False,humanApprovalsCreated=0,bySplit=by_split,limitations=manifest['limitations'])
(root/'data-audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
