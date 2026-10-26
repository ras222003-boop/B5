"""Actual bounded CPU fine-tuning from original Tiny, with isolated on-disk features."""
from pathlib import Path
from collections import Counter
import json,os,random,shutil,subprocess,sys,time
import psutil,torch,numpy as np
from rights import read,sha,check_row,check_initial,TINY_SHA
from native import initial_model,tensor,labels,decode,choose_threshold
from losses import PartialObjectness,scoped_regularizers

root=Path(sys.argv[1]).resolve()
if '--worker' not in sys.argv:
    # Terminate this known child tree if cooperative checks cannot return in time.
    process=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),str(root),'--worker'])
    try:raise SystemExit(process.wait(timeout=read(root/'protocol.json')['hardSupervisorSeconds']))
    except subprocess.TimeoutExpired:
        parent=psutil.Process(process.pid)
        for child in parent.children(recursive=True):
            try:child.terminate()
            except psutil.NoSuchProcess:pass
        parent.terminate();process.wait(timeout=15)
        (root/'training/hard-stop.json').write_text(json.dumps(dict(reason='hard_time_limit',checkpointPolicy='last rolling/epoch checkpoints retained',finalUsedForSelection=False)))
        raise SystemExit(2)

manifest=read(root/'manifest.json');lock=read(root/'cohort-lock.json');plan=read(root/'protocol.json');probe=read(root/'resolution-probe.json')
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists()
assert sha(root/'manifest.json')==lock['manifestSha256'] and sha(root/'protocol.json')==lock['protocolSha256']
assert sha(Path(__file__).with_name('rights.py'))==plan['rightsGateSha256']
check_initial(root/'assets/yolox_tiny.pth',read(root/'rights-audit.json'))
design=read(root/'study-design.json');assert design['createdBeforeAnyTraining'] and not design['finalUsedForDesign']
sizes=sorted({c['inputSize'] for c in design['candidates']});names=[c['name'] for c in manifest['categories']]
train_rows=[r for r in manifest['samples'] if r['split']=='train'];val_rows=[r for r in manifest['samples'] if r['split']=='validation']
for row in train_rows+val_rows:check_row(root,row)
torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(20261026);np.random.seed(20261026);random.seed(20261026)
out=root/'training';out.mkdir(exist_ok=True);source_used=out/'source-used.py'
if source_used.exists():assert sha(source_used)==sha(Path(__file__)),'Source changed after run started'
else:shutil.copyfile(Path(__file__),source_used)
indices={size:read(root/f'preprocessed-{size}/index.json') for size in sizes}
for index in indices.values():
    assert index['manifestSha256']==lock['manifestSha256'] and {e['id'] for e in index['entries']}=={r['id'] for r in train_rows+val_rows}
    assert index['detectorSourceSha256']==sha('client/src/lib/vision/qualityProviders.ts')
bindings=dict(manifestSha256=lock['manifestSha256'],protocolSha256=lock['protocolSha256'],resolutionProbeSha256=sha(root/'resolution-probe.json'),
    preprocessIndexSha256={str(size):sha(root/f'preprocessed-{size}/index.json') for size in sizes},initialTinySha256=TINY_SHA,
    studyDesignSha256=sha(root/'study-design.json'),
    trainerSha256=sha(Path(__file__)),nativeSourceSha256=sha(Path(__file__).with_name('native.py')),
    lossSourceSha256=sha(Path(__file__).with_name('losses.py')),rightsGateSha256=plan['rightsGateSha256'],
    usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False,inputSizes=sizes)
(out/'bindings.json').write_text(json.dumps(bindings,indent=2))
started=time.monotonic();cpu_started=time.process_time();process=psutil.Process();peak=0.;last_disk=-30.
def event(folder,kind,**fields):
    value=dict(kind=kind,elapsedSeconds=time.monotonic()-started,cpuSeconds=time.process_time()-cpu_started,**fields)
    with (folder/'events.jsonl').open('a') as handle:handle.write(json.dumps(value)+'\n')
    print(json.dumps(value),flush=True)
def guard():
    global peak,last_disk
    peak=max(peak,process.memory_info().rss/2**20)
    if peak>plan['maxRssMiB']:raise RuntimeError('memory_limit')
    if psutil.virtual_memory().available<384*2**20:raise RuntimeError('system_available_memory_limit')
    if time.monotonic()-started>plan['maxTrainingSeconds']:raise RuntimeError('training_time_limit')
    if (root/'STOP').exists():raise InterruptedError('STOP_requested')
    if time.monotonic()-started-last_disk>30:
        last_disk=time.monotonic()-started
        if sum(p.stat().st_size for p in root.rglob('*') if p.is_file())/2**20>plan['maxDiskMiB']:raise RuntimeError('disk_limit')

teacher=initial_model(root)
for p in teacher.parameters():p.requires_grad_(False)
for size in sizes:
    cache=out/f'features-{size}';cache.mkdir(exist_ok=True)
    entries={e['id']:e for e in indices[size]['entries']}
    for i,row in enumerate(train_rows+val_rows):
        guard();path=cache/(row['id']+'.pth')
        if path.exists():
            item=torch.load(path,map_location='cpu',weights_only=True);assert item['bindings']==bindings and item['sourceImageSha256']==row['sha256'];del item
            continue
        x=tensor(root,entries[row['id']],size)
        with torch.no_grad():features=[t.detach().clone() for t in teacher.backbone(x)];prior=teacher.head(features).detach().clone()
        torch.save(dict(features=features,teacher=prior,labels=labels(row,names,size),sourceImageSha256=row['sha256'],bindings=bindings,inputSize=size),path)
        if (i+1)%20==0:event(out,'feature_cache',inputSize=size,images=i+1,total=len(train_rows+val_rows),sampledRssMiB=peak)
        del x,features,prior
def load(row):
    item=torch.load(cache/(row['id']+'.pth'),map_location='cpu',weights_only=True)
    assert item['bindings']==bindings and item['sourceImageSha256']==row['sha256'] and item['inputSize']==size;return item
baseline=probe['baseline416']
def validate(model):
    model.head.eval();predictions={}
    with torch.no_grad():
        for row in val_rows:
            guard();item=load(row);raw=model.head(item['features'])
            predictions[row['id']]=dict(sha256=row['sha256'],detections=decode(raw,names,row['width'],row['height'],size))
            del item,raw
    choice,thresholds=choose_threshold(val_rows,predictions,names,baseline,plan['thresholdCandidates'])
    return choice,thresholds,predictions
reports=[];unfinished=[]
for config in design['candidates']:
    size=config['inputSize'];cache=out/f'features-{size}'
    folder=out/config['id'];folder.mkdir(exist_ok=True)
    if (folder/'report.json').exists():reports.append(read(folder/'report.json'));continue
    if (folder/'events.jsonl').exists():raise ValueError('Preserve interrupted study; no silent restart')
    model=initial_model(root);initial_head={k:v.clone() for k,v in model.head.state_dict().items()}
    for p in model.backbone.parameters():p.requires_grad_(False)
    loss_module=PartialObjectness();model.head.bcewithlog_loss=loss_module
    optimizer=torch.optim.AdamW(model.head.parameters(),lr=config['lr'],weight_decay=1e-4)
    best=(-1.,-1.,-1.);no_gain=0;step=0;epoch=0;seen=set();samples=Counter();choice=None;stop='epoch_limit'
    def save(path):
        torch.save(dict(model=model.state_dict(),optimizer=optimizer.state_dict(),optimizerSteps=step,epoch=epoch,
            trainedImageIds=sorted(seen),sampleCounts=dict(samples),config=config,bindings=bindings,
            validation=choice,initialTinySha256=TINY_SHA,usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False,
            torchRng=torch.get_rng_state()),path)
    try:
        for epoch in range(1,plan['maxEpochsPerCandidate']+1):
            model.head.train()
            for m in model.head.modules():
                if isinstance(m,torch.nn.BatchNorm2d):m.eval()
            scarce=[i for i,r in enumerate(train_rows) if r['source']=='coco-commercial']
            order=list(range(len(train_rows)))+scarce*2;random.Random(20261026+epoch).shuffle(order);losses=[]
            for offset in range(0,len(order),plan['batch']):
                guard();rows=[train_rows[i] for i in order[offset:offset+plan['batch']]];items=[load(r) for r in rows]
                features=[torch.cat([item['features'][j] for item in items]) for j in range(3)]
                targets=torch.zeros((len(rows),max(len(item['labels']) for item in items),5))
                for i,item in enumerate(items):targets[i,:len(item['labels'])]=item['labels']
                anchors=items[0]['teacher'].shape[1]
                loss_module.partial=torch.tensor([not r['completeLabels'] for r in rows]).repeat_interleave(anchors).reshape(-1,1)
                loss_module.teacher=torch.cat([item['teacher'][:,:,4:5] for item in items]).reshape(-1,1)
                optimizer.zero_grad(set_to_none=True)
                result=model.head(features,targets,torch.empty((len(rows),3,size,size)))
                model.head.eval();raw=model.head(features);negative,unknown=scoped_regularizers(raw,items,rows,names,size)
                model.head.train()
                for m in model.head.modules():
                    if isinstance(m,torch.nn.BatchNorm2d):m.eval()
                loss=result[0]+config['scopedNegativeWeight']*negative+config['stabilityWeight']*unknown
                if not torch.isfinite(loss):raise RuntimeError('nonfinite_loss')
                loss.backward();norm=torch.nn.utils.clip_grad_norm_(model.head.parameters(),10.)
                if not torch.isfinite(norm) or float(norm)<=0:raise RuntimeError('invalid_gradient')
                optimizer.step();step+=1;seen.update(r['id'] for r in rows);samples.update(r['source'] for r in rows);losses.append(float(loss.detach()))
                del items,features,targets,raw,result,loss,negative,unknown
                if step%16==0:save(folder/'rolling.pth');event(folder,'optimizer_progress',candidate=config['id'],epoch=epoch,steps=step,seenImages=len(seen),sampledRssMiB=peak)
            choice,thresholds,predictions=validate(model);rank=(float(choice['qualifies']),choice['summary']['f1'],choice['summary']['map'])
            (folder/f'validation-{epoch:02d}.json').write_text(json.dumps(dict(choice=choice,thresholds=thresholds,predictions=predictions),indent=2))
            if rank>best:best=rank;no_gain=0;save(folder/'best.pth')
            else:no_gain+=1
            save(folder/'last.pth');event(folder,'epoch',candidate=config['id'],epoch=epoch,optimizerSteps=step,
                meanLoss=float(np.mean(losses)),summary=choice['summary'],threshold=choice['threshold'],qualifies=choice['qualifies'],sampledRssMiB=peak)
            if no_gain>=plan['earlyStopPatience']:stop='validation_plateau';break
    except (RuntimeError,InterruptedError) as error:
        stop=str(error);save(folder/'interrupted.pth');event(folder,'stopped',reason=stop,optimizerSteps=step,epoch=epoch)
        unfinished.append(dict(candidate=config['id'],reason=stop,optimizerSteps=step));break
    selected=torch.load(folder/'best.pth',map_location='cpu',weights_only=True)
    changed=sum(not torch.equal(v,selected['model']['head.'+k]) for k,v in initial_head.items())
    assert step>0 and changed>0
    assert all(torch.equal(v,selected['model']['backbone.'+k]) for k,v in teacher.backbone.state_dict().items())
    report=dict(config=config,epochsRun=epoch,optimizerStepsRun=step,selectedEpoch=selected['epoch'],
        selectedOptimizerSteps=selected['optimizerSteps'],selectedTrainedImageIds=selected['trainedImageIds'],
        actualTrainImagesInSelected=len(selected['trainedImageIds']),selectedThreshold=selected['validation']['threshold'],
        bestValidation=selected['validation'],changedHeadTensors=changed,frozenBackboneUnchanged=True,backwardExecuted=True,
        checkpoint=str((folder/'best.pth').relative_to(root)),checkpointSha256=sha(folder/'best.pth'),
        stopReason=stop,bindings=bindings,inputSize=size,sampledPeakRssMiB=peak)
    (folder/'report.json').write_text(json.dumps(report,indent=2));reports.append(report)
    del selected,model,optimizer,initial_head
assert reports,'No complete validated candidate; preserve checkpoints and report failure'
selected=max(reports,key=lambda r:(r['bestValidation']['qualifies'],r['bestValidation']['summary']['f1'],r['bestValidation']['summary']['map']))
result=dict(selected=selected,candidates=reports,unfinishedCandidates=unfinished,selectedOnlyOnValidation=True,
    finalUsedForSelection=False,totalOptimizerSteps=sum(r['optimizerStepsRun'] for r in reports)+sum(r['optimizerSteps'] for r in unfinished),
    wallSeconds=time.monotonic()-started,cpuSeconds=time.process_time()-cpu_started,sampledPeakRssMiB=peak,
    inputSize=selected['inputSize'],threads=2,initialTinySha256=TINY_SHA,usedRestrictedSources=False,usedV1OrV2WeightsOrTeacher=False)
(out/'selection-lock.json').write_text(json.dumps(result,indent=2))
event(out,'complete',selected=selected['config']['id'],selectedEpoch=selected['selectedEpoch'],selectedSteps=selected['selectedOptimizerSteps'],totalSteps=result['totalOptimizerSteps'],inputSize=selected['inputSize'])
