"""Scene-paired V3 synthetic cohort with depth-tested pinhole rasterization."""
from __future__ import annotations
import argparse, hashlib, json, math, random
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image
from generate import Camera, sha256, stair_direction
from generate_v2 import CATEGORIES, MATERIALS, PALETTE, coco_rle


def seed_for(text):
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:4], 'little')


def scenes(cohort='research3-20261025'):
    result = []
    for split, fixed_reps, negative_count in [('train',4,8),('validation',1,2),('test',2,4)]:
        items = [('stairs',m,e,r) for r in range(fixed_reps) for m in MATERIALS
                 for e in ('indoor','outdoor')]
        items += [(kind,MATERIALS[i%4],('indoor','outdoor')[(i//4)%2] if negative_count==8
                   else ('indoor','outdoor')[i%2],i) for kind in
                  ('ramp','stripes','empty','escalator') for i in range(negative_count)]
        for kind, material, environment, rep in items:
            sid=f'v3-{cohort}-{split}-{kind}-{material}-{environment}-{rep}'
            seed=seed_for(sid); rng=random.Random(seed)
            result.append(dict(id=sid,group=sid,split=split,kind=kind,material=material,
                environment=environment,seed=seed,steps=rng.randint(5,12),run=rng.uniform(.26,.36),
                rise=rng.uniform(.14,.19),width=rng.uniform(1.15,2.4),yaw=rng.uniform(-.7,.7),
                lighting=rng.uniform(.62,1.28),markings=rng.random()<.38,
                railings=kind=='escalator' or rng.random()<.35,
                contrast=rng.uniform(.08,.26),floorColor=[rng.randint(105,180) for _ in range(3)]))
    return result


def point(scene,x,y,z):
    a=scene['yaw']; return (x*math.cos(a)+y*math.sin(a),-x*math.sin(a)+y*math.cos(a),z)


def camera(scene,side,frame):
    rng=random.Random(scene['seed']+seed_for(side)+frame*37)
    length=scene['steps']*scene['run']; height=scene['steps']*scene['rise']
    x=rng.uniform(-.6,.6); eye=rng.uniform(1.4,1.8)
    if side=='side':
        pos=point(scene,rng.choice((-1,1))*rng.uniform(2.2,2.9),length*.5,eye)
        target=point(scene,0,length*.5,height*.5)
    elif side=='up':
        pos=point(scene,x,-rng.uniform(2.1,3.9),eye)
        target=point(scene,rng.uniform(-.15,.15),length*rng.uniform(.4,.65),height*.55)
    else:
        pos=point(scene,x,length+rng.uniform(.65,1.35),height+eye)
        target=point(scene,0,length*rng.uniform(.3,.5),height*.3)
    if scene['kind'] in ('empty','stripes'):
        # Ordinary ground-level observer, with both level and downward-looking negatives.
        pos=point(scene,x,-rng.uniform(1.8,3.7),eye)
        target=point(scene,0,rng.uniform(.5,3),rng.uniform(0,.4) if side=='down' else rng.uniform(.4,1.1))
    return Camera(pos,target,rng.uniform(53,78))


class Raster:
    def __init__(self,camera,width,height,scene):
        self.camera,self.w,self.h=camera,width,height
        self.f,self.r,self.u=camera.basis();self.pos=np.array(camera.position)
        self.focal=width/2/math.tan(math.radians(camera.fov_degrees)/2)
        rng=random.Random(scene['seed'])
        color=np.array((172,186,199) if scene['environment']=='outdoor' else (170,164,151))
        color=np.clip(color+rng.randint(-25,25),0,255)
        self.rgb=np.broadcast_to(color,(height,width,3)).copy().astype(np.uint8)
        self.depth=np.full((height,width),np.inf);self.mask=np.zeros((height,width),np.uint8)
        self.treads=np.zeros((height,width),np.int16)

    def face(self,vertices,color,normal=None,obj=False,tread=0):
        vertices=np.asarray(vertices,dtype=float)
        if normal is not None and np.dot(normal,self.pos-vertices.mean(0))<=0:return
        delta=vertices-self.pos
        poly=[np.array((np.dot(p,self.r),np.dot(p,self.u),np.dot(p,self.f))) for p in delta]
        clipped=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            ia,ib=a[2]>=.1,b[2]>=.1
            if ia:clipped.append(a)
            if ia!=ib:clipped.append(a+(b-a)*((.1-a[2])/(b[2]-a[2])))
        if len(clipped)<3:return
        for i in range(1,len(clipped)-1):self.triangle([clipped[0],clipped[i],clipped[i+1]],color,obj,tread)

    def triangle(self,vertices,color,obj,tread):
        v=np.array(vertices);p=np.column_stack((self.w/2+self.focal*v[:,0]/v[:,2],
            self.h/2-self.focal*v[:,1]/v[:,2]))
        left=max(0,int(np.floor(p[:,0].min())));right=min(self.w-1,int(np.ceil(p[:,0].max())))
        top=max(0,int(np.floor(p[:,1].min())));bottom=min(self.h-1,int(np.ceil(p[:,1].max())))
        if left>right or top>bottom:return
        x,y=np.meshgrid(np.arange(left,right+1)+.5,np.arange(top,bottom+1)+.5)
        a,b,c=p;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-8:return
        w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
        w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;w2=1-w0-w1
        inside=(w0>=-1e-7)&(w1>=-1e-7)&(w2>=-1e-7)
        inv=w0/v[0,2]+w1/v[1,2]+w2/v[2,2]
        depth=1/np.maximum(inv,1e-9);region=np.s_[top:bottom+1,left:right+1]
        update=inside&(depth<self.depth[region])
        self.depth[region][update]=depth[update];self.rgb[region][update]=color
        self.mask[region][update]=int(obj);self.treads[region][update]=tread


def render(scene,cam,frame):
    raster=Raster(cam,320,240,scene);p=lambda x,y,z:point(scene,x,y,z)
    length=scene['steps']*scene['run'];height=scene['steps']*scene['rise'];half=scene['width']/2
    floor=np.array(scene['floorColor']);base=np.array(PALETTE[scene['material']],float)
    base=np.clip(base*scene['lighting'],35,225).astype(int)
    raster.face([p(-20,-20,0),p(20,-20,0),p(20,25,0),p(-20,25,0)],floor,(0,0,1))
    if scene['environment']=='indoor':
        wall=np.clip(floor+28,0,255)
        raster.face([p(-3.4,-8,0),p(-3.4,12,0),p(-3.4,12,height+3),p(-3.4,-8,height+3)],wall)
        raster.face([p(3.4,-8,0),p(3.4,12,0),p(3.4,12,height+3),p(3.4,-8,height+3)],wall*.94)
    # Geometric floor seams; same construction for every subtype and view.
    for j in range(-8,15):
        y=j*.7
        raster.face([p(-8,y,.002),p(8,y,.002),p(8,y+.012,.002),p(-8,y+.012,.002)],floor*.83)
    kind=scene['kind'];obj=kind in ('stairs','escalator')
    axis=np.array((math.sin(scene['yaw']),math.cos(scene['yaw']),0.))
    if kind in ('stairs','ramp','escalator'):
        raster.face([p(-8,length,height),p(8,length,height),p(8,length+10,height),p(-8,length+10,height)],floor,(0,0,1))
    if obj:
        for i in range(scene['steps']):
            y0,y1=i*scene['run'],(i+1)*scene['run'];z0,z1=i*scene['rise'],(i+1)*scene['rise']
            raster.face([p(-half,y0,z1),p(half,y0,z1),p(half,y1,z1),p(-half,y1,z1)],base,(0,0,1),True,i+1)
            raster.face([p(-half,y0,z0),p(half,y0,z0),p(half,y0,z1),p(-half,y0,z1)],base*(1-scene['contrast']),-axis,True,0)
            edge=np.array((205,177,81)) if scene['markings'] else base*.72
            raster.face([p(-half,y0,z1+.002),p(half,y0,z1+.002),p(half,y0+.018,z1+.002),p(-half,y0+.018,z1+.002)],edge,None,True,i+1)
            if kind=='escalator':
                for rib in range(1,5):
                    y=y0+rib*scene['run']/5
                    raster.face([p(-half,y,z1+.003),p(half,y,z1+.003),p(half,y+.005,z1+.003),p(-half,y+.005,z1+.003)],base*.65,None,True,i+1)
        if scene['railings']:
            for x in (-half-.13,half+.13):
                thickness=.11 if kind=='escalator' else .035
                # Wide mechanical side panels versus occasional thin fixed-stair railings.
                raster.face([p(x,0,.45),p(x,length,height+.45),p(x+thickness,length,height+.78),p(x+thickness,0,.78)],(53,59,64))
                if kind=='escalator':
                    raster.face([p(x,0,0),p(x,length,height),p(x,length,height+.65),p(x,0,.65)],(110,120,126))
    elif kind=='ramp':
        raster.face([p(-half,0,0),p(half,0,0),p(half,length,height),p(-half,length,height)],base)
        if scene['markings']:
            for i in range(scene['steps']):
                y=i*scene['run'];z=height*y/length+.003
                raster.face([p(-half,y,z),p(half,y,z),p(half,y+.018,z+height*.018/length),p(-half,y+.018,z+height*.018/length)],base*.7)
    elif kind=='stripes':
        for i in range(scene['steps']):
            y=i*scene['run']
            raster.face([p(-half,y,.004),p(half,y,.004),p(half,y+.035,.004),p(-half,y+.035,.004)],floor*.6)
    noise=np.random.default_rng(scene['seed']+frame).normal(0,random.Random(scene['seed']).uniform(1,4),raster.rgb.shape)
    image=Image.fromarray(np.clip(raster.rgb+noise,0,255).astype(np.uint8))
    visible=sum(np.count_nonzero(raster.treads==i+1)>=12 for i in range(scene['steps']))
    return image,Image.fromarray(raster.mask),int(visible)


def generate(output,cohort,previous):
    if not previous:raise ValueError('V3 requires prior synthetic manifests for test-freshness checks')
    output=output.resolve();repo=Path(__file__).resolve().parents[3]
    if output==repo or repo in output.parents or {p.lower() for p in output.parts}&{'.git','basira-vision-datasets'}:
        raise ValueError('Private synthetic output must be outside repository and real datasets')
    output.mkdir(parents=True,exist_ok=False);records=scenes(cohort);samples=[];masks={}
    for scene in records:
        views=[('up',0),('up',1),('down',0),('down',1)]+([('side',0)] if scene['kind']=='stairs' else [])
        for side,frame in views:
            cam=camera(scene,side,frame);image,mask,visible=render(scene,cam,frame+seed_for(side)%1000)
            sid=f'{scene["id"]}-{side}-{frame}';path=f'images/{sid}.png';maskpath=f'masks/{sid}.png'
            (output/'images').mkdir(exist_ok=True);(output/'masks').mkdir(exist_ok=True)
            image.save(output/path);mask.save(output/maskpath);array=np.asarray(mask);objects=[]
            direction=None;alignment=gaze=None
            if scene['kind'] in ('stairs','escalator'):
                if not array.any():raise ValueError(f'Object invisible: {sid}')
                direction,alignment,gaze=stair_direction(cam.position,cam.target,(0,0,0),
                    (math.sin(scene['yaw']),math.cos(scene['yaw'])),scene['steps'],scene['run'])
                if visible<3:direction=2303
                if scene['kind']=='escalator':direction=2304
                ys,xs=np.where(array>0)
                box=[float(xs.min()/320),float(ys.min()/240),float((xs.max()-xs.min()+1)/320),float((ys.max()-ys.min()+1)/240)]
                objects=[dict(classId=direction,box=box,areaPixels=int(array.sum()),source='synthetic_ground_truth')]
            samples.append(dict(id=sid,path=path,mask=maskpath,sha256=sha256(output/path),maskSha256=sha256(output/maskpath),
                scene_id=scene['id'],group=scene['id'],split=scene['split'],frame_id=frame,view=side,video_id=None,
                kind=scene['kind'],objects=objects,visibleTreads=visible,direction_alignment=alignment,gaze_alignment=gaze,
                camera_pose=dict(position=cam.position,target=cam.target,fov_degrees=cam.fov_degrees),
                contentKind='synthetic_ground_truth'))
            masks[sid]=mask
    old_hashes=set();old_ids=set()
    for path in previous:
        old=json.loads(path.read_text(encoding='utf-8'));old_hashes.update(s['sha256'] for s in old['samples']);old_ids.update(s['scene_id'] for s in old['samples'])
    if any(s['split']=='test' and (s['sha256'] in old_hashes or s['scene_id'] in old_ids) for s in samples):
        raise ValueError('New test overlaps previous synthetic data')
    for split in ('train','validation','test'):
        images=[];annotations=[]
        for i,sample in enumerate((s for s in samples if s['split']==split),1):
            images.append(dict(id=i,file_name=sample['path'],width=320,height=240,sample_id=sample['id'],scene_id=sample['scene_id']))
            for obj in sample['objects']:
                x,y,w,h=obj['box'];annotations.append(dict(id=len(annotations)+1,image_id=i,category_id=obj['classId'],
                    bbox=[x*320,y*240,w*320,h*240],area=obj['areaPixels'],segmentation=coco_rle(masks[sample['id']]),iscrowd=0,source='synthetic_ground_truth'))
        (output/f'coco-{split}.json').write_text(json.dumps(dict(images=images,annotations=annotations,categories=CATEGORIES)),encoding='utf-8')
    manifest=dict(schemaVersion=3,task='basira-stairs-v3-research',contentKind='synthetic_ground_truth',cohort=cohort,
        generator='depth-tested-paired-scenes-v3',scenes=records,samples=samples,categories=CATEGORIES,
        limitations=['Procedural synthetic rendering only','Single staircase per frame','No real-camera or navigation validation'])
    path=output/'manifest.json';path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    test=dict(scenes=[s for s in records if s['split']=='test'],samples=[s for s in samples if s['split']=='test'])
    fingerprint=hashlib.sha256(json.dumps(test,sort_keys=True).encode()).hexdigest()
    freeze=dict(manifestSha256=sha256(path),testFingerprint=fingerprint,priorManifests=[sha256(p) for p in previous],
        rule='No model inference on test before validation-only model and thresholds are locked')
    (output/'test-freeze.json').write_text(json.dumps(freeze,indent=2),encoding='utf-8')
    report=dict(images=len(samples),scenes=len(records),splits={s:dict(images=sum(x['split']==s for x in samples),
        scenes=sum(x['split']==s for x in records)) for s in ('train','validation','test')},**freeze)
    (output/'generation-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--cohort',default='research3-20261025');parser.add_argument('--previous-manifest',type=Path,action='append',default=[])
    args=parser.parse_args()
    if not args.cohort.replace('-','').isalnum():raise ValueError('Path-safe unique cohort required')
    generate(args.output,args.cohort,args.previous_manifest)
