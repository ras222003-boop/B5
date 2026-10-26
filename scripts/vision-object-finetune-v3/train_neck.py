"""Validation-motivated third candidate: adapt only fine-scale C3_p3 and the head.
No final data, restricted ancestor, or changed frozen prefix is used.
"""
from pathlib import Path
from collections import Counter
import json,random,shutil,sys,time
import numpy as np,torch,psutil
from rights import read,sha,check_row,TINY_SHA
from native import initial_model,tensor,decode,choose_threshold
from losses import PartialObjectness,scoped_regularizers

root=Path(sys.argv[1]).resolve();out=root/'training';folder=out/'neck-416'
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists()
assert not folder.exists(),'Never silently repeat a measured candidate'
original=read(out/'selection-lock.json');plan=read(root/'protocol.json');probe=read(root/'resolution-probe.json')
assert max(r['bestValidation']['summary']['f1'] for r in original['candidates'])<probe['baseline416']['f1']
shutil.copyfile(out/'selection-lock.json',out/'selection-lock.heads-only.json')
folder.mkdir();size=416;manifest=read(root/'manifest.json');names=[c['name'] for c in manifest['categories']]
train=[r for r in manifest['samples'] if r['split']=='train'];validation=[r for r in manifest['samples'] if r['split']=='validation']
for row in train+validation:check_row(root,row)
config=dict(id='neck-416',inputSize=416,lr=3e-6,neckLr=1e-6,scopedNegativeWeight=1.,stabilityWeight=.2,trainableNeck='C3_p3 only')
annex=dict(reason='Both head-only trials failed to beat original validation macroF1; test learning fine-scale features',
    createdBeforeCandidateTraining=True,finalUsedForDesign=False,config=config,previousSelectionSha256=sha(out/'selection-lock.heads-only.json'))
(root/'neck-study-design.json').write_text(json.dumps(annex,indent=2))
bindings=dict(original['selected']['bindings'],neckDesignSha256=sha(root/'neck-study-design.json'),neckTrainerSha256=sha(Path(__file__)))
shutil.copyfile(Path(__file__),folder/'source-used.py');torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(20261026)
started=time.monotonic();cpu_started=time.process_time();process=psutil.Process();peak=0.;last_disk=-30.
def event(kind,**fields):
    record=dict(kind=kind,elapsedSeconds=time.monotonic()-started,cpuSeconds=time.process_time()-cpu_started,**fields)
    with (folder/'events.jsonl').open('a') as f:f.write(json.dumps(record)+'\n')
    print(json.dumps(record),flush=True)
def guard():
    global peak,last_disk
    peak=max(peak,process.memory_info().rss/2**20)
    if peak>plan['maxRssMiB'] or psutil.virtual_memory().available<384*2**20:raise RuntimeError('memory_limit')
    if original['wallSeconds']+time.monotonic()-started>plan['maxTrainingSeconds']:raise RuntimeError('aggregate_training_time_limit')
    if (root/'STOP').exists():raise InterruptedError('STOP_requested')
    if time.monotonic()-started-last_disk>30:
        last_disk=time.monotonic()-started
        if sum(p.stat().st_size for p in root.rglob('*') if p.is_file())/2**20>plan['maxDiskMiB']:raise RuntimeError('disk_limit')
teacher=initial_model(root)
for p in teacher.parameters():p.requires_grad_(False)
prefix=folder/'prefix';prefix.mkdir();captured={}
hooks=[teacher.backbone.lateral_conv0.register_forward_hook(lambda m,a,v:captured.__setitem__('coarse',v.detach().clone())),
    teacher.backbone.reduce_conv1.register_forward_hook(lambda m,a,v:captured.__setitem__('middle',v.detach().clone())),
    teacher.backbone.C3_p3.register_forward_pre_hook(lambda m,a:captured.__setitem__('fine',a[0].detach().clone()))]
entries={e['id']:e for e in read(root/'preprocessed-416/index.json')['entries']}
for i,row in enumerate(train+validation):
    guard();x=tensor(root,entries[row['id']],416)
    with torch.no_grad():teacher.backbone(x)
    torch.save(dict(inputs=dict(captured),sourceImageSha256=row['sha256'],bindings=bindings),prefix/(row['id']+'.pth'))
    if (i+1)%25==0:event('clean_prefix_cache',images=i+1,total=len(train+validation),sampledRssMiB=peak)
for hook in hooks:hook.remove()
def load(row):
    base=torch.load(out/'features-416'/(row['id']+'.pth'),map_location='cpu',weights_only=True)
    p=torch.load(prefix/(row['id']+'.pth'),map_location='cpu',weights_only=True)
    assert p['bindings']==bindings and p['sourceImageSha256']==base['sourceImageSha256']==row['sha256']
    return dict(base,prefix=p['inputs'])
def features(model,items):
    neck=model.backbone;fine=torch.cat([i['prefix']['fine'] for i in items]);middle=torch.cat([i['prefix']['middle'] for i in items]);coarse=torch.cat([i['prefix']['coarse'] for i in items])
    p2=neck.C3_p3(fine);p1=neck.C3_n3(torch.cat([neck.bu_conv2(p2),middle],1));p0=neck.C3_n4(torch.cat([neck.bu_conv1(p1),coarse],1))
    return [p2,p1,p0]
check=load(train[0])
with torch.no_grad():
    for actual,expected in zip(features(teacher,[check]),check['features']):torch.testing.assert_close(actual,expected,rtol=1e-5,atol=1e-5)
del check
model=initial_model(root)
for p in model.backbone.parameters():p.requires_grad_(False)
for p in model.backbone.C3_p3.parameters():p.requires_grad_(True)
initial_head={k:v.clone() for k,v in model.head.state_dict().items()};initial_neck={k:v.clone() for k,v in model.backbone.C3_p3.state_dict().items()}
loss_module=PartialObjectness();model.head.bcewithlog_loss=loss_module
optimizer=torch.optim.AdamW([dict(params=model.head.parameters(),lr=3e-6),dict(params=model.backbone.C3_p3.parameters(),lr=1e-6)],weight_decay=1e-4)
seen=set();samples=Counter();step=0;epoch=0;choice=None;best=(-1.,-1.,-1.);patience=0;stop='epoch_limit';neck_gradient_verified=False
def save(path):
    torch.save(dict(model=model.state_dict(),optimizer=optimizer.state_dict(),epoch=epoch,optimizerSteps=step,
        trainedImageIds=sorted(seen),sampleCounts=dict(samples),config=config,bindings=bindings,validation=choice,
        initialTinySha256=TINY_SHA,usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False,torchRng=torch.get_rng_state()),path)
try:
    for epoch in range(1,4):
        model.train()
        for module in model.modules():
            if isinstance(module,torch.nn.BatchNorm2d):module.eval()
        scarce=[i for i,r in enumerate(train) if r['source']=='coco-commercial'];order=list(range(len(train)))+scarce*2;random.Random(20261026+epoch).shuffle(order);losses=[]
        for offset in range(0,len(order),2):
            guard();rows=[train[i] for i in order[offset:offset+2]];items=[load(r) for r in rows];f=features(model,items)
            targets=torch.zeros((len(rows),max(len(i['labels']) for i in items),5))
            for i,item in enumerate(items):targets[i,:len(item['labels'])]=item['labels']
            loss_module.partial=torch.tensor([not r['completeLabels'] for r in rows]).repeat_interleave(3549).reshape(-1,1)
            loss_module.teacher=torch.cat([i['teacher'][:,:,4:5] for i in items]).reshape(-1,1)
            optimizer.zero_grad(set_to_none=True);result=model.head(f,targets,torch.empty((len(rows),3,416,416)))
            model.head.eval();raw=model.head(f);negative,unknown=scoped_regularizers(raw,items,rows,names,416);model.head.train()
            for module in model.head.modules():
                if isinstance(module,torch.nn.BatchNorm2d):module.eval()
            loss=result[0]+negative+.2*unknown;assert torch.isfinite(loss)
            loss.backward();norm=torch.nn.utils.clip_grad_norm_(model.parameters(),10.);assert torch.isfinite(norm) and float(norm)>0
            neck_gradient_verified|=any(p.grad is not None and bool(p.grad.abs().sum()>0) for p in model.backbone.C3_p3.parameters())
            optimizer.step();step+=1;seen.update(r['id'] for r in rows);samples.update(r['source'] for r in rows);losses.append(float(loss.detach()))
            del items,f,targets,result,raw,loss,negative,unknown
            if step%16==0:save(folder/'rolling.pth');event('optimizer_progress',epoch=epoch,steps=step,seenImages=len(seen),sampledRssMiB=peak)
        model.eval();predictions={}
        with torch.no_grad():
            for row in validation:
                guard();item=load(row);raw=model.head(features(model,[item]));predictions[row['id']]=dict(sha256=row['sha256'],detections=decode(raw,names,row['width'],row['height'],416))
        choice,thresholds=choose_threshold(validation,predictions,names,probe['baseline416'],plan['thresholdCandidates'])
        (folder/f'validation-{epoch:02d}.json').write_text(json.dumps(dict(choice=choice,thresholds=thresholds,predictions=predictions),indent=2))
        rank=(float(choice['qualifies']),choice['summary']['f1'],choice['summary']['map'])
        if rank>best:best=rank;patience=0;save(folder/'best.pth')
        else:patience+=1
        save(folder/'last.pth');event('epoch',epoch=epoch,steps=step,summary=choice['summary'],threshold=choice['threshold'],qualifies=choice['qualifies'],meanLoss=float(np.mean(losses)))
        if patience>=2:stop='validation_plateau';break
except (RuntimeError,InterruptedError) as error:
    save(folder/'interrupted.pth');event('stopped',reason=str(error));raise
selected=torch.load(folder/'best.pth',map_location='cpu',weights_only=True)
changed_head=sum(not torch.equal(v,selected['model']['head.'+k]) for k,v in initial_head.items())
changed_neck=sum(not torch.equal(v,selected['model']['backbone.C3_p3.'+k]) for k,v in initial_neck.items())
assert changed_head and changed_neck and neck_gradient_verified
assert all(torch.equal(v,selected['model']['backbone.'+k]) for k,v in teacher.backbone.state_dict().items() if not k.startswith('C3_p3.'))
report=dict(config=config,epochsRun=epoch,optimizerStepsRun=step,selectedEpoch=selected['epoch'],selectedOptimizerSteps=selected['optimizerSteps'],
    selectedTrainedImageIds=selected['trainedImageIds'],actualTrainImagesInSelected=len(selected['trainedImageIds']),
    selectedThreshold=selected['validation']['threshold'],bestValidation=selected['validation'],changedHeadTensors=changed_head,
    changedNeckTensors=changed_neck,neckGradientVerified=neck_gradient_verified,prefixAndOtherBodyUnchanged=True,backwardExecuted=True,
    checkpoint=str((folder/'best.pth').relative_to(root)),checkpointSha256=sha(folder/'best.pth'),stopReason=stop,bindings=bindings,
    inputSize=416,sampledPeakRssMiB=peak,wallSeconds=time.monotonic()-started,cpuSeconds=time.process_time()-cpu_started)
(folder/'report.json').write_text(json.dumps(report,indent=2))
candidates=original['candidates']+[report];chosen=max(candidates,key=lambda r:(r['bestValidation']['qualifies'],r['bestValidation']['summary']['f1'],r['bestValidation']['summary']['map']))
combined=dict(original,selected=chosen,candidates=candidates,totalOptimizerSteps=original['totalOptimizerSteps']+step,
    wallSeconds=original['wallSeconds']+report['wallSeconds'],cpuSeconds=original['cpuSeconds']+report['cpuSeconds'],
    sampledPeakRssMiB=max(original['sampledPeakRssMiB'],peak),inputSize=chosen['inputSize'],neckStudyDesignSha256=sha(root/'neck-study-design.json'))
(out/'selection-lock.json').write_text(json.dumps(combined,indent=2));event('complete',selected=chosen['config']['id'],steps=combined['totalOptimizerSteps'])
