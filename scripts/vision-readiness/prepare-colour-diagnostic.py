"""Isolate colour/mask errors from missed detections using PUBLISHED REFERENCE boxes.
This is an oracle-box diagnostic, not end-to-end detection or deployment qualification.
"""
from pathlib import Path
import hashlib,json,math,sys
import numpy as np
from PIL import Image
from pycocotools import mask as cm
root=Path(sys.argv[1]).resolve();source=root.parent/'object-finetune-v3-001';read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
refs=read(root/'published-colour-references.json');manifest=read(source/'manifest.json');by_image={r['id']:r for r in manifest['samples']};rows=[]
for image_id in sorted({r['imageId'] for r in refs['references']}):
    row=by_image[image_id];assert row['split']!='test';evidence=read(source/row['rights']);assert evidence['commercialTrainingAllowed'] is True and sha(source/evidence['licenceEvidence'])==evidence['licenceEvidenceSha256']
    assert sha(source/row['path'])==row['sha256'];annotations=read(source/'source-labels'/f'{image_id}.json')['annotations']
    wanted={str(r['objectId']) for r in refs['references'] if r['imageId']==image_id};objects=[];prompts=[]
    scale=min(1,320/max(row['width'],row['height']));w=math.floor(row['width']*scale+.5);h=math.floor(row['height']*scale+.5)
    folder=root/'colour-diagnostic-masks';folder.mkdir(exist_ok=True)
    for g in row['objects']:
        if str(g['id']) not in wanted:continue
        a=next(a for a in annotations if str(a['id'])==str(g['id']));seg=a['segmentation'];rle=cm.frPyObjects(seg,row['height'],row['width']) if isinstance(seg,list) else seg
        mask=cm.decode(cm.merge(rle) if isinstance(rle,list) else rle);path=folder/f'{image_id}-{g["id"]}.png';Image.fromarray(np.uint8(mask)*255).resize((w,h),Image.Resampling.NEAREST).save(path)
        objects.append(dict(g,mask=str(path.relative_to(root)),maskSha256=sha(path)))
        x,y,bw,bh=g['box'];prompts.append(dict(id='reference-'+str(g['id']),cocoClass=g['class'],boundingBox=dict(x=x,y=y,width=bw,height=bh),
            source='INDEPENDENT_REFERENCE_PROMPT_NOT_DETECTION',confidenceKind='NOT_A_MODEL_SCORE',confidence=1,promptOrigin='COCO_PUBLISHED_REFERENCE_BOX'))
    assert len(objects)==len(wanted)
    rows.append(dict(id=image_id,groupId=row['groupId'],split='colour-diagnostic',image=str(source/row['path']),sha256=row['sha256'],width=row['width'],height=row['height'],objects=objects,detections=prompts))
plan=dict(scope='ORACLE_REFERENCE_BOX_COLOUR_DIAGNOSTIC_NOT_END_TO_END_DETECTION',inputBoxesFromReference=True,
    colourReferencesSha256=sha(root/'published-colour-references.json'),detectorFinal=False,productMasksEnabled=False,rows=rows)
target=root/'colour-diagnostic-plan.json';assert not target.exists();target.write_text(json.dumps(plan,indent=2));print(json.dumps(dict(images=len(rows),referenceBoxes=sum(len(r['objects']) for r in rows),detectorPerformanceMeasured=False)))
