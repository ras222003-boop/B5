"""Extra small/occluded YCB views, only the already designated train scenes."""
import io,json,zipfile
from collections import defaultdict
import numpy as np
from PIL import Image
from rights import ROOT,PREVIOUS,read,sha

root=ROOT;assert not (root/'cohort-lock.json').exists()
existing=read(root/'clean-reuse.json');signatures=[];seen=defaultdict(list)
def dhash(image):
    x=np.asarray(image.convert('L').resize((9,8)));return (x[:,1:]>x[:,:-1]).flatten()
for row in existing:
    signatures.append(dhash(Image.open(root/row['path'])))
    if row['source']=='ycb-video':seen[row['groupId']].append(row['frameId'])
mapping={5:'bottle',10:'banana',12:'bottle',13:'bowl',14:'cup',17:'scissors'}
rows=[];audit=[]
with zipfile.ZipFile(PREVIOUS/'assets/ycbv_test_bop19.zip') as archive:
    for scene in [48,49,51,52,54,56,58]:
        prefix=f'test/{scene:06d}/';gt=json.loads(archive.read(prefix+'scene_gt.json'));info=json.loads(archive.read(prefix+'scene_gt_info.json'))
        candidates=[]
        for frame,items in info.items():
            hard=sum(o['obj_id'] in mapping and .15<i['visib_fract']<.85 and i['bbox_visib'][2]*i['bbox_visib'][3]<96**2 for o,i in zip(gt[frame],items))
            if hard:candidates.append((hard,int(frame)))
        candidates.sort(key=lambda x:(-x[0],x[1]));kept=0
        for hard,frame in candidates:
            if kept>=6:break
            group=f'ycb-{scene:06d}'
            if any(abs(frame-f)<16 for f in seen[group]):continue
            raw=archive.read(prefix+f'rgb/{frame:06d}.png');image=Image.open(io.BytesIO(raw)).convert('RGB');sig=dhash(image)
            if any(int((sig!=s).sum())<=6 for s in signatures):continue
            converted=[]
            for index,(obj,meta) in enumerate(zip(gt[str(frame)],info[str(frame)])):
                if obj['obj_id'] not in mapping:continue
                raw_mask=archive.read(prefix+f'mask_visib/{frame:06d}_{index:06d}.png');mask=np.asarray(Image.open(io.BytesIO(raw_mask)))>0;ys,xs=np.nonzero(mask)
                if not len(xs):continue
                x,y,w,h=int(xs.min()),int(ys.min()),int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1)
                assert all(abs(a-b)<=1 for a,b in zip([x,y,w,h],meta['bbox_visib']))
                converted.append(dict(id=f'ycbhard-{scene}-{frame}-{index}',**{'class':mapping[obj['obj_id']]},
                    sourceObjectId=obj['obj_id'],box=[x/image.width,y/image.height,w/image.width,h/image.height],area=int(mask.sum()),iscrowd=0,visibleFraction=meta['visib_fract']))
            image_id=f'ycbhard-{scene:06d}-{frame:06d}';path=f'images/{image_id}.png';image.save(root/path)
            annotation=f'source-labels/{image_id}.json';(root/annotation).write_text(json.dumps(dict(gt=gt[str(frame)],info=info[str(frame)]),indent=2))
            rights=f'rights/{image_id}.json';(root/rights).write_text(json.dumps(dict(source='https://github.com/yuxng/YCB_Video_toolbox',
                archiveSource='https://huggingface.co/datasets/bop-benchmark/ycbv',archiveMember=prefix+f'rgb/{frame:06d}.png',
                licenseId='MIT',licenceEvidence='rights-evidence/ycb-license.txt',licenceEvidenceSha256=sha(root/'rights-evidence/ycb-license.txt'),
                commercialTrainingAllowed=True,humanApproval=False),indent=2))
            row=dict(id=image_id,path=path,sha256=sha(root/path),width=image.width,height=image.height,
                split='train',source='ycb-video',groupId=group,frameId=frame,completeLabels=False,annotatedClasses=sorted(set(mapping.values())),
                objects=converted,rights=rights,sourceAnnotation=annotation,referenceSource='published poses and independently checked visible masks',bucket='crowded' if len(converted)>=3 else 'simple')
            rows.append(row);signatures.append(sig);seen[group].append(frame);kept+=1
        audit.append(dict(scene=scene,additionalViews=kept))
(root/'ycb-hard.json').write_text(json.dumps(rows,indent=2));(root/'ycb-hard-audit.json').write_text(json.dumps(dict(images=len(rows),scenes=audit,newIndependentScenes=0,selection='published visibility .15-.85 and bbox<96 squared; no model predictions'),indent=2))
print(json.dumps(dict(images=len(rows),scenes=audit,newIndependentScenes=0)))
