"""Publisher captured phone images, source-block grouping, independent YOLO labels.

Mapping is from the original article:0crosswalk,1green light,2red light.
Only presence/category traffic-light is used, never crossing/navigation advice.
"""
from collections import Counter
from pathlib import Path
import hashlib,io,json,random,shutil,zipfile
import numpy as np
from PIL import Image
from rights import ROOT,read,sha

root=ROOT;assert not (root/'cohort-lock.json').exists()
download=read(root/'uroac-download.json');assert download['fullSha256Verified'] is True
archive_path=root/'assets/UrOAC_anon.zip';assert archive_path.stat().st_size==download['bytes']
inner=root/'assets/uroac-images.zip'
with zipfile.ZipFile(archive_path) as archive:
    info=archive.getinfo('images.zip')
    if not inner.exists():
        partial=inner.with_suffix('.zip.partial')
        with archive.open(info) as source,partial.open('wb') as output:shutil.copyfileobj(source,output,4*1024*1024)
        assert partial.stat().st_size==info.file_size;partial.replace(inner)
    labels={Path(n).stem:archive.read(n).decode() for n in archive.namelist() if n.startswith('LABELS/') and n.endswith('.txt')}
randomizer=random.Random(20261026);blocks=list(range(21));randomizer.shuffle(blocks)
splits={b:('train' if i<12 else 'validation' if i<16 else 'test') for i,b in enumerate(blocks)}
# Group50 filenames together, with six spaced views per block. Site identity is
# not published: do not claim distinct physical locations from filenames alone.
plan=dict(seed=20261026,blocks=splits,maxFramesPerBlock=6,
    groupMeaning='50 consecutive publisher photo IDs, not verified physical site IDs',
    categoryMapping={'0':'ignored_crosswalk','1':'traffic light','2':'traffic light'},
    labelSpecification='https://doi.org/10.1016/j.dib.2022.108172',
    minCrossGroupDhashDistance=7,finalNotUsedForSettings=True)
(root/'uroac-plan.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
for folder in ['images','rights','source-labels']:(root/folder).mkdir(exist_ok=True)
rows=[];signatures=[];rejected=[]
page=root/'rights-evidence/uroac-page.html'
assert '"short_name":"CC BY 4.0"' in page.read_text()
with zipfile.ZipFile(inner) as images:
    members={Path(n).stem:n for n in images.namelist() if Path(n).suffix.lower() in ['.png','.jpg','.jpeg']}
    assert len(members)==1010
    for block in sorted(splits):
        available=sorted((s for s in members if (int(s)-1)//50==block),key=int)
        if not available:continue
        selected=[available[i] for i in np.linspace(0,len(available)-1,min(6,len(available)),dtype=int)]
        for stem in selected:
            original=images.read(members[stem]);image=Image.open(io.BytesIO(original)).convert('RGB')
            grey=np.asarray(image.convert('L').resize((9,8)));sig=(grey[:,1:]>grey[:,:-1]).flatten()
            if any(int((sig!=other).sum())<=6 for other in signatures):
                rejected.append(dict(id=stem,reason='near_duplicate_before_model_inference'));continue
            ow,oh=image.size;ratio=min(1.,1280/max(ow,oh));image=image.resize((round(ow*ratio),round(oh*ratio)),Image.Resampling.LANCZOS)
            converted=[];ignored=[]
            for index,line in enumerate(labels[stem].splitlines()):
                values=list(map(float,line.split()));assert len(values)==5
                category,cx,cy,w,h=values;assert category in [0,1,2] and w>0 and h>0
                x,y=max(0.,cx-w/2),max(0.,cy-h/2);right,bottom=min(1.,cx+w/2),min(1.,cy+h/2)
                assert right>x and bottom>y
                if category==0:ignored.append(dict(sourceClass='crosswalk',box=[x,y,right-x,bottom-y]));continue
                converted.append(dict(id=f'uroac-{stem}-{index}',**{'class':'traffic light'},
                    box=[x,y,right-x,bottom-y],area=(right-x)*image.width*(bottom-y)*image.height,
                    iscrowd=0,sourceClass='green traffic light' if category==1 else 'red traffic light'))
            image_id='uroac-'+stem;path=f'images/{image_id}.png';image.save(root/path)
            annotation=f'source-labels/{image_id}.txt';(root/annotation).write_text(labels[stem],encoding='utf-8')
            rights=f'rights/{image_id}.json';(root/rights).write_text(json.dumps(dict(source='https://data.mendeley.com/datasets/fcrmp92ckn/2',
                authors=['Francisco Gomez-Donoso','Marcos Moreno-Martinez','Miguel Cazorla'],
                licenseId='CC-BY-4.0',licenseUrl='https://creativecommons.org/licenses/by/4.0/',
                licenceEvidence='rights-evidence/uroac-page.html',licenceEvidenceSha256=sha(page),
                commercialTrainingAllowed=True,humanApproval=False,archiveSha256=download['sha256'],
                originalImageSha256=hashlib.sha256(original).hexdigest(),archiveMember=members[stem],
                changes='RGB PNG resized to max1280; metadata stripped; normalized GT geometry retained'),indent=2),encoding='utf-8')
            rows.append(dict(id=image_id,path=path,sha256=sha(root/path),width=image.width,height=image.height,
                originalWidth=ow,originalHeight=oh,split=splits[block],source='uroac',groupId=f'uroac-block-{block:02d}',
                physicalSiteVerified=False,completeLabels=False,annotatedClasses=['traffic light'],objects=converted,
                ignoredReferences=ignored,rights=rights,sourceAnnotation=annotation,
                referenceSource='publisher independently peer-reviewed human YOLO boxes; not detector predictions',
                bucket='crowded' if len(converted)>=3 else 'simple',meanLuminanceProxy=float(np.asarray(image.convert('L').resize((64,64))).mean())))
            signatures.append(sig)
        print(json.dumps(dict(block=block,images=len(rows))),flush=True)
(root/'uroac-acquisition.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
(root/'uroac-audit.json').write_text(json.dumps(dict(images=len(rows),counts=dict(Counter(r['split'] for r in rows)),
    crossSplitNearDuplicatesPrevented=True,rejected=rejected,fullArchiveSha256Verified=True,
    sourceImageCRCChecked=True,publishedSiteIdsAvailable=False),indent=2),encoding='utf-8')
print(json.dumps(dict(images=len(rows),counts=dict(Counter(r['split'] for r in rows)))),flush=True)
