"""Real MIT YCB-V keyframes, original geometry/mask refs, scene-level split.
Released BOP keyframes are locally repartitioned; this is NOT an official BOP score.
Masks here are reference-only and never enable the unqualified colour-mask adapter.
"""
from pathlib import Path
from collections import Counter
import io,json,zipfile,sys
import numpy as np
from PIL import Image
from sources import ROOT,sha,YCB_BASE,YCB_REV

root=ROOT
assert not (root/'cohort-lock.json').exists()
for folder in ['images','rights','source-labels','reference-masks']:(root/folder).mkdir(parents=True,exist_ok=True)
mapping={5:'bottle',10:'banana',12:'bottle',13:'bowl',14:'cup',17:'scissors'}
classes=(root/'assets/ycb-classes.txt').read_text().splitlines()
assert classes[4]=='006_mustard_bottle' and classes[13]=='025_mug' and classes[16]=='037_scissors'
scene_splits={f'{i:06d}':('validation' if i in [50,53] else 'test' if i in [55,57,59] else 'train') for i in range(48,60)}
if '--redo-unfrozen' in sys.argv:
    for name in ['ycb-acquisition.jsonl','ycb-plan.json','ycb-reference-audit.json']:
        p=root/name;archive_path=root/(name+'.initial-unfrozen')
        assert p.parent==root and not archive_path.exists()
        if p.exists():p.rename(archive_path)
plan=dict(seed='basira-v2-ycb-20261025',sceneSplits=scene_splits,framesPerScene=12,minTemporalFrameGap=40,nearDuplicateHammingAtMost=4,mapping=mapping,trainingUse='scene train only; original released test keyframes repartitioned before inference',repeatedPhysicalInstancesAcrossScenes=True,
    preInferenceAmendment='Published class coverage audit: scenes58/59 contain no mapped objects. Keep them as scoped negatives, not dropped images; assign positive55/57 to final. No model results consulted.')
(root/'ycb-plan.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
journal=root/'ycb-acquisition.jsonl'
if journal.exists():raise ValueError('YCB journal already exists; do not overwrite frozen extraction')
rows=[];signatures=[];checks=0;skips=[]
with zipfile.ZipFile(root/'assets/ycbv_test_bop19.zip') as archive:
    names=set(archive.namelist())
    for scene,split in plan['sceneSplits'].items():
        prefix='test/'+scene+'/'
        gt_raw=archive.read(prefix+'scene_gt.json');info_raw=archive.read(prefix+'scene_gt_info.json')
        gt=json.loads(gt_raw);infos=json.loads(info_raw)
        (root/'source-labels'/f'ycb-{scene}-gt.json').write_bytes(gt_raw)
        (root/'source-labels'/f'ycb-{scene}-info.json').write_bytes(info_raw)
        frames=sorted(int(Path(n).stem) for n in names if n.startswith(prefix+'rgb/') and n.endswith('.png'))
        # Stratified across the whole motion, then deterministic fallback; minimum gap and hash reject duplicates.
        indices=np.linspace(0,len(frames)-1,plan['framesPerScene'],dtype=int).tolist()
        candidates=[frames[i] for i in indices]+[f for f in frames if f not in [frames[i] for i in indices]]
        kept=[]
        for frame in candidates:
            if len(kept)>=plan['framesPerScene']:break
            if any(abs(frame-f)<plan['minTemporalFrameGap'] for f in kept):continue
            image_bytes=archive.read(prefix+f'rgb/{frame:06d}.png');image=Image.open(io.BytesIO(image_bytes)).convert('RGB')
            grey=np.asarray(image.convert('L').resize((9,8)));signature=(grey[:,1:]>grey[:,:-1]).flatten()
            if any(int((signature!=old).sum())<=4 for old in signatures):continue
            w,h=image.size;objects=[];ignored=[]
            for index,(obj,info) in enumerate(zip(gt[str(frame)],infos[str(frame)])):
                obj_id=obj['obj_id']
                if obj_id not in mapping:continue
                mask_bytes=archive.read(prefix+f'mask_visib/{frame:06d}_{index:06d}.png')
                mask=np.asarray(Image.open(io.BytesIO(mask_bytes)))>0
                ys,xs=np.nonzero(mask)
                if not len(xs):ignored.append(dict(objId=obj_id,reason='fully_occluded_no_visible_pixels'));continue
                expected=[int(xs.min()),int(ys.min()),int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1)]
                bbox=info['bbox_visib']
                assert all(abs(a-b)<=1 for a,b in zip(expected,bbox)),'Published bbox differs from independent mask geometry'
                checks+=1;x,y,bw,bh=expected
                mask_path=f'reference-masks/ycb-{scene}-{frame:06d}-{index}.png';(root/mask_path).write_bytes(mask_bytes)
                objects.append(dict(id=f'ycb-{scene}-{frame}-{index}',**{'class':mapping[obj_id]},box=[x/w,y/h,bw/w,bh/h],area=int(mask.sum()),iscrowd=0,sourceObjectId=obj_id,sourceClass=classes[obj_id-1],visibleFraction=info['visib_fract'],mask=mask_path,maskSha256=sha(mask_bytes)))
            image_id=f'ycb-{scene}-{frame:06d}';path=f'images/{image_id}.png';image.save(root/path)
            rights=f'rights/{image_id}.json';(root/rights).write_text(json.dumps(dict(source=YCB_BASE+'ycbv_test_bop19.zip',archiveMember=prefix+f'rgb/{frame:06d}.png',revision=YCB_REV,licence='MIT',licenceFile='assets/ycb-license.txt',originalPublisher='Yu Xiang et al., YCB-Video',redistributor='BOP benchmark',humanApproval=False),indent=2),encoding='utf-8')
            row=dict(id=image_id,path=path,sha256=sha((root/path).read_bytes()),width=w,height=h,split=split,source='ycb-video',groupId='ycb-'+scene,sceneId='ycb-'+scene,frameId=frame,bucket='crowded' if len(objects)>=3 else 'simple',completeLabels=False,annotatedClasses=sorted(set(mapping.values())),objects=objects,ignoredReferences=ignored,rights=rights,sourceAnnotation=f'source-labels/ycb-{scene}-gt.json',sourceInfo=f'source-labels/ycb-{scene}-info.json',referenceSource='published YCB poses/visible masks, not current model predictions')
            rows.append(row);signatures.append(signature);kept.append(frame)
            with journal.open('a',encoding='utf-8') as f:f.write(json.dumps(row)+'\n')
        print(json.dumps(dict(source='YCB',scene=scene,split=split,frames=len(kept))),flush=True)
result=dict(images=len(rows),scenes=len({r['sceneId'] for r in rows}),counts=dict(Counter(r['split'] for r in rows)),bboxVsMaskChecks=checks,actualIndependentSitesUnknown=True,physicalObjectsSharedAcrossScenes=True)
(root/'ycb-reference-audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
