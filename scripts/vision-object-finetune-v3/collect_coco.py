"""Bounded fresh COCO cohort: current original-source CC BY verified per image.
Stops on rate limiting, never swaps hosts to evade it. Independent published GT.
"""
from pathlib import Path
from collections import Counter,defaultdict
import hashlib,io,json,re,time,urllib.request,urllib.error
from PIL import Image
from rights import ROOT,read,sha

root=ROOT
assert not (root/'cohort-lock.json').exists()
for folder in ['images','rights','rights-evidence/coco-pages','source-labels']:(root/folder).mkdir(parents=True,exist_ok=True)
data=read(root.parent/'object-quality-002/assets/instances_val2017.json')
names={c['id']:c['name'] for c in data['categories']};objects=defaultdict(list)
for item in data['annotations']:objects[item['image_id']].append(item)
excluded=set();excluded_authors=set()
for folder in ['object-colors-001','object-colors-development-001','object-quality-002','object-finetune-v1-001']:
    source=root.parent/folder
    for row in read(source/'manifest.json')['samples']:
        if row.get('cocoId') is not None:excluded.add(row['cocoId'])
        if row.get('siteId'):excluded_authors.add(row['siteId'].removeprefix('flickr-'))
    for directory in ['rights','license-evidence']:
        if (source/directory).exists():
            for p in (source/directory).glob('*.json'):
                j=read(p)
                if j.get('authorId'):excluded_authors.add(j['authorId'])
targets=['chair','dining table','cup','bottle','backpack','handbag','couch','bed',
    'traffic light','person','bicycle','cell phone','laptop','book','clock','sink','toilet']
target_counts={'train':96,'validation':24,'test':32}
plan=dict(seed='basira-v3-clean-coco-20261026',targets=target_counts,classes=targets,
    selection='Published independent GT and current CC BY rights only; no model inference',
    grouping='One new author per image; hash author assigns split; old cohort authors excluded',
    commercialTrainingAllowed=True)
plan_file=root/'coco-plan.json'
if plan_file.exists():assert read(plan_file)==plan
else:plan_file.write_text(json.dumps(plan,indent=2),encoding='utf-8')
journal=root/'coco-acquisition.jsonl'
rows=[json.loads(l) for l in journal.read_text().splitlines()] if journal.exists() else []
counts=Counter(r['split'] for r in rows);class_counts=Counter(c for r in rows for c in {o['class'] for o in r['objects']})
owners={r['groupId'].removeprefix('flickr-') for r in rows};done={int(r['cocoId']) for r in rows}
rejections=root/'coco-rejections.jsonl'
if rejections.exists():
    done|={j['cocoId'] for j in map(json.loads,rejections.read_text().splitlines()) if j['reason']!='HTTP_429'}
digest=lambda b:hashlib.sha256(b).hexdigest()
candidates=[im for im in data['images'] if im['license']==4 and im['id'] not in excluded|done
    and not any(o['iscrowd'] for o in objects[im['id']]) and {names[o['category_id']] for o in objects[im['id']]}&set(targets)]
seed_order=lambda im:digest((plan['seed']+str(im['id'])).encode())
candidates.sort(key=seed_order)
started=time.monotonic();attempts=0
while candidates and any(counts[k]<v for k,v in target_counts.items()) and attempts<350 and time.monotonic()-started<1800:
    # Prioritise scarce requested classes; this uses labels, never a detector score.
    needed=min(targets,key=lambda c:class_counts[c])
    index=next((i for i,im in enumerate(candidates) if needed in {names[o['category_id']] for o in objects[im['id']]}),0)
    im=candidates.pop(index);attempts+=1;photo=re.search(r'/(\d+)_',im['flickr_url']).group(1)
    try:
        request=urllib.request.Request('https://www.flickr.com/photo.gne?id='+photo,headers={'User-Agent':'BasiraResearch/3'})
        with urllib.request.urlopen(request,timeout=25) as response:page=response.read(2_500_001);landing=response.url
        if len(page)>2_500_000:raise ValueError('source_page_budget')
        text=page.decode();landed=re.search(r'/photos/[^/]+/(\d+)',landing)
        if not landed or landed.group(1)!=photo:raise ValueError('source_photo_mismatch')
        if not re.search(r'"license"\s*:\s*"https://creativecommons.org/licenses/by/2\.0/"',text):raise ValueError('current_CC_BY_not_verified')
        author=json.loads(re.search(r'"author"\s*:\s*(\{[^}]+\})',text).group(1))
        canonical=re.search(r'buddyicons/(\d+@N\d+)',author.get('image',''))
        owner=canonical.group(1) if canonical else author['url'].rstrip('/').split('/')[-1]
        alias=author['url'].rstrip('/').split('/')[-1]
        if owner in owners|excluded_authors or alias in excluded_authors:raise ValueError('previous_or_repeated_author')
        code=int(digest((plan['seed']+owner).encode())[:8],16)%10
        split='train' if code<6 else 'validation' if code<8 else 'test'
        if counts[split]>=target_counts[split]:continue
        url='https://s3.amazonaws.com/images.cocodataset.org/val2017/'+im['file_name']
        with urllib.request.urlopen(url,timeout=30) as response:raw=response.read(4_000_001)
        if len(raw)>4_000_000:raise ValueError('image_byte_budget')
        image=Image.open(io.BytesIO(raw)).convert('RGB');assert image.size==(im['width'],im['height'])
        image_id='coco-'+str(im['id']);path='images/'+image_id+'.png';image.save(root/path)
        licence_path=f'rights-evidence/coco-pages/{image_id}.html';(root/licence_path).write_bytes(page)
        rights=f'rights/{image_id}.json';reference=f'source-labels/{image_id}.json'
        (root/reference).write_text(json.dumps(dict(image=im,annotations=objects[im['id']]),indent=2))
        (root/rights).write_text(json.dumps(dict(source=landing,author=author['name'],authorId=owner,
            authorUrl=author['url'],imageSource=url,licenseId='CC-BY-2.0',licenseUrl='https://creativecommons.org/licenses/by/2.0/',
            licenceEvidence=licence_path,licenceEvidenceSha256=digest(page),commercialTrainingAllowed=True,
            originalImageSha256=digest(raw),humanApproval=False,changes='RGB PNG, EXIF omitted'),indent=2),encoding='utf-8')
        converted=[]
        for o in objects[im['id']]:
            x,y,w,h=o['bbox'];assert x>=0 and y>=0 and w>0 and h>0 and x+w<=image.width+.01 and y+h<=image.height+.01
            converted.append(dict(id=str(o['id']),categoryId=o['category_id'],**{'class':names[o['category_id']]},
                box=[x/image.width,y/image.height,w/image.width,h/image.height],area=o['area'],iscrowd=0))
        row=dict(id=image_id,cocoId=im['id'],path=path,sha256=sha(root/path),width=image.width,height=image.height,
            split=split,source='coco-commercial',groupId='flickr-'+owner,completeLabels=True,objects=converted,rights=rights,
            sourceAnnotation=reference,referenceSource='published original COCO human annotations, not model predictions',
            bucket='crowded' if len(converted)>=8 else 'simple')
        with journal.open('a',encoding='utf-8') as out:out.write(json.dumps(row)+'\n')
        rows.append(row);owners.add(owner);counts[split]+=1;class_counts.update({o['class'] for o in converted})
        if len(rows)%5==0:print(json.dumps(dict(source='COCO',images=len(rows),counts=dict(counts),attempts=attempts)),flush=True)
    except (ValueError,urllib.error.HTTPError,urllib.error.URLError) as e:
        reason='HTTP_'+str(e.code) if isinstance(e,urllib.error.HTTPError) else str(e) if isinstance(e,ValueError) else 'network_error'
        with rejections.open('a',encoding='utf-8') as out:out.write(json.dumps(dict(cocoId=im['id'],reason=reason))+'\n')
        if reason=='HTTP_429':
            print(json.dumps(dict(stopped='HTTP_429',retryAfterHonouredByStopping=True,counts=dict(counts))),flush=True);break
    time.sleep(1)
print(json.dumps(dict(source='COCO',counts=dict(counts),attempts=attempts,targetReached=all(counts[k]>=v for k,v in target_counts.items()))),flush=True)
