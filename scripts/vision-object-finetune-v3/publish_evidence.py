"""Only aggregate metrics/hashes for Git; no photos, keys, tokens or model bytes."""
from pathlib import Path
import json,sys
from rights import read,sha
from native import evaluate_rows

root=Path(sys.argv[1]).resolve();repo=Path(__file__).resolve().parents[2]
final=read(root/'test-evaluation.json');manifest=read(root/'manifest.json');errors=read(root/'final-errors.json')
train=read(root/'training/selection-lock.json');tests=read(root/'vitest-final.json')
camera=read(root/'camera-browser-v3-001.json');browser=read(root/'browser/browser-validation.json');tls=read(root/'phone-https-validation-002.json')
assert tests['numPassedTests']==tests['numTotalTests'] and tests['numFailedTests']==0
assert not browser['uploads'] and browser['modelId']=='objects-basira-v3' and browser['corruptedModelRejected']
models={}
rows=[r for r in manifest['samples'] if r['split']=='test'];names=[c['name'] for c in manifest['categories']]
for name,m in final['models'].items():
    predictions={p['id']:p for p in read(root/'results/test'/f'{name}.json')['predictions']}
    lighting={}
    for bucket,low,high in [('low_proxy',0,50),('medium_proxy',50,100),('bright_proxy',100,256)]:
        selected=[r for r in rows if r['source']=='uroac' and low<=r['meanLuminanceProxy']<high]
        if selected:lighting[bucket]=dict(images=len(selected),operating=evaluate_rows(selected,{r['id']:predictions[r['id']] for r in selected},names,m['threshold'],compute_ap=False)['overall'])
    models[name]=dict(modelSha256=m['modelSha256'],operating=m['overall'],map=m['map'],inputSize=m['inputSize'],threshold=m['threshold'],
        latency=m['latency'],browserProcessTreeRssAfterMiB=m['memory']['after']['rssMiB'],
        perClass={c:{k:v for k,v in metric.items() if k not in ['missedExamples','falsePositiveExamples']} for c,metric in m['perClass'].items()},
        perSource={s:dict(operating=r['overall'],map=r['map'],coverage=r['coverage']) for s,r in m['perSource'].items()},
        groups=m['groups'],sizeRecall=errors['models'][name]['sizeRecall'],illuminationDiagnostic=lighting,licenceStatus=m['licenceStatus'])
files=['manifest.json','cohort-lock.json','protocol.json','study-design.json','neck-study-design.json','rights-audit.json',
    'strict-coco-licence-audit.json','rights-inventory.json','selection-lock.json','training/selection-lock.json','training/onnx-report.json',
    'test-evaluation.json','validation-evaluation.json','basira-knowledge.json','final-errors.json','camera-browser-v3-001.json',
    'phone-https-validation-002.json','motion-comparison.json']
snapshot=dict(schemaVersion=1,baseCommit='8bf3576',cohort=dict(images=len(manifest['samples']),trainImages=sum(r['split']=='train' for r in manifest['samples']),
    validationImages=sum(r['split']=='validation' for r in manifest['samples']),testImages=final['images'],testGroups=final['sceneGroups'],references=final['referenceObjects']),
    rights=dict(bddTrainingImages=0,restrictedAncestorsUsed=False,originalTinySha256=train['initialTinySha256'],
        admittedCocoSourcePagesVerified=read(root/'strict-coco-licence-audit.json')['imagesVerified'],
        upstreamOriginalPretrainingPhotosReaudited=False,productionApproval=False),
    training=dict(configurations=len(train['candidates']),totalOptimizerSteps=train['totalOptimizerSteps'],selectedConfig=train['selected']['config'],
        selectedEpoch=train['selected']['selectedEpoch'],selectedSteps=train['selected']['selectedOptimizerSteps'],
        selectedImages=train['selected']['actualTrainImagesInSelected'],changedHeadTensors=train['selected']['changedHeadTensors'],
        changedNeckTensors=train['selected'].get('changedNeckTensors',0),wallSeconds=train['wallSeconds'],cpuSeconds=train['cpuSeconds'],peakRssMiB=train['sampledPeakRssMiB'],threads=2),
    models=models,qualityConclusion='NO_MEANINGFUL_IMPROVEMENT_OVER_TINY_OR_V1_ON_THIS_FINAL',finalUsedForSelection=False,
    bootstrap=errors['pairedSceneBootstrap'],matchedGainsVsTiny=errors['matchedGainsVsTiny'],matchedLossesVsTiny=errors['matchedLossesVsTiny'],
    camera=dict(status=camera['status'],physicalCameraTested=camera['physicalCameraTested'],
        sceneVariationObserved=camera['sceneVariationObserved'],measurement=camera['measurement'],memoryAfter=camera['memoryAfterAnalysis'],
        sourceOverridden=False,rawFramesSaved=False,accuracy=None,appStopEndsTracks=camera['appStopEndsTracks']),
    tests=dict(vitest=tests['numPassedTests'],browserRollbackVerified=browser['previousTinyRollbackVerified'],
        corruptedModelRejected=browser['corruptedModelRejected'],softwareCameraNotPhysical=True),
    motion=[r['summary'] for r in read(root/'motion-comparison.json')['results']],
    phone=dict(status='NOT_RUN_ON_IPHONE',tlsStatus=tls['status'],interceptionObserved=tls.get('interceptionObserved'),
        observedIssuer=tls.get('observedIssuer'),certificateVerificationBypassed=False,trustOrProtectionChanged=False,latency=None,memory=None),
    masksEnabled=False,navigationEligible=False,productionEligible=False,
    caveats=['Only13 independent-author COCO images and one conservative UrOAC visual/source component in final.',
        'Small-object area uses saved evaluation RGB dimensions, not unresized phone sensor originals.',
        'Lighting bins are computed brightness proxies and diagnostic only, not independent lighting GT.',
        'Browser RSS includes decode/canvas/data URLs over the whole offline cohort, not model-only or phone memory.',
        'No live-scene or independent video track-identity accuracy claim.'],inputSha256={p:sha(root/p) for p in files})
target=repo/'docs/vision-ai-evidence/object-finetune-v3/results.json';target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'comparison-summary.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'final-consumption-receipt.json').write_text(json.dumps(dict(finalTestOpened=True,selectionLockIsPreOpenSnapshot=True,
    selectionLockSha256=sha(root/'selection-lock.json'),finalUsedForSelection=False,finalReportSha256=sha(root/'test-evaluation.json'),
    note='Consumed final: no further model or threshold tuning may claim this as a fresh final'),indent=2))
print(json.dumps(dict(output=str(target),models=len(models),imagesPublished=0,weightsPublished=0,quality=snapshot['qualityConclusion'])))
