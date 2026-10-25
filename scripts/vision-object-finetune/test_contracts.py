"""Contract tests, separate from the actual training/evaluation evidence."""
from pathlib import Path
import sys,unittest,tempfile,subprocess
import torch
from common import prepare_image,decode
torch.set_num_threads(1)
class TrainingContracts(unittest.TestCase):
    def test_finalized_evaluation_cannot_restart_training(self):
        base=Path('.vision-ai').resolve();base.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            root=Path(folder);self.assertEqual(root.parent,base)
            (root/'selection-lock.json').write_text('{}',encoding='utf-8')
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('train.py')),str(root)],capture_output=True,text=True,timeout=45)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('No training after final selection/evaluation',result.stderr)
            self.assertFalse((root/'training').exists())
    def test_protected_final_pixels_cannot_enter_training_preprocess(self):
        with self.assertRaisesRegex(AssertionError,'Final images'):
            prepare_image(Path('nonexistent'),{'split':'test'},['chair'])
    def test_raw_decode_keeps_real_confidence_and_separate_objects(self):
        raw=torch.zeros((1,3549,85));names=['class'+str(i) for i in range(80)]
        for row,x in [(0,2.),(20,0.)]:
            raw[0,row,:5]=torch.tensor([x,2.,0.,0.,.8]);raw[0,row,5]=.75
        found=decode(raw,names,416,416,.5)
        self.assertEqual(len(found),2)
        self.assertAlmostEqual(found[0]['confidence'],.6,places=5)
        self.assertEqual(found[0]['cocoClass'],'class0')
        self.assertEqual(decode(raw,names,416,416,.65),[])
    def test_invalid_and_off_image_boxes_do_not_become_labels(self):
        raw=torch.zeros((1,3549,85));raw[0,0,:5]=torch.tensor([-20.,-20.,0.,0.,.9]);raw[0,0,5]=.9
        self.assertEqual(decode(raw,['class'+str(i) for i in range(80)],416,416),[])
if __name__=='__main__':unittest.main()
