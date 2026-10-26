"""Freeze licensed source/scene roles before any V3 cohort model inference."""
from collections import Counter,defaultdict
from pathlib import Path
import json,shutil
import numpy as np
from PIL import Image
from rights import ROOT,read,sha,check_row,check_initial

root=ROOT;assert not (root/'cohort-lock.json').exists()
rows=read(root/'clean-reuse.json')+read(root/'ycb-hard.json')+read(root/'uroac-grouped.json')
rows += [json.loads(l) for l in (root/'coco-acquisition.jsonl').read_text().splitlines()]
audit=read(root/'rights-audit.json');check_initial(root/'assets/yolox_tiny.pth',audit)
categories=read(root.parent/'object-quality-002/assets/instances_val2017.json')['categories'];categories.sort(key=lambda c:c['id'])
names={c['name'] for c in categories};assignments={};hashes=set();signatures=[];dropped=[];accepted=[]
def dhash(path):
    x=np.asarray(Image.open(path).convert('L').resize((9,8)));return (x[:,1:]>x[:,:-1]).flatten()
# Held-out rows take priority. No model outputs are involved in duplicate exclusion.
rows.sort(key=lambda r:({'test':0,'validation':1,'train':2}[r['split']],r['source'],r['id']))
for row in rows:
    check_row(root,row);key=(row['source'],row['groupId'])
    assert assignments.setdefault(key,row['split'])==row['split'],'Source group crossed roles'
    signature=dhash(root/row['path'])
    reason='exact_duplicate' if row['sha256'] in hashes else 'cross_split_near_duplicate' if any(s!=row['split'] and int((signature!=v).sum())<=6 for s,v in signatures) else None
    if reason:dropped.append(dict(id=row['id'],reason=reason));continue
    for o in row['objects']:
        assert o['class'] in names
        x,y,w,h=o['box'];assert all(np.isfinite([x,y,w,h])) and x>=0 and y>=0 and w>0 and h>0 and x+w<=1.00001 and y+h<=1.00001
    row['trainingEligible']=row['split']=='train';row['commercialTrainingAllowed']=True
    hashes.add(row['sha256']);signatures.append((row['split'],signature));accepted.append(row)
protected=[]
for folder in ['object-colors-001','object-colors-development-001','object-quality-002','object-finetune-v1-001','object-finetune-v2-001']:
    base=root.parent/folder
    for row in read(base/'manifest.json')['samples']:
        if row.get('split')=='test':protected.append((row['sha256'],row.get('groupId',row.get('siteId',row.get('sceneId')))))
for row in accepted:
    assert row['sha256'] not in {p[0] for p in protected},'A previous final image entered new data'
    if row['split']=='train':assert row['groupId'] not in {p[1] for p in protected},'Prior final source scene in training'
counts=Counter(r['source']+'/'+r['split'] for r in accepted)
assert sum(r['split']=='train' for r in accepted)>=100,'Insufficient actual accepted data'
assert sum(r['split']=='test' for r in accepted)>=20
assert any(r['source']=='coco-commercial' and r['split']=='validation' for r in accepted)
manifest=dict(schemaVersion=5,samples=accepted,categories=categories,commercialTrainingAllowed=True,
    licenceRestrictions=['Retain original MIT/Apache/CC BY notices and per-image attributions; public licence is not private-person consent.'],
    limitations=['Source/visual groups are not verified GPS/site identities.','YCB views share physical object instances.','COCO publisher may have used public validation images in development.','UrOAC references evaluate traffic-light class only.'])
(root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
protocol=dict(schemaVersion=3,initial='original Tiny SHA-bound; no V1/V2 initialization, teacher, cache or optimizer',
    inputResolutionCandidates=[416,640],thresholdCandidates=[.35,.5,.65],
    selection='validation only; source-balanced F1 under FP<=Tiny416*.1+Tiny416+2 and mean recall>=Tiny416; then source-balanced AP',
    candidates=[dict(id='stable-head',lr=3e-6,scopedNegativeWeight=1.,stabilityWeight=.2),dict(id='adaptive-head',lr=1e-5,scopedNegativeWeight=1.,stabilityWeight=.2)],
    maxEpochsPerCandidate=3,earlyStopPatience=2,threads=2,batch=2,maxTrainingSeconds=3600,
    hardSupervisorSeconds=3660,maxRssMiB=3072,maxDiskMiB=12288,
    featureCache='Per-image FP32 on disk, load only the current batch; avoid whole-corpus RAM cache',
    dataCounts=dict(counts),syntheticImages=0,protectedFinalUsedForSelection=False,
    sourceBalance='Every train row each epoch, plus two extra passes over scarce COCO daily-object rows; exposures are not unique images',
    rightsGateSha256=sha(Path(__file__).with_name('rights.py')),metricSourceSha256=sha(Path(__file__).parent.parent/'vision-object-finetune-v2/knowledge.py'))
(root/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
(root/'references').mkdir(exist_ok=True);reference_files={}
for split in ['train','validation','test']:
    chosen=[r for r in accepted if r['split']==split];images=[];annotations=[]
    for i,row in enumerate(chosen,1):
        images.append(dict(id=i,width=row['width'],height=row['height'],file_name=row['path'],rowId=row['id']))
        for obj in row['objects']:
            x,y,w,h=obj['box'];annotations.append(dict(id=len(annotations)+1,image_id=i,
                category_id=next(c['id'] for c in categories if c['name']==obj['class']),
                bbox=[x*row['width'],y*row['height'],w*row['width'],h*row['height']],area=obj['area'],iscrowd=obj['iscrowd']))
    path=root/'references'/f'{split}.coco.json';path.write_text(json.dumps(dict(info={'description':'V3 commercially licensed, explicit partial label scope'},images=images,annotations=annotations,categories=categories)),encoding='utf-8');reference_files[split]=sha(path)
lock=dict(manifestSha256=sha(root/'manifest.json'),protocolSha256=sha(root/'protocol.json'),
    referenceFiles=reference_files,createdBeforeModelInference=True,sourceGroups=len({(r['source'],r['groupId']) for r in accepted}))
(root/'cohort-lock.json').write_text(json.dumps(lock,indent=2),encoding='utf-8')
(root/'data-audit.json').write_text(json.dumps(dict(images=len(accepted),counts=dict(counts),dropped=dropped,
    previousFinalImagesExcluded=True,rightsAccepted=True,bddImages=0,initialTinyVerified=True,humanApprovalsCreated=0),indent=2),encoding='utf-8')
print(json.dumps(dict(frozen=True,images=len(accepted),counts=dict(counts),sourceGroups=lock['sourceGroups'],dropped=len(dropped))))
