"""Export real selected clean checkpoint; fresh ORT execution and Torch parity."""
from pathlib import Path
import json,sys,time
import numpy as np,onnx,onnxruntime as ort,torch
from rights import read,sha,TINY_SHA
from native import model_from,tensor

root=Path(sys.argv[1]).resolve();selection=read(root/'training/selection-lock.json');chosen=selection['selected']
assert selection['finalUsedForSelection'] is False and selection['usedRestrictedSources'] is False
assert selection['initialTinySha256']==TINY_SHA and selection['usedV1OrV2WeightsOrTeacher'] is False
checkpoint=root/chosen['checkpoint'];assert sha(checkpoint)==chosen['checkpointSha256'] and chosen['selectedOptimizerSteps']>0 and chosen['changedHeadTensors']>0
torch.set_num_threads(2);size=chosen['inputSize'];model=model_from(root,checkpoint)
loaded=torch.load(checkpoint,map_location='cpu',weights_only=True)
assert set(loaded['trainedImageIds']).issubset({r['id'] for r in read(root/'manifest.json')['samples'] if r['split']=='train'})
assert loaded['initialTinySha256']==TINY_SHA and not loaded['usedRestrictedSources'] and not loaded['usedV1OrV2WeightsOrTeacher']
entry=next(e for e in read(root/f'preprocessed-{size}/index.json')['entries'] if e['split']=='validation');x=tensor(root,entry,size)
with torch.no_grad():expected=model(x).numpy()
target=root/'training/basira_objects_v3.onnx';assert not target.exists(),'Never overwrite measured ONNX'
torch.onnx.export(model,x,target,opset_version=17,input_names=['images'],output_names=['output'],do_constant_folding=True,dynamo=False)
onnx.checker.check_model(str(target));options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
runtime=ort.InferenceSession(str(target),sess_options=options,providers=['CPUExecutionProvider'])
assert runtime.get_inputs()[0].shape==[1,3,size,size]
anchors=sum((size//s)**2 for s in [8,16,32]);assert runtime.get_outputs()[0].shape==[1,anchors,85]
actual=runtime.run(None,{'images':x.numpy()})[0];np.testing.assert_allclose(actual,expected,rtol=1e-3,atol=1e-4)
assert np.isfinite(actual).all()
torch.save(dict(model=model.state_dict(),classNames=[c['name'] for c in read(root/'manifest.json')['categories']],initialTinySha256=TINY_SHA),root/'training/weights-only.pth')
report=dict(modelSha256=sha(target),bytes=target.stat().st_size,inputSize=size,inputs={'images':[1,3,size,size]},outputs={'output':[1,anchors,85]},
    checkpointSha256=sha(checkpoint),selectedEpoch=chosen['selectedEpoch'],selectedOptimizerSteps=chosen['selectedOptimizerSteps'],
    checkerPassed=True,freshCPUInference=True,torchOnnxMaxAbsoluteError=float(np.abs(actual-expected).max()),
    initialTinySha256=TINY_SHA,usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False,
    commercialTrainingAllowed=True,productionEligible=False,protectedFinalPixelsRead=0)
(root/'training/onnx-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
