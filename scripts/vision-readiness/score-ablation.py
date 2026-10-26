"""Scoped validation metrics; a validation gain never qualifies a production change."""
from pathlib import Path
import json,sys,statistics
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-finetune-v2'))
from knowledge import evaluate_rows
root=Path(sys.argv[1]).resolve();source=root.parent/'object-finetune-v3-001'
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
run=read(root/'detector-validation-ablation.json');assert run['scope']=='VALIDATION_ONLY' and run['protectedFinalPixelsRead']==0
manifest=read(source/'manifest.json');rows=[r for r in manifest['samples'] if r['split']=='validation'];names=[c['name'] for c in manifest['categories']]
assert {r['id'] for r in rows}=={r['id'] for r in run['results']}
report={}
for name in run['variants']:
    predictions={r['id']:dict(detections=r['variants'][name]) for r in run['results']}
    result=evaluate_rows(rows,predictions,names,.5)
    result['medianMs']=statistics.median(r['baselineMs' if name=='baseline' else 'withTilesMs'] for r in run['results'])
    result['perSource']={source:evaluate_rows([r for r in rows if r['source']==source],{r['id']:predictions[r['id']] for r in rows if r['source']==source},names,.5,compute_ap=False)['overall'] for source in {r['source'] for r in rows}}
    report[name]=result
baseline=report['baseline']['overall']
for name,r in report.items():
    r['improvesBothPrecisionAndRecall']=r['overall']['precision']>baseline['precision'] and r['overall']['recall']>baseline['recall']
out=dict(stage='validation',images=len(rows),models=report,independentFinalPerformed=False,productChangeQualified=False,
    reason='Validation alone cannot qualify a change; do not reuse the consumed V3 final for selection')
(root/'detector-ablation-evaluation.json').write_text(json.dumps(out,indent=2))
print(json.dumps({name:{'operating':r['overall'],'map':r['map'],'medianMs':r['medianMs'],'improvesBoth':r['improvesBothPrecisionAndRecall']} for name,r in report.items()}))
