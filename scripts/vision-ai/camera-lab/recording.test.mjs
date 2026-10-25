import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneIdentity,makeReport} from './recording.mjs';
import {validateCertificate} from './tls-diagnostic.mjs';
test('recording requires pseudonymous group identities and never claims reference accuracy',()=>{
  const identity={siteId:'site-1',captureSessionId:'session-2',sceneId:'scene-3',sampleId:'frame-4'};
  assert.deepEqual(sceneIdentity(identity),identity);
  assert.throws(()=>sceneIdentity({...identity,siteId:'private address / street'}),/pseudonymous/);
  assert.throws(()=>sceneIdentity({...identity,sceneId:''}),/sceneId/);
  const report=makeReport({id:'capture-1',identity,source:{kind:'camera'},metrics:{processedFrames:1},predictions:[{classId:2301,inferenceMs:12}]});
  assert.equal(report.predictionsAreGroundTruth,false);assert.equal(report.referenceLabelsIncluded,false);assert.equal(report.realWorldAccuracyMeasured,false);assert.equal(report.mediaIncluded,false);
});
test('TLS preflight refuses malformed certificates instead of weakening verification',()=>{
  assert.throws(()=>validateCertificate({leaf:'invalid',ca:'invalid',host:'127.0.0.1'}));
});
