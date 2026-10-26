"""Finalize only completed, validated candidates after a bounded study stops.
Never resumes training, opens final images, or presents an interrupted setup as trained.
"""
from pathlib import Path
import hashlib,json,sys,torch
root=Path(sys.argv[1]).resolve();read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
target=root/'training/selection-lock.json'
assert not target.exists() and not (root/'selection-lock.json').exists() and not (root/'results/test').exists()
plan=read(root/'protocol.json');initial=read(root/'training/initial-validation.json')['summary'];reports=[];unfinished=[]
for config in plan['candidates']:
    folder=root/'training'/config['id']
    if (folder/'report.json').exists():
        report=read(folder/'report.json');assert sha(root/report['checkpoint'])==report['checkpointSha256'] and report['selectedOptimizerSteps']>0
        assert report['bindings']==read(root/'training/bindings.json');reports.append(report)
    else:
        events=[json.loads(l) for l in (folder/'events.jsonl').read_text().splitlines()] if (folder/'events.jsonl').exists() else []
        meta={}
        if (folder/'interrupted.pth').exists():
            checkpoint=torch.load(folder/'interrupted.pth',map_location='cpu',weights_only=True)
            meta=dict(optimizerSteps=checkpoint['optimizerSteps'],epochStarted=checkpoint['epoch'])
        unfinished.append(dict(candidate=config['id'],completedValidatedEpochs=sum(e['kind']=='epoch' for e in events),reason=next((e.get('reason') for e in reversed(events) if e['kind']=='stopped'),'not completed'),lastObservedWallSeconds=max([e['elapsedSeconds'] for e in events] or [0]),**meta))
assert len(reports)>=2,'Need multiple actually validated candidates, not placeholders'
selected=max(reports,key=lambda r:(r['bestValidation']['f1'],r['bestValidation']['map']))
result=dict(selected=selected,candidates=reports,unfinishedCandidates=unfinished,selectedOnlyOnValidation=True,finalUsedForSelection=False,threshold=.5,totalOptimizerSteps=sum(r['optimizerStepsRun'] for r in reports)+sum(r.get('optimizerSteps',0) for r in unfinished),initialValidation=initial,threads=2,budgetSeconds=plan['maxTrainingSeconds'],stopReason='bounded study stopped; only completed validated candidates selected',budgetEnforcement='soft wall-clock checks between operations; elapsed can overshoot during blocking work; no hard OS cap claimed')
target.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(dict(selected=selected['config']['id'],selectedEpoch=selected['selectedEpoch'],selectedSteps=selected['selectedOptimizerSteps'],trainedImages=selected['actualTrainImagesInSelected'],completeCandidates=len(reports),unfinished=unfinished,totalSteps=result['totalOptimizerSteps'])))
