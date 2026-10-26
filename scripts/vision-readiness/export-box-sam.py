"""Re-export the publisher's unmodified SlimSAM decoder with actual native box embeddings.
No training or new image upload. Artifacts stay outside Git. Existing q8 encoder is reused.
"""
from pathlib import Path
import hashlib,json,os,sys,time,urllib.request
root=Path(sys.argv[1]).resolve();assets=root/'slimsam-box';assets.mkdir(parents=True,exist_ok=True)
os.environ['HF_HOME']=str(root/'hf-cache');os.environ['TRANSFORMERS_OFFLINE']='1'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pin='72a5ae6ca4d1da579a001f6f008b6fb949282c10'
expected='b0ee221e3d33935807a820c157fec81a537b3b9979edc88b148a8dae8bbdd5d2'
source=assets/'source';source.mkdir(exist_ok=True)
for name in ['config.json','preprocessor_config.json','README.md','model.safetensors']:
    path=source/name
    if not path.exists():
        url=f'https://huggingface.co/nielsr/slimsam-77-uniform/resolve/{pin}/{name}'
        with urllib.request.urlopen(url,timeout=60) as response:path.write_bytes(response.read(45_000_001))
    assert path.stat().st_size<45_000_000
assert sha(source/'model.safetensors')==expected
assert 'apache-2.0' in (source/'README.md').read_text().lower()
import torch,onnx,onnxruntime as ort,numpy as np,shutil
from transformers import SamModel
torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(20261026)
model=SamModel.from_pretrained(source,local_files_only=True).eval()
class BoxDecoder(torch.nn.Module):
    def __init__(self):
        super().__init__();self.prompt=model.prompt_encoder;self.decoder=model.mask_decoder
    def forward(self,image_embeddings,image_positional_embeddings,input_boxes):
        sparse,dense=self.prompt(input_points=None,input_labels=None,input_boxes=input_boxes,input_masks=None)
        masks,scores,*_=self.decoder(image_embeddings=image_embeddings,image_positional_embeddings=image_positional_embeddings,
            sparse_prompt_embeddings=sparse,dense_prompt_embeddings=dense,multimask_output=True)
        return scores,masks
decoder=BoxDecoder().eval();emb=torch.randn(1,256,64,64)*.1;pos=torch.randn_like(emb)*.1
boxes=torch.tensor([[[64.,128.,700.,900.],[250.,100.,800.,650.]]])
target=assets/'onnx/prompt_encoder_mask_decoder.onnx';target.parent.mkdir(exist_ok=True)
started=time.monotonic()
if not target.exists():
 with torch.inference_mode():
    torch.onnx.export(decoder,(emb,pos,boxes),str(target),opset_version=17,
        input_names=['image_embeddings','image_positional_embeddings','input_boxes'],output_names=['iou_scores','pred_masks'],
        dynamic_axes={'input_boxes':{1:'objects'},'iou_scores':{1:'objects'},'pred_masks':{1:'objects'}})
onnx.checker.check_model(str(target))
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
session=ort.InferenceSession(str(target),sess_options=opts,providers=['CPUExecutionProvider'])
errors=[]
for count in [1,2,3]:
    b=boxes[:,:1].repeat(1,count,1)
    with torch.inference_mode():reference=[v.numpy() for v in decoder(emb,pos,b)]
    actual=session.run(None,dict(image_embeddings=emb.numpy(),image_positional_embeddings=pos.numpy(),input_boxes=b.numpy()))
    score_error=float(np.abs(actual[0]-reference[0]).max());delta=np.abs(actual[1]-reference[1]);agreement=float(((actual[1]>0)==(reference[1]>0)).mean())
    # FP32 decoder reductions differ between ORT and PyTorch. Inspect scores, mean/logit error and actual thresholded mask changes.
    assert score_error<1e-4 and float(delta.max())<.02 and float(delta.mean())<.001 and agreement>.999
    errors.append(dict(objects=count,maxScoreError=score_error,maxLogitError=float(delta.max()),meanLogitError=float(delta.mean()),binaryMaskAgreement=agreement))
for name in ['config.json','preprocessor_config.json']:shutil.copyfile(source/name,assets/name)
encoder=Path('.vision-ai/object-quality/slimsam/onnx/vision_encoder_quantized.onnx')
shutil.copyfile(encoder,assets/'onnx/vision_encoder_quantized.onnx')
record=dict(publisher='nielsr/slimsam-77-uniform',revision=pin,license='Apache-2.0',sourceWeightSha256=expected,
    decoderSha256=sha(target),decoderBytes=target.stat().st_size,encoderSha256=sha(encoder),
    nativeBoxEmbeddings=[2,3],pointLabelShortcutUsed=False,trainingExecuted=False,checkerPassed=True,freshCPUParity=errors,
    wallSeconds=time.monotonic()-started,maskColourQualified=False,productionEligible=False)
(assets/'export-report.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record),flush=True)
