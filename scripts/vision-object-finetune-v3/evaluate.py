"""Same frozen licensed cohort, appropriate declared contract/threshold per model."""
from pathlib import Path
import json,math,statistics,sys
from rights import read,sha
from native import evaluate_rows

root=Path(sys.argv[1]).resolve();stage=sys.argv[2];manifest=read(root/'manifest.json');lock=read(root/'cohort-lock.json')
assert sha(root/'manifest.json')==lock['manifestSha256']
if stage=='test':assert read(root/'selection-lock.json')['finalUsedForSelection'] is False
rows=[r for r in manifest['samples'] if r['split']==stage];names=[c['name'] for c in manifest['categories']];models={}
for name in ['lite0','yolox-tiny','objects-basira-v1','objects-basira-v2','objects-basira-v3']:
    path=root/'results'/stage/(name+'.json');report=read(path)
    assert report['referencesUsedInInference'] is False and report['cohortSha256']==lock['manifestSha256']
    predictions={r['id']:r for r in report['predictions']};assert set(predictions)=={r['id'] for r in rows}
    for row in rows:assert predictions[row['id']]['sha256']==row['sha256'] and sha(root/row['path'])==row['sha256']
    threshold=report['config'].get('threshold',.5)
    measured=evaluate_rows(rows,predictions,names,threshold)
    times=sorted(p['detectorMs'] for p in predictions.values())
    measured.update(modelSha256=report['modelSha256'],predictionsSha256=sha(path),modelBytes=report['modelBytes'],
        latency=dict(medianMs=statistics.median(times),p95Ms=times[math.ceil(.95*len(times))-1],warmupExcluded=True),
        memory=report['memory'],inputSize=report['config'].get('inputSize',320 if name=='lite0' else 416),
        licenceStatus='RESEARCH_ONLY_BDD_DERIVATIVE' if name=='objects-basira-v2' else
            'PERMISSIVE_SOURCE_TRAINING_GRANTS_VERIFIED_NOT_PRODUCTION_APPROVED' if name=='objects-basira-v3' else 'UPSTREAM_OR_PRIOR_RUN_SEE_RIGHTS_AUDIT',
        groups={g:evaluate_rows([r for r in rows if r['bucket']==g],{r['id']:predictions[r['id']] for r in rows if r['bucket']==g},names,threshold,compute_ap=False)['overall']
            for g in ['simple','crowded'] if any(r['bucket']==g for r in rows)})
    models[name]=measured
output=dict(stage=stage,images=len(rows),sceneGroups=len({(r['source'],r['groupId']) for r in rows}),
    referenceObjects=sum(not o['iscrowd'] for r in rows for o in r['objects']),models=models,
    metricsScope='Explicit per-source annotation scopes; out-of-scope classes are unknown, not false or confirmed correct',
    finalUsedForSelection=False,phoneTested=False,calibrated=False,
    independence='Source/visual groups; physical GPS sites not certified. All visually connected UrOAC remains held-out.',
    rightsAuditSha256=sha(root/'rights-audit.json'))
(root/f'{stage}-evaluation.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
print(json.dumps({name:dict(operating=m['overall'],map=m['map'],threshold=m['threshold'],latency=m['latency']) for name,m in models.items()}))
