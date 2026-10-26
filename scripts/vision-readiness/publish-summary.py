"""Publish only aggregate evidence. Never copy images, network logs, private paths or certificates."""
from pathlib import Path
import json,sys
root=Path(sys.argv[1]).resolve();repo=Path(__file__).resolve().parents[2]
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
ablation=read(root/'detector-ablation-evaluation.json')
mask=read(root/'mask-evaluation-test-native-box.json')
colour=read(root/'mask-evaluation-colour-diagnostic-native-box.json')
camera=read(root/'camera-asus-user-scene-003-headful.json')
voice=read(root/'local-voice-headful.json')
tests=read(root/'vitest-final-509.json')
browser=read(root/'browser-verified/browser-validation.json')
access=read(root/'browser-verified/readiness-accessibility.json')
summary=dict(schemaVersion=1,baseCommit='47ea29e78c1c3d80006d04997c4c5a2a4d97998b',
 scope='LOCAL_OBJECT_DESCRIPTION_AND_PREVIEW_PREPARATION_NOT_NAVIGATION_QUALIFICATION',
 detectorTrainingRepeated=False,
 validationAblation=dict(images=ablation['images'],models={k:{'overall':v['overall'],'map':v['map']} for k,v in ablation['models'].items()},promoted=False),
 masks={k:mask[k] for k in ['images','attempted','matchedMasks','acceptedMatchedMasks','meanAcceptedIoU','meanMatchedIoU','meanAcceptedPurity','worstAcceptedIoU','medianMs','p95Ms','productMasksMayEnable']},
 publishedColourOracleDiagnostic={k:colour[k] for k in ['images','attempted','colourAgreement','productMasksMayEnable']},
 colourStatus='UNPROVEN_MASKS_DISABLED',
 asus=dict(physicalCameraTested=camera['physicalCameraTested'],headless=camera['headless'],sceneVariationObserved=camera['sceneVariationObserved'],
  camera={k:camera['device'][k] for k in ['width','height','frameRate','audioTracks']},measurement=camera['measurement'],memoryAfterAnalysis=camera['memoryAfterAnalysis'],
  modelSha256=camera['modelSha256'],appStopEndsTracks=camera['appStopEndsTracks'],modelAccuracy=None,rawFramesSaved=False,mediaUploaded=False,
  caveat='Headless feed was unchanged earlier. A later visible Chrome trial changed; the underlying cause is not established. Text-only user reference is not frame/bbox ground truth.'),
 localSpeech={k:voice[k] for k in ['status','elapsedMs','headless','localArabicVoices','audibleIntelligibilityVerified','microphoneUsed','audioSaved','paidSynthesisRequested']},
 softwareTests=dict(total=tests['numTotalTests'],passed=tests['numPassedTests'],failed=tests['numFailedTests'],success=tests['success'],
  note='Before the additional five isolated Manus preview boundary tests, which passed separately.',
  browserActualOnnxTestPassed=True,nonVacuousSpeechSubmissionVerified=True,sourcePixelVariationExportVerified=True,keyboardAndReaderControlsVerified=True,
  softwareCameraIsNotHardwareTrial=True),
 preview=dict(branch='codex/basira-vision-readiness-v1',projectCopyCreated=False,remoteDeploymentPerformed=False,httpsUrl=None,
  blocker='Shared replay URL is readable, but no authenticated editable Manus project is available; browser runtime failed initialization even after reset.',
  databaseConnected=False,originalProjectChanged=False,localPreviewBoundaryTestsPassed=5),
 iphoneTested=False,voiceOverTested=False,navigationEligible=False,productionEligible=False)
# Frame fingerprints/timing are local diagnostics, not identifying camera frames or publishing private media.
for when in ['before','after']:
    summary['asus']['measurement'][when]={k:v for k,v in camera['measurement'][when].items() if k not in ['sampledFrameSha256','text']}
out=repo/'docs/vision-ai-evidence/vision-readiness';out.mkdir(parents=True,exist_ok=True)
(out/'results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(output='docs/vision-ai-evidence/vision-readiness/results.json',mediaPublished=False,phoneTested=False)))
