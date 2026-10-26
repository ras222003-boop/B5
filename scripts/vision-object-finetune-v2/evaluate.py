"""Actual browser predictions vs independent source-scoped references, all four models."""
from pathlib import Path
from collections import defaultdict
import hashlib,json,math,statistics,sys
from knowledge import evaluate_rows
root=Path(sys.argv[1]).resolve();stage=sys.argv[2]
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
manifest=read(root/'manifest.json');lock=read(root/'cohort-lock.json')
assert sha(root/'manifest.json')==lock['manifestSha256']
if stage=='test':assert (root/'selection-lock.json').exists(),'Final requires immutable selection'
rows=[r for r in manifest['samples'] if r['split']==stage];names=[c['name'] for c in manifest['categories']]
models={}
for name in ['lite0','yolox-tiny','objects-basira-v1','objects-basira-v2']:
    path=root/'results'/stage/(name+'.json');report=read(path)
    assert report['referencesUsedInInference'] is False and report['cohortSha256']==lock['manifestSha256']
    predictions={r['id']:r for r in report['predictions']};assert set(predictions)=={r['id'] for r in rows}
    for row in rows:assert predictions[row['id']]['sha256']==row['sha256'] and sha(root/row['path'])==row['sha256']
    measured=evaluate_rows(rows,predictions,names,.5)
    times=sorted(p['detectorMs'] for p in predictions.values())
    measured.update(modelSha256=report['modelSha256'],predictionsSha256=sha(path),modelBytes=report['modelBytes'],latency=dict(medianMs=statistics.median(times),p95Ms=times[math.ceil(.95*len(times))-1],warmupExcluded=True),memory=report['memory'],groups={g:evaluate_rows([r for r in rows if r['bucket']==g],{r['id']:predictions[r['id']] for r in rows if r['bucket']==g},names,.5,compute_ap=False)['overall'] for g in ['simple','crowded'] if any(r['bucket']==g for r in rows)})
    models[name]=measured
out=dict(stage=stage,images=len(rows),sceneGroups=len({r['groupId'] for r in rows}),referenceObjects=sum(not o['iscrowd'] for r in rows for o in r['objects']),models=models,confidence=.5,calibrated=False,metricsScope='only explicitly annotated classes on each source; unknown predictions ignored, not proven correct',licenceRestrictions=manifest['licenceRestrictions'],phoneTested=False)
(root/f'{stage}-evaluation.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps({name:dict(operating=v['overall'],map=v['map'],latency=v['latency']) for name,v in models.items()}))
