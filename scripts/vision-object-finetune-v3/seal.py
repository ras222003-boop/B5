"""Immutable validated-model selection before the fresh final cohort is inferred."""
from pathlib import Path
import json,sys
from rights import read,sha,TINY_SHA

root=Path(sys.argv[1]).resolve()
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists()
training=read(root/'training/selection-lock.json');onnx=read(root/'training/onnx-report.json');val=read(root/'validation-evaluation.json')
assert training['selectedOnlyOnValidation'] is True and training['finalUsedForSelection'] is False
assert onnx['modelSha256']==val['models']['objects-basira-v3']['modelSha256']==sha(root/'training/basira_objects_v3.onnx')
assert onnx['checkerPassed'] and onnx['freshCPUInference'] and training['initialTinySha256']==TINY_SHA
record=dict(cohortSha256=sha(root/'manifest.json'),detectorSourceSha256=sha('client/src/lib/vision/qualityProviders.ts'),
    validationEvaluationSha256=sha(root/'validation-evaluation.json'),trainingSelectionSha256=sha(root/'training/selection-lock.json'),
    modelSha256=onnx['modelSha256'],inputSize=onnx['inputSize'],threshold=training['selected']['selectedThreshold'],
    selectedOnlyOnValidation=True,finalUsedForSelection=False,finalTestOpened=False,
    usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False,commercialTrainingAllowed=True,
    productionEligible=False,phoneValidated=False)
(root/'selection-lock.json').write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record))
