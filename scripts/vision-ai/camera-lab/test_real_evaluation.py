"""Procedural unit fixtures only: no real-data approvals or accuracy claims."""
import copy, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parent))
import real_evaluation as e

class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='basira-unit-only-',dir=e.REPO.parent);self.root=Path(self.tmp.name)
        (self.root/'unit-evidence.txt').write_text('UNIT TEST fixture, not a rights approval or independent review')
        self.review=dict(status='approved',reviewerId='unit-test',reviewedAt='2026-10-25T00:00:00Z',recordPath=str(self.root/'unit-evidence.txt'),recordSha256=e.sha(self.root/'unit-evidence.txt'))
        self.rights=dict(self.review,privacyReviewed=True,allowedUses=['local_research_evaluation'])
        self.model=self.root/'model.onnx';self.model.write_bytes(b'NOT A MODEL: unit contract fixture only')
        self.patcher=patch.object(e,'V3_SHA',e.sha(self.model));self.patcher.start()
        e.write(self.root/'entry.json',dict(model='model.onnx',sha256=e.V3_SHA,researchOnly=True,productionEnabled=False))
        Image.new('RGB',(64,48),(20,30,40)).save(self.root/'unit.png')
        self.asset=dict(assetId='asset1',siteId='site1',captureSessionId='session1',sceneId='scene1',contentKind='real_capture',kind='image',path='unit.png',sha256=e.sha(self.root/'unit.png'),rights=self.rights)
        e.write(self.root/'intake.json',dict(contentKind='real_capture_intake',datasetId='unit-test-only',assets=[self.asset]))
        e.write(self.root/'registry.json',dict(review=self.review,trainingOrTuning={},reservedTests=[]))
    def tearDown(self):self.patcher.stop();self.tmp.cleanup()
    def prepared(self):
        e.stage(self.root/'intake.json',self.root/'stage')
        path=self.root/'stage/references.json';refs=e.read(path)
        refs['samples'][0].update(category='stairs_up',objects=[dict(**{'class':'stairs_up'},box=[.1,.1,.6,.6])],review=dict(self.review,method='independent_manual',blindToModel=True))
        e.write(path,refs);return path
    def freeze(self):return e.freeze(self.root/'stage/staged.json',self.root/'stage/references.json',self.root/'registry.json',self.root/'entry.json')
    def test_empty_init_never_fabricates_approvals_or_accuracy(self):
        target=self.root/'empty';result=e.init(target)
        self.assertEqual(result['realSamples'],0);self.assertIsNone(e.read(target/'readiness.json')['accuracy'])
        self.assertEqual(e.read(target/'usage-registry.json')['review']['status'],'pending')
        with self.assertRaisesRegex(ValueError,'No real assets'):e.stage(target/'intake.json',self.root/'no-output')
    def test_pending_rights_rejected_before_media_decode(self):
        self.asset['rights']['status']='pending';e.write(self.root/'intake.json',dict(contentKind='real_capture_intake',datasetId='unit',assets=[self.asset]))
        with self.assertRaisesRegex(ValueError,'pending'):e.stage(self.root/'intake.json',self.root/'stage')
        self.assertFalse((self.root/'stage').exists())
    def test_predictions_cannot_become_references(self):
        path=self.prepared();refs=e.read(path);refs['samples'][0]['review']['method']='model_prediction';e.write(path,refs)
        with self.assertRaisesRegex(ValueError,'independent'):self.freeze()
    def test_blind_review_required(self):
        path=self.prepared();refs=e.read(path);refs['samples'][0]['review']['blindToModel']=False;e.write(path,refs)
        with self.assertRaisesRegex(ValueError,'independent'):self.freeze()
    def test_location_and_session_overlap_rejected(self):
        self.prepared()
        for key in ['siteIds','captureSessionIds','sceneIds','sourceSha256']:
            values={'siteIds':['site1'],'captureSessionIds':['session1'],'sceneIds':['scene1'],'sourceSha256':[self.asset['sha256']]}
            registry=e.read(self.root/'registry.json');registry['trainingOrTuning']={key:values[key]};e.write(self.root/'registry.json',registry)
            with self.assertRaisesRegex(ValueError,'leakage'):self.freeze()
            self.assertFalse((self.root/'stage/manifest.json').exists())
    def test_freeze_reserves_groups_and_detects_tampering(self):
        self.prepared();result=self.freeze();self.assertTrue(result['referencesFrozenBeforeInference'])
        e.verify_frozen(self.root/'stage');self.assertEqual(len(e.read(self.root/'registry.json')['reservedTests']),1)
        with self.assertRaisesRegex(ValueError,'already frozen'):self.freeze()
        (self.root/'stage/frames/asset1-f000000.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'changed'):e.verify_frozen(self.root/'stage')
    def test_reference_box_bounds_and_category_consistency(self):
        path=self.prepared();refs=e.read(path);refs['samples'][0]['objects'][0]['box']=[.9,.1,.6,.6];e.write(path,refs)
        with self.assertRaisesRegex(ValueError,'outside'):self.freeze()
    def test_changed_evidence_rejected(self):
        self.prepared();(self.root/'unit-evidence.txt').write_text('changed unit record')
        with self.assertRaisesRegex(ValueError,'evidence'):self.freeze()
    def test_source_kind_cannot_be_synthetic(self):
        self.asset['contentKind']='synthetic_ground_truth';e.write(self.root/'intake.json',dict(contentKind='real_capture_intake',datasetId='unit',assets=[self.asset]))
        with self.assertRaisesRegex(ValueError,'Synthetic'):e.stage(self.root/'intake.json',self.root/'stage')
    def test_score_binds_predictions_and_consumes_test_without_training(self):
        self.prepared();lock=self.freeze();data,_=e.verify_frozen(self.root/'stage');row=data['samples'][0]
        prediction=dict(scope='frozen-real-test-browser-inference',manifestSha256=lock['manifestSha256'],entrySha256=lock['entrySha256'],modelSha256=e.V3_SHA,
            referenceLabelsUsedForInference=False,predictions=[dict(sampleId=row['sampleId'],imageSha256=row['sha256'],classId=None,box=None,inferenceMs=12)])
        path=self.root/'unit-predictions.json';e.write(path,prediction)
        report=e.score(self.root/'stage',path);self.assertFalse(report['v4TrainingStarted']);self.assertEqual(report['metrics']['fixedPresence']['fn'],1)
        self.assertTrue(e.read(self.root/'stage/test-freeze.json')['testConsumed']);self.assertEqual(e.score(self.root/'stage',path),report)
        self.assertTrue((self.root/'stage/evaluation/errors.html').is_file())
        self.assertEqual(e.read(self.root/'stage/evaluation/v4-proposal.json')['status'],'proposal_only_no_training')
        prediction['predictions'][0]['inferenceMs']=99;e.write(path,prediction)
        with self.assertRaisesRegex(ValueError,'consumed'):e.score(self.root/'stage',path)
    def test_all_research_training_loaders_reject_real_holdout(self):
        self.prepared();self.freeze()
        sys.path.insert(0,str(e.REPO/'scripts/vision-ai/synthetic-stairs'))
        from train_small import validate_manifest
        from train_v2 import read_contract
        from train_v3 import verify_contract
        with self.assertRaisesRegex(ValueError,'excluded from training'):validate_manifest(self.root/'stage/manifest.json',256)
        for loader,arg in [(read_contract,self.root/'stage/manifest.json'),(verify_contract,self.root/'stage')]:
            with self.assertRaisesRegex(ValueError,'excluded from training'):loader(arg)
    def test_video_frames_are_explicit_and_keep_capture_group(self):
        import cv2, numpy as np
        source=self.root/'unit-video.avi';writer=cv2.VideoWriter(str(source),cv2.VideoWriter_fourcc(*'MJPG'),5,(64,48))
        self.assertTrue(writer.isOpened())
        for i in range(4):writer.write(np.full((48,64,3),i*50,dtype=np.uint8))
        writer.release();self.asset.update(kind='video',path='unit-video.avi',sha256=e.sha(source),frameIndices=[0,2])
        e.write(self.root/'intake.json',dict(contentKind='real_capture_intake',datasetId='unit',assets=[self.asset]))
        result=e.stage(self.root/'intake.json',self.root/'stage');self.assertEqual(result['samples'],2)
        rows=e.read(self.root/'stage/staged.json')['samples'];self.assertEqual([r['frameIndex'] for r in rows],[0,2])
        self.assertEqual({r['sceneId'] for r in rows},{'scene1'});self.assertAlmostEqual(rows[1]['mediaTimeSeconds'],.4,places=3)

class MetricTests(unittest.TestCase):
    def test_known_counts_include_abstentions_false_alerts_and_missed_boxes(self):
        categories=['stairs_up','stairs_down','ramp','escalator','empty','stairs_present_uncertain_direction']
        guesses=[2301,2303,2301,2304,None,None];rows=[];predictions=[]
        for i,(category,guess) in enumerate(zip(categories,guesses)):
            objects=[] if category in ['ramp','empty'] else [{'class':category,'box':[.1,.1,.5,.5]}]
            rows.append(dict(sampleId=str(i),sha256=str(i),siteId='site',captureSessionId='session',sceneId=f'scene{i}',reference=dict(category=category,objects=objects)))
            predictions.append(dict(sampleId=str(i),imageSha256=str(i),classId=guess,box=[.1,.1,.5,.5] if guess else None,inferenceMs=10+i))
        metrics=e.summary(rows,predictions)
        self.assertEqual({k:metrics['fixedPresence'][k] for k in ['tp','fp','fn','tn']},dict(tp=2,fp=1,fn=1,tn=2))
        self.assertEqual(metrics['localizationIoU50']['tp'],2);self.assertEqual(metrics['localizationIoU50']['fn'],2)
        self.assertEqual(metrics['direction']['abstained'],1);self.assertEqual(metrics['direction']['decidedCoverageAllFixed'],1/3)
        self.assertEqual(metrics['falseAlertsByReferenceCategory'],{'ramp':1})
        self.assertEqual(metrics['confusion']['counts']['stairs_down']['stairs_present_uncertain_direction'],1)
    def test_missing_or_reordered_predictions_rejected(self):
        with self.assertRaisesRegex(ValueError,'nonempty'):e.summary([],[])
    def test_nan_or_incorrect_boxes_rejected(self):
        for box in [[0,0,float('nan'),1],[.8,0,.5,1],[0,0,0,1]]:
            with self.assertRaises(ValueError):e.validate_box(box)

if __name__=='__main__':unittest.main()
