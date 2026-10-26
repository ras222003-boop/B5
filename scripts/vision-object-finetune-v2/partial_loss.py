"""Loss-only use of partial independent annotations; teacher priors are not reference labels."""
import torch
import torch.nn.functional as F

class PartialObjectness(torch.nn.Module):
    def __init__(self):
        super().__init__();self.partial=None;self.teacher=None
    def forward(self,logits,targets):
        bce=F.binary_cross_entropy_with_logits(logits,targets.float(),reduction='none')
        if logits.shape[-1]==1 and self.partial is not None:
            distill=.25*4*(logits.sigmoid()-self.teacher).square()
            bce=torch.where(self.partial & (targets==0),distill,bce)
        return bce

grids=[]
for stride in [8,16,32]:
    y,x=torch.meshgrid(torch.arange(416//stride),torch.arange(416//stride),indexing='ij')
    grids.append((torch.stack([x,y],-1).reshape(-1,2)+.5)*stride)
CENTRES=torch.cat(grids)

def scoped_regularizers(raw,items,rows,names):
    negative=[];unknown=[]
    for i,row in enumerate(rows):
        if row['completeLabels']:continue
        scopes=[names.index(name) for name in row['annotatedClasses']]
        labels=items[i]['labels'];valid=labels[:,1:].sum(1)>0;boxes=labels[valid,1:]
        inside=torch.zeros(3549,dtype=torch.bool)
        for box in boxes:
            inside|=((CENTRES[:,0]-box[0]).abs()<=box[2]*.6)&((CENTRES[:,1]-box[1]).abs()<=box[3]*.6)
        weights=(~inside).float()*raw[i,:,4].detach()
        probability=raw[i,:,5:][:,scopes].clamp(1e-6,1-1e-6)
        negative.append(((-torch.log1p(-probability)).mean(1)*weights).sum()/weights.sum().clamp_min(1.))
        other=[j for j in range(80) if j not in scopes]
        if other:
            prior=items[i]['teacher'][0,:,5:][:,other]
            unknown.append(((raw[i,:,5:][:,other]-prior).square().mean(1)*items[i]['teacher'][0,:,4]).mean())
    zero=raw.sum()*0
    return (torch.stack(negative).mean() if negative else zero),(torch.stack(unknown).mean() if unknown else zero)
