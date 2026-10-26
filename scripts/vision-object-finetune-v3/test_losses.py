import unittest
import torch
from losses import scoped_regularizers

class ScopeLoss(unittest.TestCase):
    def test_640_known_negative_does_not_turn_unknown_classes_into_background(self):
        torch.set_num_threads(2)
        raw=torch.full((1,8400,85),.2,requires_grad=True)
        teacher=raw.detach().clone()
        rows=[dict(completeLabels=False,annotatedClasses=['traffic light'])]
        items=[dict(labels=torch.zeros((1,5)),teacher=teacher)]
        names=['traffic light']+[f'unknown{i}' for i in range(79)]
        negative,unknown=scoped_regularizers(raw,items,rows,names,640)
        self.assertGreater(float(negative.detach()),0)
        self.assertEqual(float(unknown.detach()),0)
        (negative+unknown).backward()
        self.assertGreater(float(raw.grad[:,:,5].abs().sum()),0)
        self.assertEqual(float(raw.grad[:,:,6:].abs().sum()),0)
        self.assertEqual(float(raw.grad[:,:,:5].abs().sum()),0)

if __name__=='__main__':unittest.main()
