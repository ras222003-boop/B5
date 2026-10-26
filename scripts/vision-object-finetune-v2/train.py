"""CPU V2 study: exact browser pixels, frozen body, real gradient updates.
Only independent mapped GT supervises labels. Unknown source classes are not negatives.
An original Tiny teacher regularizes unknown objectness/class scores; it is NOT reference GT.
"""
from pathlib import Path
from collections import Counter
import json,os,random,shutil,sys,time,hashlib
os.environ['CUDA_VISIBLE_DEVICES']='';os.environ['OMP_NUM_THREADS']='2';os.environ['MKL_NUM_THREADS']='2'
import numpy as np
import psutil,torch
import torch.nn.functional as F
from knowledge import evaluate_rows
from partial_loss import PartialObjectness,scoped_regularizers
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vision-object-finetune'))
from common import model_from,decode

root=Path(sys.argv[1]).resolve()
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists(),'Final selection/evaluation prohibits further training'
manifest=read(root/'manifest.json');lock=read(root/'cohort-lock.json');plan=read(root/'protocol.json')
assert sha(root/'manifest.json')==lock['manifestSha256'] and sha(root/'protocol.json')==lock['protocolSha256']
names=[c['name'] for c in manifest['categories']]
train_rows=[r for r in manifest['samples'] if r['split']=='train'];val_rows=[r for r in manifest['samples'] if r['split']=='validation']
assert len(train_rows)>=150 and len({r['groupId'] for r in train_rows})>=100,'Insufficient independent real source groups'
index=read(root/'preprocessed/index.json');pixels={e['id']:e for e in index['entries']}
assert set(pixels)=={r['id'] for r in train_rows+val_rows} and not any(e['split']=='test' for e in pixels.values())
torch.set_num_threads(2);torch.set_num_interop_threads(1)
torch.manual_seed(20261025);np.random.seed(20261025);random.seed(20261025)
out=root/'training';out.mkdir(exist_ok=True)
source_used=out/'source-used.py'
if source_used.exists():assert sha(source_used)==sha(Path(__file__)),'Training source changed; use a new study'
else:shutil.copyfile(Path(__file__),source_used)
bindings=dict(cohortSha256=sha(root/'manifest.json'),protocolSha256=sha(root/'protocol.json'),preprocessIndexSha256=sha(root/'preprocessed/index.json'),trainerSha256=sha(Path(__file__)),metricSourceSha256=sha(Path(__file__).with_name('knowledge.py')),lossSourceSha256=sha(Path(__file__).with_name('partial_loss.py')),initialV1Sha256=sha(root.parent/'object-finetune-v1-001/training/best.pth'),teacherTinySha256=sha(root/'assets/yolox_tiny.pth'))
(out/'bindings.json').write_text(json.dumps(bindings,indent=2),encoding='utf-8')
started=time.monotonic();cpu_start=time.process_time();process=psutil.Process();peak=0.;last_disk=-10.
def guard():
    global peak,last_disk
    rss=process.memory_info().rss/2**20;peak=max(peak,rss)
    if rss>plan['maxRssMiB']:raise RuntimeError('sampled_memory_budget')
    if time.monotonic()-started>plan['maxTrainingSeconds']:raise RuntimeError('training_time_budget')
    if time.monotonic()-started-last_disk>=15:
        last_disk=time.monotonic()-started
        if sum(p.stat().st_size for p in root.rglob('*') if p.is_file())/2**20>plan['maxDiskMiB']:raise RuntimeError('disk_budget')
    if (root/'STOP').exists():raise InterruptedError('STOP: checkpoint preserved, no further steps')
def event(folder,kind,**data):
    value=dict(kind=kind,elapsedSeconds=time.monotonic()-started,**data)
    with (folder/'events.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(value)+'\n')
    print(json.dumps(value),flush=True)

teacher=model_from(root)
for p in teacher.parameters():p.requires_grad_(False)
v1_path=root.parent/'object-finetune-v1-001/training/best.pth'
cache_file=out/'features.pth'
if cache_file.exists():
    loaded=torch.load(cache_file,map_location='cpu',weights_only=True)
    assert loaded['bindings']==bindings
    cache=loaded['items']
else:
    cache={}
    for n,row in enumerate(train_rows+val_rows):
        guard();entry=pixels[row['id']]
        assert entry['sourceImageSha256']==row['sha256'] and sha(root/entry['path'])==entry['sha256']
        rgba=np.frombuffer((root/entry['path']).read_bytes(),dtype=np.uint8).reshape(416,416,4)
        x=torch.from_numpy(rgba[:,:,:3][:,:,::-1].transpose(2,0,1).copy().astype(np.float32)).unsqueeze(0)
        ratio=entry['ratio'];labels=torch.zeros((max(1,len(row['objects'])),5))
        for i,obj in enumerate(row['objects']):
            a,b,w,h=obj['box'];labels[i]=torch.tensor([names.index(obj['class']),(a+w/2)*row['width']*ratio,(b+h/2)*row['height']*ratio,w*row['width']*ratio,h*row['height']*ratio])
        with torch.no_grad():
            features=[t.detach().clone() for t in teacher.backbone(x)]
            original=teacher.head(features).detach().clone()
        cache[row['id']]=dict(features=features,labels=labels,teacher=original)
        if (n+1)%25==0:event(out,'feature_cache',completed=n+1,total=len(train_rows+val_rows))
    torch.save(dict(bindings=bindings,items=cache),cache_file)

def summarize(measured):
    return dict(f1=float(np.mean([v['overall']['f1'] for v in measured['perSource'].values() if v['overall']['f1'] is not None])),map=float(np.mean([v['map'] for v in measured['perSource'].values() if v['map'] is not None])),overall=measured['overall'],perSource={s:dict(overall=v['overall'],map=v['map']) for s,v in measured['perSource'].items()})
def validate(model):
    model.head.eval();predictions={}
    with torch.no_grad():
        for row in val_rows:
            guard();raw=model.head(cache[row['id']]['features'])
            predictions[row['id']]=dict(sha256=row['sha256'],detections=decode(raw,names,row['width'],row['height']))
    measured=evaluate_rows(val_rows,predictions,names,.5)
    return summarize(measured),measured,predictions

initial_model=model_from(root,v1_path)
assert all(torch.equal(p,teacher.backbone.state_dict()[k]) for k,p in initial_model.backbone.state_dict().items()),'Frozen body must match teacher cache'
initial_summary,initial_metrics,initial_predictions=validate(initial_model)
(out/'initial-validation.json').write_text(json.dumps(dict(summary=initial_summary,metrics=initial_metrics,predictions=initial_predictions),indent=2),encoding='utf-8')
del initial_model
reports=[]
for config in plan['candidates']:
    folder=out/config['id'];folder.mkdir(exist_ok=True)
    if (folder/'report.json').exists():reports.append(read(folder/'report.json'));continue
    if (folder/'events.jsonl').exists():raise ValueError('Interrupted run exists; preserve it, do not silently restart/duplicate it')
    torch.manual_seed(20261025)
    model=model_from(root,v1_path)
    initial_head={k:v.clone() for k,v in model.head.state_dict().items()}
    for p in model.backbone.parameters():p.requires_grad_(False)
    if config['predictorsOnly']:
        for n,p in model.head.named_parameters():p.requires_grad_(n.startswith(('cls_preds.','reg_preds.','obj_preds.')))
    loss_module=PartialObjectness();model.head.bcewithlog_loss=loss_module
    optimizer=torch.optim.AdamW([p for p in model.head.parameters() if p.requires_grad],lr=config['lr'],weight_decay=1e-4)
    best=(-1.,-1.);no_gain=0;step=0;seen=set();sample_counts=Counter();stop='epoch_budget';epoch=0
    def checkpoint(path,summary):
        torch.save(dict(model=model.state_dict(),optimizer=optimizer.state_dict(),epoch=epoch,optimizerSteps=step,trainedImageIds=sorted(seen),sampleCounts=dict(sample_counts),config=config,bindings=bindings,validation=summary,torchRng=torch.get_rng_state()),path)
    try:
        for epoch in range(1,plan['maxEpochsPerCandidate']+1):
            guard();model.head.train()
            for m in model.head.modules():
                if isinstance(m,torch.nn.BatchNorm2d):m.eval()
            rng=random.Random(20261025+epoch)
            replay=[i for i,r in enumerate(train_rows) if r['source']=='coco-replay']
            order=list(range(len(train_rows)))+replay*3;rng.shuffle(order)
            losses=[];neg_losses=[]
            for offset in range(0,len(order),4):
                guard();rows=[train_rows[i] for i in order[offset:offset+4]];items=[cache[r['id']] for r in rows]
                features=[torch.cat([item['features'][j] for item in items]) for j in range(3)]
                labels=torch.zeros((len(rows),max(len(item['labels']) for item in items),5))
                for i,item in enumerate(items):labels[i,:len(item['labels'])]=item['labels']
                loss_module.partial=torch.tensor([not r['completeLabels'] for r in rows]).repeat_interleave(3549).reshape(-1,1)
                loss_module.teacher=torch.cat([item['teacher'][:,:,4:5] for item in items]).reshape(-1,1)
                optimizer.zero_grad(set_to_none=True)
                result=model.head(features,labels,torch.empty((len(rows),3,416,416)))
                model.head.eval();raw=model.head(features);negative,unknown=scoped_regularizers(raw,items,rows,names)
                model.head.train()
                for m in model.head.modules():
                    if isinstance(m,torch.nn.BatchNorm2d):m.eval()
                loss=result[0]+config['scopedNegativeWeight']*negative+.1*unknown
                if not torch.isfinite(loss):raise RuntimeError('nonfinite_loss')
                loss.backward();norm=torch.nn.utils.clip_grad_norm_(model.head.parameters(),10.)
                if not torch.isfinite(norm) or float(norm)==0:raise RuntimeError('invalid_gradient')
                optimizer.step();step+=1;seen.update(r['id'] for r in rows);sample_counts.update(r['source'] for r in rows)
                losses.append(float(loss.detach()));neg_losses.append(float(negative.detach()))
            summary,measured,predictions=validate(model)
            (folder/f'validation-{epoch:02d}.json').write_text(json.dumps(dict(summary=summary,metrics=measured,predictions=predictions),indent=2),encoding='utf-8')
            score=(summary['f1'],summary['map']);gain=score>best
            if gain:best=score;no_gain=0;checkpoint(folder/'best.pth',summary)
            else:no_gain+=1
            checkpoint(folder/'last.pth',summary)
            event(folder,'epoch',candidate=config['id'],epoch=epoch,optimizerSteps=step,actualTrainImages=len(seen),meanLoss=float(np.mean(losses)),meanScopedNegativeLoss=float(np.mean(neg_losses)),validation=summary,improved=gain,sampledRssMiB=process.memory_info().rss/2**20)
            if no_gain>=plan['earlyStopPatience']:stop='validation_plateau';break
    except (RuntimeError,InterruptedError) as e:
        stop=str(e);checkpoint(folder/'interrupted.pth',dict(f1=best[0],map=best[1]));event(folder,'stopped',reason=stop);raise
    chosen=torch.load(folder/'best.pth',map_location='cpu',weights_only=True)
    assert all(torch.equal(chosen['model']['backbone.'+k],v) for k,v in teacher.backbone.state_dict().items()),'Frozen backbone changed'
    changed=sum(not torch.equal(v,chosen['model']['head.'+k]) for k,v in initial_head.items())
    assert step>0 and changed>0
    report=dict(config=config,epochsRun=epoch,optimizerStepsRun=step,selectedEpoch=chosen['epoch'],selectedOptimizerSteps=chosen['optimizerSteps'],selectedTrainedImageIds=chosen['trainedImageIds'],actualTrainImagesInSelected=len(chosen['trainedImageIds']),changedHeadTensors=changed,frozenBackboneUnchanged=True,bestValidation=chosen['validation'],checkpoint=str((folder/'best.pth').relative_to(root)),checkpointSha256=sha(folder/'best.pth'),backwardExecuted=True,stopReason=stop,trainableParameters=sum(p.numel() for p in model.head.parameters() if p.requires_grad),sampledPeakRssMiB=peak,bindings=bindings)
    (folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');reports.append(report)
    del model,optimizer,chosen
selected=max(reports,key=lambda r:(r['bestValidation']['f1'],r['bestValidation']['map']))
choice=dict(selected=selected,candidates=reports,selectedOnlyOnValidation=True,finalUsedForSelection=False,threshold=.5,totalOptimizerSteps=sum(r['optimizerStepsRun'] for r in reports),wallSeconds=time.monotonic()-started,cpuSeconds=time.process_time()-cpu_start,sampledPeakRssMiB=peak,threads=2,initialWeights='V1 best; original Tiny is a soft stability teacher, never reference GT',initialV1Sha256=bindings['initialV1Sha256'],teacherTinySha256=bindings['teacherTinySha256'],initialValidation=initial_summary)
(out/'selection-lock.json').write_text(json.dumps(choice,indent=2),encoding='utf-8');print(json.dumps(dict(selected=selected['config']['id'],epoch=selected['selectedEpoch'],steps=choice['totalOptimizerSteps'],images=selected['actualTrainImagesInSelected'],validation=selected['bestValidation'],wallSeconds=choice['wallSeconds'])),flush=True)
