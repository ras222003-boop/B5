"""Read-only artifact/group/hash audit; never manufactures rights or reference approval."""
from pathlib import Path
import json,sys,re,hashlib
import numpy as np
from PIL import Image
root=Path(sys.argv[1]).resolve();read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
manifest=read(root/'manifest.json');lock=read(root/'cohort-lock.json');selection=read(root/'selection-lock.json')
assert sha(root/'manifest.json')==lock['manifestSha256']==selection['cohortSha256']
assert sha(root/'validation-evaluation.json')==selection['validationEvaluationSha256']
assert sha('client/src/lib/vision/qualityProviders.ts')==selection['detectorSourceSha256']
assert manifest['trainingUse']=='forbidden' and manifest['inferenceUsedForSelection'] is False
currentMaskIndependent=True
for name,digest in read(root/'final-color-config-lock.json').items():
    if name=='objectMasks' and sha('client/src/lib/vision/'+name+'.ts')!=digest:
        audit=read(root/'mask-contract-audit.json');assert sha(root/audit['archivedSource'])==digest==audit['archivedSourceSha256'];currentMaskIndependent=False
    else:assert sha('client/src/lib/vision/'+name+'.ts')==digest
oldPhotos=set();oldAuthors=set();oldImages=[]
for folder in ['object-colors-001','object-colors-development-001']:
    old=root.parent/folder;m=read(old/'manifest.json')
    for row in m['samples']:
        if row.get('siteId'):oldAuthors.add(row['siteId'].removeprefix('flickr-'))
        match=re.search(r'/photos/([^/]+)/(\d+)',row.get('source',''))
        if match:oldAuthors.add(match[1]);oldPhotos.add(match[2])
        oldImages.append((folder+'/'+row['id'],old/row['path']))
    for path in (old/'license-evidence').glob('*.json'):
        match=re.search(r'/photos/([^/]+)/(\d+)',read(path).get('source',''))
        if match:oldAuthors.add(match[1]);oldPhotos.add(match[2])
authors=set();photos=set();hashes=set();counts={};newImages=[]
for row in manifest['samples']:
    assert sha(root/row['path'])==row['sha256']
    assert row['sha256'] not in hashes;hashes.add(row['sha256']);newImages.append((row['split']+'/'+row['id'],root/row['path']))
    rights=read(root/row['rights']);assert rights['license']=='https://creativecommons.org/licenses/by/2.0/' and rights['humanApproval'] is False
    match=re.search(r'/photos/([^/]+)/(\d+)',rights['source']);assert match
    assert rights['authorId'] not in authors and rights['authorId'] not in oldAuthors and match[1] not in oldAuthors and match[2] not in oldPhotos
    authors.add(rights['authorId']);assert match[2] not in photos;photos.add(match[2]);key=row['split']+'/'+row['bucket'];counts[key]=counts.get(key,0)+1
    for obj in row['objects']:
        if obj.get('mask'):assert sha(root/obj['mask'])==obj['maskSha256']
assert counts==lock['counts']
def dhash(path):
    a=np.asarray(Image.open(path).convert('L').resize((9,8)));return (a[:,1:]>a[:,:-1]).flatten()
signatures=[(name,dhash(path)) for name,path in newImages+oldImages];suspects=[]
for i,(name,a) in enumerate(signatures[:len(newImages)]):
    for other,b in signatures[i+1:]:
        distance=int((a!=b).sum())
        if distance<=4:suspects.append(dict(first=name,second=other,hamming=distance))
report=dict(passed=True,currentMaskAdapterIndependentlyTested=currentMaskIndependent,images=len(manifest['samples']),objects=sum(len(r['objects']) for r in manifest['samples']),counts=counts,uniqueAuthors=len(authors),sourcePhotoIdsUnique=True,priorSourceOverlap=False,perceptualNearDuplicateSuspects=suspects,
    caveats=['Author grouping is not a guarantee of distinct physical sites.','No proof these public COCO validation images were unseen by publishers.','A perceptual hash is only an audit heuristic.'])
(root/'integrity-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
