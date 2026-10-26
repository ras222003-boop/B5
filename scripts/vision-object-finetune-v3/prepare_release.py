"""Measured knowledge + evidence-bound local V3 registry; never production publish."""
from pathlib import Path
from collections import Counter
import hashlib,json,shutil,sys
from rights import read,sha,check_row,TINY_SHA
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-finetune-v2'))
from knowledge import generate_registry,save_registry

root=Path(sys.argv[1]).resolve();repo=Path(__file__).resolve().parents[2]
manifest=read(root/'manifest.json');selection=read(root/'training/selection-lock.json');chosen=selection['selected']
onnx=read(root/'training/onnx-report.json');final=read(root/'test-evaluation.json');audit=read(root/'rights-audit.json')
assert read(root/'strict-coco-licence-audit.json')['passed'] is True
assert selection['initialTinySha256']==TINY_SHA and not selection['usedRestrictedSources'] and not selection['usedV1OrV2WeightsOrTeacher']
assert onnx['modelSha256']==sha(root/'training/basira_objects_v3.onnx')==final['models']['objects-basira-v3']['modelSha256']
assert onnx['checkerPassed'] and onnx['freshCPUInference']
assert chosen['checkpointSha256']==sha(root/chosen['checkpoint']) and chosen['checkpointSha256'] not in audit['deniedWeightHashes']
train_ids=set(chosen['selectedTrainedImageIds']);training_rows=[r for r in manifest['samples'] if r['id'] in train_ids]
assert len(training_rows)==len(train_ids) and all(r['split']=='train' for r in training_rows)
attributions=[dict(imageId=r['id'],datasetSource=r['source'],**check_row(root,r)) for r in training_rows]
v1=root.parent/'object-finetune-v1-001';v2=root.parent/'object-finetune-v2-001'
v1_ids=[r['id'] for r in read(v1/'manifest.json')['samples'] if r['split']=='train'][:8]
stage1=dict(manifestPath=str(v1/'manifest.json'),manifestSha256=sha(v1/'manifest.json'),trainedImageIds=v1_ids,
    checkpointPath=str(v1/'training/best.pth'),checkpointSha256=sha(v1/'training/best.pth'),selectedOnlyOnValidation=True,referencesIndependent=True)
prior=read(v2/'training/selection-lock.json')['selected']
stage2=dict(manifestPath=str(v2/'manifest.json'),manifestSha256=sha(v2/'manifest.json'),trainedImageIds=prior['selectedTrainedImageIds'],
    checkpointPath=str(v2/prior['checkpoint']),checkpointSha256=prior['checkpointSha256'],selectedOnlyOnValidation=True,referencesIndependent=True,
    researchOnly=True,usageRestrictions=['BDD derivative: local research only; excluded from V3 ancestry'])
stage3=dict(manifestPath='manifest.json',manifestSha256=sha(root/'manifest.json'),trainedImageIds=chosen['selectedTrainedImageIds'],
    checkpointPath=chosen['checkpoint'],checkpointSha256=chosen['checkpointSha256'],selectedOnlyOnValidation=True,referencesIndependent=True,
    usageRestrictions=manifest['licenceRestrictions'])
descriptors=[]
for name in ['lite0','yolox-tiny','objects-basira-v1','objects-basira-v2','objects-basira-v3']:
    measured=read(root/'results/test'/f'{name}.json')
    stages=[stage3] if name.endswith('-v3') else [stage1,stage2] if name.endswith('-v2') else [stage1] if name.endswith('-v1') else []
    descriptors.append(dict(id=name,name=name,modelSha256=measured['modelSha256'],predictionsPath=f'results/test/{name}.json',
        inheritedClasses='coco80',threshold=measured['config'].get('threshold',.5),trainingStages=stages))
config=root/'knowledge-models.json';config.write_text(json.dumps(dict(models=descriptors),indent=2),encoding='utf-8')
registry=generate_registry(root,config,repo/'client/src/lib/vision/cocoLabels.ts')
for model in registry['models']:
    model['runtimeProfileId']='original' if model['id']=='lite0' else 'objects-yolox-tiny' if model['id']=='yolox-tiny' else model['id']
    if model['id']=='objects-basira-v3':
        model.update(commercialTrainingAllowed=True,licenceEligibility='PER_SOURCE_GRANTS_VERIFIED_WITH_ATTRIBUTION_NOT_PRODUCTION_APPROVAL',
            initialWeightPermission='Official original YOLOX publisher Apache-2.0 grant; original full pretraining image corpus not re-audited',
            rightsAuditSha256=sha(root/'rights-audit.json'),usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False)
    elif model['id']=='objects-basira-v1':model['licenceEligibility']='PRIOR_CC_BY_RECORDS_SOURCE_PAGES_NOT_ARCHIVED_REAUDIT_BEFORE_COMMERCIAL_USE'
registry['provenance'].update(v3WrapperSourceSha256=sha(Path(__file__)),rightsAuditSha256=sha(root/'rights-audit.json'))
registry['inputFingerprint']=hashlib.sha256(json.dumps(registry['provenance'],sort_keys=True).encode()).hexdigest()
registry['canonicalIndexMeaning']='outputIndex is canonical COCO vocabulary index; not a raw MediaPipe tensor position'
save_registry(registry,root/'basira-knowledge.json')
destination=repo/'.vision-ai/object-quality/finetuned-v3';assert not destination.exists(),'Preserve an existing release'
(destination/'yolox').mkdir(parents=True)
shutil.copyfile(root/'training/basira_objects_v3.onnx',destination/'yolox/yolox_tiny.onnx')
shutil.copyfile(root/'assets/upstream/LICENSE',destination/'yolox/LICENSE')
shutil.copyfile(root/'basira-knowledge.json',destination/'basira-knowledge.json')
lineage=dict(modelSha256=onnx['modelSha256'],checkpointSha256=chosen['checkpointSha256'],initialTinySha256=TINY_SHA,
    usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False,commercialTrainingAllowed=True,productionEligible=False,
    manifestSha256=sha(root/'manifest.json'),rightsAuditSha256=sha(root/'rights-audit.json'),trainingImages=len(train_ids),
    trainingSources=dict(Counter(r['source'] for r in training_rows)),
    usage='Experimental only. Retain all licence/attribution notices. No navigation or automatic production approval.',
    upstreamPermissionLimit='Publisher model grant verified; not an audit of every original pretraining photograph.')
(destination/'yolox/LINEAGE.json').write_text(json.dumps(lineage,indent=2))
(destination/'yolox/DATA-ATTRIBUTIONS.json').write_text(json.dumps(attributions,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copyfile(root/'rights-evidence/ycb-license.txt',destination/'yolox/LICENSE-YCB')
assets={str(p.relative_to(destination)).replace('\\','/'):dict(sha256=sha(p),bytes=p.stat().st_size) for p in (destination/'yolox').iterdir()}
profile=dict(id='objects-basira-v3',name='بصيرة أشياء V3 — تدريب بمصادر مؤهلة، تقييم تجريبي',model='yolox-tiny',
    modelSha256=onnx['modelSha256'],threshold=chosen['selectedThreshold'],inputSize=chosen['inputSize'],
    navigationEligible=False,productionEligible=False,humanApproval=False,maskForStills=False,maskModel='slimsam-q8',
    maskQualification='REJECTED_FINAL',colorStatus='UNPROVEN',commercialTrainingAllowed=True,
    knowledgeSha256=sha(destination/'basira-knowledge.json'),lineageEvidenceSha256=sha(destination/'yolox/LINEAGE.json'),
    validationSha256=sha(root/'validation-evaluation.json'),assets=assets,
    trainingEvidence=dict(checkpointSha256=chosen['checkpointSha256'],optimizerSteps=chosen['selectedOptimizerSteps'],epochs=chosen['selectedEpoch'],
        onnxValidationSha256=sha(root/'training/onnx-report.json'),testEvaluationSha256=sha(root/'test-evaluation.json'),finalUsedForSelection=False),
    licence='YOLOX Apache-2.0 publisher checkpoint; YCB MIT; each fresh COCO training image CC BY2.0 verified and archived. No BDD ancestor.',
    usageRestrictions=manifest['licenceRestrictions'],qualification='Source training permission is separate from product, phone, accuracy and navigation qualification. All remain unapproved.')
(destination/'manifest.json').write_text(json.dumps(profile,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'local-release.json').write_text(json.dumps(dict(modelSha256=onnx['modelSha256'],profileSha256=sha(destination/'manifest.json'),
    knowledgeSha256=profile['knowledgeSha256'],lineageSha256=profile['lineageEvidenceSha256'],destination=str(destination),productionEligible=False),indent=2))
print(json.dumps(dict(model=profile['id'],modelSha256=profile['modelSha256'],inputSize=profile['inputSize'],threshold=profile['threshold'],trainingImages=len(train_ids),knowledgeModels=len(registry['models']),productionEligible=False)))
