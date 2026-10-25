"""Official pycocotools AP on a tiny, fully annotated COCO subset; validation-only selection."""
from pathlib import Path
import json,sys,hashlib,io,contextlib,statistics,math
import numpy as np
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def overlap(a,b,crowd=False):
    inter=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]))*max(0,min(a[1]+a[3],b[1]+b[3])-max(a[1],b[1]))
    denom=b[2]*b[3] if crowd else a[2]*a[3]+b[2]*b[3]-inter
    return inter/denom if denom else 0
def box(p):return [p['boundingBox'][k] for k in ['x','y','width','height']]
def operating(rows,predictions,threshold):
    tp=fp=fn=ignored=0;errors=[];bySize={k:dict(reference=0,detected=0) for k in ['small','medium','large']}
    for row in rows:
        gt=[g for g in row['objects'] if not g['iscrowd']];crowd=[g for g in row['objects'] if g['iscrowd']];used=set()
        allp=predictions[row['id']]['detections'];selected=sorted([p for p in allp if p['confidence']>=threshold],key=lambda p:-p['confidence']);matches={}
        for p in selected:
            candidates=[(overlap(g['box'],box(p)),i) for i,g in enumerate(gt) if i not in used and p.get('cocoClass')==g['class']]
            best=max(candidates,default=(0,None))
            if best[0]>=.5:tp+=1;used.add(best[1]);matches[best[1]]=p
            elif any(g['class']==p.get('cocoClass') and overlap(g['box'],box(p),True)>=.5 for g in crowd):ignored+=1
            else:fp+=1;errors.append(dict(imageId=row['id'],kind='false_positive',prediction=p.get('cocoClass'),score=p['confidence'],box=box(p)))
        fn+=len(gt)-len(used)
        for i,g in enumerate(gt):
            area=g['area'];size='small' if area<32**2 else 'medium' if area<96**2 else 'large';bySize[size]['reference']+=1;bySize[size]['detected']+=i in used
            if i in used:continue
            same=[p for p in allp if p.get('cocoClass')==g['class'] and overlap(g['box'],box(p))>=.5]
            wrong=[p for p in selected if overlap(g['box'],box(p))>=.5]
            reason='below_operating_threshold' if same and max(p['confidence'] for p in same)<threshold else 'wrong_class_or_duplicate_assignment' if wrong else 'localization' if any(p.get('cocoClass')==g['class'] and overlap(g['box'],box(p))>=.1 for p in selected) else 'no_matching_proposal'
            errors.append(dict(imageId=row['id'],objectId=g['id'],kind='miss',reference=g['class'],size=size,reason=reason,
                minEdgeAt320=min(g['box'][2]*row['width'],g['box'][3]*row['height'])*320/max(row['width'],row['height']),
                overlappingBoxProxy=any(j!=i and overlap(g['box'],other['box'])>.2 for j,other in enumerate(gt))))
    precision=tp/(tp+fp) if tp+fp else 0;recall=tp/(tp+fn) if tp+fn else 0
    return dict(tp=tp,fp=fp,fn=fn,precision=precision,recall=recall,f1=2*precision*recall/(precision+recall) if precision+recall else 0,crowdIgnored=ignored,bySize=bySize,errors=errors)
def evaluate(root,stage):
    root=Path(root).resolve();manifest=read(root/'manifest.json');rows=[r for r in manifest['samples'] if r['split']==stage]
    if stage=='test' and not (root/'selection-lock.json').exists():raise ValueError('Final evaluation requires frozen validation selection')
    lock=read(root/'cohort-lock.json')
    if sha(root/'manifest.json')!=lock['manifestSha256']:raise ValueError('Cohort changed')
    with contextlib.redirect_stdout(io.StringIO()):gt=COCO(str(root/'assets/instances_val2017.json'))
    categories={c['name']:c['id'] for c in gt.dataset['categories']};summaries={}
    for path in sorted((root/'results'/stage).glob('*.json')):
        if path.name.endswith('.failure.json'):continue
        report=read(path);predictions={r['id']:r for r in report['predictions']}
        if set(predictions)!={r['id'] for r in rows}:raise ValueError('Missing/extra images')
        if report.get('referencesUsedInInference') is not False:raise ValueError('Reference leakage')
        dt=[]
        for r in rows:
            if predictions[r['id']]['sha256']!=r['sha256'] or sha(root/r['path'])!=r['sha256']:raise ValueError('Prediction image changed')
            for p in predictions[r['id']]['detections']:
                if p.get('cocoClass') not in categories:continue
                x,y,w,h=box(p);dt.append(dict(image_id=r['cocoId'],category_id=categories[p['cocoClass']],bbox=[x*r['width'],y*r['height'],w*r['width'],h*r['height']],score=p['confidence']))
        with contextlib.redirect_stdout(io.StringIO()) as log:
            evaluated=COCOeval(gt,gt.loadRes(dt),'bbox');evaluated.params.imgIds=[r['cocoId'] for r in rows];evaluated.evaluate();evaluated.accumulate();evaluated.summarize()
        times=sorted(p['detectorMs'] for p in report['predictions']);stats=evaluated.stats
        metrics={str(t):operating(rows,predictions,t) for t in [.25,.4,.5,.65]}
        summaries[report['config']['id']]=dict(config=report['config'],predictionsSha256=sha(path),modelSha256=report['modelSha256'],modelBytes=report['modelBytes'],
            map=float(stats[0]),ap50=float(stats[1]),ap75=float(stats[2]),apSmall=float(stats[3]),apMedium=float(stats[4]),apLarge=float(stats[5]),
            latency=dict(medianMs=statistics.median(times),p95Ms=times[math.ceil(len(times)*.95)-1],warmupExcluded=True),memory=report['memory'],
            operating=metrics,groups={group:{str(t):operating([r for r in rows if r['bucket']==group],predictions,t) for t in [.25,.4,.5,.65]} for group in ['simple','crowded']},officialEvaluatorLog=log.getvalue())
    result=dict(stage=stage,images=len(rows),objects=sum(not o['iscrowd'] for r in rows for o in r['objects']),models=summaries,
        methodology='pycocotools 2.0.10 bbox AP .50:.95, 101 recall points, maxDets100; tiny selected COCO val subset, not official full COCO benchmark',limitations=manifest['limitations'])
    (root/f'{stage}-evaluation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:dict(map=round(v['map'],4),ap50=round(v['ap50'],4),latency=v['latency'],thresholds={t:{q:m[q] for q in ['tp','fp','fn','f1']} for t,m in v['operating'].items()}) for k,v in summaries.items()}))
    return result
def select(root):
    root=Path(root).resolve()
    if (root/'selection-lock.json').exists():raise ValueError('Selection already frozen; do not overwrite its validation evidence')
    evaluation=evaluate(root,'validation');candidates=[]
    for name,m in evaluation['models'].items():
        if name=='lite0-cap12' or m['latency']['p95Ms']>500 or m['memory']['after']['rssMiB']>2048:continue
        for threshold,v in m['operating'].items():
            # Validation revealed many false names at .25. Prefer an observed precision floor;
            # this amendment is recorded before the final test and is not a calibration claim.
            if v['precision']>=.85:candidates.append((v['f1'],m['map'],-m['latency']['medianMs'],name,float(threshold)))
    if not candidates:raise ValueError('No model qualified for camera budget')
    best=max(candidates);image=max(evaluation['models'],key=lambda k:evaluation['models'][k]['map'])
    path=root/'selection-lock.json'
    if path.exists():raise ValueError('Selection already frozen; do not tune on final test')
    selected=dict(cameraModel=best[3],threshold=best[4],stillImageAPWinner=image,validationEvaluationSha256=sha(root/'validation-evaluation.json'),cohortSha256=sha(root/'manifest.json'),
        rule='maximum validation F1 with observed precision>=.85, then AP, then latency, p95<=500ms, browser tree RSS<=2048MiB',
        protocolAmendment='Validation-only: false-name analysis added observed precision floor .85 before opening final predictions; not calibrated population precision',
        detectorSourceSha256=sha('client/src/lib/vision/qualityProviders.ts'),finalTestOpened=False,training=False,phoneValidated=False)
    path.write_text(json.dumps(selected,indent=2),encoding='utf-8');print(json.dumps(selected))
if __name__=='__main__':
    if sys.argv[2]=='select':select(sys.argv[1])
    else:evaluate(sys.argv[1],sys.argv[2])
