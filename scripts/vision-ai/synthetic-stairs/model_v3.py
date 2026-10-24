"""Independent presence/direction heads with mask-supervised local features."""
from __future__ import annotations
import math
import numpy as np
import torch
from PIL import Image
from torch import nn

SIZE=160


class Pool4(nn.Module):
    """Exact adaptive 10x10 -> 4x4 averaging with ONNX-supported slice/mean ops."""
    def forward(self,x):
        starts=(0,2,5,7);ends=(3,5,8,10)
        return torch.stack([torch.stack([x[:,:,a:b,c:d].mean((-2,-1))
            for c,d in zip(starts,ends)],-1) for a,b in zip(starts,ends)],-2)


def letterbox(path,mask_path=None):
    with Image.open(path) as source:
        source=source.convert('RGB');w,h=source.size
        scale=min(SIZE/w,SIZE/h);rw=int(math.floor(w*scale+.5));rh=int(math.floor(h*scale+.5))
        left=(SIZE-rw)//2;top=(SIZE-rh)//2
        canvas=Image.new('RGB',(SIZE,SIZE),(127,127,127))
        canvas.paste(source.resize((rw,rh),Image.Resampling.BILINEAR),(left,top))
        tensor=torch.from_numpy(np.asarray(canvas,dtype=np.float32).transpose(2,0,1)/255)
    mask=None
    if mask_path is not None:
        with Image.open(mask_path) as source:
            target=Image.new('L',(SIZE,SIZE),0)
            target.paste(source.resize((rw,rh),Image.Resampling.NEAREST),(left,top))
            mask=torch.from_numpy(np.asarray(target.resize((20,20),Image.Resampling.NEAREST),dtype=np.float32).copy()).unsqueeze(0)
    return tensor,mask,dict(width=w,height=h,resizedWidth=rw,resizedHeight=rh,left=left,top=top)


def padded_box(box,meta):
    x,y,w,h=box
    return [(x*meta['resizedWidth']+meta['left'])/SIZE,(y*meta['resizedHeight']+meta['top'])/SIZE,
            w*meta['resizedWidth']/SIZE,h*meta['resizedHeight']/SIZE]


def original_box(box,meta):
    x,y,w,h=box
    x0=max(0,min(1,(x*SIZE-meta['left'])/meta['resizedWidth']))
    y0=max(0,min(1,(y*SIZE-meta['top'])/meta['resizedHeight']))
    x1=max(0,min(1,((x+w)*SIZE-meta['left'])/meta['resizedWidth']))
    y1=max(0,min(1,((y+h)*SIZE-meta['top'])/meta['resizedHeight']))
    return [float(x0),float(y0),float(max(0,x1-x0)),float(max(0,y1-y0))]


class StairV3(nn.Module):
    def __init__(self):
        super().__init__();channels=(24,48,72,96);source=3;blocks=[]
        for target in channels:
            blocks.append(nn.Sequential(nn.Conv2d(source,target,3,2,1),nn.GroupNorm(6,target),nn.ReLU()))
            source=target
        self.blocks=nn.ModuleList(blocks)
        self.embed=nn.Sequential(Pool4(),nn.Flatten(),nn.Linear(96*4*4,128),nn.ReLU())
        self.presence_head=nn.Linear(128,3);self.direction_head=nn.Linear(128,3)
        self.box_head=nn.Linear(128,4);self.mask_head=nn.Conv2d(72,1,1)

    def forward_train(self,image):
        x=image;mask=None
        for i,block in enumerate(self.blocks):
            x=block(x)
            if i==2:mask=self.mask_head(x)
        feature=self.embed(x);raw=torch.sigmoid(self.box_head(feature))
        width=.03+.97*raw[:,2];height=.03+.97*raw[:,3]
        box=torch.stack((raw[:,0]*(1-width),raw[:,1]*(1-height),width,height),1)
        return self.presence_head(feature),self.direction_head(feature),box,mask

    def forward(self,image):
        p,d,b,_=self.forward_train(image);return p,d,b

    def initialize_v2(self,state):
        copied=[]
        with torch.no_grad():
            for i,block in enumerate(self.blocks):
                for suffix in ('weight','bias'):
                    key=f'features.{i*2}.{suffix}'
                    if key in state and getattr(block[0],suffix).shape==state[key].shape:
                        getattr(block[0],suffix).copy_(state[key]);copied.append(key)
            for target,key in [(self.embed[2],'features.10'),(self.box_head,'box_head')]:
                for suffix in ('weight','bias'):
                    source=state[f'{key}.{suffix}']
                    if getattr(target,suffix).shape==source.shape:
                        getattr(target,suffix).copy_(source);copied.append(f'{key}.{suffix}')
        return copied


def softmax(values):
    values=np.asarray(values,dtype=np.float64);exp=np.exp(values-values.max());return exp/exp.sum()


def decode(presence,direction,box,meta,thresholds):
    if np.asarray(presence).shape!=(3,) or np.asarray(direction).shape!=(3,) or np.asarray(box).shape!=(4,) or not all(np.isfinite(value).all() for value in (presence,direction,box)):
        raise ValueError('Invalid V3 inference outputs')
    p=softmax(presence);d=softmax(direction);kind=int(p.argmax())
    result=dict(classId=None,score=float(p[0]),box=None,presenceProbabilities=p.tolist(),
                directionProbabilities=d.tolist(),directionAbstained=False)
    if kind==0 or p[kind]<thresholds['presenceMin']:return result
    label=2304
    if kind==1:
        order=np.argsort(d)[::-1];abstain=(order[0]==2 or d[order[0]]<thresholds['directionMin']
            or d[order[0]]-d[order[1]]<thresholds['directionMargin'])
        label=2303 if abstain else (2301 if order[0]==0 else 2302)
        result['directionAbstained']=bool(abstain)
    result.update(classId=label,score=float(p[kind]),box=original_box(box,meta))
    return result
