"""Actual ONNX checker/tensor contracts; no training or cloud inference."""
from pathlib import Path
import json,hashlib,sys,onnx
from onnx import numpy_helper
root=Path(sys.argv[1]).resolve();records=[]
for path in list((root/'assets/yolox').glob('*.onnx'))+list((root/'assets/slimsam/onnx').glob('*.onnx')):
    onnx.checker.check_model(str(path));model=onnx.load(path)
    shape=lambda value:[d.dim_value or d.dim_param for d in value.type.tensor_type.shape.dim]
    record=dict(file=path.relative_to(root).as_posix(),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),checkerPassed=True,inputs={x.name:shape(x) for x in model.graph.input},outputs={x.name:shape(x) for x in model.graph.output})
    if 'prompt_encoder' in path.name:
        constants={n.output[0]:numpy_helper.to_array(a.t).tolist() for n in model.graph.node if n.op_type=='Constant' for a in n.attribute if a.name=='value'};dependent={'input_labels'};labels=[]
        for node in model.graph.node:
            if any(i in dependent for i in node.input):
                dependent.update(node.output)
                if node.op_type=='Equal':labels.extend(constants[i] for i in node.input if isinstance(constants.get(i),(int,float)))
        record.update(pointLabelEqualityConstants=labels,nativeBoxInputs='input_boxes' in record['inputs'],nativeBoxLabels=2 in labels and 3 in labels)
    records.append(record)
(root/'onnx-assets-audit.json').write_text(json.dumps(dict(records=records,trainingPerformed=False),indent=2),encoding='utf-8');print(json.dumps(records))
