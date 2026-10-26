"""V1 development-only audit. No final images or final predictions are opened."""
from collections import Counter
from pathlib import Path
import hashlib,json,math,random,re,sys
import numpy as np
from PIL import Image

def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def distribution(rows):
    instances=Counter(o['class'] for row in rows for o in row['objects'] if not o.get('iscrowd'))
    images=Counter(c for row in rows for c in {o['class'] for o in row['objects'] if not o.get('iscrowd')})
    return dict(images=len(rows),objects=sum(instances.values()),classInstances=dict(instances),classImages=dict(images))

def crop_quality(rows):
    fractions=[];removed=0;source_objects=0;affected=[]
    for row in rows:
        boxes=[o['box'] for o in row['objects'] if not o.get('iscrowd')]
        if not boxes:continue
        target=min(boxes,key=lambda b:b[2]*b[3]);side=.7
        left=float(np.clip(target[0]+target[2]/2-side/2,0,1-side));top=float(np.clip(target[1]+target[3]/2-side/2,0,1-side))
        x0,y0,x1,y1=round(left*row['width']),round(top*row['height']),round((left+side)*row['width']),round((top+side)*row['height'])
        weak=False
        for x,y,w,h in boxes:
            source_objects+=1;l=max(x*row['width'],x0);t=max(y*row['height'],y0);r=min((x+w)*row['width'],x1);b=min((y+h)*row['height'],y1)
            if r-l<2 or b-t<2:removed+=1;continue
            fraction=(r-l)*(b-t)/(w*row['width']*h*row['height']);fractions.append(fraction)
            weak|=fraction<.25
        if weak:affected.append(row['id'])
    return dict(sourceObjects=source_objects,retained=len(fractions),removed=removed,retainedBelowQuarterVisible=sum(f<.25 for f in fractions),retainedBelowHalfVisible=sum(f<.5 for f in fractions),imagesWithQuarterVisibleFragments=affected,
        note='Reference-derived crop labels are geometrically consistent but some retained positives are small fragments. This is a possible semantic-quality issue, not proven causality.')

def per_image_counts(rows,metrics):
    refs=Counter({r['id']:sum(not o.get('iscrowd') for o in r['objects']) for r in rows})
    miss=Counter(e['imageId'] for e in metrics['operating']['errors'] if e['kind']=='miss')
    fp=Counter(e['imageId'] for e in metrics['operating']['errors'] if e['kind']=='false_positive')
    return [(refs[r['id']]-miss[r['id']],fp[r['id']],miss[r['id']]) for r in rows]

def bootstrap_difference(before,after,repetitions=10000):
    def f1(counts):
        tp=sum(c[0] for c in counts);fp=sum(c[1] for c in counts);fn=sum(c[2] for c in counts)
        return 2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.
    rng=random.Random(20261026);values=[]
    for _ in range(repetitions):
        indices=[rng.randrange(len(before)) for _ in before]
        values.append(f1([after[i] for i in indices])-f1([before[i] for i in indices]))
    return dict(repetitions=repetitions,observedDifference=f1(after)-f1(before),percentile2_5=float(np.percentile(values,2.5)),percentile97_5=float(np.percentile(values,97.5)),fractionResamplesPositive=sum(v>0 for v in values)/len(values),meaning='Paired validation-scene bootstrap diagnostic on only nine groups; not population accuracy or a safety confidence guarantee.')

def main(source,out):
    source=source.resolve();out=out.resolve();out.mkdir(parents=True,exist_ok=True)
    manifest=read(source/'manifest.json');rows=[r for r in manifest['samples'] if r['split'] in ['train','validation']]
    train=[r for r in rows if r['split']=='train'];validation=[r for r in rows if r['split']=='validation'];plan=read(source/'protocol.json');pilot=train[:plan['pilotImages']]
    assert sha(source/'assets/instances_val2017.json')==manifest['annotationSha256']
    original=read(source/'assets/instances_val2017.json');refs={str(a['id']):a for a in original['annotations']};categories={c['id']:c['name'] for c in original['categories']}
    installed=re.findall(r'^  \["([^"]+)",',Path('client/src/lib/vision/cocoLabels.ts').read_text(encoding='utf-8'),re.M)
    assert installed==[categories[k] for k in sorted(categories)] and len(installed)==80
    reference_ids={}
    for a in original['annotations']:reference_ids.setdefault(a['image_id'],set()).add(str(a['id']))
    groups={};signatures=[]
    for row in rows:
        assert sha(source/row['path'])==row['sha256']
        for key in ['siteId','sceneId']:
            value=key+'::'+row[key];assert value not in groups or groups[value]==row['split'];groups[value]=row['split']
        image=Image.open(source/row['path']);assert image.size==(row['width'],row['height'])
        assert {obj['id'] for obj in row['objects']}==reference_ids[row['cocoId']], 'Missing/extra reference annotation'
        a=np.asarray(image.convert('L').resize((9,8)));signature=(a[:,1:]>a[:,:-1]).ravel()
        assert not any(int((signature!=old).sum())<=4 for old in signatures);signatures.append(signature)
        for obj in row['objects']:
            ref=refs[obj['id']];assert ref['image_id']==row['cocoId'] and categories[ref['category_id']]==obj['class']
            expected=[ref['bbox'][0]/row['width'],ref['bbox'][1]/row['height'],ref['bbox'][2]/row['width'],ref['bbox'][3]/row['height']]
            assert all(abs(a-b)<1e-9 for a,b in zip(expected,obj['box']))
    records=[];snapshots={}
    for name in ['training','training-predictors']:
        events=[json.loads(line) for line in (source/name/'events.jsonl').read_text(encoding='utf-8').splitlines()]
        report=read(source/name/'training-report.json');epochs=[e for e in events if e['kind']=='epoch']
        records.append(dict(name=name,learningRate=report['learningRate'],trainedParameters=report['trainedParameters'],optimizerSteps=report['optimizerSteps'],epochs=epochs,initialValidation=next(e for e in events if e['kind']=='initial_validation'),expanded=report['expanded'],stopReason=report['stopReason']))
    initial=read(source/'training/initial-validation.json');selected=read(source/'training/validation-epoch-02.json')['metrics'];last=read(source/'training/validation-epoch-05.json')['metrics']
    for name,metric in [('initial',initial),('selectedEpoch2',selected),('lastEpoch5',last)]:
        refs_count=Counter(o['class'] for r in validation for o in r['objects'] if not o.get('iscrowd'))
        missed=Counter(e['reference'] for e in metric['operating']['errors'] if e['kind']=='miss');fp=Counter(e['prediction'] for e in metric['operating']['errors'] if e['kind']=='false_positive')
        snapshots[name]=dict(map=metric['map'],aggregate={k:metric['operating'][k] for k in ['tp','fp','fn','precision','recall','f1']},byClass={c:dict(reference=refs_count[c],tp=refs_count[c]-missed[c],fn=missed[c],fp=fp[c]) for c in sorted(set(refs_count)|set(fp))})
    counts=distribution(train);pilot_counts=distribution(pilot);val_counts=distribution(validation)
    result=dict(schemaVersion=1,scope='V1 train and validation only; no final predictions/pixels used',finalImagesOpened=0,finalPredictionsOpened=False,referenceGeometryAndClassIdsVerified=True,trainValidationGroupsDisjoint=True,nearDuplicateDevelopmentPairsAtHamming4=0,
        distribution=dict(pilot=pilot_counts,expandedTrain=counts,validation=val_counts),
        validationClassesAbsentFromPilot=sorted(set(val_counts['classInstances'])-set(pilot_counts['classInstances'])),
        validationClassesAbsentFromExpandedTraining=sorted(set(val_counts['classInstances'])-set(counts['classInstances'])),
        cropDiagnostics=crop_quality(train),runs=records,validationSnapshots=snapshots,
        bootstrapSelectedVsInitialization=bootstrap_difference(per_image_counts(validation,initial),per_image_counts(validation,selected)),
        preprocessing=read(source/'preprocess-diagnostic.json'),
        supportedFindings=['Expansion changes both the image distribution and optimizer steps per epoch from4 to9; it is not a controlled sample-count ablation.','Expanded-phase mean training loss falls while fixed-threshold validation F1 drops; aggregate AP does not follow exactly the same trend.','Full-head and predictors-only runs change both learning rate and trainable parameters; LR alone was not isolated.','Nine validation source groups and a one-FP selection gain make checkpoint ranking unstable.','The deployed Canvas and training Pillow resizing differ in measured input pixels; selection should use the deployed preprocessing.'],
        hypothesesNotProven=['Over-specialization/catastrophic forgetting in the head from few diverse sources.','Cropped fragments and rare-class oversampling altering objectness/confidence.','Learning rate too high for a small dataset; no isolated LR experiment or exploding-gradient evidence exists.'],
        nextControlledComparison=['Use source/scene-separated larger development data and exact browser-exported input tensors.','Compare fixed data/sampling/head with a small LR grid, then one head-size/freeze ablation if validation justifies it.','Use identical update budgets and report original unique scenes independently from augmented views.','Do not select by final test, confidence inflation, or a one-object change on tiny validation.'],
        inputFilesSha256={p:sha(source/p) for p in ['manifest.json','assets/instances_val2017.json','protocol.json','training/events.jsonl','training-predictors/events.jsonl','training/initial-validation.json','training/validation-epoch-02.json','training/validation-epoch-05.json','preprocess-diagnostic.json']})
    (out/'v1-audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(dict(trainImages=counts['images'],validationImages=val_counts['images'],pilotImages=pilot_counts['images'],cropDiagnostics=result['cropDiagnostics'],bootstrap=result['bootstrapSelectedVsInitialization'])))

if __name__=='__main__':main(Path(sys.argv[1]),Path(sys.argv[2]))
