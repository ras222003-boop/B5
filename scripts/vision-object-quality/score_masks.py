"""Independent COCO polygon geometry; colour agreement remains provisional, never human approval."""
from pathlib import Path
import json,sys,statistics,hashlib
import numpy as np
from PIL import Image
from evaluate import overlap,box,read
root=Path(sys.argv[1]).resolve();stage=sys.argv[2];manifest=read(root/'manifest.json');run=read(root/'masks'/stage/'results.json')
refs={r['objectId']:r for r in read(root/('test-color-references.json' if stage=='test' else 'color-references.json'))['references']};rows={r['id']:r for r in manifest['samples'] if r['split']==stage};measurements=[];colors=[]
for image in run['results']:
    row=rows[image['id']];used=set()
    for item in image['objects']:
        p=item['detection'];candidates=[(overlap(g['box'],box(p)),i,g) for i,g in enumerate(row['objects']) if not g['iscrowd'] and g['class']==p.get('cocoClass') and i not in used]
        if not candidates:continue
        best=max(candidates,key=lambda v:v[0])
        if best[0]<.5:continue
        _,i,g=best;used.add(i)
        if g['id'] in refs:colors.append(dict(imageId=row['id'],objectId=g['id'],reference=refs[g['id']]['color'],before=item['before'].get('name'),after=item['after'].get('name'),humanApproval=False))
        if not item['mask'] or 'mask' not in g:continue
        values=[];bit=0
        for n in item['mask']['rle']:values.extend([bit]*n);bit=1-bit
        predicted=np.array(values,dtype=bool).reshape((image['height'],image['width']));truth=np.asarray(Image.open(root/g['mask']))>0
        if predicted.shape!=truth.shape:
            # Python round and JS Math.round differ at half pixels; preserve physical alignment.
            truth=np.asarray(Image.open(root/g['mask']).resize((image['width'],image['height']),Image.Resampling.NEAREST))>0
        intersection=(predicted&truth).sum();union=(predicted|truth).sum();mask_iou=float(intersection/union) if union else 0
        yy,xx=np.mgrid[:image['height'],:image['width']];x,y,w,h=box(p);core=(xx/image['width']>=x+.2*w)&(xx/image['width']<x+.8*w)&(yy/image['height']>=y+.2*h)&(yy/image['height']<y+.8*h)
        for other in image['objects']:
            if other is item:continue
            a,b,c,d=box(other['detection']);core&=~((xx/image['width']>=a)&(xx/image['width']<a+c)&(yy/image['height']>=b)&(yy/image['height']<b+d))
        measurements.append(dict(imageId=row['id'],objectId=g['id'],category=g['class'],accepted=item['mask']['accepted'],modelScore=item['mask']['score'],iou=mask_iou,
            foregroundPurity=float(intersection/predicted.sum()) if predicted.sum() else 0,boxCorePurity=float((core&truth).sum()/core.sum()) if core.sum() else None))
accepted=[r for r in measurements if r['accepted']];times=[r['maskMs'] for r in run['results'] if any(o['mask'] for o in r['objects'])]
labelled=[r for r in colors if r['reference'] is not None]
report=dict(stage=stage,maskAttempts=sum(o['mask'] is not None for r in run['results'] for o in r['objects']),acceptedTotal=sum(bool(o['mask'] and o['mask']['accepted']) for r in run['results'] for o in r['objects']),
    matchedMasks=len(measurements),acceptedMatchedMasks=len(accepted),acceptedMeanIoU=statistics.mean(r['iou'] for r in accepted) if accepted else None,
    acceptedMeanPurity=statistics.mean(r['foregroundPurity'] for r in accepted) if accepted else None,acceptedMeanBoxCorePurity=statistics.mean(r['boxCorePurity'] for r in accepted if r['boxCorePurity'] is not None) if accepted else None,
    medianMaskMs=statistics.median(times),cameraQualified=False,reason='~7 second mask latency exceeds camera budget; evaluate for stills only',
    photoMaskEligible=bool(accepted and all(r['iou']>=.5 for r in accepted) and statistics.mean(r['iou'] for r in accepted)>=.7),
    colorAgreement={method:dict(matchedReferences=len(labelled),decided=sum(r[method] is not None for r in labelled),agreed=sum(r[method]==r['reference'] for r in labelled),abstained=sum(r[method] is None for r in labelled),humanValidatedAccuracy=None) for method in ['before','after']},
    masks=measurements,colors=colors,limitations=['Tiny validation selection; model IoU score is uncalibrated.','COCO polygons can contain occluders and are imperfect surface-colour references.','Provisional assistant colour labels are not human ground truth.'])
(root/f'{stage}-mask-evaluation.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k not in ['masks','colors']}))
