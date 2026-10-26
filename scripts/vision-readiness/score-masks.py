"""Independent polygon overlap, plus optional blind human colour reference. Never infer labels from pixels/predictions."""
from pathlib import Path
import hashlib,json,math,statistics,sys
import numpy as np
from PIL import Image
root=Path(sys.argv[1]).resolve();stage=sys.argv[2];mode=sys.argv[3]
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
plan_name='colour-diagnostic-plan.json' if stage=='colour-diagnostic' else 'mask-plan.json'
plan=read(root/plan_name);run=read(root/f'masks-{stage}-{mode}.json');assert run['cohortSha256']==sha(root/plan_name)
rows={r['id']:r for r in plan['rows'] if r['split']==stage};assert set(rows)=={r['id'] for r in run['results']}
human=read(root/'colour-reference-template.json' if len(sys.argv)<5 else Path(sys.argv[4]));reviewed={}
published=human.get('status')=='PUBLISHED_REFERENCE_SUBSET_NOT_PRODUCT_QUALIFICATION'
if published:assert human['independentOfModelPredictions'] is True and human['license']=='CC-BY-4.0' and human['humanApprovalsCreated']==0
allowed={'red','blue','green','yellow','orange','purple','pink','black','white','gray','brown','multicolor',None}
for r in human['references']:
    if not published and not r['reviewed']:continue
    assert human.get('independentOfModelPredictions') is True and (published or r.get('reviewerId')) and r['referenceColor'] in allowed
    key=(r['imageId'],str(r['objectId']));assert key not in reviewed;reviewed[key]=r
def iou(a,b):
    x,y,w,h=a;u,v,s,t=b;z=max(0,min(x+w,u+s)-max(x,u))*max(0,min(y+h,v+t)-max(y,v))
    return z/(w*h+s*t-z) if w*h+s*t-z else 0
measurements=[];colours=[]
for image in run['results']:
    row=rows[image['id']];assert row['sha256']==image['sha256'];used=set()
    for item in sorted(image['objects'],key=lambda o:-o['detection']['confidence']):
        p=item['detection'];b=p['boundingBox'];box=[b[k] for k in ['x','y','width','height']]
        matches=[(iou(box,g['box']),g['id'],g) for g in row['objects'] if g['class']==p['cocoClass'] and g['id'] not in used]
        if not matches:continue
        score,_,g=max(matches,key=lambda x:x[0])
        if score<.5:continue
        used.add(g['id'])
        if (row['id'],str(g['id'])) in reviewed:
            ref=reviewed[(row['id'],str(g['id']))]
            colours.append(dict(imageId=row['id'],objectId=g['id'],reference=ref['referenceColor'],before=item['before'].get('name'),after=item['after'].get('name')))
        if not item['mask']:continue
        values=[];bit=0
        for n in item['mask']['rle']:assert isinstance(n,int) and n>=0;values.extend([bit]*n);bit=1-bit
        assert len(values)==image['width']*image['height']
        predicted=np.asarray(values,dtype=bool).reshape(image['height'],image['width'])
        assert sha(root/g['mask'])==g['maskSha256'];truth=np.asarray(Image.open(root/g['mask']))>0;assert truth.shape==predicted.shape
        intersection=int((predicted&truth).sum());union=int((predicted|truth).sum())
        measurements.append(dict(imageId=row['id'],objectId=g['id'],category=g['class'],accepted=item['mask']['accepted'],modelScore=item['mask']['score'],
            iou=intersection/union if union else 0,purity=intersection/int(predicted.sum()) if predicted.sum() else 0))
accepted=[m for m in measurements if m['accepted']];times=sorted(r['maskMs'] for r in run['results'] if any(o['mask'] for o in r['objects']))
accuracy={}
for method in ['before','after']:
    known=[c for c in colours if c['reference'] is not None];decided=[c for c in known if c[method] is not None];correct=sum(c[method]==c['reference'] for c in decided)
    accuracy[method]=dict(matchedReferences=len(colours),knownColourReferences=len(known),decided=len(decided),correctDecided=correct,
        agreementWhenDecided=correct/len(decided) if decided else None,coverage=len(decided)/len(known) if known else None,
        abstainedOnKnown=len(known)-len(decided),unclearReferenceAbstentions=sum(c['reference'] is None and c[method] is None for c in colours))
report=dict(stage=stage,mode=mode,inputBoxesFromReference=plan.get('inputBoxesFromReference',False),images=len(rows),attempted=sum(bool(o['mask']) for r in run['results'] for o in r['objects']),
    matchedMasks=len(measurements),acceptedMatchedMasks=len(accepted),meanAcceptedIoU=statistics.mean(m['iou'] for m in accepted) if accepted else None,
    meanMatchedIoU=statistics.mean(m['iou'] for m in measurements) if measurements else None,
    meanAcceptedPurity=statistics.mean(m['purity'] for m in accepted) if accepted else None,worstAcceptedIoU=min((m['iou'] for m in accepted),default=None),
    medianMs=statistics.median(times) if times else None,p95Ms=times[math.ceil(.95*len(times))-1] if times else None,
    humanColourReferences=len(colours),colourReferenceKind='PUBLISHED_CROWDSOURCED_NOT_NEWLY_ADJUDICATED' if published else 'BLIND_MANUAL_REVIEW',colourAgreement=accuracy,productMasksMayEnable=False,cameraQualified=False,
    reason='Geometry is not colour qualification. Independent reviewed colour coverage and phone performance are still required.',
    independentObjectDetectionFinal=False,measurements=measurements,colours=colours)
(root/f'mask-evaluation-{stage}-{mode}.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['measurements','colours']}))
