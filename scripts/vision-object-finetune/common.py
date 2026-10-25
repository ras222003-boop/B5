"""Shared local-only data, CPU model and independent-reference metrics."""
from pathlib import Path
from collections import Counter
import contextlib, hashlib, io, json, re, sys, types
import numpy as np
from PIL import Image, ImageEnhance
import torch
from torchvision.ops import nms

read = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

def corpus(root):
    manifest, lock = read(root/'manifest.json'), read(root/'cohort-lock.json')
    assert sha(root/'manifest.json') == lock['manifestSha256']
    categories = sorted(read(root/'references/train.coco.json')['categories'], key=lambda c:c['id'])
    names = [c['name'] for c in categories]
    installed = re.findall(r'^  \["([^"]+)",', Path('client/src/lib/vision/cocoLabels.ts').read_text(encoding='utf-8'), re.M)
    assert names == installed and len(names) == 80, 'COCO contiguous index/category mapping differs'
    for split, digest in lock['referenceFiles'].items():
        assert sha(root/'references'/f'{split}.coco.json') == digest
    return manifest, names

def model_from(root, checkpoint=None):
    assets = root/'assets'
    upstream = read(assets/'upstream.json')
    for row in upstream['files']:
        assert sha(assets/row['path']) == row['sha256'], 'Upstream/source/checkpoint changed'
    # Namespace imports skip only the optional distributed trainer/build registries.
    # Architecture, SimOTA matching and losses remain the pinned official source.
    for name, folder in [('yolox','yolox'),('yolox.models','yolox/models')]:
        module=types.ModuleType(name); module.__path__=[str(assets/'upstream'/folder)]; sys.modules[name]=module
    from yolox.models.yolox import YOLOX
    from yolox.models.yolo_pafpn import YOLOPAFPN
    from yolox.models.yolo_head import YOLOXHead
    model = YOLOX(YOLOPAFPN(.33,.375), YOLOXHead(80,.375))
    for m in model.modules():
        if isinstance(m, torch.nn.BatchNorm2d): m.eps=1e-3; m.momentum=.03
    value=torch.load(checkpoint or assets/'yolox_tiny.pth', map_location='cpu', weights_only=True)
    model.load_state_dict(value['model'],strict=True)
    model.head.decode_in_inference=False
    return model.cpu().eval()

def prepare_image(root, row, names, variant=0):
    assert row['split'] != 'test', 'Final images cannot enter training/validation preprocessing'
    assert sha(root/row['path']) == row['sha256']
    image=Image.open(root/row['path']).convert('RGB')
    boxes=[(o['class'], list(o['box'])) for o in row['objects'] if not o['iscrowd']]
    if variant:
        # A geometry-derived crop enlarges small instances. Keep every visible box, not predictions.
        rng=np.random.default_rng(int(row['id'])+913)
        target=min(boxes,key=lambda b:b[1][2]*b[1][3])[1]
        side=.7; left=float(np.clip(target[0]+target[2]/2-side/2,0,1-side)); top=float(np.clip(target[1]+target[3]/2-side/2,0,1-side))
        x0,y0,x1,y1=round(left*image.width),round(top*image.height),round((left+side)*image.width),round((top+side)*image.height)
        transformed=[]
        for name,(x,y,w,h) in boxes:
            l=max(x*image.width,x0); t=max(y*image.height,y0); r=min((x+w)*image.width,x1); b=min((y+h)*image.height,y1)
            if r-l>=2 and b-t>=2: transformed.append((name,[(l-x0)/(x1-x0),(t-y0)/(y1-y0),(r-l)/(x1-x0),(b-t)/(y1-y0)]))
        image=image.crop((x0,y0,x1,y1)); boxes=transformed
        image=ImageEnhance.Brightness(image).enhance(float(rng.uniform(.9,1.1)))
    ratio=min(416/image.width,416/image.height)
    resized=image.resize((int(image.width*ratio),int(image.height*ratio)),Image.Resampling.BILINEAR)
    pixels=np.full((416,416,3),114,dtype=np.float32)
    pixels[:resized.height,:resized.width]=np.asarray(resized)[:,:,::-1]
    labels=torch.zeros((max(1,len(boxes)),5),dtype=torch.float32)
    for i,(name,(x,y,w,h)) in enumerate(boxes):
        labels[i]=torch.tensor([names.index(name),(x+w/2)*image.width*ratio,(y+h/2)*image.height*ratio,w*image.width*ratio,h*image.height*ratio])
    return torch.from_numpy(pixels.transpose(2,0,1).copy()).unsqueeze(0),labels

def decode(raw, names, width, height, minimum=.01):
    grids=[]; strides=[]
    for s in [8,16,32]:
        y,x=torch.meshgrid(torch.arange(416//s),torch.arange(416//s),indexing='ij')
        grids.append(torch.stack([x,y],-1).reshape(-1,2));strides.append(torch.full(((416//s)**2,1),s))
    grid=torch.cat(grids); stride=torch.cat(strides)
    values=raw[0].detach().cpu(); scores,classes=(values[:,4:5]*values[:,5:]).max(1)
    keep=(scores>=minimum)&(scores<=1)&torch.isfinite(scores)
    values,grid,stride,scores,classes=values[keep],grid[keep],stride[keep],scores[keep],classes[keep]
    centres=(values[:,:2]+grid)*stride; sizes=values[:,2:4].exp()*stride
    scale=min(416/width,416/height)
    xyxy=torch.cat([centres-sizes/2,centres+sizes/2],1)/scale
    xyxy[:,[0,2]]=xyxy[:,[0,2]].clamp(0,width)/width
    xyxy[:,[1,3]]=xyxy[:,[1,3]].clamp(0,height)/height
    valid=torch.isfinite(xyxy).all(1)&(xyxy[:,2]>xyxy[:,0])&(xyxy[:,3]>xyxy[:,1])
    xyxy,scores,classes=xyxy[valid],scores[valid],classes[valid]
    # Match the browser's normalized class-aware .6 NMS, followed by .55 merge.
    order=torch.argsort(scores,descending=True)
    for threshold in [.6,.55]:
        kept=[]
        for label in classes.unique():
            candidates=order[classes[order]==label]
            kept.extend(candidates[nms(xyxy[candidates],scores[candidates],threshold)].tolist())
        order=torch.tensor(sorted(kept,key=lambda i:-float(scores[i])),dtype=torch.long)
    result=[]
    for i in order[:100]:
        x,y,r,b=xyxy[i].tolist()
        result.append(dict(cocoClass=names[int(classes[i])],confidence=float(scores[i]),boundingBox=dict(x=x,y=y,width=r-x,height=b-y)))
    return result

def metrics(root, split, predictions, names):
    sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-quality'))
    from evaluate import operating
    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval
    rows=[r for r in read(root/'manifest.json')['samples'] if r['split']==split]
    assert set(predictions)=={r['id'] for r in rows}
    with contextlib.redirect_stdout(io.StringIO()):
        gt=COCO(str(root/'references'/f'{split}.coco.json'))
        cats={c['name']:c['id'] for c in gt.dataset['categories']}
        dt=[]
        for row in rows:
            for p in predictions[row['id']]['detections']:
                b=p['boundingBox']; dt.append(dict(image_id=row['cocoId'],category_id=cats[p['cocoClass']],bbox=[b['x']*row['width'],b['y']*row['height'],b['width']*row['width'],b['height']*row['height']],score=p['confidence']))
        if dt:
            ev=COCOeval(gt,gt.loadRes(dt),'bbox');ev.params.imgIds=[r['cocoId'] for r in rows];ev.evaluate();ev.accumulate();ev.summarize();stats=ev.stats
        else: stats=np.zeros(12)
    op=operating(rows,predictions,.5)
    return dict(map=float(stats[0]),ap50=float(stats[1]),apSmall=float(stats[3]),operating=op,groups={g:operating([r for r in rows if r['bucket']==g],predictions,.5) for g in ['simple','crowded']})
