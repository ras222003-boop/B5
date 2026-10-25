"""Freeze the rights-verified acquisition journal before training, even if source is rate-limited."""
from pathlib import Path
from collections import Counter
import hashlib,json,sys
from PIL import Image
root=Path(sys.argv[1]).resolve()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert not (root/'cohort-lock.json').exists() and not (root/'training').exists()
rows=[json.loads(line) for line in (root/'acquisition.jsonl').read_text(encoding='utf-8').splitlines()]
counts=Counter(r['split']+'/'+r['bucket'] for r in rows)
assert len({r['siteId'] for r in rows})==len(rows)==len({r['sha256'] for r in rows})
for split,minimum in [('train',12),('validation',6),('test',6)]:assert sum(r['split']==split for r in rows)>=minimum
for row in rows:
    assert sha(root/row['path'])==row['sha256']
    rights=read(root/row['rights'])
    assert rights['license']=='https://creativecommons.org/licenses/by/2.0/' and rights['humanApproval'] is False
    assert Image.open(root/row['path']).size==(row['width'],row['height'])
data=read(root/'assets/instances_val2017.json')
plan_path=root/'protocol.json';original=read(plan_path)
(root/'acquisition-protocol.json').write_bytes(plan_path.read_bytes())
plan={**original,'counts':dict(counts),'pilotImages':8,'acquisitionPlanSha256':sha(root/'acquisition-protocol.json'),
    'amendment':'Before any cohort inference/training: Flickr HTTP429 prevented target112. Freeze all36 currently rights-verified images; original grouping/seed/references preserved. Pilot8 then18 if validation improves. No final predictions consulted.'}
plan_path.write_text(json.dumps(plan,indent=2),encoding='utf-8')
manifest=dict(schemaVersion=3,samples=rows,annotationSha256=sha(root/'assets/instances_val2017.json'),protocolSha256=sha(plan_path),inferenceUsedForSelection=False,trainingUse='train_split_only',limitations=['36-photo pilot, not population accuracy or standard COCO benchmark.','Pretrained publisher may have tuned on public COCO val images.','Author separation does not prove different physical sites.','No manufactured privacy consent, human approval, colour or video identity labels.'])
path=root/'manifest.json';path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
for split in ['train','validation','test']:
    ids={r['cocoId'] for r in rows if r['split']==split}
    subset=dict(info={'description':'Basira pilot independent COCO reference'},licenses=data['licenses'],categories=data['categories'],images=[im for im in data['images'] if im['id'] in ids],annotations=[a for a in data['annotations'] if a['image_id'] in ids])
    (root/'references'/f'{split}.coco.json').write_text(json.dumps(subset),encoding='utf-8')
lock=dict(manifestSha256=sha(path),protocolSha256=sha(plan_path),createdBeforeTrainingAndInference=True,counts=dict(counts),referenceFiles={s:sha(root/'references'/f'{s}.coco.json') for s in ['train','validation','test']})
(root/'cohort-lock.json').write_text(json.dumps(lock,indent=2),encoding='utf-8');print(json.dumps(lock))
