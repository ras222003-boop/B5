"""Measure a validation-only interpolation discrepancy; no tuning or qualification follows."""
from pathlib import Path
import json,sys,numpy as np,onnxruntime as ort
from common import corpus,prepare_image
root=Path(sys.argv[1]).resolve();manifest,names=corpus(root)
row=next(r for r in manifest['samples'] if r['split']=='validation')
tensor,_=prepare_image(root,row,names)
rgba=np.frombuffer((root/'preprocess/browser-rgba.bin').read_bytes(),dtype=np.uint8).reshape(416,416,4)
browser=rgba[:,:,:3][:,:,::-1].transpose(2,0,1).copy().astype(np.float32)[None]
reference=tensor.numpy();delta=np.abs(browser-reference)
options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
session=ort.InferenceSession(str(root/'training/basira_objects_v1.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
a=session.run(None,{'images':reference})[0];b=session.run(None,{'images':browser})[0]
report=dict(scope='one_reused_validation_image_only_not_a_new_independent_test',imageId=row['id'],meanAbsoluteInputPixelDifference=float(delta.mean()),maxAbsoluteInputPixelDifference=float(delta.max()),fractionInputChannelsChanged=float((delta>0).mean()),maxRawOutputDifference=float(np.abs(a-b).max()),maxObjectnessDifference=float(np.abs(a[:,:,4]-b[:,:,4]).max()),maxClassScoreDifference=float(np.abs(a[:,:,5:]-b[:,:,5:]).max()),finalTestUsed=False,settingsChanged=False,note='Pillow downsampling and Canvas default smoothing are numerically different; this does not prove they solely caused the quality regression. Future training should match or explicitly study deployed preprocessing on fresh validation.')
(root/'preprocess-diagnostic.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
