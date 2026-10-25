"""Local opt-in only, with actual checkpoint/ONNX/evaluation evidence. No default promotion."""
from pathlib import Path
import json,shutil,sys
from common import read,sha,corpus
root=Path(sys.argv[1]).resolve();manifest,names=corpus(root)
choice=read(root/'training-choice.json')['selected'];export=read(root/'training/onnx-report.json');selection=read(root/'selection-lock.json')
validation=read(root/'validation-evaluation.json');final=read(root/'test-evaluation.json')
assert selection['validationEvaluationSha256']==sha(root/'validation-evaluation.json')
assert choice['checkpointSha256']==sha(root/choice['checkpoint'])==export['checkpointSha256']
assert choice['checkpointOptimizerSteps']>0 and export['selectedChangedHeadTensors']>0 and export['checkerPassed'] and export['freshCPUInference']
assert final['models']['objects-basira-v1']['modelSha256']==export['modelSha256']==sha(root/'training/basira_objects_v1.onnx')
assert selection['detectorSourceSha256']==sha(Path('client/src/lib/vision/qualityProviders.ts'))
out=Path('.vision-ai/object-quality/finetuned').resolve()
assert 'public' not in out.parts and 'dist' not in out.parts
out.mkdir(parents=True,exist_ok=True);(out/'yolox').mkdir(exist_ok=True)
shutil.copyfile(root/'training/basira_objects_v1.onnx',out/'yolox/yolox_tiny.onnx')
shutil.copyfile(root/'assets/upstream/LICENSE',out/'yolox/LICENSE')
assets={p.relative_to(out).as_posix():dict(sha256=sha(p),bytes=p.stat().st_size) for p in (out/'yolox').iterdir() if p.is_file()}
new=final['models']['objects-basira-v1'];old=final['models']['yolox-tiny'];improved=new['operating']['0.5']['f1']>old['operating']['0.5']['f1'] and new['map']>=old['map']
profile=dict(id='objects-basira-v1',name='بصيرة أشياء V1 — تدريب فعلي، تحسن غير مثبت',model='yolox-tiny',modelSha256=export['modelSha256'],threshold=.5,navigationEligible=False,productionEligible=False,humanApproval=False,maskForStills=False,maskModel='slimsam-q8',maskQualification='REJECTED_FINAL',colorStatus='UNPROVEN',validationSha256=sha(root/'validation-evaluation.json'),assets=assets,
    trainingEvidence=dict(checkpointSha256=choice['checkpointSha256'],optimizerSteps=choice['checkpointOptimizerSteps'],epochs=choice['checkpointEpoch'],onnxValidationSha256=sha(root/'training/onnx-report.json'),testEvaluationSha256=sha(root/'test-evaluation.json'),finalUsedForSelection=False),
    evaluation=dict(finalImages=final['images'],finalObjects=final['objects'],map=new['map'],precision=new['operating']['0.5']['precision'],recall=new['operating']['0.5']['recall'],falsePositives=new['operating']['0.5']['fp'],improvementOverPreviousDemonstrated=False,numericallyImprovedOnTinySubset=improved),
    licence='Apache-2.0 upstream code/checkpoint; CC BY image attribution held with local data',qualification='Real-trained prototype on 8 selected-checkpoint images, nine independent final images; no population, colour, identity or phone qualification. Original remains default.')
(out/'manifest.json').write_text(json.dumps(profile,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(dict(localRegistry=str(out),id=profile['id'],modelSha256=export['modelSha256'],productionEligible=False,maskForStills=False)))
