"""Partial-label negatives are class-scoped; original Tiny priors never become GT."""
import sys
from pathlib import Path
import torch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-finetune-v2'))
from partial_loss import PartialObjectness

def scoped_regularizers(raw,items,rows,names,size):
    grids=[]
    for stride in [8,16,32]:
        y,x=torch.meshgrid(torch.arange(size//stride),torch.arange(size//stride),indexing='ij')
        grids.append((torch.stack([x,y],-1).reshape(-1,2)+.5)*stride)
    centres=torch.cat(grids);negative=[];unknown=[]
    for i,row in enumerate(rows):
        if row['completeLabels']:continue
        scope=[names.index(n) for n in row['annotatedClasses']]
        labels=items[i]['labels'];boxes=labels[labels[:,1:].sum(1)>0,1:]
        inside=torch.zeros(len(centres),dtype=torch.bool)
        for b in boxes:inside|=((centres[:,0]-b[0]).abs()<=b[2]*.6)&((centres[:,1]-b[1]).abs()<=b[3]*.6)
        weights=(~inside).float()*raw[i,:,4].detach()
        probability=raw[i,:,5:][:,scope].clamp(1e-6,1-1e-6)
        negative.append(((-torch.log1p(-probability)).mean(1)*weights).sum()/weights.sum().clamp_min(1.))
        other=[j for j in range(80) if j not in scope]
        if other:
            prior=items[i]['teacher'][0,:,5:][:,other]
            unknown.append(((raw[i,:,5:][:,other]-prior).square().mean(1)*items[i]['teacher'][0,:,4]).mean())
    zero=raw.sum()*0
    return (torch.stack(negative).mean() if negative else zero),(torch.stack(unknown).mean() if unknown else zero)
