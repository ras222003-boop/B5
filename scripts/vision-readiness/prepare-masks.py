"""Freeze a new adapter-only geometry cohort using independently published COCO polygons.
These were detector development images: NOT a new independent object-detection final.
No inferred or assistant-assigned colour is promoted to human reference.
"""
from pathlib import Path
import hashlib,json,math,sys
import numpy as np
from PIL import Image
from pycocotools import mask as coco_mask
root=Path(sys.argv[1]).resolve();source=root.parent/'object-finetune-v3-001'
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
manifest=read(source/'manifest.json');predictions={r['id']:r for r in read(source/'results/validation/yolox-tiny.json')['predictions']}
rows=[r for r in manifest['samples'] if r['source']=='coco-commercial' and r['split']=='validation']
rows.sort(key=lambda r:hashlib.sha256(('basira-mask-native-box-20261026'+r['groupId']).encode()).hexdigest())
assert len(rows)==18
out=root/'mask-reference-masks';out.mkdir(exist_ok=True)
prepared=[];template=[]
for i,row in enumerate(rows):
    evidence=read(source/row['rights']);assert evidence['commercialTrainingAllowed'] and evidence['licenseId']=='CC-BY-2.0'
    assert sha(source/evidence['licenceEvidence'])==evidence['licenceEvidenceSha256'] and sha(source/row['path'])==row['sha256']
    annotations=read(source/'source-labels'/f"{row['id']}.json")['annotations']
    scale=min(1,320/max(row['width'],row['height']));w=math.floor(row['width']*scale+.5);h=math.floor(row['height']*scale+.5)
    objects=[]
    for g in row['objects']:
        if g['iscrowd'] or g['class']=='person':continue
        a=next(a for a in annotations if str(a['id'])==str(g['id']));seg=a['segmentation']
        rle=coco_mask.frPyObjects(seg,row['height'],row['width']) if isinstance(seg,list) else seg
        truth=coco_mask.decode(coco_mask.merge(rle) if isinstance(rle,list) else rle)
        path=out/f"{row['id']}-{g['id']}.png"
        Image.fromarray(np.uint8(truth)*255).resize((w,h),Image.Resampling.NEAREST).save(path)
        objects.append(dict(g,mask=str(path.relative_to(root)),maskSha256=sha(path)))
        template.append(dict(imageId=row['id'],objectId=g['id'],cocoClass=g['class'],sourceImage=str(source/row['path']),box=g['box'],
            reviewed=False,referenceColor=None,referenceShade=None,referenceComponents=[],visibility=None,lighting=None,reflective=None,reviewerId=None))
    prepared.append(dict(id=row['id'],groupId=row['groupId'],split='development' if i<6 else 'test',image=str(source/row['path']),sha256=row['sha256'],
        width=row['width'],height=row['height'],maskWidth=w,maskHeight=h,objects=objects,
        detections=[d for d in predictions[row['id']]['detections'] if d['confidence']>=.5]))
plan=dict(scope='ADAPTER_GEOMETRY_ONLY',selection='Source-group hash, frozen before native-box mask inference; first six development, remaining twelve held out',
    referenceSource='COCO published polygons, CC BY 4.0 annotations; per-photo CC BY 2.0 evidence retained in V3 corpus',
    imageRightsInheritedFrom=str(source/'rights-audit.json'),detectorFinal=False,colourHumanReferenceAvailable=False,
    reusedDetectorDevelopmentImages=True,productMasksEnabled=False,rows=prepared)
path=root/'mask-plan.json';assert not path.exists();path.write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'colour-reference-template.json').write_text(json.dumps(dict(status='EMPTY_NOT_REVIEWED',independentOfModelPredictions=None,
    instructions='Review originals blind to predictions. null colour with reviewed=true means genuinely unclear. No signature/approval is created by this template.',references=template),ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(images=len(rows),development=6,test=12,referenceObjects=len(template),humanColourLabels=0)))
