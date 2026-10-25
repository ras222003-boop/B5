"""Bounded mask-supervised CPU training; validation selection precedes sealed test."""
from __future__ import annotations
import argparse, hashlib, json, os, random, time
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from model_v3 import StairV3,letterbox,padded_box,decode
from metrics_v2 import iou_xywh
from train_small import resident_memory_bytes,sha256
from train_v2 import save_json,tensor_iou

DEFAULT_THRESHOLDS=dict(presenceMin=.45,directionMin=.55,directionMargin=.10)


def verify_contract(root):
    manifest=root/'manifest.json';data=json.loads(manifest.read_text(encoding='utf-8'))
    if data.get('excludedFromTraining') or data.get('contentKind')=='real_independent_test':
        raise ValueError('Independent real evaluation data is excluded from training')
    freeze=json.loads((root/'test-freeze.json').read_text(encoding='utf-8'))
    test=dict(scenes=[s for s in data['scenes'] if s['split']=='test'],samples=[s for s in data['samples'] if s['split']=='test'])
    fingerprint=hashlib.sha256(json.dumps(test,sort_keys=True).encode()).hexdigest()
    if data.get('schemaVersion')!=3 or data.get('contentKind')!='synthetic_ground_truth' or freeze['manifestSha256']!=sha256(manifest) or freeze['testFingerprint']!=fingerprint:
        raise ValueError('Frozen V3 synthetic contract changed')
    return data,freeze


def metrics(rows,predictions):
    if len(rows)!=len(predictions):raise ValueError('Prediction count differs from frozen sample count')
    for row,pred in zip(rows,predictions):
        if 'id' in row and 'id' in pred and row['id']!=pred['id']:raise ValueError('Prediction sample order changed')
    confusion=Counter();presence=Counter();support=Counter();correct=Counter();false_kinds=Counter()
    tp=fp=fn=tn=0;all_iou=[];detected_iou=[];localized=0;decided=decided_correct=abstentions=0
    for row,pred in zip(rows,predictions):
        truth=row['objects'][0]['classId'] if row['objects'] else None;guess=pred['classId']
        t='fixed' if truth in (2301,2302,2303) else ('escalator' if truth==2304 else 'background')
        g='fixed' if guess in (2301,2302,2303) else ('escalator' if guess==2304 else 'background')
        confusion[(str(truth),str(guess))]+=1;presence[(t,g)]+=1;support[truth]+=1;correct[truth]+=int(truth==guess)
        if t=='fixed':
            tp+=int(g=='fixed');fn+=int(g!='fixed')
            if guess==2303:abstentions+=1
            if guess in (2301,2302):decided+=1;decided_correct+=int(guess==truth)
        else:
            fp+=int(g=='fixed');tn+=int(g!='fixed')
            if g=='fixed':false_kinds[row.get('kind','unknown')]+=1
        if truth is not None:
            overlap=iou_xywh(row['objects'][0]['box'],pred['box']) if guess is not None and pred['box'] else 0.
            all_iou.append(overlap)
            if guess is not None:detected_iou.append(overlap)
            localized+=int(guess==truth and overlap>=.5)
    prec=tp/(tp+fp) if tp+fp else 0.;rec=tp/(tp+fn) if tp+fn else 0.;f1=2*prec*rec/(prec+rec) if prec+rec else 0.
    recalls={str(c):correct[c]/support[c] if support[c] else None for c in (None,2301,2302,2303,2304)}
    presence_recalls={c:presence[(c,c)]/sum(n for (t,g),n in presence.items() if t==c)
        if any(t==c for t,g in presence) else None for c in ('background','fixed','escalator')}
    direction_total=sum(support[c] for c in (2301,2302,2303));direction_correct=sum(correct[c] for c in (2301,2302,2303))
    result=dict(images=len(rows),scenes=len({r['scene_id'] for r in rows}),support={str(k):v for k,v in support.items()},
        classRecall=recalls,presenceRecall=presence_recalls,macroPresenceRecall=float(np.mean([v for v in presence_recalls.values() if v is not None])),
        fixedDetection=dict(tp=tp,fp=fp,fn=fn,tn=tn,precision=prec,recall=rec,f1=f1,falsePositiveRate=fp/(fp+tn) if fp+tn else 0),
        directionAccuracyAllFixed=direction_correct/direction_total if direction_total else None,
        directionDecidedCoverage=decided/direction_total if direction_total else None,
        directionAccuracyAmongDecisions=decided_correct/decided if decided else None,directionAbstentions=abstentions,
        meanIoUAllObjects=float(np.mean(all_iou)) if all_iou else 0.,
        meanIoUDetectedObjects=float(np.mean(detected_iou)) if detected_iou else None,correctClassAndIoU50=localized,
        confusion=[dict(truth=t,prediction=g,count=n) for (t,g),n in sorted(confusion.items())],
        presenceConfusion=[dict(truth=t,prediction=g,count=n) for (t,g),n in sorted(presence.items())],falseAlertsByKind=dict(false_kinds))
    result['selectionScore']=(.35*f1+.20*result['macroPresenceRecall']+.20*min(recalls['2301'] or 0,recalls['2302'] or 0)
        +.15*(result['directionAccuracyAllFixed'] or 0)+.10*result['meanIoUAllObjects']-.15*result['fixedDetection']['falsePositiveRate'])
    return result


def cache_rows(root,rows):
    result={}
    for row in rows:
        if sha256(root/row['path'])!=row['sha256'] or sha256(root/row['mask'])!=row['maskSha256']:
            raise ValueError('Training/validation image changed')
        tensor,mask,meta=letterbox(root/row['path'],root/row['mask'])
        truth=row['objects'][0]['classId'] if row['objects'] else None
        result[row['id']]=dict(image=tensor,mask=mask,meta=meta,presence=2 if truth==2304 else (1 if truth else 0),
            direction={2301:0,2302:1,2303:2}.get(truth,-1),box=padded_box(row['objects'][0]['box'],meta) if truth else [0.,0.,0.,0.])
    return result


def raw_outputs(model,rows,cache):
    model.eval();raw=[]
    with torch.inference_mode():
        for offset in range(0,len(rows),8):
            batch=rows[offset:offset+8];images=torch.stack([cache[r['id']]['image'] for r in batch])
            p,d,b=model(images)
            for i,row in enumerate(batch):raw.append((p[i].numpy(),d[i].numpy(),b[i].numpy(),cache[row['id']]['meta']))
    return raw


def decoded(raw,thresholds):return [decode(p,d,b,m,thresholds) for p,d,b,m in raw]


def train_candidate(root,data,freeze,output,mode,v2_weights,deadline,bounds):
    run=output/mode;run.mkdir(parents=True,exist_ok=True);summary_path=run/'summary.json'
    if summary_path.exists():
        prior=json.loads(summary_path.read_text(encoding='utf-8'))
        if prior['manifestSha256']!=freeze['manifestSha256'] or prior['mode']!=mode or sha256(Path(prior['checkpoint']))!=prior['checkpointSha256']:
            raise ValueError('Completed candidate binding changed')
        return prior
    torch.manual_seed(619753);np.random.seed(619753);random.seed(619753)
    model=StairV3();copied=model.initialize_v2(torch.load(v2_weights,map_location='cpu',weights_only=True)) if mode=='warmstart' else []
    initial={k:v.detach().clone() for k,v in model.state_dict().items()};optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.0001)
    rows=[r for r in data['samples'] if r['split']=='train'];val=[r for r in data['samples'] if r['split']=='validation']
    cache=cache_rows(root,rows+val);grouped=defaultdict(list)
    for row in rows:grouped[row['scene_id']].append(row)
    counts=Counter(cache[r['id']]['direction'] for r in rows if cache[r['id']]['direction']>=0)
    dirweights=torch.tensor([max(counts.values())/counts[i] for i in range(3)],dtype=torch.float32)
    presenceweights=torch.tensor([4/3,1.,4.]);history=[];steps=0;start=0;peak=0
    checkpoints=sorted(run.glob('epoch-??.pt'))
    if checkpoints:
        state=torch.load(checkpoints[-1],map_location='cpu',weights_only=True)
        if state['manifestSha256']!=freeze['manifestSha256'] or state['mode']!=mode:raise ValueError('Resume binding changed')
        model.load_state_dict(state['model']);optimizer.load_state_dict(state['optimizer']);initial=state['initial']
        history=state['history'];steps=state['steps'];start=state['epoch']
    def check():
        nonlocal peak
        if time.monotonic()>deadline:raise TimeoutError('Authorized CPU duration reached; epoch checkpoints retained')
        memory=resident_memory_bytes()
        if memory:
            peak=max(peak,memory[1]/1024**2)
            if memory[0]>bounds['memoryMB']*1024**2:raise MemoryError('Memory bound exceeded')
        if sum(p.stat().st_size for p in output.rglob('*') if p.is_file())>bounds['storageMB']*1024**2:raise OSError('Storage bound exceeded')
    def improved_stage():
        if len(history)==3:return max(x['score'] for x in history[1:])>history[0]['score']+.002
        return max(x['score'] for x in history[-3:])>max(x['score'] for x in history[:-3])+.002
    already_stopped=start>=3 and start%3==0 and not improved_stage()
    for epoch in range(24 if already_stopped else start,24):
        model.train();selected=[];rng=random.Random(619753+epoch)
        for group in sorted(grouped):
            choices=grouped[group];selected.extend(choices if len(choices)==5 else choices+[rng.choice(choices)])
        rng.shuffle(selected);losses=[]
        for offset in range(0,len(selected),8):
            check();batch=[cache[r['id']] for r in selected[offset:offset+8]]
            images=torch.stack([x['image'] for x in batch]);masks=torch.stack([x['mask'] for x in batch]);boxes=torch.tensor([x['box'] for x in batch])
            plabels=torch.tensor([x['presence'] for x in batch]);dlabels=torch.tensor([x['direction'] for x in batch]);fixed=plabels==1;positive=plabels>0
            if rng.random()<.5:images=images.flip(-1);masks=masks.flip(-1);boxes[:,0]=1-boxes[:,0]-boxes[:,2]
            images=((images-.5)*rng.uniform(.8,1.2)+.5+rng.uniform(-.10,.10)).clamp(0,1)
            optimizer.zero_grad(set_to_none=True);p,d,b,seg=model.forward_train(images)
            loss=F.cross_entropy(p,plabels,weight=presenceweights)
            if fixed.any():loss=loss+.8*F.cross_entropy(d[fixed],dlabels[fixed],weight=dirweights)
            if positive.any():loss=loss+3*F.smooth_l1_loss(b[positive],boxes[positive])+.5*(1-tensor_iou(b[positive],boxes[positive])).mean()
            maskloss=F.binary_cross_entropy_with_logits(seg,masks)
            prob=torch.sigmoid(seg);dice=1-(2*(prob*masks).sum((1,2,3))+1)/(prob.sum((1,2,3))+masks.sum((1,2,3))+1)
            loss=loss+.5*maskloss+.5*dice.mean()
            if not torch.isfinite(loss):raise ValueError('Nonfinite training loss')
            loss.backward()
            if any(x.grad is not None and not torch.isfinite(x.grad).all() for x in model.parameters()):raise ValueError('Nonfinite gradient')
            optimizer.step();steps+=1;losses.append(float(loss.detach()))
        result=metrics(val,decoded(raw_outputs(model,val,cache),DEFAULT_THRESHOLDS));score=result['selectionScore']
        history.append(dict(epoch=epoch+1,score=score,loss=float(np.mean(losses)),steps=steps,validation=result))
        state=dict(model=model.state_dict(),optimizer=optimizer.state_dict(),initial=initial,epoch=epoch+1,history=history,
            steps=steps,mode=mode,manifestSha256=freeze['manifestSha256'])
        path=run/f'epoch-{epoch+1:02d}.pt';temp=path.with_suffix('.tmp');torch.save(state,temp);os.replace(temp,path)
        print(json.dumps(dict(mode=mode,epoch=epoch+1,loss=history[-1]['loss'],score=score,
            fixedF1=result['fixedDetection']['f1'],falseAlerts=result['fixedDetection']['fp'],
            upRecall=result['classRecall']['2301'],downRecall=result['classRecall']['2302'],escalatorRecall=result['classRecall']['2304'])),flush=True)
        if (epoch+1)%3==0 and not improved_stage():break
    best=max(history,key=lambda x:x['score']);checkpoint=run/f'epoch-{best["epoch"]:02d}.pt'
    state=torch.load(checkpoint,map_location='cpu',weights_only=True);model.load_state_dict(state['model']);raw=raw_outputs(model,val,cache)
    choices=[]
    for presence in (.35,.45,.55,.65):
        for direction in (.45,.55,.65):
            for margin in (.10,.20):
                thresholds=dict(presenceMin=presence,directionMin=direction,directionMargin=margin)
                result=metrics(val,decoded(raw,thresholds));choices.append((result['selectionScore'],thresholds,result))
    score,thresholds,result=max(choices,key=lambda x:x[0])
    delta=max(float((state['model'][k]-state['initial'][k]).abs().max()) for k in state['model'])
    if steps<1 or not np.isfinite(delta) or delta<=0:raise ValueError('No verified V3 optimizer update')
    summary=dict(mode=mode,checkpoint=str(checkpoint),checkpointSha256=sha256(checkpoint),bestEpoch=best['epoch'],epochsRun=len(history),
        optimizerSteps=steps,parameterDelta=delta,validation=result,score=score,thresholds=thresholds,
        warmstartKeys=copied,peakMemoryMB=round(peak,2),history=history,manifestSha256=freeze['manifestSha256'])
    save_json(summary_path,summary);return summary


def train(root,output,v2_report,bounds):
    import onnx,onnxruntime as ort
    torch.set_num_threads(bounds['threads']);os.environ['CUDA_VISIBLE_DEVICES']=''
    root=root.resolve();output=output.resolve();data,freeze=verify_contract(root)
    if root not in output.parents:raise ValueError('Private output must be inside synthetic cohort')
    validation_path=root/'validation.json'
    validation=json.loads(validation_path.read_text(encoding='utf-8')) if validation_path.exists() else {}
    if not validation.get('passed') or validation.get('manifestSha256')!=freeze['manifestSha256'] or validation.get('testFingerprint')!=freeze['testFingerprint'] or validation.get('priorManifestsChecked',0)<1:
        raise ValueError('Independent V3 data validation required before training')
    output.mkdir(parents=True,exist_ok=True)
    if (output/'selection-lock.json').exists():
        prior=json.loads((output/'selection-lock.json').read_text(encoding='utf-8'))
        if prior['manifestSha256']!=freeze['manifestSha256'] or prior['testFingerprint']!=freeze['testFingerprint'] or sha256(Path(prior['weights']))!=prior['weightsSha256'] or sha256(Path(prior['onnx']))!=prior['onnxSha256']:
            raise ValueError('Completed V3 output binding changed')
        return prior
    baseline=json.loads(v2_report.read_text(encoding='utf-8'));v2_weights=Path(baseline['weights'])
    if sha256(v2_weights)!=baseline['weightsSha256']:raise ValueError('V2 weights hash changed')
    config=dict(seed=619753,optimizer='AdamW',learningRate=.001,weightDecay=.0001,batchSize=8,
        inputSize=160,resize='letterbox',padValue=127,maskSupervision=True,
        presenceClasses=['background','fixed','escalator'],directionClasses=['up','down','uncertain'],
        presenceLossWeights=[4/3,1,4],stageEpochs=3,maxEpochs=24,bounds=bounds,
        sourceV2WeightsSha256=baseline['weightsSha256'],testEvaluated=False)
    save_json(output/'config.json',config);deadline=time.monotonic()+bounds['minutes']*60
    candidates=[train_candidate(root,data,freeze,output,mode,v2_weights,deadline,bounds) for mode in ('warmstart','scratch')]
    selected=max(candidates,key=lambda x:x['score']);model=StairV3().eval()
    state=torch.load(selected['checkpoint'],map_location='cpu',weights_only=True);model.load_state_dict(state['model'])
    weights=output/'weights.pt';torch.save(model.state_dict(),weights)
    reloaded=StairV3().eval();reloaded.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True))
    onnx_path=output/'model.onnx';dummy=torch.zeros((1,3,160,160))
    torch.onnx.export(reloaded,dummy,str(onnx_path),input_names=['image'],output_names=['presence_logits','direction_logits','box_xywh'],opset_version=17,dynamo=False)
    onnx.checker.check_model(onnx.load(str(onnx_path)));options=ort.SessionOptions();options.intra_op_num_threads=2
    session=ort.InferenceSession(str(onnx_path),sess_options=options,providers=['CPUExecutionProvider'])
    val=next(r for r in data['samples'] if r['split']=='validation');image,_,_=letterbox(root/val['path']);image=image.unsqueeze(0)
    with torch.inference_mode():expected=reloaded(image)
    actual=session.run(None,{'image':image.numpy()});parity=max(float(np.max(np.abs(a.numpy()-b))) for a,b in zip(expected,actual))
    if not np.isfinite(parity) or any(not np.isfinite(a).all() for a in actual) or parity>1e-4:raise ValueError('ONNX parity failed')
    entry=dict(schemaVersion=3,name='basira-stairs-v3-research',model='model.onnx',sha256=sha256(onnx_path),
        input=dict(name='image',shape=[1,3,160,160],resize='letterbox',padValue=127,range=[0,1],color='RGB'),
        outputs=dict(presence='presence_logits',direction='direction_logits',box='box_xywh'),
        thresholds=selected['thresholds'],confidenceCalibrated=False,researchOnly=True,productionEnabled=False,
        navigationAudioEnabled=False,realCameraEvaluation='not_performed')
    save_json(output/'entry.json',entry)
    lock=dict(status='selected_before_test',manifestSha256=freeze['manifestSha256'],testFingerprint=freeze['testFingerprint'],
        selectedMode=selected['mode'],selectedCheckpoint=selected['checkpoint'],checkpointSha256=selected['checkpointSha256'],
        weights=str(weights),weightsSha256=sha256(weights),onnx=str(onnx_path),onnxSha256=sha256(onnx_path),
        entry=str(output/'entry.json'),thresholds=selected['thresholds'],validation=selected['validation'],candidates=candidates,
        selectionRule='0.35 detection F1 + 0.20 presence macro recall + 0.20 minimum up/down recall + 0.15 all-direction accuracy + 0.10 IoU including misses - 0.15 fixed false-positive rate',
        onnxCheckerPassed=True,onnxRuntimePassed=True,onnxParity=parity,testEvaluated=False,confidenceCalibrated=False)
    save_json(output/'selection-lock.json',lock);return lock


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--v2-report',type=Path,required=True);parser.add_argument('--minutes',type=int,default=30);parser.add_argument('--threads',type=int,default=2)
    parser.add_argument('--memory-mb',type=int,default=4096);parser.add_argument('--storage-mb',type=int,default=2048);args=parser.parse_args()
    if not(1<=args.minutes<=30 and 1<=args.threads<=4 and 512<=args.memory_mb<=4096 and 128<=args.storage_mb<=2048):raise ValueError('CPU authorization bounds exceeded')
    try:
        result=train(args.root,args.output,args.v2_report,dict(minutes=args.minutes,threads=args.threads,memoryMB=args.memory_mb,storageMB=args.storage_mb))
        print(json.dumps(dict(status=result['status'],mode=result['selectedMode'],onnx=result['onnx'],testEvaluated=False)),flush=True)
    except BaseException as error:
        if args.output.exists():save_json(args.output/'failure.json',dict(reason=str(error),partialResultsRetained=True))
        raise
