"""Pinned public research-licensed BDD2018 images + original per-image JSON.
One filename-prefix group per cohort image; no Flickr traffic, no model predictions.
"""
from pathlib import Path
from collections import Counter
import hashlib,io,json,re,sys,time
from PIL import Image
from sources import ROOT,BDD_REV,BDD_BASE,request,sha

MAPPING={'person':'person','pedestrian':'person','rider':'person','car':'car','truck':'truck','bus':'bus','train':'train','motor':'motorcycle','motorcycle':'motorcycle','bike':'bicycle','bicycle':'bicycle','traffic light':'traffic light'}
SCOPES=sorted(set(MAPPING.values()))
root=ROOT;root.mkdir(parents=True,exist_ok=True)
if (root/'cohort-lock.json').exists():raise ValueError('Dataset is frozen')
for folder in ['images','rights','source-labels','assets/bdd-index']:(root/folder).mkdir(parents=True,exist_ok=True)
plan=dict(seed='basira-object-v2-20261025',targets={'train':160,'validation':32,'test':40},
    source='BDD2018 original JSON via pinned public redistribution',group='at most one image for each first8 filename prefix; never split prefix across roles',
    final='mirror/test from original official val, not used for settings',licence='Berkeley research/not-for-profit only; commercial eligibility NOT granted',
    annotationScope=SCOPES,excludedMapping='traffic sign is NOT COCO stop sign',modelUseForSelection=False)
plan_path=root/'bdd-plan.json'
if plan_path.exists():assert json.loads(plan_path.read_text())==plan
else:plan_path.write_text(json.dumps(plan,indent=2),encoding='utf-8')
journal=root/'bdd-acquisition.jsonl'
rows=[json.loads(l) for l in journal.read_text(encoding='utf-8').splitlines()] if journal.exists() else []
groups={r['groupId'] for r in rows};counts=Counter(r['split'] for r in rows)
def listing(split,shard):
    name=f'{split}-shard_{shard:03d}.json';path=root/'assets/bdd-index'/name
    if not path.exists():
        url=f'https://huggingface.co/api/datasets/dronefreak/BDD100K/tree/{BDD_REV}/data/labels/100k/{split}/shard_{shard:03d}?limit=1000'
        path.write_bytes(request(url,2_000_000))
    items=json.loads(path.read_text(encoding='utf-8'))
    return [x for x in items if x['type']=='file' and x['path'].endswith('.json')]
for source_split,shards in [('test',range(3)),('train',range(9))]:
    for shard in shards:
        candidates=listing(source_split,shard)
        candidates.sort(key=lambda x:sha((plan['seed']+x['path']).encode()))
        for entry in candidates:
            name=Path(entry['path']).stem;prefix=name.split('-')[0];group='bdd-'+prefix
            if group in groups:continue
            split='test' if source_split=='test' else ('validation' if int(sha((plan['seed']+prefix).encode())[:8],16)%7==0 else 'train')
            if counts[split]>=plan['targets'][split]:continue
            raw=request(BDD_BASE+entry['path'],100_000);source=json.loads(raw)
            if source['name'].removesuffix('.jpg')!=name:raise ValueError('Annotation/photo name mismatch')
            if len(source.get('frames',[]))!=1:raise ValueError('Ambiguous frame reference')
            objects=[o for o in source['frames'][0]['objects'] if 'box2d' in o and o['category'] in MAPPING]
            # Prefer meaningful positives, including small/occluded instances; never score with a model.
            if not objects:continue
            image_path=entry['path'].replace('data/labels/','data/images_100k/').removesuffix('.json')+'.jpg'
            original=request(BDD_BASE+image_path,3_000_000);image=Image.open(io.BytesIO(original)).convert('RGB')
            if image.size!=(1280,720):raise ValueError('BDD expected1280x720')
            converted=[]
            for obj in objects:
                b=obj['box2d'];x,y=max(0.,float(b['x1'])),max(0.,float(b['y1']));right,bottom=min(1280.,float(b['x2'])),min(720.,float(b['y2']))
                if not right>x or not bottom>y:raise ValueError('Invalid original BDD box')
                converted.append(dict(id=f"bdd-{name}-{obj['id']}",**{'class':MAPPING[obj['category']]},box=[x/1280,y/720,(right-x)/1280,(bottom-y)/720],area=(right-x)*(bottom-y),iscrowd=0,sourceClass=obj['category'],attributes=obj.get('attributes',{})))
            image_id='bdd-'+name;path=f'images/{image_id}.png';image.save(root/path)
            annotation=f'source-labels/{image_id}.json';(root/annotation).write_bytes(raw)
            rights=f'rights/{image_id}.json';(root/rights).write_text(json.dumps(dict(source=BDD_BASE+image_path,annotation=BDD_BASE+entry['path'],dataset='BDD100K2018',mirrorRevision=BDD_REV,originalPublisher='UC Berkeley/BAIR',licence='BDD100K-data-licence',licenceFile='assets/bdd-data-license.rst',useScope='local_research_not_for_profit',commercialUseEligible=False,humanApproval=False,originalImageSha256=sha(original)),indent=2),encoding='utf-8')
            row=dict(id=image_id,path=path,sha256=sha((root/path).read_bytes()),width=1280,height=720,split=split,source='bdd100k',groupId=group,sceneId=group,bucket='crowded' if len(converted)>=8 else 'simple',completeLabels=False,annotatedClasses=SCOPES,objects=converted,rights=rights,sourceAnnotation=annotation,sourceAnnotationSha256=sha(raw),attributes=source.get('attributes',{}),referenceSource='published human BDD2018 original JSON, not detector output')
            with journal.open('a',encoding='utf-8') as f:f.write(json.dumps(row)+'\n')
            rows.append(row);groups.add(group);counts[split]+=1
            if len(rows)%10==0:print(json.dumps(dict(source='BDD',images=len(rows),counts=dict(counts))),flush=True)
            time.sleep(.15)
            if all(counts[k]>=v for k,v in plan['targets'].items()):break
        if all(counts[k]>=v for k,v in plan['targets'].items()):break
        if source_split=='test' and counts['test']>=plan['targets']['test']:break
    if all(counts[k]>=v for k,v in plan['targets'].items()):break
print(json.dumps(dict(source='BDD',counts=dict(counts),targetReached=all(counts[k]>=v for k,v in plan['targets'].items()))))
