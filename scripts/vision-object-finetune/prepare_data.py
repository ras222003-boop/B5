"""Real CC BY images with independent COCO annotations. Freeze before any model use.
One canonical Flickr author per image; all previous evaluation authors excluded.
Incremental journal permits bounded acquisition to resume without replacing evidence.
"""
from pathlib import Path
from collections import Counter
import hashlib, io, json, re, shutil, sys, time, urllib.request, urllib.error
import numpy as np
from PIL import Image

root = Path(sys.argv[1]).resolve()
previous = root.parent/'object-quality-002'
root.mkdir(parents=True, exist_ok=True)
read = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
sha = lambda b: hashlib.sha256(b).hexdigest()
if (root/'cohort-lock.json').exists():
    raise ValueError('Dataset frozen; acquisition cannot replace it')
plan = dict(schemaVersion=1, seed='basira-object-finetune-v1-20261025',
    counts={'train/simple':32, 'train/crowded':32, 'validation/simple':12, 'validation/crowded':12, 'test/simple':12, 'test/crowded':12},
    group='One canonical Flickr author per image; exclude all prior cohorts and authors',
    dataSource='New licensed COCO val2017 subset repartitioned locally; NOT standard COCO benchmark',
    references='Original COCO 80 class IDs and boxes, independent of any detector; no human approval manufactured',
    syntheticImages=0, trainingBudget=dict(threads=2, maxSeconds=1800, maxRssMiB=4096, maxDiskMiB=2048, maxEpochs=12),
    pilotImages=16, pilotEpochs=2, expandOnlyIf='validation F1 at fixed .5 exceeds initialization; no final access',
    selection='Best validation F1 at fixed confidence .5, then AP; frozen before final test',
    finalUse='Once after model selection; no settings chosen from final errors')
plan_path = root/'protocol.json'
if plan_path.exists():
    assert read(plan_path) == plan
else:
    plan_path.write_text(json.dumps(plan, indent=2), encoding='utf-8')
for folder in ['assets', 'images', 'rights', 'references']:
    (root/folder).mkdir(exist_ok=True)
annotations = root/'assets/instances_val2017.json'
if not annotations.exists():
    shutil.copyfile(previous/'assets/instances_val2017.json', annotations)
data = read(annotations)
categories = {c['id']:c['name'] for c in data['categories']}
assert len(categories) == 80
by = {}
for a in data['annotations']:
    by.setdefault(a['image_id'], []).append(a)
excluded_authors, excluded_photos, excluded_hashes, old_signatures = set(), set(), set(), []
def dhash(image):
    a = np.asarray(image.convert('L').resize((9,8)))
    return (a[:,1:] > a[:,:-1]).flatten()
prior_names=['object-colors-001', 'object-colors-development-001', 'object-quality-002']
prior_names += [p.name for p in root.parent.glob('object-finetune-*') if p.resolve()!=root and (p/'manifest.json').exists()]
for name in prior_names:
    old = root.parent/name
    manifest = read(old/'manifest.json')
    for row in manifest['samples']:
        excluded_hashes.add(row['sha256'])
        old_signatures.append(dhash(Image.open(old/row['path'])))
        if row.get('siteId'):
            excluded_authors.add(row['siteId'].removeprefix('flickr-'))
    for directory in ['rights','license-evidence']:
        for p in (old/directory).glob('*.json'):
            evidence=read(p); match=re.search(r'/photos/([^/]+)/(\d+)', evidence.get('source',''))
            if match:
                excluded_authors.add(match[1]); excluded_photos.add(match[2])
            if evidence.get('authorId'):
                excluded_authors.add(evidence['authorId'])
journal = root/'acquisition.jsonl'
selected = [json.loads(line) for line in journal.read_text(encoding='utf-8').splitlines()] if journal.exists() else []
authors = {r['siteId'] for r in selected}
done = {r['id'] for r in selected}
if (root/'rejections.jsonl').exists():
    for line in (root/'rejections.jsonl').read_text(encoding='utf-8').splitlines():
        failure=json.loads(line)
        if failure['reason'] in ['Current CC BY not verified','Near-duplicate excluded','Invalid reference box']:
            done.add(str(failure['id']))
counts = Counter(r['split']+'/'+r['bucket'] for r in selected)
signatures = [dhash(Image.open(root/r['path'])) for r in selected]
targets = ['person','chair','dining table','bottle','cup','car','backpack','handbag','bicycle','couch','bed','traffic light']
candidates = [im for im in data['images'] if im['license']==4 and not any(a['iscrowd'] for a in by.get(im['id'],[]))]
candidates.sort(key=lambda im: sha((plan['seed']+str(im['id'])).encode()))
def fetch(url, limit):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BasiraResearch/3'}),timeout=20) as r:
                raw=r.read(limit+1); landing=r.url
            break
        except urllib.error.HTTPError as e:
            if e.code!=429 or attempt==2:raise
            delay=min(60,max(20,int(e.headers.get('Retry-After','30'))))
            print(json.dumps(dict(rateLimited=True,retryAfterSeconds=delay)),flush=True)
            time.sleep(delay)
    if len(raw)>limit: raise ValueError('Download budget')
    return raw,landing
for index, im in enumerate(candidates):
    if str(im['id']) in done: continue
    ann = by.get(im['id'],[])
    bucket = 'simple' if 1<=len(ann)<=3 else 'crowded' if len(ann)>=8 else None
    if bucket is None or all(counts[s+'/'+bucket]>=plan['counts'][s+'/'+bucket] for s in ['train','validation','test']): continue
    labels = {categories[a['category_id']] for a in ann}
    if not labels.intersection(targets): continue
    needed = {targets[counts[s+'/'+bucket]%len(targets)] for s in ['train','validation','test'] if counts[s+'/'+bucket]<plan['counts'][s+'/'+bucket]}
    if index<700 and not labels.intersection(needed): continue
    photo = re.search(r'/(\d+)_', im['flickr_url']).group(1)
    if photo in excluded_photos: continue
    try:
        page,landing=fetch('https://www.flickr.com/photo.gne?id='+photo,2_500_000)
        time.sleep(.5)
        landed=re.search(r'/photos/[^/]+/(\d+)',landing)
        if not landed or landed.group(1)!=photo:raise ValueError('Licence page is not the requested source photo')
        text=page.decode('utf-8')
        if not re.search(r'"license"\s*:\s*"https://creativecommons.org/licenses/by/2\.0/"',text): raise ValueError('Current CC BY not verified')
        author=json.loads(re.search(r'"author"\s*:\s*(\{[^}]+\})',text).group(1))
        canonical=re.search(r'buddyicons/(\d+@N\d+)',author.get('image',''))
        owner=canonical.group(1) if canonical else author['url'].rstrip('/').split('/')[-1]
        alias=author['url'].rstrip('/').split('/')[-1]
        if owner in excluded_authors or alias in excluded_authors or owner in authors: continue
        code=int(sha((plan['seed']+owner).encode())[:8],16)%14
        split='train' if code<8 else 'validation' if code<11 else 'test'
        key=split+'/'+bucket
        if counts[key]>=plan['counts'][key]: continue
        if index<700 and targets[counts[key]%len(targets)] not in labels: continue
        raw,url=fetch('https://s3.amazonaws.com/images.cocodataset.org/val2017/'+im['file_name'],3_000_000)
        image=Image.open(io.BytesIO(raw)).convert('RGB')
        if image.size!=(im['width'],im['height']): raise ValueError('Dimensions differ from reference')
        sig=dhash(image)
        if any(int((sig!=old).sum())<=4 for old in old_signatures+signatures): raise ValueError('Near-duplicate excluded')
        path='images/'+str(im['id'])+'.png'; image.save(root/path)
        digest=sha((root/path).read_bytes())
        if digest in excluded_hashes: raise ValueError('Prior image hash')
        objects=[]
        for a in ann:
            x,y,w,h=a['bbox']
            if not (w>0 and h>0 and x>=0 and y>=0 and x+w<=image.width+.01 and y+h<=image.height+.01): raise ValueError('Invalid reference box')
            objects.append(dict(id=str(a['id']),categoryId=a['category_id'],**{'class':categories[a['category_id']]},box=[x/image.width,y/image.height,w/image.width,h/image.height],area=a['area'],iscrowd=0))
        evidence=dict(source=landing, author=author['name'], authorId=owner, authorUrl=author['url'],license='https://creativecommons.org/licenses/by/2.0/',sourcePageSha256=sha(page),imageSource=url,originalImageSha256=sha(raw),humanApproval=False,rightsBasis='Public CC BY declaration; not a consent or sensitive-use approval',changes='RGB PNG at original dimensions; EXIF omitted')
        rights='rights/'+str(im['id'])+'.json'; (root/rights).write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
        row=dict(id=str(im['id']),cocoId=im['id'],path=path,sha256=digest,width=image.width,height=image.height,siteId=owner,sceneId='coco-'+str(im['id']),split=split,bucket=bucket,rights=rights,referenceSource='COCO_original_annotation_not_model_prediction',objects=objects)
        with journal.open('a',encoding='utf-8') as out: out.write(json.dumps(row,ensure_ascii=False)+'\n')
        selected.append(row); authors.add(owner); signatures.append(sig); counts[key]+=1
        print(json.dumps(dict(id=im['id'],counts=dict(counts),objects=len(ann))),flush=True)
        if all(counts[k]==v for k,v in plan['counts'].items()): break
    except Exception as e:
        with (root/'rejections.jsonl').open('a',encoding='utf-8') as out: out.write(json.dumps(dict(id=im['id'],reason=str(e)))+'\n')
        print(json.dumps(dict(rejected=im['id'],reason=str(e))),flush=True)
        if isinstance(e,urllib.error.HTTPError) and e.code==429:
            raise RuntimeError('Source rate limited; journal retained. Retry later or freeze the verified available subset.') from e
if any(counts[k]!=v for k,v in plan['counts'].items()): raise ValueError('Acquisition incomplete; resume from journal, no training approval invented')
manifest=dict(schemaVersion=3,samples=selected,annotationSha256=sha(annotations.read_bytes()),protocolSha256=sha(plan_path.read_bytes()),inferenceUsedForSelection=False,trainingUse='train_split_only',limitations=['Small public COCO subset, publishers may have tuned on these images.','Author grouping does not prove separate physical locations.','Public licence is not a privacy/consent approval.','No independent human colour or video identity labels.'])
path=root/'manifest.json'; path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
for split in ['train','validation','test']:
    ids={r['cocoId'] for r in selected if r['split']==split}
    subset=dict(info={'description':'Basira independent-reference local subset'},licenses=data['licenses'],categories=data['categories'],images=[im for im in data['images'] if im['id'] in ids],annotations=[a for a in data['annotations'] if a['image_id'] in ids])
    (root/'references'/f'{split}.coco.json').write_text(json.dumps(subset),encoding='utf-8')
(root/'cohort-lock.json').write_text(json.dumps(dict(manifestSha256=sha(path.read_bytes()),protocolSha256=manifest['protocolSha256'],createdBeforeTrainingAndInference=True,counts=dict(counts),referenceFiles={s:sha((root/'references'/f'{s}.coco.json').read_bytes()) for s in ['train','validation','test']}),indent=2),encoding='utf-8')
print(json.dumps(dict(frozen=True,counts=dict(counts),images=len(selected))))
