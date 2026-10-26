"""Install an explicitly research-only, hash-bound local V2 profile; never publish.

The independent final result is descriptive and cannot choose another checkpoint.
This command does not modify the original model, default selection or navigation.
"""
from pathlib import Path
import hashlib, json, shutil, sys

root=Path(sys.argv[1]).resolve()
repo=Path(__file__).resolve().parents[2]
destination=repo/'.vision-ai/object-quality/finetuned-v2'
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
selection=read(root/'selection-lock.json')
training=read(root/'training/selection-lock.json')['selected']
onnx=read(root/'training/onnx-report.json')
final=read(root/'test-evaluation.json')
knowledge=read(root/'basira-knowledge.json')
assert selection['finalUsedForSelection'] is False
assert onnx['checkerPassed'] and onnx['freshCPUInference']
assert onnx['modelSha256']==selection['modelSha256']==sha(root/'training/basira_objects_v2.onnx')
assert final['models']['objects-basira-v2']['modelSha256']==onnx['modelSha256']
assert training['checkpointSha256']==onnx['checkpointSha256']==sha(root/training['checkpoint'])
assert training['selectedOptimizerSteps']>0 and training['backwardExecuted'] is True
assert knowledge['policy']['productionEligible'] is False
model=next(m for m in knowledge['models'] if m['id']=='objects-basira-v2')
assert model['modelSha256']==onnx['modelSha256'] and model['training']['researchOnly'] is True
assert model['training']['selectedTrainingUniqueImages']==training['actualTrainImagesInSelected']
assert knowledge['provenance']['selectionLockSha256']==sha(root/'selection-lock.json')
assert not destination.exists(), 'Preserve an existing release; never overwrite its evidence'
(destination/'yolox').mkdir(parents=True)
shutil.copyfile(root/'training/basira_objects_v2.onnx',destination/'yolox/yolox_tiny.onnx')
shutil.copyfile(repo/'.vision-ai/object-quality/yolox/LICENSE',destination/'yolox/LICENSE')
shutil.copyfile(root/'basira-knowledge.json',destination/'basira-knowledge.json')
assets={str(p.relative_to(destination)).replace('\\','/'):dict(sha256=sha(p),bytes=p.stat().st_size)
    for p in (destination/'yolox').iterdir()}
measured=final['models']['objects-basira-v2']
profile=dict(id='objects-basira-v2',name='بصيرة أشياء V2 — بحثي، تقييم محدود',
    model='yolox-tiny',modelSha256=onnx['modelSha256'],threshold=.5,
    navigationEligible=False,productionEligible=False,humanApproval=False,
    maskForStills=False,maskModel='slimsam-q8',maskQualification='REJECTED_FINAL',
    colorStatus='UNPROVEN',researchOnlyData=True,knowledgeSha256=sha(destination/'basira-knowledge.json'),
    validationSha256=sha(root/'validation-evaluation.json'),assets=assets,
    trainingEvidence=dict(checkpointSha256=training['checkpointSha256'],
        optimizerSteps=training['selectedOptimizerSteps'],epochs=training['selectedEpoch'],
        onnxValidationSha256=sha(root/'training/onnx-report.json'),
        testEvaluationSha256=sha(root/'test-evaluation.json'),finalUsedForSelection=False),
    evaluation=dict(finalImages=final['images'],finalGroups=final['sceneGroups'],
        finalObjects=final['referenceObjects'],operating=measured['overall'],map=measured['map'],
        improvementOverPreviousDemonstrated=False,phoneTested=False),
    licence='YOLOX Apache-2.0; YCB MIT; COCO per-image CC BY; BDD research/education/not-for-profit only. No commercial qualification.',
    usageRestrictions=read(root/'manifest.json')['licenceRestrictions'],
    qualification='Partial-source reference scope; synthetic evidence not used. No population, colour, identity, phone or navigation qualification. Original remains default.',
    knowledgeIndexMeaning='outputIndex is canonical COCO vocabulary order, not a raw MediaPipe tensor index')
(destination/'manifest.json').write_text(json.dumps(profile,ensure_ascii=False,indent=2),encoding='utf-8')
receipt=dict(destination=str(destination),profileSha256=sha(destination/'manifest.json'),
    modelSha256=onnx['modelSha256'],knowledgeSha256=profile['knowledgeSha256'],
    productionEligible=False,researchOnlyData=True)
(root/'local-release.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
print(json.dumps(receipt))
