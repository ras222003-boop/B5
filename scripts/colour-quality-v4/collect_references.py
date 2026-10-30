"""Colour V4 cohort: bounded, model-independent, independent of the V3 cohort.
Usage: collect_references.py <output-root> <assets-dir>
<assets-dir> holds instances_val2017.json, attributes.json.zip, image_data.json.zip, publisher-home.html
(downloaded by the operator from the public COCO / Visual Genome sources).
Photo and attribute licences are checked separately. No training, no human approvals invented. Stops on HTTP429.
Photos from the V3 cohort (docs/vision-ai-evidence/colour-quality-v3/DATA-ATTRIBUTIONS.json) are excluded.
Earlier private cohorts that are not recorded in the repository cannot be excluded here; the colour engine
has no learned weights, so the protection that matters is freezing the algorithm before the test split is read.
"""
from pathlib import Path
from collections import defaultdict,Counter
import hashlib,io,json,re,sys,time,urllib.request,urllib.error,urllib.parse,zipfile
from PIL import Image

root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
focus=False
previous=Path(sys.argv[2]).resolve();repo=Path(__file__).resolve().parents[2];read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda b:hashlib.sha256(b).hexdigest()
if (root/'cohort-lock.json').exists():raise RuntimeError('Frozen cohort must not be overwritten')
for name in ['images','rights','references']:(root/name).mkdir(exist_ok=True)
coco_path=previous/'instances_val2017.json';coco=read(coco_path)
attrs_path=previous/'attributes.json.zip';meta_path=attrs_path.with_name('image_data.json.zip')
publisher=attrs_path.with_name('publisher-home.html');assert 'creativecommons.org/licenses/by/4.0' in publisher.read_text()
excluded=set();old_groups=set()
v3=read(repo/'docs/vision-ai-evidence/colour-quality-v3/DATA-ATTRIBUTIONS.json')['photos']
for row in v3:
    excluded.add(int(row['imageId'][5:]));old_groups.add(row['source'].rstrip('/').split('/')[-2])
for directory in []:
    manifest=directory/'manifest.json'
    if manifest.is_file():
        try:old=read(manifest)
        except (ValueError,OSError):continue
        for row in old.get('samples',[]):
            if row.get('cocoId') is not None:excluded.add(int(row['cocoId']))
            if str(row.get('id','')).startswith('coco-'):
                try:excluded.add(int(row['id'][5:]))
                except ValueError:pass
            if row.get('groupId','').startswith('flickr-'):old_groups.add(row['groupId'][7:])
names={c['id']:c['name'] for c in coco['categories']};images={im['id']:im for im in coco['images'] if im['license']==4 and im['id'] not in excluded}
boxes=defaultdict(list)
for a in coco['annotations']:
    if a['image_id'] in images and not a['iscrowd']:boxes[a['image_id']].append(a)
with zipfile.ZipFile(meta_path) as z:vg=json.load(z.open(z.namelist()[0]))
mapped={v['image_id']:(v,images[v['coco_id']]) for v in vg if v.get('coco_id') in images and str(v.get('flickr_id'))==re.search(r'/(\d+)_',images[v['coco_id']]['flickr_url']).group(1)}
colours={'black','white','red','blue','green','yellow','brown','pink','purple','orange','gray'}
targets={'car','chair','backpack','handbag','suitcase','bottle','cup','couch','bed','bus','bicycle','book','umbrella','bowl','vase','laptop','motorcycle','truck','bench','train'}
aliases={'sofa':'couch','bike':'bicycle'}
def records(stream):
    decoder=json.JSONDecoder();buffer='';started=False;eof=False
    while True:
        buffer=buffer.lstrip()
        if not started:
            if buffer.startswith('['):buffer=buffer[1:];started=True;continue
        else:
            buffer=buffer.lstrip(', \r\n\t')
            if buffer.startswith(']'):return
            try:item,end=decoder.raw_decode(buffer);buffer=buffer[end:];yield item;continue
            except json.JSONDecodeError:
                if eof:raise
        chunk=stream.read(65536)
        if not chunk:eof=True
        buffer+=chunk
        if len(buffer)>8_000_000:raise ValueError('Annotation record budget')
def iou(a,b):
    x,y,w,h=a;u,v,s,t=b;q=max(0,min(x+w,u+s)-max(x,u))*max(0,min(y+h,v+t)-max(y,v));return q/(w*h+s*t-q) if w*h+s*t>q else 0
candidates=defaultdict(list)
with zipfile.ZipFile(attrs_path) as z,io.TextIOWrapper(z.open(z.namelist()[0]),encoding='utf-8') as stream:
    for v in records(stream):
        if v['image_id'] not in mapped:continue
        vg_im,im=mapped[v['image_id']]
        if abs((im['width']/im['height'])/(vg_im['width']/vg_im['height'])-1)>.015:continue
        for o in v['attributes']:
            ns=o.get('names',[o.get('name','')]);ns=[ns] if isinstance(ns,str) else ns
            classes={aliases.get(n.lower().strip(),n.lower().strip()) for n in ns}&targets
            if len(classes)!=1:continue
            category=next(iter(classes));attrs=[a.lower().strip().replace('grey','gray') for a in o.get('attributes',[])]
            cs={a.removeprefix('dark ').removeprefix('light ') for a in attrs}&colours
            if not cs:continue
            multi=any(a in {'multicolored','multi-colored','multicoloured','multi-coloured'} for a in attrs)
            if len(cs)!=1 and not multi:continue
            box=[o['x']/vg_im['width'],o['y']/vg_im['height'],o['w']/vg_im['width'],o['h']/vg_im['height']]
            choices=[]
            for a in boxes[im['id']]:
                if names[a['category_id']]!=category:continue
                x,y,w,h=a['bbox'];b=[x/im['width'],y/im['height'],w/im['width'],h/im['height']];choices.append((iou(box,b),a,b))
            if not choices:continue
            overlap,a,b=max(choices,key=lambda q:q[0])
            if overlap<.7:continue
            candidates[im['id']].append(dict(objectId=str(a['id']),cocoClass=category,box=b,referenceColor='multicolor' if multi else next(iter(cs)),referenceComponents=sorted(cs) if multi else [],vgObjectId=o['object_id'],vgImageId=v['image_id'],geometryIoU=overlap,sourceAttributes=attrs,referenceOrigin='PUBLISHED_HUMAN_VISUAL_GENOME_NOT_MODEL_PREDICTION',referenceReviewedByBasira=False))
if focus:candidates={i:refs for i,refs in candidates.items() if any(r['cocoClass']=='car' and r['referenceColor'] in {'red','white'} for r in refs)}
seed='basira-colour-v4-independent-20261030';order=sorted(candidates,key=lambda i:sha((seed+str(i)).encode()))
plan=dict(seed=seed,selection='Published human boxes/attributes and per-photo CC BY only; no RGB colour inference or model predictions',excludedOldCocoImages=len(excluded),candidates=len(order),maxImages=140,maxAttempts=500,maxSeconds=2400,maxStoredBytes=450_000_000,sourceAnnotationsSha256=sha(coco_path.read_bytes()),attributesSha256=sha(attrs_path.read_bytes()),metadataSha256=sha(meta_path.read_bytes()),humanApprovalsCreated=0)
if focus:plan['focus']='Missing red/white car coverage, final evaluation only, all new sources excluded from development/calibration'
plan_path=root/'acquisition-plan.json'
if plan_path.exists():assert read(plan_path)==plan
else:plan_path.write_text(json.dumps(plan,indent=2))
journal=root/'acquisition.jsonl';rows=[json.loads(l) for l in journal.read_text().splitlines()] if journal.exists() else []
done={r['cocoId'] for r in rows};owners={r['groupId'] for r in rows};counts=Counter(r['split'] for r in rows);attempts=0;start=time.monotonic();rejected=[]
for ident in order:
    if ident in done:continue
    if len(rows)>=plan['maxImages'] or attempts>=plan['maxAttempts'] or time.monotonic()-start>plan['maxSeconds']:break
    if sum(p.stat().st_size for p in root.rglob('*') if p.is_file())>plan['maxStoredBytes']:break
    attempts+=1;im=images[ident];photo=re.search(r'/(\d+)_',im['flickr_url']).group(1)
    try:
        req=urllib.request.Request('https://www.flickr.com/photo.gne?id='+photo,headers={'User-Agent':'BasiraColourEvaluation/1.0'})
        with urllib.request.urlopen(req,timeout=12) as r:page=r.read(2_500_001);landing=r.url
        parsed=urllib.parse.urlparse(landing)
        if parsed.scheme!='https' or parsed.hostname not in {'www.flickr.com','flickr.com'} or parsed.username or parsed.password or len(page)>2_500_000 or not re.search(r'/photos/[^/]+/'+photo+r'/?$',landing):raise ValueError('Source identity/size')
        documents=[]
        for text in re.findall(r'<script[^>]+type=[\"\x27]application/ld\+json[\"\x27][^>]*>(.*?)</script>',page.decode(),re.S|re.I):
            try:documents.append(json.loads(text))
            except ValueError:pass
        matches=[i for d in documents for i in d.get('@graph',[d]) if i.get('@type')=='ImageObject' and '/'+photo+'_' in i.get('contentUrl','') and i.get('license')=='https://creativecommons.org/licenses/by/2.0/']
        if len(matches)!=1:raise ValueError('Per-photo CC BY not verified')
        author=matches[0]['author'];owner=author.get('url','').rstrip('/').split('/')[-1]
        if not owner or owner in old_groups or 'flickr-'+owner in owners:raise ValueError('Previous/repeated source author')
        code=int(sha((seed+owner).encode())[:8],16)%10;split='development' if code<4 else 'calibration' if code<6 else 'test'
        if focus:split='test'
        if counts[split]>={'development':45,'calibration':25,'test':70}[split]:continue
        with urllib.request.urlopen('https://s3.amazonaws.com/images.cocodataset.org/val2017/'+im['file_name'],timeout=15) as r:raw=r.read(4_000_001)
        if len(raw)>4_000_000:raise ValueError('Photo budget')
        image=Image.open(io.BytesIO(raw)).convert('RGB');assert image.size==(im['width'],im['height'])
        image_id='coco-'+str(ident);image_path=root/'images'/f'{image_id}.png';image.save(image_path)
        right_path=root/'rights'/f'{image_id}.html';right_path.write_bytes(page)
        ref_path=root/'references'/f'{image_id}.json';ref_path.write_text(json.dumps(dict(image=im,annotations=boxes[ident]),indent=2))
        byid={}
        for o in candidates[ident]:
            if o['objectId'] in byid and byid[o['objectId']] is None:continue
            if o['objectId'] in byid and byid[o['objectId']]['referenceColor']!=o['referenceColor']:byid[o['objectId']]=None
            elif o['objectId'] not in byid:byid[o['objectId']]=o
        refs=[o for o in byid.values() if o]
        row=dict(id=image_id,cocoId=ident,path=str(image_path.relative_to(root)),sha256=sha(image_path.read_bytes()),width=image.width,height=image.height,groupId='flickr-'+owner,split=split,objects=refs,license='CC-BY-2.0',source=landing,author=author.get('name'),licenceEvidence=str(right_path.relative_to(root)),licenceEvidenceSha256=sha(page),attributeLicense='CC-BY-4.0',referenceDocument=str(ref_path.relative_to(root)),referenceDocumentSha256=sha(ref_path.read_bytes()),privateMedia=False)
        with journal.open('a',encoding='utf-8') as out:out.write(json.dumps(row)+'\n')
        rows.append(row);owners.add(row['groupId']);counts[split]+=1
        print(json.dumps(dict(acquired=len(rows),split=split,references=len(refs),counts=dict(counts))),flush=True)
    except (ValueError,KeyError,urllib.error.HTTPError,urllib.error.URLError,TimeoutError) as err:
        reason='HTTP_'+str(err.code) if isinstance(err,urllib.error.HTTPError) else type(err).__name__+': '+str(err)[:100];rejected.append(dict(cocoId=ident,reason=reason))
        if isinstance(err,urllib.error.HTTPError) and err.code==429:break
    time.sleep(.5)
manifest=dict(schemaVersion=1,samples=rows,scope='V4_NEW_PHOTOS_ORACLE_BOX_COLOUR_EVALUATION_NOT_END_TO_END_DETECTION',selectionUsedModelPredictions=False,attributeSource='https://homes.cs.washington.edu/~ranjay/visualgenome/',attributeLicense='CC-BY-4.0',attribution='Visual Genome: Krishna et al., IJCV 2017. COCO: Lin et al. Photo authors and original CC BY links are recorded per image.',developmentGroupsDisjoint=True,basiraHumanColourReview=False,lightingReflectionReferenceAvailable=False,protectedOldTestsUsed=False)
encoded=json.dumps(manifest,indent=2).encode();(root/'manifest.json').write_bytes(encoded)
(root/'cohort-lock.json').write_text(json.dumps(dict(manifestSha256=sha(encoded),planSha256=sha(plan_path.read_bytes()),frozenBeforeInference=True,counts=dict(counts),references=sum(len(r['objects']) for r in rows),humanApprovalsCreated=0),indent=2))
(root/'source-rejections.json').write_text(json.dumps(rejected,indent=2))
print(json.dumps(dict(frozen=True,images=len(rows),counts=dict(counts),references=sum(len(r['objects']) for r in rows),attempts=attempts,seconds=round(time.monotonic()-start,1))),flush=True)
