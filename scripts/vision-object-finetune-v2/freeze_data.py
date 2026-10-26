"""Freeze actual licensed mixed data and public independent references; no predictions."""
from pathlib import Path
from collections import Counter
import hashlib,json,shutil,sys
import numpy as np
from PIL import Image
from sources import ROOT,sha
root=ROOT
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
assert not (root/'cohort-lock.json').exists() and not (root/'training').exists()
rows=[]
for name in ['bdd-acquisition.jsonl','ycb-acquisition.jsonl']:
    rows.extend(json.loads(l) for l in (root/name).read_text(encoding='utf-8').splitlines())
old=root.parent/'object-finetune-v1-001';old_manifest=read(old/'manifest.json')
for row in old_manifest['samples']:
    if row['split']=='test':continue
    item={**row,'id':'coco-'+row['id'],'source':'coco-replay','groupId':'coco-author-'+row['siteId'],'completeLabels':True,'sourceRole':'training replay' if row['split']=='train' else 'previous validation regression, not fresh final'}
    image_path='images/'+item['id']+'.png';rights='rights/'+item['id']+'.json'
    shutil.copyfile(old/row['path'],root/image_path);shutil.copyfile(old/row['rights'],root/rights)
    item.update(path=image_path,rights=rights)
    rows.append(item)
assert len([r for r in rows if r['source']=='bdd100k' and r['split']=='train'])>=100,'Not enough independent road scenes to justify expansion'
assert len([r for r in rows if r['source']=='ycb-video' and r['split']=='train'])>=40
names=sorted(read(root.parent/'object-quality-002/assets/instances_val2017.json')['categories'],key=lambda c:c['id'])
class_names=[c['name'] for c in names];groups={};hashes=set();signatures=[];audit_counts=Counter()
def dhash(path):
    a=np.asarray(Image.open(path).convert('L').resize((9,8)));return (a[:,1:]>a[:,:-1]).flatten()
prior_final=[]
for folder in ['object-colors-001','object-colors-development-001','object-quality-002','object-finetune-v1-001']:
    p=root.parent/folder
    for r in read(p/'manifest.json')['samples']:
        if folder=='object-finetune-v1-001' and r['split']!='test':continue
        prior_final.append((r['sha256'],dhash(p/r['path'])))
for row in rows:
    raw=(root/row['path']).read_bytes();assert sha(raw)==row['sha256'] and row['sha256'] not in hashes
    sig=dhash(root/row['path']);assert not any(d==row['sha256'] or int((sig!=s).sum())<=4 for d,s in prior_final),'Old protected image/near duplicate'
    assert groups.setdefault(row['groupId'],row['split'])==row['split'],'Group leakage'
    hashes.add(row['sha256']);signatures.append((row['id'],row['split'],sig))
    rights=read(root/row['rights']);assert rights['humanApproval'] is False
    assert rights.get('licence',rights.get('license')) in ['MIT','BDD100K-data-licence','https://creativecommons.org/licenses/by/2.0/']
    for obj in row['objects']:
        assert obj['class'] in class_names
        x,y,w,h=obj['box'];assert all(np.isfinite([x,y,w,h])) and x>=0 and y>=0 and w>0 and h>0 and x+w<=1.00001 and y+h<=1.00001
    audit_counts[row['source']+'/'+row['split']]+=1
near=[]
for i,(a,split,sig) in enumerate(signatures):
    for b,other,second in signatures[i+1:]:
        if split!=other and int((sig!=second).sum())<=4:near.append([a,b])
assert not near,'Cross-split near duplicate'
for split in ['train','validation','test']:
    assert any(r['split']==split for r in rows)
protocol=dict(schemaVersion=2,study='Basira object fine-tune V2',dataCounts=dict(audit_counts),syntheticImages=0,
    selection='validation only: source-balanced macroF1 at confidence .5, then source-balanced AP; final never tunes settings',
    candidates=[dict(id='head-standard',initial='V1',lr=1e-5,predictorsOnly=False,scopedNegativeWeight=0.),dict(id='head-scoped-negatives',initial='V1',lr=1e-5,predictorsOnly=False,scopedNegativeWeight=.5),dict(id='predictors-scoped-negatives',initial='V1',lr=3e-5,predictorsOnly=True,scopedNegativeWeight=.5)],
    maxEpochsPerCandidate=6,earlyStopPatience=2,threads=2,maxTrainingSeconds=2700,maxRssMiB=6144,maxDiskMiB=6144,
    imagePreprocess='Exact deployed OffscreenCanvas 416 BGR floats, letterbox114; no PIL resizing',
    partialLabels='Supervise mapped independent positives; unknown labels are not background GT; teacher scores only regularize, never become reference labels',
    defaultConfidence=.5,commercialUseEligible=False,researchOnlyData=True,finalTestUse='once after immutable validation selection')
(root/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
manifest=dict(schemaVersion=4,samples=rows,categories=names,trainingUse='train_only',inferenceUsedForSelection=False,licenceRestrictions=['BDD data permits research/not-for-profit, commercial use not granted'],limitations=['YCB views share physical object instances and possibly one lab site.','BDD first8 prefix groups reduce sequence overlap; distinct locations are not guaranteed.','Mixed partial labels: only declared classes are evaluable on each source.','COCO validation replay is old validation, not independent final.'])
path=root/'manifest.json';path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
reference_paths={}
for split in ['train','validation','test']:
    selected=[r for r in rows if r['split']==split];images=[];annotations=[];annotation_id=1
    for i,row in enumerate(selected,1):
        images.append(dict(id=i,width=row['width'],height=row['height'],file_name=row['path'],rowId=row['id']))
        for obj in row['objects']:
            x,y,w,h=obj['box'];annotations.append(dict(id=annotation_id,image_id=i,category_id=next(c['id'] for c in names if c['name']==obj['class']),bbox=[x*row['width'],y*row['height'],w*row['width'],h*row['height']],area=obj['area'],iscrowd=obj['iscrowd']));annotation_id+=1
    target=root/'references'/f'{split}.coco.json';target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(dict(info={'description':'mixed scoped independent references'},categories=names,images=images,annotations=annotations)),encoding='utf-8');reference_paths[split]=sha(target.read_bytes())
(root/'cohort-lock.json').write_text(json.dumps(dict(manifestSha256=sha(path.read_bytes()),protocolSha256=sha((root/'protocol.json').read_bytes()),createdBeforeTrainingAndInference=True,counts=dict(audit_counts),referenceFiles=reference_paths),indent=2),encoding='utf-8')
(root/'data-audit.json').write_text(json.dumps(dict(passed=True,images=len(rows),sourceGroups=len(groups),counts=dict(audit_counts),crossSplitNearDuplicates=near,humanApprovalsCreated=0,commercialUseEligible=False),indent=2),encoding='utf-8')
# Reuse audited official architecture/checkpoint, never overwrite old experiments.
for item in (old/'assets/upstream').rglob('*'):
    if item.is_file() and '__pycache__' not in item.parts:
        dest=root/'assets/upstream'/item.relative_to(old/'assets/upstream');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(item,dest)
for name in ['upstream.json','yolox_tiny.pth']:shutil.copyfile(old/'assets'/name,root/'assets'/name)
print(json.dumps(dict(frozen=True,images=len(rows),counts=dict(audit_counts),groups=len(groups))))
