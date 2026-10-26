"""Fresh real checkpoint reload, ONNX checker, CPU parity; no final pixels."""
from pathlib import Path
import hashlib,json,sys
import numpy as np,onnx,onnxruntime as ort,torch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-finetune'))
from common import model_from
root=Path(sys.argv[1]).resolve();read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
torch.set_num_threads(2)
selection=read(root/'training/selection-lock.json');selected=selection['selected']
assert selection['selectedOnlyOnValidation'] is True and selection['finalUsedForSelection'] is False
assert selected['selectedOptimizerSteps']>0 and selected['changedHeadTensors']>0 and selected['backwardExecuted'] is True
checkpoint=root/selected['checkpoint'];assert sha(checkpoint)==selected['checkpointSha256']
model=model_from(root,checkpoint)
fresh=torch.load(checkpoint,map_location='cpu',weights_only=True)
assert set(fresh['trainedImageIds']).issubset({r['id'] for r in read(root/'manifest.json')['samples'] if r['split']=='train'})
torch.save(dict(model=model.state_dict(),classNames=[c['name'] for c in read(root/'manifest.json')['categories']]),root/'training/weights-only.pth')
entry=next(e for e in read(root/'preprocessed/index.json')['entries'] if e['split']=='validation')
assert sha(root/entry['path'])==entry['sha256']
rgba=np.frombuffer((root/entry['path']).read_bytes(),dtype=np.uint8).reshape(416,416,4)
x=torch.from_numpy(rgba[:,:,:3][:,:,::-1].transpose(2,0,1).copy().astype(np.float32)).unsqueeze(0)
with torch.no_grad():expected=model(x).numpy()
target=root/'training/basira_objects_v2.onnx'
if target.exists():raise ValueError('ONNX already exists; never overwrite measured artifacts')
torch.onnx.export(model,x,target,opset_version=17,input_names=['images'],output_names=['output'],do_constant_folding=True,dynamo=False)
onnx.checker.check_model(str(target))
options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
runtime=ort.InferenceSession(str(target),sess_options=options,providers=['CPUExecutionProvider'])
assert runtime.get_inputs()[0].name=='images' and runtime.get_inputs()[0].shape==[1,3,416,416] and runtime.get_inputs()[0].type=='tensor(float)'
assert runtime.get_outputs()[0].name=='output' and runtime.get_outputs()[0].shape==[1,3549,85]
actual=runtime.run(None,{'images':x.numpy()})[0]
np.testing.assert_allclose(actual,expected,rtol=1e-3,atol=1e-4)
before=model_from(root,root.parent/'object-finetune-v1-001/training/best.pth')
with torch.no_grad():previous=before(x).numpy()
assert not np.array_equal(actual,previous)
report=dict(modelSha256=sha(target),bytes=target.stat().st_size,checkpointSha256=sha(checkpoint),selectedConfig=selected['config'],selectedEpoch=selected['selectedEpoch'],selectedOptimizerSteps=selected['selectedOptimizerSteps'],selectedTrainedImageIds=selected['selectedTrainedImageIds'],checkerPassed=True,freshCPUInference=True,torchOnnxMaxAbsoluteError=float(np.abs(actual-expected).max()),outputDeltaFromV1=float(np.abs(actual-previous).max()),inputs={'images':[1,3,416,416]},outputs={'output':[1,3549,85]},validationImageId=entry['id'],protectedFinalPixelsRead=0,productionEligible=False,researchOnlyData=True)
(root/'training/onnx-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
