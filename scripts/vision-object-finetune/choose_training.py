"""Choose only between the two bounded runs on validation; preserve both checkpoints."""
from pathlib import Path
import json,sys,torch
from common import read,sha
root=Path(sys.argv[1]).resolve()
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists()
candidates=[]
plan=read(root/'protocol.json');train_count=sum(r['split']=='train' for r in read(root/'manifest.json')['samples'])
for name in ['training','training-predictors']:
    report=read(root/name/'training-report.json');selection=read(root/name/'selection-lock.json')
    checkpoint=root/name/selection['checkpoint'];assert sha(checkpoint)==selection['checkpointSha256']
    state=torch.load(checkpoint,map_location='cpu',weights_only=True)['state']
    candidates.append(dict(directory=name,validationF1=report['bestValidationF1'],validationAP=state['bestAP'],checkpoint=checkpoint.relative_to(root).as_posix(),checkpointSha256=sha(checkpoint),checkpointEpoch=state['epoch'],checkpointOptimizerSteps=state['step'],checkpointTrainImages=train_count if state['expanded'] else plan['pilotImages'],runEpochs=report['epochs'],runOptimizerSteps=report['optimizerSteps'],runReportSha256=sha(root/name/'training-report.json')))
selected=max(candidates,key=lambda c:(c['validationF1'],c['validationAP']))
record=dict(selected=selected,candidates=candidates,selectedOn='validation F1, then AP, fixed .5 threshold',finalPredictionsConsulted=False,totalOptimizerSteps=sum(c['runOptimizerSteps'] for c in candidates),totalEpochs=sum(c['runEpochs'] for c in candidates),note='Run-wide image/epoch counts differ from the chosen checkpoint. All later expanded-run checkpoints are retained, not substituted.')
(root/'training-choice.json').write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record))
