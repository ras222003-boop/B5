"""Post-selection error diagnostics. Never selects weights or changes thresholds."""
from pathlib import Path
from collections import Counter, defaultdict
import json, sys
import numpy as np
from knowledge import evaluate_rows, _iou

root=Path(sys.argv[1]).resolve()
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
assert read(root/'selection-lock.json')['finalUsedForSelection'] is False
manifest=read(root/'manifest.json');rows=[r for r in manifest['samples'] if r['split']=='test']
names=[c['name'] for c in manifest['categories']]
models={};matched={};grouped={}
for name in ['lite0','yolox-tiny','objects-basira-v1','objects-basira-v2']:
    predictions={r['id']:r for r in read(root/'results/test'/f'{name}.json')['predictions']}
    matched[name]=set();sizes=defaultdict(Counter);reasons=Counter();fps=Counter();examples=[]
    for row in rows:
        refs=[o for o in row['objects'] if not o.get('iscrowd')]
        scope=set(names if row.get('completeLabels') else row['annotatedClasses'])
        candidates=sorted(predictions[row['id']]['detections'],key=lambda p:-p['confidence'])[:100]
        used=set()
        for p in candidates:
            if p['confidence']<.5 or p['cocoClass'] not in scope:continue
            box=list(p['boundingBox'].values()) if isinstance(p['boundingBox'],dict) else p['boundingBox']
            # Explicit field order rather than relying on JSON key ordering.
            if isinstance(p['boundingBox'],dict):box=[p['boundingBox'][k] for k in ['x','y','width','height']]
            options=[(_iou(o['box'],box),i) for i,o in enumerate(refs) if i not in used and o['class']==p['cocoClass']]
            overlap,index=max(options,default=(0.,-1))
            if overlap>=.5:used.add(index);matched[name].add((row['id'],refs[index]['id']))
            else:
                same=[o for o in refs if o['class']==p['cocoClass']]
                kind='duplicate' if any(_iou(o['box'],box)>=.5 for o in same) else 'localization' if any(_iou(o['box'],box)>=.1 for o in same) else 'no_matching_reference'
                fps[kind]+=1
        for i,o in enumerate(refs):
            area=o['box'][2]*row['width']*o['box'][3]*row['height']
            bucket='small_lt32sq' if area<32**2 else 'medium_32to96sq' if area<96**2 else 'large_ge96sq'
            sizes[bucket]['referenceCount']+=1;sizes[bucket]['tp' if i in used else 'fn']+=1
            if i in used:continue
            same=[p for p in candidates if p['cocoClass']==o['class']]
            def b(p):return [p['boundingBox'][k] for k in ['x','y','width','height']]
            aligned=[p for p in same if _iou(o['box'],b(p))>=.5]
            reason='below_threshold' if aligned and max(p['confidence'] for p in aligned)<.5 else 'localization' if any(_iou(o['box'],b(p))>=.1 for p in same) else 'no_matching_proposal'
            reasons[reason]+=1
            if len(examples)<16:examples.append(dict(imageId=row['id'],className=o['class'],objectId=o['id'],reason=reason,box=o['box']))
    groups=defaultdict(list)
    for row in rows:groups[(row['source'],row['groupId'])].append(row)
    grouped[name]={g:evaluate_rows(rs,{r['id']:predictions[r['id']] for r in rs},names,.5,compute_ap=False)['overall'] for g,rs in groups.items()}
    operating=read(root/'test-evaluation.json')['models'][name]['overall']
    assert sum(v['tp'] for v in sizes.values())==operating['tp']==len(matched[name])
    assert sum(fps.values())==operating['fp']
    models[name]=dict(sizeRecall={k:dict(referenceCount=v['referenceCount'],tp=v['tp'],fn=v['fn'],
        recall=v['tp']/v['referenceCount']) for k,v in sizes.items()},
        missedReasons=dict(reasons),falsePositiveReasons=dict(fps),missedExamples=examples)

# A paired, source-stratified scene bootstrap: correlated video frames stay together.
rng=np.random.default_rng(20261026);sources=defaultdict(list)
for g in grouped['yolox-tiny']:sources[g[0]].append(g)
deltas=[]
for _ in range(10000):
    chosen=[groups[i] for groups in sources.values() for i in rng.integers(0,len(groups),size=len(groups))]
    metrics=[]
    for name in ['yolox-tiny','objects-basira-v2']:
        totals={k:sum(grouped[name][g][k] for g in chosen) for k in ['tp','fp','fn']}
        metrics.append([totals['tp']/(totals['tp']+totals['fn']),2*totals['tp']/(2*totals['tp']+totals['fp']+totals['fn'])])
    deltas.append(np.subtract(metrics[1],metrics[0]))
ci=np.quantile(deltas,[.025,.975],axis=0)
diagnostic=dict(models=models,matchedGainsVsTiny=len(matched['objects-basira-v2']-matched['yolox-tiny']),
    matchedLossesVsTiny=len(matched['yolox-tiny']-matched['objects-basira-v2']),
    pairedSceneBootstrap=dict(replicates=10000,seed=20261026,sourceStratified=True,
        recallDelta95=ci[:,0].tolist(),f1Delta95=ci[:,1].tolist(),
        limitation='Descriptive small-cohort interval, especially only three YCB scenes; not population or safety qualification'),
    finalUsedForSelection=False,threshold=.5,
    sizeMeaning='COCO-style bbox area in original pixels, not segmentation area; bins are diagnostic, no retuning',
    reasonMeaning='Output-based diagnostics, not a proven physical cause; low-threshold proposals are limited to top100')
(root/'final-errors.json').write_text(json.dumps(diagnostic,indent=2),encoding='utf-8')
print(json.dumps(dict(gained=diagnostic['matchedGainsVsTiny'],lost=diagnostic['matchedLossesVsTiny'],
    bootstrap=diagnostic['pairedSceneBootstrap'],v2=models['objects-basira-v2'])))
