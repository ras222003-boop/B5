"""Validation-only input-size/threshold ablation using original, unmodified Tiny."""
from pathlib import Path
import json,sys,time
import torch
from rights import read,sha
from native import initial_model,tensor,decode,evaluate_rows,summarize,choose_threshold

root=Path(sys.argv[1]).resolve();assert not (root/'selection-lock.json').exists()
torch.set_num_threads(2);torch.set_num_interop_threads(1)
manifest=read(root/'manifest.json');rows=[r for r in manifest['samples'] if r['split']=='validation'];names=[c['name'] for c in manifest['categories']]
model=initial_model(root);outputs={}
for size in [416,640]:
    index=read(root/f'preprocessed-{size}/index.json');entries={e['id']:e for e in index['entries']}
    assert index['manifestSha256']==sha(root/'manifest.json')
    predictions={};latencies=[]
    for row in rows:
        x=tensor(root,entries[row['id']],size);start=time.monotonic()
        with torch.no_grad():raw=model(x)
        latencies.append((time.monotonic()-start)*1000)
        predictions[row['id']]=dict(sha256=row['sha256'],detections=decode(raw,names,row['width'],row['height'],size))
    metrics=evaluate_rows(rows,predictions,names,.5)
    outputs[str(size)]=dict(inputSize=size,summary=summarize(metrics),metrics=metrics,predictions=predictions,
        inferenceMedianMs=__import__('statistics').median(latencies),referencesUsedInInference=False)
    print(json.dumps(dict(size=size,summary=outputs[str(size)]['summary'],medianMs=outputs[str(size)]['inferenceMedianMs'])),flush=True)
baseline=outputs['416']['summary'];ranked=[]
for record in outputs.values():
    choice,_=choose_threshold(rows,record['predictions'],names,baseline,[.35,.5,.65])
    ranked.append(dict(inputSize=record['inputSize'],threshold=choice['threshold'],qualifies=choice['qualifies'],summary=choice['summary']))
selected=max(ranked,key=lambda r:(r['qualifies'],r['summary']['f1'],r['summary']['map']))
result=dict(selected=selected,baseline416=baseline,ablations=ranked,raw=outputs,selectedOnlyOnValidation=True,
    finalUsedForSelection=False,manifestSha256=sha(root/'manifest.json'),initialTinySha256=sha(root/'assets/yolox_tiny.pth'))
(root/'resolution-probe.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(dict(selected=selected)),flush=True)
