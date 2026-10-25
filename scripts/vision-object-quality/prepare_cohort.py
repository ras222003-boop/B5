"""COCO exact categories/instance polygons, source CC BY verified before any inference.
Author-grouped validation/final test; selection cannot consult model predictions.
"""
from pathlib import Path
import json,re,hashlib,urllib.request,io,sys
from PIL import Image,ImageDraw,ImageOps
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
if (root/'manifest.json').exists():raise ValueError('Cohort already frozen; do not overwrite')
plan=dict(seed='basira-quality-002-20261025',perStratum=8,strata=['validation/simple','validation/crowded','test/simple','test/crowded'],
    simple='1 to 3 noncrowd instances',crowded='8 or more noncrowd instances',group='canonical Flickr author',
    excluded='prior local photo IDs and authors',categories='exact COCO 80, no Open Images crosswalk',
    cameraBudgetMs=500,maximumBrowserTreeMiB=2048,modelSelection='validation only: highest F1 at IoU .5 under camera budget; image option may be slower',
    thresholds=[.25,.4,.5,.65],testUse='once after selection lock; no tuning',training=False)
planPath=root/'protocol.json'
if planPath.exists() and json.loads(planPath.read_text())!=plan:raise ValueError('Plan changed')
planPath.write_text(json.dumps(plan,indent=2),encoding='utf-8')
data=json.loads((root/'assets/instances_val2017.json').read_text(encoding='utf-8'));categories={c['id']:c['name'] for c in data['categories']}
by={}
for a in data['annotations']:by.setdefault(a['image_id'],[]).append(a)
excludedAuthors=set();excludedPhotos=set()
for folder in ['object-colors-001','object-colors-development-001']:
    old=root.parent/folder
    if not (old/'manifest.json').exists():continue
    for row in json.loads((old/'manifest.json').read_text(encoding='utf-8'))['samples']:
        if 'siteId' in row:excludedAuthors.add(row['siteId'].removeprefix('flickr-'))
        match=re.search(r'/photos/([^/]+)/(\d+)',row.get('source',''))
        if match:excludedAuthors.add(match[1]);excludedPhotos.add(match[2])
    for p in (old/'license-evidence').glob('*.json'):
        evidence=json.loads(p.read_text());match=re.search(r'/photos/([^/]+)/(\d+)',evidence.get('source',''))
        if match:excludedAuthors.add(match[1]);excludedPhotos.add(match[2])
def get(url,limit):
    r=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BasiraLocalResearch/2'}),timeout=15)
    raw=r.read(limit+1)
    if len(raw)>limit:raise ValueError('Public file resource bound')
    return raw,r.url
targets=['chair','cup','bottle','car','backpack','couch','dining table','bicycle']
candidates=[im for im in data['images'] if im['license']==4 and (len([a for a in by.get(im['id'],[]) if not a['iscrowd']])<=3 or len([a for a in by.get(im['id'],[]) if not a['iscrowd']])>=8)]
candidates.sort(key=lambda im:sha((plan['seed']+str(im['id'])).encode()))
selected=[];usedAuthors=set();rejected=[];counts={(s,b):0 for s in ['validation','test'] for b in ['simple','crowded']}
for directory in ['images','rights','reference-masks']:(root/directory).mkdir(exist_ok=True)
for sourceIndex,im in enumerate(candidates):
    annotations=by.get(im['id'],[]);noncrowd=[a for a in annotations if not a['iscrowd']];bucket='simple' if len(noncrowd)<=3 else 'crowded'
    if all(counts[(s,bucket)]>=8 for s in ['validation','test']):continue
    labels={categories[a['category_id']] for a in noncrowd}
    if not any(t in labels for t in targets):continue
    needed=[targets[counts[(s,bucket)]] for s in ['validation','test'] if counts[(s,bucket)]<8]
    if not any(t in labels for t in needed) and sourceIndex<300:continue
    photo=re.search(r'/(\d+)_',im['flickr_url']).group(1)
    if photo in excludedPhotos:continue
    try:
        page,landing=get('https://www.flickr.com/photo.gne?id='+photo,2_500_000);text=page.decode('utf-8')
        if not re.search(r'"license"\s*:\s*"https://creativecommons.org/licenses/by/2\.0/"',text):raise ValueError('Current CC BY could not be verified')
        author=json.loads(re.search(r'"author"\s*:\s*(\{[^}]+\})',text).group(1));canonical=re.search(r'buddyicons/(\d+@N\d+)',author.get('image',''))
        owner=canonical.group(1) if canonical else author['url'].rstrip('/').split('/')[-1]
        alias=author['url'].rstrip('/').split('/')[-1]
        if owner in excludedAuthors or alias in excludedAuthors or owner in usedAuthors:continue
        split='validation' if int(sha((plan['seed']+owner).encode())[:8],16)%2==0 else 'test'
        if counts[(split,bucket)]>=8:continue
        # Round-robin target preference within each stratum, with late fallback for rare classes.
        target=targets[counts[(split,bucket)]]
        if target not in labels and sourceIndex<300:continue
        raw,url=get('https://s3.amazonaws.com/images.cocodataset.org/val2017/'+im['file_name'],3_000_000)
        image=Image.open(io.BytesIO(raw)).convert('RGB')
        if image.size!=(im['width'],im['height']):raise ValueError('Reference dimensions changed')
        path='images/'+str(im['id'])+'.png';image.save(root/path)
        objects=[]
        scale=min(1,320/max(image.size));mw,mh=round(image.width*scale),round(image.height*scale)
        for a in annotations:
            x,y,w,h=a['bbox'];item=dict(id=str(a['id']),categoryId=a['category_id'],**{'class':categories[a['category_id']]},box=[x/image.width,y/image.height,w/image.width,h/image.height],area=a['area'],iscrowd=a['iscrowd'])
            if isinstance(a['segmentation'],list):
                mask=Image.new('L',(mw,mh));draw=ImageDraw.Draw(mask)
                for polygon in a['segmentation']:
                    if len(polygon)>=6:draw.polygon([(polygon[i]*mw/image.width,polygon[i+1]*mh/image.height) for i in range(0,len(polygon),2)],fill=255)
                maskPath='reference-masks/'+str(a['id'])+'.png';mask.save(root/maskPath);item.update(mask=maskPath,maskSha256=sha((root/maskPath).read_bytes()))
            objects.append(item)
        evidence=dict(source=landing,author=author['name'],authorId=owner,authorUrl=author['url'],license='https://creativecommons.org/licenses/by/2.0/',sourcePageSha256=sha(page),imageSource=url,imageSha256=sha(raw),humanApproval=False,changes='RGB PNG; original dimensions; no EXIF retained')
        evidencePath='rights/'+str(im['id'])+'.json';(root/evidencePath).write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
        selected.append(dict(id=str(im['id']),cocoId=im['id'],path=path,sha256=sha((root/path).read_bytes()),width=image.width,height=image.height,siteId=owner,sceneId='coco-'+str(im['id']),split=split,bucket=bucket,rights=evidencePath,objects=objects))
        usedAuthors.add(owner);counts[(split,bucket)]+=1
        print(json.dumps({'id':im['id'],'split':split,'bucket':bucket,'objects':len(objects),'counts':[f'{s}/{b}:{n}' for (s,b),n in counts.items()]}),flush=True)
        if all(n==8 for n in counts.values()):break
    except Exception as e:rejected.append(dict(id=im['id'],reason=str(e)));print(json.dumps({'rejected':im['id'],'reason':str(e)}),flush=True)
manifest=dict(schemaVersion=2,samples=selected,annotationSha256=sha((root/'assets/instances_val2017.json').read_bytes()),protocolSha256=sha(planPath.read_bytes()),inferenceUsedForSelection=False,trainingUse='forbidden',colorReferences='no independent human colour labels yet',limitations=['Small COCO validation subset; publishers may have tuned on COCO validation.','Flickr author grouping is a conservative source boundary, not proof of different physical sites.'])
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');(root/'rejections.json').write_text(json.dumps(rejected,indent=2),encoding='utf-8')
lock=dict(manifestSha256=sha((root/'manifest.json').read_bytes()),protocolSha256=manifest['protocolSha256'],createdBeforeInference=True,counts={s+'/'+b:n for (s,b),n in counts.items()})
(root/'cohort-lock.json').write_text(json.dumps(lock,indent=2),encoding='utf-8')
print(json.dumps(lock))
