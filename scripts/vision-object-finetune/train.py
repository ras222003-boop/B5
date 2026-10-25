"""Real head fine-tuning with frozen backbone, official YOLOX losses, bounded CPU.
Training only consumes train images; validation selects epochs; final is never opened.
STOP file stops after a batch with checkpoint saved; --resume retains optimizer/RNG.
"""
from pathlib import Path
from collections import Counter
import argparse, copy, hashlib, json, os, random, time
os.environ['CUDA_VISIBLE_DEVICES']=''
os.environ['OMP_NUM_THREADS']='2'; os.environ['MKL_NUM_THREADS']='2'
import numpy as np
import psutil, torch
from common import corpus, model_from, prepare_image, decode, metrics, read, sha

parser=argparse.ArgumentParser()
parser.add_argument('root',type=Path);parser.add_argument('--resume',action='store_true')
parser.add_argument('--predictors-only',action='store_true')
args=parser.parse_args();root=args.root.resolve()
assert not (root/'selection-lock.json').exists() and not (root/'results/test').exists(), 'No training after final selection/evaluation'
torch.set_num_threads(2);torch.set_num_interop_threads(1)
torch.manual_seed(20261025);np.random.seed(20261025);random.seed(20261025)
manifest,names=corpus(root);plan=read(root/'protocol.json');bounds=plan['trainingBudget']
out=root/('training-predictors' if args.predictors_only else 'training');out.mkdir(exist_ok=True)
if (out/'selection-lock.json').exists(): raise ValueError('Training is finalized; final selection cannot be retuned')
if (out/'events.jsonl').exists() and not args.resume: raise ValueError('Use --resume; never overwrite a run')
started=time.monotonic();cpu_started=time.process_time();process=psutil.Process();peak=0;last_disk_check=-10.
state=dict(epoch=0,step=0,bestF1=-1.,bestAP=-1.,expanded=False,elapsedSeconds=0.)
def event(kind,**values):
    record=dict(kind=kind,elapsedSeconds=time.monotonic()-started,**values)
    with (out/'events.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(record)+'\n')
    print(json.dumps(record),flush=True)
def guard():
    global peak,last_disk_check
    rss=process.memory_info().rss/2**20;peak=max(peak,rss)
    if rss>bounds['maxRssMiB']:raise RuntimeError('memory_budget')
    if time.monotonic()-started+state['elapsedSeconds']>bounds['maxSeconds']:raise RuntimeError('time_budget')
    if time.monotonic()-started-last_disk_check>=10:
        last_disk_check=time.monotonic()-started
        if sum(p.stat().st_size for p in root.rglob('*') if p.is_file())/2**20>bounds['maxDiskMiB']:raise RuntimeError('disk_budget')
    if (root/'STOP').exists():raise InterruptedError('STOP requested; remove file and --resume to continue')

model=model_from(root)
for p in model.backbone.parameters():p.requires_grad_(False)
if args.predictors_only:
    for name,p in model.head.named_parameters():p.requires_grad_(name.startswith(('cls_preds.','reg_preds.','obj_preds.')))
learning_rate=1e-5 if args.predictors_only else 3e-5
optimizer=torch.optim.AdamW([p for p in model.head.parameters() if p.requires_grad],lr=learning_rate,weight_decay=1e-4)
initial_head={k:v.clone() for k,v in model.head.state_dict().items()}
initial_backbone={k:v.clone() for k,v in model.backbone.state_dict().items()}
if args.resume:
    saved=torch.load(out/'last.pth',map_location='cpu',weights_only=True)
    assert saved['cohortSha256']==sha(root/'manifest.json') and saved['initialWeightsSha256']==sha(root/'assets/yolox_tiny.pth')
    model.load_state_dict(saved['model']);optimizer.load_state_dict(saved['optimizer']);state.update(saved['state'])
    torch.set_rng_state(saved['torchRng']); random.setstate(saved['pythonRng'])

train_rows=[r for r in manifest['samples'] if r['split']=='train']
validation_rows=[r for r in manifest['samples'] if r['split']=='validation']
cache_path=out/'features.pth'
cache_meta=dict(cohortSha256=sha(root/'manifest.json'),initialWeightsSha256=sha(root/'assets/yolox_tiny.pth'),sourceSha256=sha(Path(__file__).with_name('common.py')))
if cache_path.exists():
    loaded=torch.load(cache_path,map_location='cpu',weights_only=True)
    assert loaded['metadata']==cache_meta,'Stale feature cache'
    cache=loaded['items']
else:
    cache={}
    for row in train_rows+validation_rows:
        for variant in ([0,1] if row['split']=='train' else [0]):
            guard();tensor,labels=prepare_image(root,row,names,variant)
            with torch.no_grad():features=[x.detach().clone() for x in model.backbone(tensor)]
            cache[row['id']+':'+str(variant)]=dict(features=features,labels=labels)
        event('features',imageId=row['id'],split=row['split'])
    torch.save(dict(metadata=cache_meta,items=cache),cache_path)

def validate():
    model.head.eval();predictions={}
    with torch.no_grad():
        for row in validation_rows:
            guard();values=model.head(cache[row['id']+':0']['features'])
            predictions[row['id']]=dict(detections=decode(values,names,row['width'],row['height']))
    result=metrics(root,'validation',predictions,names)
    return result,predictions

def checkpoint(name):
    # weights_only reload supported; no arbitrary classes or NumPy objects are pickled.
    progress=state.copy();progress['elapsedSeconds']=state['elapsedSeconds']+time.monotonic()-started
    saved=dict(model=model.state_dict(),optimizer=optimizer.state_dict(),state=progress,torchRng=torch.get_rng_state(),pythonRng=random.getstate(),cohortSha256=cache_meta['cohortSha256'],initialWeightsSha256=cache_meta['initialWeightsSha256'],classNames=names)
    torch.save(saved,out/name)

if not (out/'initial-validation.json').exists():
    initial,initial_predictions=validate()
    (out/'initial-validation.json').write_text(json.dumps(initial,indent=2),encoding='utf-8')
    state['bestF1']=initial['operating']['f1'];state['bestAP']=initial['map']
    event('initial_validation',tp=initial['operating']['tp'],fp=initial['operating']['fp'],f1=state['bestF1'],map=state['bestAP'])
    checkpoint('initial.pth')
else:initial=read(out/'initial-validation.json')
epochs_without_gain=0;stopped=None
try:
    for epoch in range(state['epoch']+1,bounds['maxEpochs']+1):
        guard();active=train_rows[:plan['pilotImages']] if epoch<=plan['pilotEpochs'] else train_rows
        if epoch>plan['pilotEpochs'] and not state['expanded']:
            if state['bestF1']<=initial['operating']['f1']+1e-9:
                stopped='pilot_did_not_improve_validation';break
            state['expanded']=True;event('expanded',uniqueTrainImages=len(train_rows))
        model.head.train()
        # Keep all BN running statistics fixed for the small pilot; affine weights can train.
        for m in model.head.modules():
            if isinstance(m,torch.nn.BatchNorm2d):m.eval()
        frequencies=Counter(o['class'] for row in active for o in row['objects'])
        weights=[sum(1/np.sqrt(frequencies[o['class']]) for o in row['objects'])/max(1,len(row['objects'])) for row in active]
        rng=random.Random(20261025+epoch)
        order=list(range(len(active)))+rng.choices(range(len(active)),weights=weights,k=len(active))
        rng.shuffle(order)
        losses=[];backward_steps=0
        for offset in range(0,len(order),4):
            guard();items=[cache[active[i]['id']+':'+str(rng.randrange(2))] for i in order[offset:offset+4]]
            features=[torch.cat([item['features'][level] for item in items]) for level in range(3)]
            labels=torch.zeros((len(items),max(len(item['labels']) for item in items),5))
            for i,item in enumerate(items):labels[i,:len(item['labels'])]=item['labels']
            optimizer.zero_grad(set_to_none=True)
            result=model.head(features,labels,torch.empty((len(items),3,416,416)))
            loss=result[0]
            if not torch.isfinite(loss):raise RuntimeError('nonfinite_loss')
            loss.backward()
            norm=torch.nn.utils.clip_grad_norm_(model.head.parameters(),10.)
            if not torch.isfinite(norm) or float(norm)==0:raise RuntimeError('invalid_gradient')
            optimizer.step();state['step']+=1;backward_steps+=1;losses.append(float(loss.detach()))
        state['epoch']=epoch
        validation,predictions=validate()
        path=out/f'validation-epoch-{epoch:02d}.json';path.write_text(json.dumps(dict(metrics=validation,predictions=predictions),indent=2),encoding='utf-8')
        f1,ap=validation['operating']['f1'],validation['map']
        improved=(f1,ap)>(state['bestF1'],state['bestAP'])
        if improved:
            state['bestF1'],state['bestAP']=f1,ap;state['bestEpoch']=epoch;checkpoint('best.pth');epochs_without_gain=0
        else:epochs_without_gain+=1
        checkpoint('last.pth')
        event('epoch',epoch=epoch,step=state['step'],uniqueImages=len(active),backwardAndOptimizerSteps=backward_steps,meanLoss=float(np.mean(losses)),validation=dict(tp=validation['operating']['tp'],fp=validation['operating']['fp'],fn=validation['operating']['fn'],f1=f1,map=ap),improved=improved,rssMiB=process.memory_info().rss/2**20)
        if epoch>=plan['pilotEpochs']+2 and epochs_without_gain>=3:
            stopped='validation_plateau';break
except (RuntimeError,InterruptedError) as error:
    stopped=str(error);checkpoint('last.pth');event('stopped',reason=stopped)
checkpoint('last.pth')
changed=sum(not torch.equal(v,model.head.state_dict()[k]) for k,v in initial_head.items())
backbone_unchanged=all(torch.equal(v,model.backbone.state_dict()[k]) for k,v in initial_backbone.items())
assert state['step']>0 and changed>0 and backbone_unchanged
selected=out/'best.pth'
# Even a weak real-trained checkpoint is retained for comparison; do not silently call initialization trained.
if not selected.exists():selected=out/'last.pth'
fresh=model_from(root,selected);sample=validation_rows[0];tensor,_=prepare_image(root,sample,names)
with torch.no_grad():new_output=fresh(tensor)
assert tuple(new_output.shape)==(1,3549,85) and torch.isfinite(new_output).all()
selected_state=torch.load(selected,map_location='cpu',weights_only=True)['state']
report=dict(initialWeightsSha256=cache_meta['initialWeightsSha256'],initialWeightsSource='official YOLOX 0.1.1rc0 yolox_tiny.pth',cohortSha256=cache_meta['cohortSha256'],torchVersion=str(torch.__version__),threads=2,batchSize=4,optimizer='AdamW',learningRate=learning_rate,epochs=state['epoch'],optimizerSteps=state['step'],backwardExecuted=True,weightsChanged=True,changedHeadTensors=changed,frozenBackboneUnchanged=backbone_unchanged,trainedParameters=sum(p.numel() for p in model.head.parameters() if p.requires_grad),trainingMode=('prediction outputs only' if args.predictors_only else 'full detection head')+'; Official SimOTA + IoU/objectness/class losses; BN stats fixed; balanced sampling; geometry-derived crops',expanded=state['expanded'],trainImages=len(train_rows) if state['expanded'] else plan['pilotImages'],selectedCheckpointEpoch=selected_state['epoch'],selectedCheckpointOptimizerSteps=selected_state['step'],selectedCheckpointTrainImages=len(train_rows) if selected_state['expanded'] else plan['pilotImages'],validationImages=len(validation_rows),finalImagesRead=0,peakRssMiB=peak,wallSeconds=state['elapsedSeconds']+time.monotonic()-started,cpuSeconds=time.process_time()-cpu_started,stopReason=stopped or 'epoch_budget',checkpoint=selected.name,checkpointSha256=sha(selected),freshReloadInferencePassed=True,bestValidationF1=state['bestF1'],initialValidationF1=initial['operating']['f1'],bestEpoch=state.get('bestEpoch'),productionEligible=False,phoneTested=False)
(out/'training-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
if isinstance(stopped,str) and ('STOP requested' in stopped or stopped in ['time_budget','memory_budget','disk_budget']):
    print(json.dumps(report));raise SystemExit(2)
(out/'selection-lock.json').write_text(json.dumps(dict(checkpoint=selected.name,checkpointSha256=sha(selected),cohortSha256=cache_meta['cohortSha256'],threshold=.5,selectedOnlyOnValidation=True,finalTestOpened=False,selectionRule=plan['selection']),indent=2),encoding='utf-8')
print(json.dumps(report))
