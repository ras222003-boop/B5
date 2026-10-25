"""Reuse actual CC0 clips/frames; blank references remain pending, never negative labels."""
from pathlib import Path
import json,sys
from common import read,sha
root=Path(sys.argv[1]).resolve();source=root.parent/'object-colors-001'
motion=read(source/'motion-manifest.json');clips=[]
for clip in motion['clips']:
    assert clip['license']=='https://creativecommons.org/publicdomain/zero/1.0/'
    frames=[]
    for frame in clip['frames']:
        assert sha(source/frame['path'])==frame['sha256']
        frames.append(dict(id=frame['id'],path=str((source/frame['path']).resolve()),sha256=frame['sha256'],mediaTimeMs=frame['mediaTimeMs'],sceneId=clip['id'],objects=None,referenceStatus='PENDING_INDEPENDENT_REVIEW'))
    clips.append(dict(id=clip['id'],group=clip['id'],split='diagnostic_only',license=clip['license'],sourceSha256=clip['sourceSha256'],frames=frames))
record=dict(clips=clips,originalManifestSha256=sha(source/'motion-manifest.json'),trainingEligible=False,referenceStatus='UNLABELLED_NOT_NEGATIVE',predictionsMayBecomeGroundTruth=False,requiredReferenceFields=['independentReviewerEvidence','frameId','cocoClass','normalizedBox','persistentTrackId','occlusionOrUncertainty'],note='Reuse real licensed video; keep each clip/session in one split. Do not train or calculate identity accuracy until independent references exist.')
(root/'video-reference-intake.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
phone=read(Path('scripts/vision-object-quality/iphone-trial-template.json'));phone.update(model='objects-basira-v1',modelSha256=read(root/'training/onnx-report.json')['modelSha256'],previousModel='objects-yolox-tiny',status='NOT_RUN',physicalDeviceTested=False)
(root/'iphone-trial.json').write_text(json.dumps(phone,indent=2),encoding='utf-8')
print(json.dumps(dict(realClips=len(clips),realFrames=sum(len(c['frames']) for c in clips),independentIdentitiesAvailable=False,iPhoneTested=False)))
