"""Bounded local CPU verification before an experimental model is listed."""
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort

def validate(entry_path):
    entry_path=Path(entry_path).resolve();entry=json.loads(entry_path.read_text(encoding='utf-8'))
    path=(entry_path.parent/entry['model']).resolve()
    if path.parent!=entry_path.parent or path.stat().st_size>64*1024*1024:raise ValueError('Bounded sibling model file required')
    raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest()
    if digest!=entry['sha256'] or entry.get('researchOnly') is not True or entry.get('productionEnabled') is not False:raise ValueError('Research model identity mismatch')
    model=onnx.load_model_from_string(raw)
    def graphs(graph):
        yield graph
        for node in graph.node:
            for attribute in node.attribute:
                if attribute.type==onnx.AttributeProto.GRAPH:yield from graphs(attribute.g)
                elif attribute.type==onnx.AttributeProto.GRAPHS:
                    for nested in attribute.graphs:yield from graphs(nested)
    for graph in graphs(model.graph):
        if any(t.data_location==onnx.TensorProto.EXTERNAL or t.external_data for t in graph.initializer):raise ValueError('External model data is not allowed')
        if any(node.domain not in ('','ai.onnx') for node in graph.node):raise ValueError('Custom operator domain is not supported')
    onnx.checker.check_model(model,full_check=True)
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    session=ort.InferenceSession(raw,sess_options=options,providers=['CPUExecutionProvider'])
    inputs=session.get_inputs();outputs=session.get_outputs()
    if len(inputs)!=1 or inputs[0].name!='image' or inputs[0].type!='tensor(float)' or inputs[0].shape!=[1,3,160,160]:raise ValueError('Unsupported input tensor contract')
    expected={'presence_logits':[1,3],'direction_logits':[1,3],'box_xywh':[1,4]}
    if {o.name:o.shape for o in outputs}!=expected or any(o.type!='tensor(float)' for o in outputs):raise ValueError('Unsupported output tensor contract')
    for tensor in [np.zeros((1,3,160,160),np.float32),np.random.default_rng(719).random((1,3,160,160),dtype=np.float32)]:
        result=dict(zip([o.name for o in outputs],session.run(None,{'image':tensor})))
        if any(not np.isfinite(v).all() for v in result.values()):raise ValueError('Nonfinite model output')
        if np.any(result['box_xywh'][0,2:]<=0):raise ValueError('Nonpositive model box')
    return dict(schemaVersion=1,status='verified',modelSha256=digest,checkerPassed=True,cpuInferencePassed=True,
        input=dict(name='image',shape=inputs[0].shape,type=inputs[0].type),outputs=expected,probeInputs=2,
        scope='technical_probe_not_accuracy_or_safety',productionEligible=False)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--entry',required=True);a=p.parse_args()
    print(json.dumps(validate(a.entry),allow_nan=False))
