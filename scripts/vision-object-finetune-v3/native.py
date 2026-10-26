"""CPU training primitives; model/decoder follow audited YOLOX, with explicit size."""
from pathlib import Path
import sys
import numpy as np
import torch
from torchvision.ops import nms
from rights import read,sha,check_initial
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-finetune'))
from common import model_from
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-finetune-v2'))
from knowledge import evaluate_rows

def initial_model(root):
    check_initial(root/'assets/yolox_tiny.pth',read(root/'rights-audit.json'))
    return model_from(root)

def tensor(root,entry,size):
    raw=(root/entry['path']).read_bytes();assert __import__('hashlib').sha256(raw).hexdigest()==entry['sha256']
    rgba=np.frombuffer(raw,dtype=np.uint8).reshape(size,size,4)
    return torch.from_numpy(rgba[:,:,:3][:,:,::-1].transpose(2,0,1).copy().astype(np.float32)).unsqueeze(0)

def labels(row,names,size):
    ratio=min(size/row['width'],size/row['height']);objects=[o for o in row['objects'] if not o.get('iscrowd')]
    out=torch.zeros((max(1,len(objects)),5))
    for i,o in enumerate(objects):
        x,y,w,h=o['box'];out[i]=torch.tensor([names.index(o['class']),(x+w/2)*row['width']*ratio,
            (y+h/2)*row['height']*ratio,w*row['width']*ratio,h*row['height']*ratio])
    return out

def decode(raw,names,width,height,size,minimum=.01):
    grids=[];strides=[]
    for s in [8,16,32]:
        y,x=torch.meshgrid(torch.arange(size//s),torch.arange(size//s),indexing='ij')
        grids.append(torch.stack([x,y],-1).reshape(-1,2));strides.append(torch.full(((size//s)**2,1),s))
    grid=torch.cat(grids);stride=torch.cat(strides);values=raw[0].detach().cpu()
    assert values.shape==(len(grid),85)
    scores,classes=(values[:,4:5]*values[:,5:]).max(1);keep=(scores>=minimum)&(scores<=1)&torch.isfinite(scores)
    values,grid,stride,scores,classes=values[keep],grid[keep],stride[keep],scores[keep],classes[keep]
    centres=(values[:,:2]+grid)*stride;sizes=values[:,2:4].exp()*stride
    xyxy=torch.cat([centres-sizes/2,centres+sizes/2],1)/min(size/width,size/height)
    xyxy[:,[0,2]]=xyxy[:,[0,2]].clamp(0,width)/width;xyxy[:,[1,3]]=xyxy[:,[1,3]].clamp(0,height)/height
    valid=torch.isfinite(xyxy).all(1)&(xyxy[:,2]>xyxy[:,0])&(xyxy[:,3]>xyxy[:,1])
    xyxy,scores,classes=xyxy[valid],scores[valid],classes[valid];order=torch.argsort(scores,descending=True)
    for threshold in [.6,.55]:
        kept=[]
        for label in classes.unique():
            candidates=order[classes[order]==label];kept.extend(candidates[nms(xyxy[candidates],scores[candidates],threshold)].tolist())
        order=torch.tensor(sorted(kept,key=lambda i:-float(scores[i])),dtype=torch.long)
    result=[]
    for i in order[:100]:
        x,y,r,b=xyxy[i].tolist();result.append(dict(cocoClass=names[int(classes[i])],confidence=float(scores[i]),boundingBox=dict(x=x,y=y,width=r-x,height=b-y)))
    return result

def summarize(measured):
    results=list(measured['perSource'].values())
    return dict(f1=float(np.mean([v['overall']['f1'] for v in results if v['overall']['f1'] is not None])),
        recall=float(np.mean([v['overall']['recall'] for v in results if v['overall']['recall'] is not None])),
        map=float(np.mean([v['map'] for v in results if v['map'] is not None])),
        overall=measured['overall'],perSource={s:dict(overall=v['overall'],map=v['map']) for s,v in measured['perSource'].items()})

def choose_threshold(rows,predictions,names,baseline,thresholds):
    ap=evaluate_rows(rows,predictions,names,.5)
    results=[]
    for threshold in thresholds:
        measured=evaluate_rows(rows,predictions,names,threshold,compute_ap=False)
        measured['map']=ap['map']
        for name,value in measured['perClass'].items():value['ap']=ap['perClass'][name]['ap']
        for source,value in measured['perSource'].items():
            value['map']=ap['perSource'][source]['map']
            for name,metric in value['perClass'].items():metric['ap']=ap['perSource'][source]['perClass'][name]['ap']
        summary=summarize(measured)
        fp_limit=baseline['overall']['fp']+max(2,int(np.ceil(.1*baseline['overall']['fp'])))
        qualifies=summary['overall']['fp']<=fp_limit and summary['recall']>=baseline['recall']-1e-9
        results.append(dict(threshold=threshold,qualifies=qualifies,fpLimit=fp_limit,summary=summary,metrics=measured))
    return max(results,key=lambda r:(r['qualifies'],r['summary']['f1'],r['summary']['map'])),results
