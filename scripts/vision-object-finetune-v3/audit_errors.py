"""Historical consumed V2 errors: diagnostic only, excluded from V3 fitting/selection."""
from collections import Counter
from pathlib import Path
import json,re,sys
import numpy as np
from rights import ROOT,PREVIOUS,read,sha

manifest=read(PREVIOUS/'manifest.json');rows=[r for r in manifest['samples'] if r['split']=='test']
names=[c['name'] for c in manifest['categories']]
assert names[9]=='traffic light' and manifest['categories'][9]['id']==10
installed=re.findall(r'^  \["([^"]+)",',Path('client/src/lib/vision/cocoLabels.ts').read_text(),re.M)
assert installed==names
boxes=[];lights=[]
for row in rows:
    for obj in row['objects']:
        w,h=obj['box'][2]*row['width'],obj['box'][3]*row['height'];ratio=min(416/row['width'],416/row['height'])
        value=dict(imageId=row['id'],className=obj['class'],width=w,height=h,area=w*h,
            networkWidth=w*ratio,networkHeight=h*ratio,minStrideCells=min(w,h)*ratio/8)
        if w*h<32**2:boxes.append(value)
        if obj['class']=='traffic light':lights.append(value)
def describe(items):
    return dict(instances=len(items),medianNetworkWidth=float(np.median([i['networkWidth'] for i in items])),
        medianNetworkHeight=float(np.median([i['networkHeight'] for i in items])),
        minSideBelow4Pixels=sum(min(i['networkWidth'],i['networkHeight'])<4 for i in items),
        minSideBelowStride8=sum(min(i['networkWidth'],i['networkHeight'])<8 for i in items))
evaluation=read(PREVIOUS/'test-evaluation.json')['models']['objects-basira-v2']
errors=read(PREVIOUS/'final-errors.json')['models']['objects-basira-v2']
record=dict(mappingChecked=True,trafficLightCocoCategoryId=10,trafficLightContiguousOutputIndex=9,
    smallObjects=describe(boxes),trafficLights=describe(lights),v2SmallRecall=errors['sizeRecall']['small_lt32sq'],
    trafficLightMetrics=evaluation['perClass']['traffic light'],falsePositiveReasons=errors['falsePositiveReasons'],
    perClassFalsePositives={n:m['fp'] for n,m in evaluation['perClass'].items() if m['fp']},
    preprocessingContractPreviouslyPassed=read(PREVIOUS/'preprocess-parity.json'),
    possibleCauses=['416px letterbox collapses most small objects below one stride cell',
        'Frozen original backbone cannot learn new low-level tiny-object features',
        'V2 partial-label loss can shift confidence/position without improving precise AP',
        'Road/car imbalance and weak daily-object coverage; rare classes lack independent positives'],
    causalityProven=False,historicalFinalAlreadyConsumed=True,trainingEligible=False,
    maySelectV3WeightsOrThresholds=False,referencesAreModelPredictions=False,
    sourceManifestSha256=sha(PREVIOUS/'manifest.json'))
(ROOT/'historical-error-audit.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps(dict(mappingChecked=True,small=record['smallObjects'],lights=record['trafficLights'],falsePositives=record['perClassFalsePositives'])))
