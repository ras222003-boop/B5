"""Seal model/threshold/source after validation and before any new final predictions."""
from pathlib import Path
import sys,json
from common import read,sha,corpus
root=Path(sys.argv[1]).resolve();manifest,names=corpus(root)
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-quality'))
from evaluate import evaluate
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists()
choice=read(root/'training-choice.json')['selected'];source=root/choice['directory']
training=read(source/'selection-lock.json');onnx=read(root/'training/onnx-report.json')
assert sha(source/training['checkpoint'])==training['checkpointSha256']
assert onnx['checkerPassed'] and onnx['freshCPUInference'] and sha(root/'training/basira_objects_v1.onnx')==onnx['modelSha256']
evaluation=evaluate(root,'validation')
assert set(evaluation['models'])=={'lite0','yolox-tiny','objects-basira-v1'}
assert evaluation['models']['objects-basira-v1']['modelSha256']==onnx['modelSha256']
record=dict(cameraModel='objects-basira-v1',threshold=.5,cohortSha256=sha(root/'manifest.json'),detectorSourceSha256=sha(Path('client/src/lib/vision/qualityProviders.ts')),validationEvaluationSha256=sha(root/'validation-evaluation.json'),trainingSelectionSha256=sha(root/'training/selection-lock.json'),onnxSha256=onnx['modelSha256'],finalTestOpened=False,training=True,phoneValidated=False,rule='Real-trained checkpoint selected by validation F1/AP, fixed threshold .5; research option, no automatic production promotion',browserValidationImproved=evaluation['models']['objects-basira-v1']['operating']['0.5']['f1']>evaluation['models']['yolox-tiny']['operating']['0.5']['f1'])
(root/'selection-lock.json').write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record))
