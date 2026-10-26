"""Export aggregate measured evidence only. Never publishes images or model assets."""
from pathlib import Path
import hashlib,json,sys

root=Path(sys.argv[1]).resolve();repo=Path(__file__).resolve().parents[2]
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
final=read(root/'test-evaluation.json');training=read(root/'training/selection-lock.json')
knowledge=read(root/'basira-knowledge.json');errors=read(root/'final-errors.json')
camera=read(root/'camera/browser-v2-001.json');browser=read(root/'browser-recheck-002/browser-validation.json')
tests=read(root/'vitest.json');onnx=read(root/'training/onnx-report.json')
assert tests['numPassedTests']==tests['numTotalTests'] and tests['numFailedTests']==0
assert browser['modelSha256']==camera['modelSha256']==onnx['modelSha256']
assert browser['corruptedModelRejected'] and browser['originalProviderRestarted'] and not browser['uploads']
models={}
for name,m in final['models'].items():
    entry=next(k for k in knowledge['models'] if k['id']==name)
    models[name]=dict(modelSha256=m['modelSha256'],operating=m['overall'],map=m['map'],
        latency=m['latency'],browserTreeRssMiB=m['memory']['after']['rssMiB'],groups=m['groups'],
        perSource={s:dict(operating=v['overall'],map=v['map'],coverage=v['coverage']) for s,v in m['perSource'].items()},
        perClass={n:{k:v for k,v in c.items() if k not in ['missedExamples','falsePositiveExamples']}
            for n,c in m['perClass'].items()},
        selectedAdditionalTrainingImages=entry['training']['selectedTrainingUniqueImages'],
        inheritedClasses=entry['inheritedClassCount'],furtherTrainedClasses=entry['furtherTrainedClasses'],
        evaluatedClasses=entry['evaluatedClasses'],sizeRecall=errors['models'][name]['sizeRecall'])
checks=dict(vitestPassed=tests['numPassedTests'],onnxCheckerPassed=onnx['checkerPassed'],
    freshNativeCpuInference=onnx['freshCPUInference'],torchOnnxMaxAbsoluteError=onnx['torchOnnxMaxAbsoluteError'],
    actualBasiraPhotoInference=True,corruptedModelRejected=browser['corruptedModelRejected'],
    rollbackToPrevious=browser['previousTinyRollbackVerified'],rollbackToOriginal=browser['originalProviderRestarted'],
    softwareCameraTracksStopped=browser['tracksStopped'],physicalCameraTracksStopped=camera['appStopEndsTracks'],
    physicalCameraTested=camera['physicalCameraTested'],physicalLiveSceneVariationVerified=camera['sceneVariationObserved'],
    physicalCameraStatus=camera['status'],physicalCameraAccuracy=None,iphoneTested=False,masksEnabled=False)
inputs=['manifest.json','cohort-lock.json','protocol.json','selection-lock.json','training/selection-lock.json',
    'training/onnx-report.json','test-evaluation.json','validation-evaluation.json','final-errors.json',
    'basira-knowledge.json','motion-comparison.json','camera/browser-v2-001.json','camera/phone-preflight-v2.json']
receipt=dict(schemaVersion=1,cohort=dict(images=final['images'],sourceGroups=final['sceneGroups'],
    references=final['referenceObjects'],dataAudit=read(root/'data-audit.json')),
    models=models,threshold=.5,metricsScope=final['metricsScope'],modelsSelectedOnlyOnValidation=True,
    finalUsedForSelection=False,bootstrap=errors['pairedSceneBootstrap'],
    optimizerStepsExecuted=training['totalOptimizerSteps'],selectedOptimizerSteps=training['selected']['selectedOptimizerSteps'],
    selectedConfig=training['selected']['config'],selectedEpoch=training['selected']['selectedEpoch'],
    interruptedCandidates=training['unfinishedCandidates'],checks=checks,
    physicalCamera=dict(measurement=camera['measurement'],memoryBefore=camera['memoryBeforeCamera'],
        memoryAfter=camera['memoryAfterAnalysis'],rawFramesSaved=False,mediaUploaded=False),
    motion=[r['summary'] for r in read(root/'motion-comparison.json')['results']],
    researchOnlyData=True,commercialEligibility=False,productionEligible=False,navigationEligible=False,
    colourAccuracy=None,identityAccuracy=None,iphoneLatency=None,iphoneMemory=None,
    limitations=['Only nine classes have positive final references.',
        'Partial labels: out-of-scope detections ignored, never confirmed correct.',
        'Only three YCB final scenes; repeated physical instances and sites not independent.',
        'Higher V2 recall/AP accompanies more false positives and very poor small-object recall.',
        'Current physical V2 frames static; camera transport/inference measured, changing scene not verified.',
        'BDD research-only licence; no commercial or production qualification.',
        'Soft training time limit overshot; incomplete third candidate excluded.'],
    inputSha256={p:sha(root/p) for p in inputs})
target=repo/'docs/vision-ai-evidence/object-finetune-v2/results.json'
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(path=str(target),bytes=target.stat().st_size,models=len(models),imagesPublished=0,weightsPublished=0)))
