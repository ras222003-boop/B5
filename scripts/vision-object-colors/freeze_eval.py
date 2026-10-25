"""Freeze a NEW cohort and the implementation before inference, never overwrite an evaluated cohort."""
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();repo=Path(__file__).resolve().parents[2]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
if (root/'evaluation-lock.json').exists() or list(root.glob('predictions-*.json')):raise ValueError('Already frozen/evaluated; choose a new cohort')
refs=root/'color-references.json'
if not refs.exists():refs.write_text(json.dumps(dict(status='pending_independent_reference',humanApproval=False,references=[],limitations=['No independent colour reference; colour accuracy is unavailable.']),indent=2),encoding='utf-8')
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
if manifest.get('inferenceUsedForSelection') is not False:raise ValueError('Selection provenance required')
for row in manifest['samples']:
    if sha(root/row['path'])!=row['sha256']:raise ValueError('Image changed')
lock=dict(schemaVersion=1,createdBeforeInference=True,manifestSha256=sha(root/'manifest.json'),referenceSha256=sha(refs),
    colorSourceSha256=sha(repo/'client/src/lib/vision/objectColors.ts'),
    models={name:sha(path) for name,path in {'lite0':repo/'client/public/vision/efficientdet_lite0_int8.tflite','lite2':root/'sources/lite2.tflite','ssd':root/'sources/ssd.tflite'}.items()},
    selectionUse='no_phone_adoption_from_desktop_results')
(root/'evaluation-lock.json').write_text(json.dumps(lock,indent=2),encoding='utf-8');print(json.dumps(lock))
