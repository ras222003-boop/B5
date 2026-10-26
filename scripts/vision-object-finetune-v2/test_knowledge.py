"""Unit fixtures only: these invented boxes/bytes are never experimental evidence."""
from pathlib import Path
import json
import tempfile
import unittest
from knowledge import evaluate_rows, _training, canonical_labels

NAMES = ["cup", "person"]

def ref(name="cup", ident="r1"):
    return dict(id=ident, **{"class": name}, box=[.1,.1,.3,.3], area=900, iscrowd=0)

def pred(name="cup", score=.9):
    return dict(cocoClass=name, confidence=score,
                boundingBox=dict(x=.1,y=.1,width=.3,height=.3))

def row(ident="one", source="ycb", objects=None, complete=False, scope=None, group="scene"):
    result=dict(id=ident,width=100,height=100,source=source,groupId=group,
                objects=[ref()] if objects is None else objects)
    if complete:
        result["completeLabels"]=True
    else:
        result["annotatedClasses"]=["cup"] if scope is None else scope
    return result

class ScopedKnowledgeTests(unittest.TestCase):
    def test_published_image_id_order_keeps_quantized_ap_ties_reproducible(self):
        positive={**row("positive"),"cocoId":1}
        negative={**row("negative",objects=[]),"cocoId":2}
        predictions={"positive":{"detections":[pred(score=.5)]},"negative":{"detections":[pred(score=.5)]}}
        first=evaluate_rows([positive,negative],predictions,NAMES)
        reverse=evaluate_rows([negative,positive],predictions,NAMES)
        self.assertAlmostEqual(first["map"],reverse["map"])
        self.assertAlmostEqual(first["map"],1.)

    def test_crowd_detection_is_ignored_not_a_false_positive(self):
        obj=ref();obj["iscrowd"]=1
        result=evaluate_rows([row(objects=[obj])],{"one":{"detections":[pred()]}},NAMES)
        self.assertEqual(result["overall"]["fp"],0)
        self.assertEqual(result["overall"]["ignoredCrowdDetections"],1)
        self.assertIsNone(result["map"])
    def test_partial_labels_do_not_turn_other_objects_into_false_positives(self):
        result=evaluate_rows([row()],{"one":{"detections":[pred("person",.99),pred()]}},NAMES)
        self.assertEqual((result["overall"]["tp"],result["overall"]["fp"],result["overall"]["fn"]),(1,0,0))
        self.assertEqual(result["overall"]["ignoredOutOfScopeAtThreshold"],1)
        self.assertIsNone(result["perClass"]["person"]["precision"])
        self.assertIsNone(result["perClass"]["person"]["ap"])
        self.assertAlmostEqual(result["perClass"]["cup"]["ap"],1.)

    def test_explicit_scoped_negative_scene_retains_fp_without_positive_accuracy(self):
        result=evaluate_rows([row(objects=[])],{"one":{"detections":[pred(),pred("person")]}},NAMES)
        self.assertEqual(result["overall"]["fp"],1)
        self.assertEqual(result["perClass"]["cup"]["fp"],1)
        self.assertEqual(result["perClass"]["person"]["fp"],0)
        for key in ["precision","recall","ap"]:
            self.assertIsNone(result["perClass"]["cup"][key])
        self.assertIsNone(result["map"])

    def test_empty_detections_are_zero_recall_ap_for_positive_reference(self):
        result=evaluate_rows([row()],{"one":{"detections":[]}},NAMES)
        self.assertEqual(result["overall"]["fn"],1)
        self.assertEqual(result["overall"]["recall"],0)
        self.assertEqual(result["overall"]["f1"],0)
        self.assertEqual(result["perClass"]["cup"]["ap"],0)

    def test_duplicate_and_known_wrong_class_are_false_positives(self):
        result=evaluate_rows([row(complete=True)],{"one":{"detections":[pred(),pred(score=.8),pred("person",.7)]}},NAMES)
        self.assertEqual((result["overall"]["tp"],result["overall"]["fp"]),(1,2))
        self.assertAlmostEqual(result["overall"]["precision"],1/3)
        self.assertEqual(result["perClass"]["person"]["fp"],1)
        self.assertIsNone(result["perClass"]["person"]["ap"])

    def test_scope_and_unlabelled_rows_cannot_be_guessed(self):
        unscoped=row();unscoped.pop("annotatedClasses")
        with self.assertRaisesRegex(ValueError,"scope missing"):
            evaluate_rows([unscoped],{"one":{"detections":[]}},NAMES)
        unlabelled=row();unlabelled["objects"]=None
        with self.assertRaisesRegex(ValueError,"null is unlabelled"):
            evaluate_rows([unlabelled],{"one":{"detections":[]}},NAMES)
        wrong=row(objects=[ref("person")])
        with self.assertRaisesRegex(ValueError,"outside declared"):
            evaluate_rows([wrong],{"one":{"detections":[]}},NAMES)

    def test_sources_are_separate_groups_and_rates_not_frame_accuracy(self):
        rows=[row("a",source="coco",complete=True),row("b",source="ycb")]
        result=evaluate_rows(rows,{"a":{"detections":[pred()]},"b":{"detections":[]}},NAMES)
        self.assertEqual(result["coverage"]["groups"],2)
        self.assertEqual(result["perSource"]["coco"]["overall"]["recall"],1)
        self.assertEqual(result["perSource"]["ycb"]["overall"]["recall"],0)

    def test_operating_threshold_does_not_remove_reference_denominator(self):
        result=evaluate_rows([row()],{"one":{"detections":[pred(score=.4)]}},NAMES)
        self.assertEqual(result["overall"]["referenceCount"],1)
        self.assertEqual((result["overall"]["tp"],result["overall"]["fn"]),(0,1))
        self.assertEqual(result["perClass"]["cup"]["missedExamples"][0]["reason"],"below_threshold")

    def test_training_counts_selected_ids_deduplicate_across_stages(self):
        base=Path(".vision-ai").resolve();base.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            root=Path(folder);self.assertEqual(root.parent,base)
            one=dict(id="old",split="train",sha256="a"*64,objects=[ref()],source="coco",groupId="old-scene")
            unused=dict(id="unused",split="train",sha256="b"*64,objects=[ref("person")],source="coco",groupId="unused")
            for name,ident in [("v1","old"),("v2","prefixed-old")]:
                image={**one,"id":ident}
                (root/(name+".json")).write_text(json.dumps(dict(samples=[image,unused])),encoding="utf-8")
            stages=[dict(manifestPath="v1.json",trainedImageIds=["old"],checkpointSha256="c"*64,selectedOnlyOnValidation=True,referencesIndependent=True),
                    dict(manifestPath="v2.json",trainedImageIds=["prefixed-old"],checkpointSha256="d"*64,selectedOnlyOnValidation=True,referencesIndependent=True,researchOnly=True,usageRestrictions=["BDD research-only source restriction"]) ]
            result=_training(root,dict(trainingStages=stages),NAMES,[])
            self.assertEqual(result["selectedTrainingUniqueImages"],1)
            self.assertEqual(result["perClass"]["cup"],dict(uniqueImages=1,uniqueInstances=1))
            self.assertEqual(result["perClass"]["person"],dict(uniqueImages=0,uniqueInstances=0))
            self.assertTrue(result["researchOnly"])
            self.assertIn("BDD research-only source restriction",result["usageRestrictions"])
            bad=[{**stages[0],"trainedImageIds":None}]
            with self.assertRaisesRegex(ValueError,"selected-checkpoint trainedImageIds"):
                _training(root,dict(trainingStages=bad),NAMES,[])

    def test_missing_training_evidence_is_unknown_not_invented_zero(self):
        result=_training(Path("."),{},NAMES,[])
        self.assertIsNone(result["selectedTrainingUniqueImages"])
        self.assertIsNone(result["perClass"]["cup"]["uniqueImages"])
        self.assertFalse(result["metadataKnown"])
        result=_training(Path("."),dict(trainingStages=[]),NAMES,[])
        self.assertEqual(result["selectedTrainingUniqueImages"],0)

    def test_training_metadata_cannot_use_final_images(self):
        base=Path(".vision-ai").resolve();base.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            root=Path(folder);self.assertEqual(root.parent,base)
            image=dict(id="x",split="test",sha256="a"*64,objects=[ref()])
            (root/"manifest.json").write_text(json.dumps(dict(samples=[image])),encoding="utf-8")
            stage=dict(manifestPath="manifest.json",trainedImageIds=["x"],checkpointSha256="b"*64,selectedOnlyOnValidation=True,referencesIndependent=True)
            with self.assertRaisesRegex(ValueError,"includes validation/final"):
                _training(root,dict(trainingStages=[stage]),NAMES,[])

if __name__=="__main__":
    unittest.main()
