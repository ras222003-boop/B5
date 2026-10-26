"""Bind measured models to the images their selected checkpoints actually saw."""
from pathlib import Path
import hashlib, json, sys

root = Path(sys.argv[1]).resolve()
read = lambda p: json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous = root.parent / 'object-finetune-v1-001'
selection = read(root/'training/selection-lock.json')['selected']
v1_ids = [r['id'] for r in read(previous/'manifest.json')['samples'] if r['split']=='train'][:8]
# V1's recorded protocol used the first eight train rows, four steps/epoch,
# and selected epoch two. Do not count the later rejected 18-image attempt.
v1_stage = dict(manifestPath=str(previous/'manifest.json'),
    manifestSha256=sha(previous/'manifest.json'), trainedImageIds=v1_ids,
    checkpointPath=str(previous/'training/best.pth'),
    checkpointSha256=sha(previous/'training/best.pth'),
    selectedOnlyOnValidation=True, referencesIndependent=True)
v2_stage = dict(manifestPath='manifest.json', manifestSha256=sha(root/'manifest.json'),
    trainedImageIds=selection['selectedTrainedImageIds'],
    checkpointPath=selection['checkpoint'], checkpointSha256=selection['checkpointSha256'],
    selectedOnlyOnValidation=True, referencesIndependent=True, researchOnly=True,
    usageRestrictions=read(root/'manifest.json')['licenceRestrictions'])
models=[]
for name in ['lite0','yolox-tiny','objects-basira-v1','objects-basira-v2']:
    prediction = read(root/'results/test'/f'{name}.json')
    models.append(dict(id=name, name=name, modelSha256=prediction['modelSha256'],
        predictionsPath=f'results/test/{name}.json', inheritedClasses='coco80', threshold=.5,
        trainingStages=([v1_stage,v2_stage] if name.endswith('-v2') else
            [v1_stage] if name.endswith('-v1') else [])))
target=root/'knowledge-models.json'
with target.open('x', encoding='utf-8') as out:
    json.dump(dict(schemaVersion=1, models=models), out, ensure_ascii=False, indent=2)
print(json.dumps(dict(models=len(models), v1SelectedImages=len(v1_ids),
    v2SelectedImages=len(selection['selectedTrainedImageIds']))))
