import unittest,tempfile,json,hashlib
from pathlib import Path
from evaluate import operating,select
def p(name,score=.9):return dict(cocoClass=name,confidence=score,boundingBox=dict(x=.1,y=.1,width=.3,height=.3))
class MetricsTests(unittest.TestCase):
    def setUp(self):
        self.rows=[dict(id='1',width=100,height=100,objects=[dict(id='a',**{'class':'cup'},box=[.1,.1,.3,.3],area=900,iscrowd=0)])]
    def test_threshold_cannot_change_reference_denominator(self):
        result=operating(self.rows,{'1':dict(detections=[p('cup',.4)])},.5)
        self.assertEqual((result['tp'],result['fn']),(0,1));self.assertEqual(result['errors'][0]['reason'],'below_operating_threshold')
    def test_duplicate_and_wrong_class_are_false_positives(self):
        result=operating(self.rows,{'1':dict(detections=[p('cup'),p('cup',.8),p('fork')])},.5)
        self.assertEqual((result['tp'],result['fp'],result['fn']),(1,2,0))
    def test_reselect_does_not_rewrite_frozen_validation(self):
        base=Path('.vision-ai').resolve();base.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            self.assertEqual(Path(folder).parent,base)
            root=Path(folder);(root/'selection-lock.json').write_text('{}');data=b'original evidence';(root/'validation-evaluation.json').write_bytes(data)
            with self.assertRaisesRegex(ValueError,'already frozen'):select(root)
            self.assertEqual((root/'validation-evaluation.json').read_bytes(),data)
if __name__=='__main__':unittest.main()
