import unittest,torch
from partial_loss import PartialObjectness,scoped_regularizers,CENTRES
torch.set_num_threads(1)
class PartialLossTests(unittest.TestCase):
    def test_unknown_absence_is_soft_prior_not_ground_truth_zero(self):
        loss=PartialObjectness();loss.partial=torch.tensor([[True],[False],[True]])
        loss.teacher=torch.full((3,1),.5)
        logits=torch.zeros((3,1),requires_grad=True);targets=torch.tensor([[0.],[0.],[1.]])
        result=loss(logits,targets);result.sum().backward()
        self.assertEqual(result[0].item(),0.)
        self.assertAlmostEqual(logits.grad[0].item(),0.)
        self.assertAlmostEqual(logits.grad[1].item(),.5)
        self.assertAlmostEqual(logits.grad[2].item(),-.5)
    def test_known_false_class_outside_gt_penalized_but_gt_region_excluded(self):
        names=[str(i) for i in range(80)]
        raw=torch.full((1,3549,85),.1);raw[:,:,4]=1.;raw.requires_grad_()
        items=[dict(labels=torch.tensor([[1.,208.,208.,100.,100.]]),teacher=raw.detach().clone())]
        rows=[dict(completeLabels=False,annotatedClasses=['1'])]
        negative,unknown=scoped_regularizers(raw,items,rows,names);negative.backward()
        self.assertGreater(raw.grad[0,0,6].item(),0.)
        inside=int(torch.argmin((CENTRES-torch.tensor([208.,208.])).square().sum(1)))
        self.assertEqual(raw.grad[0,inside,6].item(),0.)
        self.assertEqual(raw.grad[0,0,7].item(),0.)
        self.assertEqual(unknown.item(),0.)
    def test_complete_labels_keep_original_loss_path(self):
        raw=torch.full((1,3549,85),.1,requires_grad=True)
        a,b=scoped_regularizers(raw,[],[dict(completeLabels=True)],[str(i) for i in range(80)])
        self.assertEqual(a.item()+b.item(),0.)
if __name__=='__main__':unittest.main()
