"""Export the validation-selected real-trained checkpoint; fresh reload and CPU ORT parity."""
from pathlib import Path
import json,sys
import numpy as np
import onnx,onnxruntime as ort,torch
from common import read,sha,corpus,model_from,prepare_image
root=Path(sys.argv[1]).resolve();torch.set_num_threads(2)
manifest,names=corpus(root);training=root/'training'
choice=read(root/'training-choice.json')['selected'];source=root/choice['directory']
selection=read(source/'selection-lock.json');report=read(source/'training-report.json')
checkpoint=source/selection['checkpoint']
assert sha(checkpoint)==selection['checkpointSha256'] and report['optimizerSteps']>0 and report['weightsChanged'] and report['backwardExecuted']
assert selection['cohortSha256']==sha(root/'manifest.json') and selection['finalTestOpened'] is False
model=model_from(root,checkpoint)
initial=model_from(root)
changed=[name for name,p in model.head.state_dict().items() if not torch.equal(p,initial.head.state_dict()[name])]
assert changed, 'Selected checkpoint must actually contain trained weights'
torch.save(dict(model=model.state_dict(),classNames=names),training/'weights-only.pth')
row=next(r for r in manifest['samples'] if r['split']=='validation');tensor,_=prepare_image(root,row,names)
with torch.no_grad():expected=model(tensor).numpy()
path=training/'basira_objects_v1.onnx'
if path.exists():raise ValueError('ONNX already exported; do not overwrite evidence')
torch.onnx.export(model,tensor,path,opset_version=17,input_names=['images'],output_names=['output'],do_constant_folding=True,dynamo=False)
onnx.checker.check_model(str(path))
options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
assert session.get_inputs()[0].shape==[1,3,416,416] and session.get_outputs()[0].shape==[1,3549,85]
actual=session.run(['output'],{'images':tensor.numpy()})[0]
np.testing.assert_allclose(actual,expected,rtol=1e-3,atol=1e-4)
with torch.no_grad():before=initial(tensor).numpy()
baseline=ort.InferenceSession(str(root.parent/'object-quality-002/assets/yolox/yolox_tiny.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
baseline_output=baseline.run(None,{'images':tensor.numpy()})[0]
initial_delta=float(np.max(np.abs(before-baseline_output)))
result=dict(trainingRun=choice['directory'],selectedCheckpointEpoch=choice['checkpointEpoch'],selectedCheckpointOptimizerSteps=choice['checkpointOptimizerSteps'],selectedCheckpointTrainImages=choice['checkpointTrainImages'],modelSha256=sha(path),bytes=path.stat().st_size,checkpointSha256=sha(checkpoint),weightsOnlySha256=sha(training/'weights-only.pth'),checkerPassed=True,inputs={'images':[1,3,416,416]},outputs={'output':[1,3549,85]},freshCPUInference=True,torchOnnxMaxAbsoluteError=float(np.max(np.abs(actual-expected))),trainedOutputChangeFromInitialization=float(np.max(np.abs(actual-before))),selectedChangedHeadTensors=len(changed),officialCheckpointVersusPreviousOnnxMaxError=initial_delta,officialInitializationMatchesPreviousOnnx=bool(np.allclose(before,baseline_output,rtol=1e-3,atol=1e-4)),realValidationImageId=row['id'],referenceLabelsUsedInInference=False,preprocess='BGR float32 0..255, CHW, top-left letterbox114',rawGridOutput=True,phoneTested=False)
(training/'onnx-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
