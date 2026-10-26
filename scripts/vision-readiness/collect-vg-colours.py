"""Published human attribute references on already licensed photos, never model-generated colour GT.
Use the author's university host, not the repurposed old visualgenome.org domain.
Only exact/explicit object-name mappings + image IDs/Flickr IDs/aspect ratios + IoU >= .7.
"""
from pathlib import Path
import hashlib,io,json,re,sys,urllib.request,zipfile
root=Path(sys.argv[1]).resolve();source=root.parent/'object-finetune-v3-001';assets=root/'vg-annotations';assets.mkdir(exist_ok=True)
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
base='https://homes.cs.washington.edu/~ranjay/visualgenome/'
evidence=assets/'publisher-home.html'
if not evidence.exists():evidence.write_bytes(urllib.request.urlopen(base,timeout=30).read(1_000_001))
assert 'creativecommons.org/licenses/by/4.0' in evidence.read_text()
for name,budget in [('image_data.json.zip',3_000_000),('attributes.json.zip',90_000_000)]:
    path=assets/name
    if not path.exists():
        partial=assets/(name+'.partial');size=0
        with urllib.request.urlopen(base+'data/dataset/'+name,timeout=60) as response,partial.open('wb') as out:
            while chunk:=response.read(1024*1024):
                size+=len(chunk);assert size<=budget;out.write(chunk)
        partial.rename(path)
    assert path.stat().st_size<=budget
    print(json.dumps(dict(download=name,bytes=path.stat().st_size,sha256=sha(path))),flush=True)
def records(stream):
    """Bounded JSON-array reader, no need to install a parser or hold the 400MB dump in RAM."""
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
        buffer+=chunk;assert len(buffer)<8_000_000,'Unexpectedly large source record'
def readzip(path):
    archive=zipfile.ZipFile(path);names=archive.namelist();assert len(names)==1 and names[0].endswith('.json')
    return archive,io.TextIOWrapper(archive.open(names[0]),encoding='utf-8')
manifest=read(source/'manifest.json');rows={int(r['cocoId']):r for r in manifest['samples'] if r['source']=='coco-commercial' and r['split']!='test'}
with zipfile.ZipFile(assets/'image_data.json.zip') as z:metadata=json.load(z.open(z.namelist()[0]))
matches={}
for im in metadata:
    row=rows.get(im.get('coco_id'))
    if not row:continue
    original=read(source/'source-labels'/f"{row['id']}.json")['image'];photo=re.search(r'/(\d+)_',original['flickr_url']).group(1)
    if str(im.get('flickr_id'))!=photo:continue
    if abs((im['width']/im['height'])/(row['width']/row['height'])-1)>.015:continue
    matches[im['image_id']]=(im,row)
names={c['name']:c['name'] for c in manifest['categories']};names.update({'sofa':'couch','bike':'bicycle','motorbike':'motorcycle','tv monitor':'tv'})
colour_names={'red','blue','green','yellow','orange','purple','pink','black','white','gray','brown'}
def colour(word):
    word=word.lower().strip().replace('grey','gray');shade=None
    for prefix,tag in [('light ','LIGHT'),('dark ','DARK')]:
        if word.startswith(prefix):word=word[len(prefix):];shade=tag
    return (word,shade) if word in colour_names else None
def iou(a,b):
    x,y,w,h=a;u,v,s,t=b;z=max(0,min(x+w,u+s)-max(x,u))*max(0,min(y+h,v+t)-max(y,v));return z/(w*h+s*t-z) if w*h+s*t-z else 0
references=[];seen={};rejectedConflicts=[]
archive,stream=readzip(assets/'attributes.json.zip')
with archive,stream:
 for image in records(stream):
    match=matches.get(image['image_id'])
    if not match:continue
    im,row=match
    for obj in image['attributes']:
        object_names=obj.get('names',[obj.get('name','')]);object_names=[object_names] if isinstance(object_names,str) else object_names
        classes={names[n.lower().strip()] for n in object_names if n.lower().strip() in names}
        if len(classes)!=1:continue
        category=next(iter(classes))
        if category in {'person','traffic light'}:continue
        values={c for a in obj.get('attributes',[]) if (c:=colour(a))}
        colours={c[0] for c in values}
        # Multiple positive colours do not establish which is dominant; preserve as ambiguous, never manufacture a dominant reference.
        if len(colours)!=1:continue
        box=[obj['x']/im['width'],obj['y']/im['height'],obj['w']/im['width'],obj['h']/im['height']]
        candidates=[(iou(box,g['box']),g) for g in row['objects'] if g['class']==category and not g['iscrowd']]
        if not candidates:continue
        overlap,g=max(candidates,key=lambda x:x[0])
        if overlap<.7:continue
        key=(row['id'],str(g['id']));name=next(iter(colours))
        if key in seen:
            if seen[key]['referenceColor']!=name:rejectedConflicts.append(key)
            continue
        record=dict(imageId=row['id'],objectId=g['id'],cocoClass=category,referenceColor=name,
            referenceShade=next(iter(values))[1] if len(values)==1 else None,vgImageId=im['image_id'],vgObjectId=obj['object_id'],
            geometryIoU=overlap,sourceAttributes=obj.get('attributes',[]),referenceOrigin='PUBLISHED_HUMAN_CROWDSOURCED_VISUAL_GENOME',
            referenceIndependentlyReviewedByBasira=False)
        seen[key]=record
references=[r for key,r in seen.items() if key not in rejectedConflicts]
report=dict(status='PUBLISHED_REFERENCE_SUBSET_NOT_PRODUCT_QUALIFICATION',independentOfModelPredictions=True,
    source=base,license='CC-BY-4.0',licenseEvidenceSha256=sha(evidence),attribution='Krishna et al., Visual Genome, Stanford University and collaborators, IJCV 2017; selected attributes mapped to licensed COCO images and canonical classes.',
    archiveSha256={p.name:sha(p) for p in assets.glob('*.zip')},references=references,
    caveats=['Crowdsourced published human labels are noisy, incomplete and not newly adjudicated by Basira.',
        'Only exact single-colour positives accepted; no reliable abstention, lighting or reflection GT.',
        'Geometry/name/metadata matching does not turn these into a comprehensive new independent object-detection final.',
        'No V3 final images used; no training or product mask activation.'],humanApprovalsCreated=0)
(root/'published-colour-references.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(linkedLicensedImages=len(matches),matchedReferences=len(references),classes=sorted({r['cocoClass'] for r in references}),finalImagesRead=0)),flush=True)
