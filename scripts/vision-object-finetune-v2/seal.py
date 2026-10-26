"""Bind exact validated/browser-tested weights before final inference. Does not retune."""
from pathlib import Path
import hashlib,json,sys
root=Path(sys.argv[1]).resolve();read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists()
chosen=read(root/'training/selection-lock.json');onnx=read(root/'training/onnx-report.json');validation=read(root/'validation-evaluation.json')
assert chosen['finalUsedForSelection'] is False and chosen['selectedOnlyOnValidation'] is True
assert onnx['modelSha256']==sha(root/'training/basira_objects_v2.onnx')==validation['models']['objects-basira-v2']['modelSha256']
assert onnx['checkerPassed'] and onnx['freshCPUInference']
record=dict(cameraModel='objects-basira-v2',threshold=.5,cohortSha256=sha(root/'manifest.json'),detectorSourceSha256=sha(Path('client/src/lib/vision/qualityProviders.ts')),validationEvaluationSha256=sha(root/'validation-evaluation.json'),modelSha256=onnx['modelSha256'],trainingSelectionSha256=sha(root/'training/selection-lock.json'),selectedOnlyOnValidation=True,finalUsedForSelection=False,finalTestOpened=False,researchOnlyData=True,phoneValidated=False)
(root/'selection-lock.json').write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record))
