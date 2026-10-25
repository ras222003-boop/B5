"""Local real-data intake, immutable test preparation and independent scoring.

No model labels, rights approvals or independent reviews are generated here.
All outputs are private. The browser runner uses the unchanged V3 ONNX adapter.
"""
from __future__ import annotations
import argparse, hashlib, html, json, math, re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

V3_SHA = 'a16132720922738e2cc3d248b84af5c1d92c6c9d97bc757d07867b3861ef0061'
CLASSES = ['background','stairs_up','stairs_down','stairs_present_uncertain_direction','escalator']
IDS = {None:'background',2301:CLASSES[1],2302:CLASSES[2],2303:CLASSES[3],2304:'escalator'}
CATEGORIES = CLASSES[1:] + ['ramp','lines','empty','mixed_stairs']
FIXED = set(CLASSES[1:4])
REPO = Path(__file__).resolve().parents[3]

def check(ok, message):
    if not ok: raise ValueError(message)

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def write(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    temp.replace(path)

def identifier(value):
    check(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}',value),'Use pseudonymous IDs (letters, digits, underscore, hyphen)')
    return value

def private_output(path):
    path=Path(path).resolve()
    check(path != REPO and REPO not in path.parents,'Real media/reviews/results must remain outside the repository')
    check(not any(p.lower() in ('.git','basira-vision-datasets') for p in path.parts),'Protected output path')
    return path

def evidence(review,base,kind):
    check(review.get('status')=='approved',f'{kind}: independent approval is pending')
    identifier(review.get('reviewerId'))
    check(bool(review.get('reviewedAt')),f'{kind}: review timestamp required')
    when=datetime.fromisoformat(review['reviewedAt'].replace('Z','+00:00'))
    check(when.tzinfo is not None and when<=datetime.now(timezone.utc),f'{kind}: use a completed review timestamp with timezone')
    record=(base/review['recordPath']).resolve()
    check(record.is_file() and sha(record)==review.get('recordSha256'),f'{kind}: missing/changed evidence record')
    return dict(review,recordPath=str(record))

def rights(value,base):
    result=evidence(value,base,'rights/privacy')
    check(value.get('privacyReviewed') is True and 'local_research_evaluation' in value.get('allowedUses',[]),'Rights/privacy scope does not permit local evaluation')
    return result

def init(folder):
    folder=private_output(folder); check(not folder.exists(),'Choose a new intake directory')
    folder.mkdir(parents=True)
    write(folder/'intake.json',dict(schemaVersion=1,contentKind='real_capture_intake',datasetId='real-v3-001',assets=[]))
    write(folder/'usage-registry.json',dict(schemaVersion=1,review=dict(status='pending',reviewerId=None,reviewedAt=None,recordPath=None,recordSha256=None),
        trainingOrTuning=dict(siteIds=[],captureSessionIds=[],sceneIds=[],sourceSha256=[]),reservedTests=[]))
    write(folder/'readiness.json',dict(status='awaiting_authorized_real_data',realSamples=0,accuracy=None,navigationSafety='not_established',v4TrainingStarted=False))
    (folder/'README.md').write_text('مجموعة إدخال فارغة. لا توجد بيانات واقعية أو موافقات أو وسوم مرجعية مولدة.\nراجع ml/vision/REAL-EVALUATION.md لتعبئة intake.json وسجل الاستخدام والمراجعات المستقلة.\n',encoding='utf-8')
    return dict(status='awaiting_authorized_real_data',folder=str(folder),realSamples=0)

def stage(intake_path,output,max_frames=120,max_mb=1024):
    from PIL import Image, ImageOps
    intake_path=Path(intake_path).resolve(); base=intake_path.parent; data=read(intake_path)
    check(data.get('contentKind')=='real_capture_intake','Real intake schema required')
    identifier(data.get('datasetId')); check(bool(data.get('assets')),'No real assets supplied; nothing staged')
    output=private_output(output); check(not output.exists(),'Staging output must be new')
    check(0<max_frames<=1000 and 0<max_mb<=4096,'Preparation resource limits invalid')
    approved=[]; asset_ids=set(); total_bytes=0
    # Validate every authorization before decoding/copying any media.
    for asset in data['assets']:
        aid=identifier(asset.get('assetId')); check(aid not in asset_ids,'Duplicate assetId'); asset_ids.add(aid)
        for key in ['siteId','captureSessionId','sceneId']: identifier(asset.get(key))
        check(asset.get('contentKind')=='real_capture','Synthetic/unknown source prohibited in real test')
        approval=rights(asset['rights'],base); source=(base/asset['path']).resolve()
        check(source.is_file() and sha(source)==asset.get('sha256'),'Source hash missing or changed')
        total_bytes+=source.stat().st_size; check(total_bytes<=max_mb*1024*1024,'Source resource limit exceeded')
        check(asset.get('kind') in ('image','video'),'Only image/video assets are accepted')
        approved.append((asset,source,approval))
    output.mkdir(); (output/'frames').mkdir(); samples=[]; references=[]; bytes_written=0
    def add(asset,approval,image,frame_index,timestamp,fps=None):
        nonlocal bytes_written
        check(len(samples)<max_frames,'Frame limit exceeded; partial staging retained, not frozen')
        sid=f'{asset["assetId"]}-f{frame_index:06d}'; target=output/'frames'/f'{sid}.png'
        image.convert('RGB').save(target); bytes_written+=target.stat().st_size
        check(bytes_written<=max_mb*1024*1024,'Output storage limit exceeded')
        samples.append(dict(sampleId=sid,assetId=asset['assetId'],siteId=asset['siteId'],captureSessionId=asset['captureSessionId'],sceneId=asset['sceneId'],
            path=f'frames/{sid}.png',sha256=sha(target),width=image.width,height=image.height,sourceSha256=asset['sha256'],sourceKind=asset['kind'],
            frameIndex=frame_index,mediaTimeSeconds=timestamp,fps=fps,rights=approval))
        references.append(dict(sampleId=sid,imageSha256=sha(target),coordinateSpace='prepared_upright_frame_normalized_xywh',category=None,objects=[],
            review=dict(status='pending',method='independent_manual',blindToModel=None,reviewerId=None,reviewedAt=None,recordPath=None,recordSha256=None)))
    for asset,source,approval in approved:
        if asset['kind']=='image':
            with Image.open(source) as im: add(asset,approval,ImageOps.exif_transpose(im),0,None)
        else:
            import cv2
            indices=asset.get('frameIndices',[])
            check(indices and len(indices)<=max_frames and all(type(x) is int and 0<=x<18000 for x in indices),'Explicit bounded video frameIndices required')
            check(len(set(indices))==len(indices),'Duplicate video frame index')
            cap=cv2.VideoCapture(str(source))
            try:
                check(cap.isOpened(),'Video decoder unavailable'); fps=float(cap.get(cv2.CAP_PROP_FPS))
                check(math.isfinite(fps) and fps>0,'Video FPS unknown; cannot bind frame timestamps')
                wanted=set(indices); index=0
                while wanted:
                    ok,bgr=cap.read(); check(ok,'Requested video frame not decoded')
                    if index in wanted:
                        timestamp=float(cap.get(cv2.CAP_PROP_POS_MSEC))/1000
                        check(math.isfinite(timestamp) and timestamp>=0,'Invalid decoded video timestamp')
                        add(asset,approval,Image.fromarray(cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)),index,timestamp,fps); wanted.remove(index)
                    index+=1
            finally: cap.release()
    write(output/'staged.json',dict(schemaVersion=1,datasetId=data['datasetId'],contentKind='real_capture_staging',samples=samples,intakeSha256=sha(intake_path)))
    write(output/'references.json',dict(schemaVersion=1,source='independent_reference_review',samples=references))
    return dict(status='awaiting_independent_blind_reference_review',samples=len(samples),output=str(output))

def validate_box(box):
    check(isinstance(box,list) and len(box)==4 and all(type(x) in (int,float) and math.isfinite(x) for x in box),'Invalid normalized box')
    x,y,w,h=box; check(x>=0 and y>=0 and w>0 and h>0 and x+w<=1.000001 and y+h<=1.000001,'Box outside prepared image')

def freeze(staged_path,references_path,registry_path,entry_path):
    staged_path=Path(staged_path).resolve(); root=private_output(staged_path.parent)
    data=read(staged_path); references_path=Path(references_path).resolve(); refs=read(references_path)
    check(data.get('contentKind')=='real_capture_staging' and data.get('samples'),'No real staged samples')
    check(refs.get('source')=='independent_reference_review','Predictions cannot be reference labels')
    check(not (root/'manifest.json').exists(),'Test already frozen; do not overwrite')
    registry_path=Path(registry_path).resolve(); registry=read(registry_path); evidence(registry['review'],registry_path.parent,'usage independence review')
    reference_map={r['sampleId']:r for r in refs['samples']}
    check(len(reference_map)==len(refs['samples'])==len(data['samples']),'Reference coverage/duplicates mismatch')
    entry_path=Path(entry_path).resolve(); entry=read(entry_path)
    check(entry.get('researchOnly') is True and entry.get('productionEnabled') is False and entry.get('sha256')==V3_SHA,'Unchanged research V3 required')
    check(sha(entry_path.parent/entry['model'])==V3_SHA,'Current V3 ONNX hash mismatch')
    groups={key:set() for key in ['siteIds','captureSessionIds','sceneIds','sourceSha256']}; samples=[]; seen=set(); hashes=set()
    site_session={}; scene_parent={}
    for row in data['samples']:
        sid=row['sampleId']; check(sid not in seen,'Duplicate sample'); seen.add(sid)
        for key in ['sampleId','siteId','captureSessionId','sceneId']: identifier(row.get(key))
        path=(root/row['path']).resolve(); check(root in path.parents and sha(path)==row['sha256'],'Prepared image changed or escaped root')
        check(row['sha256'] not in hashes,'Exact duplicate prepared frames; reduce correlated samples'); hashes.add(row['sha256'])
        rights(row['rights'],root)
        parent=(row['siteId'],row['captureSessionId'])
        check(site_session.setdefault(row['captureSessionId'],row['siteId'])==row['siteId'],'Session spans inconsistent sites')
        check(scene_parent.setdefault(row['sceneId'],parent)==parent,'Scene spans inconsistent capture sessions/sites')
        ref=reference_map[sid]; check(ref.get('imageSha256')==row['sha256'],'Reference image binding mismatch')
        check(ref.get('coordinateSpace')=='prepared_upright_frame_normalized_xywh','Reference coordinate contract mismatch')
        review=evidence(ref['review'],references_path.parent,'reference labels')
        check(review.get('method')=='independent_manual' and review.get('blindToModel') is True,'Reference must be independent of V3 predictions')
        check(ref.get('category') in CATEGORIES,'Reference scene category required')
        objects=ref.get('objects'); check(isinstance(objects,list),'Explicit reference objects required')
        for obj in objects:
            check(obj.get('class') in CLASSES[1:],'Invalid reference object class'); validate_box(obj.get('box'))
        object_classes={o['class'] for o in objects}
        if ref['category'] in ('ramp','lines','empty'): check(not objects,'Negative category contains stair reference')
        elif ref['category']=='mixed_stairs': check(len(objects)>1,'Mixed category requires multiple reference objects')
        else: check(objects and object_classes=={ref['category']},'Scene and object reference labels conflict')
        for k,value in zip(groups,[row['siteId'],row['captureSessionId'],row['sceneId'],row['sourceSha256']]):groups[k].add(value)
        samples.append(dict(row,split='real_independent_test',excludedFromTraining=True,reference=dict(ref,review=review)))
    for used in [registry.get('trainingOrTuning',{}),*registry.get('reservedTests',[])]:
        for key,values in groups.items(): check(not values.intersection(used.get(key,[])),f'Location/session/source leakage or prior test reuse: {key}')
    binding=dict(schemaVersion=1,contentKind='real_independent_test',datasetId=data['datasetId'],excludedFromTraining=True,synthetic=False,
        modelSha256=V3_SHA,entrySha256=sha(entry_path),referenceFileSha256=sha(references_path),registryReview=registry['review'],samples=samples,
        groupCounts={key:len(values) for key,values in groups.items()},createdAt=datetime.now(timezone.utc).isoformat())
    write(root/'manifest.json',binding)
    lock=dict(schemaVersion=1,manifestSha256=sha(root/'manifest.json'),modelSha256=V3_SHA,entrySha256=sha(entry_path),
        referencesFrozenBeforeInference=True,selectionUse='forbidden',trainingUse='forbidden',testConsumed=False)
    registry.setdefault('reservedTests',[]).append(dict(datasetId=data['datasetId'],manifestSha256=lock['manifestSha256'],**{k:sorted(v) for k,v in groups.items()}))
    write(registry_path,registry)
    # Publish the usable freeze only after the holdout reservation is durable.
    lock['usageRegistrySha256AtFreeze']=sha(registry_path)
    write(root/'test-freeze.json',lock)
    return dict(status='frozen_for_independent_evaluation',samples=len(samples),**lock)

def verify_frozen(root):
    root=Path(root).resolve(); data=read(root/'manifest.json'); lock=read(root/'test-freeze.json')
    check(data.get('contentKind')=='real_independent_test' and data.get('excludedFromTraining') is True and data.get('synthetic') is False,'Independent real test contract required')
    check(sha(root/'manifest.json')==lock['manifestSha256'] and data.get('modelSha256')==lock['modelSha256']==V3_SHA,'Frozen binding changed')
    for row in data['samples']:
        check(row.get('excludedFromTraining') is True and row.get('split')=='real_independent_test','Frozen holdout protection changed')
        path=(root/row['path']).resolve(); check(root in path.parents and sha(path)==row['sha256'],'Frozen frame changed')
    return data,lock

def iou(a,b):
    x=max(a[0],b[0]);y=max(a[1],b[1]);w=max(0,min(a[0]+a[2],b[0]+b[2])-x);h=max(0,min(a[1]+a[3],b[1]+b[3])-y)
    inter=w*h; return inter/(a[2]*a[3]+b[2]*b[3]-inter) if inter else 0.

def ratio(a,b): return a/b if b else None
def summary(rows,predictions):
    check(len(rows)==len(predictions)>0,'Complete nonempty evaluation coverage required')
    confusion={t:{g:0 for g in CLASSES} for t in CATEGORIES}; presence={t:{g:0 for g in ['background','fixed','escalator']} for t in ['background','fixed','escalator','mixed']}
    tp=fp=fn=tn=0; localized_tp=localized_fp=localized_fn=0; overlaps=[]; errors=[]; latency=[]; dirs=Counter(); false_by_kind=Counter(); grouped=defaultdict(list)
    for row,pred in zip(rows,predictions):
        check(row['sampleId']==pred['sampleId'] and row['sha256']==pred['imageSha256'],'Sample prediction binding mismatch')
        check('classId' in pred,'Explicit prediction class (including null background) required')
        guess=IDS.get(pred.get('classId'),'invalid');check(guess!='invalid','Unknown predicted class')
        box=pred.get('box'); check((guess=='background')==(box is None),'Prediction class/box mismatch')
        if box is not None: validate_box(box)
        ms=pred.get('inferenceMs');check(type(ms) in (int,float) and math.isfinite(ms) and ms>=0,'Invalid inference latency');latency.append(ms)
        ref=row['reference'];truth=ref['category']; objects=ref['objects'];confusion[truth][guess]+=1
        fixed=[o for o in objects if o['class'] in FIXED]; actual=bool(fixed); detected=guess in FIXED
        tp+=actual and detected;fn+=actual and not detected;fp+=not actual and detected;tn+=not actual and not detected
        if not actual and detected:false_by_kind[truth]+=1
        presence['mixed' if truth=='mixed_stairs' else 'fixed' if actual else 'escalator' if objects else 'background']['fixed' if detected else 'escalator' if guess=='escalator' else 'background']+=1
        best=max((iou(o['box'],box) for o in objects),default=0.) if box else 0.
        overlaps.extend([iou(o['box'],box) if box else 0. for o in objects])
        matches=[o for o in objects if o['class']==guess and box and iou(o['box'],box)>=.5]
        localized_tp+=bool(matches); localized_fp+=guess!='background' and not matches;localized_fn+=len(objects)-bool(matches)
        if truth in FIXED:
            dirs['totalFixed']+=1;dirs['abstained']+=guess==CLASSES[3];dirs['decided']+=guess in CLASSES[1:3]
            dirs['correctDecided']+=guess in CLASSES[1:3] and guess==truth
            dirs['knownTotal']+=truth in CLASSES[1:3];dirs['knownDecided']+=truth in CLASSES[1:3] and guess in CLASSES[1:3]
            dirs['unknownForced']+=truth==CLASSES[3] and guess in CLASSES[1:3]
        reasons=[]
        if actual and not detected: reasons.append('missed_fixed_stairs')
        if not actual and detected:reasons.append('false_fixed_stair_alert')
        if truth in FIXED and guess!=truth:reasons.append('direction_or_presence_mismatch')
        if objects and best<.5:reasons.append('poor_or_missing_box')
        if len(objects)>1:reasons.append('single_output_model_multi_object_limit')
        if reasons: errors.append(dict(sampleId=row['sampleId'],siteId=row['siteId'],sceneId=row['sceneId'],truth=truth,prediction=guess,bestIoU=best,reasons=reasons))
        grouped[row['sceneId']].append(dict(actual=actual,detected=detected,ms=ms))
    ordered=sorted(latency);precision=ratio(tp,tp+fp);recall=ratio(tp,tp+fn)
    return dict(samples=len(rows),scenes=len(grouped),sites=len({r['siteId'] for r in rows}),captureSessions=len({r['captureSessionId'] for r in rows}),
        confusion=dict(rows='independent scene category',columns='single V3 prediction',counts=confusion),presenceConfusion=presence,
        fixedPresence=dict(tp=tp,fp=fp,fn=fn,tn=tn,precision=precision,recall=recall,f1=ratio(2*tp,2*tp+fp+fn),falsePositiveRate=ratio(fp,fp+tn)),
        localizationIoU50=dict(tp=localized_tp,fp=localized_fp,fn=localized_fn,precision=ratio(localized_tp,localized_tp+localized_fp),recall=ratio(localized_tp,localized_tp+localized_fn),meanIoUAllReferenceObjectsMissesZero=ratio(sum(overlaps),len(overlaps))),
        direction=dict(dirs,decidedCoverageAllFixed=ratio(dirs['decided'],dirs['totalFixed']),accuracyAmongDecisions=ratio(dirs['correctDecided'],dirs['decided']),knownDirectionCoverage=ratio(dirs['knownDecided'],dirs['knownTotal'])),
        falseAlertsByReferenceCategory=dict(false_by_kind),latency=dict(scope='browser preprocessing + ONNX WASM; excludes file decode and model load',medianMs=ordered[len(ordered)//2],p95Ms=ordered[min(len(ordered)-1,math.ceil(len(ordered)*.95)-1)]),
        perScene=[dict(sceneId=k,frames=len(v),falseAlerts=sum(not r['actual'] and r['detected'] for r in v),misses=sum(r['actual'] and not r['detected'] for r in v)) for k,v in grouped.items()],errors=errors,
        limitations=['Frame metrics are correlated within scenes/sessions; no independent-frame confidence interval.',
            'Model predicts at most one object. Ramps and lines are negative challenge groups, not model output classes.',
            'Small convenience samples do not establish population accuracy or navigation safety.'])

def score(root,prediction_path):
    root=Path(root).resolve(); data,lock=verify_frozen(root); run=read(prediction_path)
    check(run.get('scope')=='frozen-real-test-browser-inference' and run.get('manifestSha256')==lock['manifestSha256'],'Wrong prediction/test binding')
    check(run.get('modelSha256')==V3_SHA and run.get('entrySha256')==lock['entrySha256'],'Wrong model or thresholds contract')
    check(run.get('referenceLabelsUsedForInference') is False,'Reference leakage into inference')
    metrics=summary(data['samples'],run['predictions'])
    result=dict(schemaVersion=1,status='real_data_evaluated',modelSha256=V3_SHA,manifestSha256=lock['manifestSha256'],predictionSha256=sha(prediction_path),
        confidenceCalibrated=False,navigationSafety='not_established',productionEnabled=False,v4TrainingStarted=False,metrics=metrics)
    destination=root/'evaluation'; destination.mkdir(exist_ok=True)
    if (destination/'report.json').exists():
        prior=read(destination/'report.json');check(prior['predictionSha256']==result['predictionSha256'],'Test already consumed by a different run');return prior
    write(destination/'report.json',result)
    plan=[]
    if metrics['fixedPresence']['fn']:plan.append('Review independently labeled missed stairs by site, distance, lighting and occlusion; collect separate development scenes, never reuse this test for training.')
    if metrics['fixedPresence']['fp']:plan.append('Collect new development negatives targeting the observed false-alert categories; preserve this test and its sites outside training.')
    if metrics['direction'].get('unknownForced'):plan.append('Investigate forced direction on independently uncertain scenes; tune abstention only on a new development set.')
    if metrics['localizationIoU50']['fn']:plan.append('Inspect local box overlays and multi-object limits before proposing architectural changes.')
    write(destination/'v4-proposal.json',dict(status='proposal_only_no_training',basedOnReportSha256=sha(destination/'report.json'),actions=plan or ['Expand independent real coverage before proposing model changes.'],nextFinalTestMustUseNewSites=True))
    cards=[]
    for err in metrics['errors']:
        row=next(r for r in data['samples'] if r['sampleId']==err['sampleId']);pred=next(p for p in run['predictions'] if p['sampleId']==err['sampleId'])
        rectangles=[]
        for box,color in [(o['box'],'#169c59') for o in row['reference']['objects']]+([(pred['box'],'#dc3434')] if pred['box'] else []):
            x,y,w,h=box;rectangles.append(f'<rect x="{x*1000}" y="{y*1000}" width="{w*1000}" height="{h*1000}" fill="none" stroke="{color}" stroke-width="5"/>')
        cards.append(f'<article><h2>{html.escape(err["sampleId"])}</h2><div><img src="../{html.escape(row["path"])}"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none">{"".join(rectangles)}</svg></div><p>{html.escape(json.dumps(err,ensure_ascii=False))}</p></article>')
    (destination/'errors.html').write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'unsafe-inline\'"><title>Independent real evaluation errors</title><style>body{font:16px system-ui}article{max-width:640px}article>div{position:relative}img{width:100%;display:block}svg{position:absolute;inset:0;width:100%;height:100%}p{overflow-wrap:anywhere}</style><h1>Real evaluation errors</h1><p>Green: independent reference; red: V3. Private local media. No navigation validity.</p>'+''.join(cards),encoding='utf-8')
    def display(value):return 'غير متاح' if value is None else f'{value:.3f}' if isinstance(value,float) else str(value)
    matrix='<tr><th>المرجع / V3</th>'+''.join(f'<th>{html.escape(c)}</th>' for c in CLASSES)+'</tr>'
    for category,counts in metrics['confusion']['counts'].items():
        matrix+=f'<tr><th>{html.escape(category)}</th>'+''.join(f'<td>{counts[c]}</td>' for c in CLASSES)+'</tr>'
    details=''.join(f'<h2>{html.escape(name)}</h2><pre>{html.escape(json.dumps(metrics[name],ensure_ascii=False,indent=2))}</pre>' for name in ['fixedPresence','localizationIoU50','direction','falseAlertsByReferenceCategory','latency','perScene'])
    (destination/'report.html').write_text('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>تقييم V3 الواقعي المستقل</title><style>body{font:16px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}pre{direction:ltr;white-space:pre-wrap}</style><h1>تقييم V3 الواقعي المستقل</h1><p>نتائج وصفية لهذه العينة فقط؛ الثقة غير معايرة وصلاحية التنقل غير مثبتة. الإطارات مترابطة داخل المشاهد.</p>'
        +f'<p>صور: {metrics["samples"]} · مشاهد: {metrics["scenes"]} · مواقع: {metrics["sites"]} · جلسات: {metrics["captureSessions"]}</p><p><a href="errors.html">أمثلة الأخطاء والمربعات</a> · <a href="report.json">JSON الكامل</a></p><table>{matrix}</table>'+details+'</html>',encoding='utf-8')
    (destination/'REPORT.md').write_text('# تقييم V3 الواقعي المستقل\n\nنتائج وصفية فقط؛ الثقة غير معايرة وصلاحية التنقل غير مثبتة.\n\n'
        +f'عينات: {metrics["samples"]}، مشاهد: {metrics["scenes"]}، مواقع: {metrics["sites"]}.\n\n'
        +'| مقياس presence | قيمة |\n| --- | ---: |\n'+''.join(f'| {k} | {display(v)} |\n' for k,v in metrics['fixedPresence'].items())
        +'\n[التقرير والمصفوفات](report.html) · [الأخطاء والمربعات](errors.html) · [مقترح V4 دون تدريب](v4-proposal.json)\n',encoding='utf-8')
    lock['testConsumed']=True;lock['predictionSha256']=sha(prediction_path);write(root/'test-freeze.json',lock)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('init');p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('stage');p.add_argument('--intake',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--max-frames',type=int,default=120);p.add_argument('--max-mb',type=int,default=1024)
    p=sub.add_parser('freeze');p.add_argument('--staged',type=Path,required=True);p.add_argument('--references',type=Path,required=True);p.add_argument('--registry',type=Path,required=True);p.add_argument('--entry',type=Path,required=True)
    p=sub.add_parser('score');p.add_argument('--dataset',type=Path,required=True);p.add_argument('--predictions',type=Path,required=True)
    a=parser.parse_args()
    if a.command=='init': result=init(a.output)
    elif a.command=='stage':result=stage(a.intake,a.output,a.max_frames,a.max_mb)
    elif a.command=='freeze':result=freeze(a.staged,a.references,a.registry,a.entry)
    else:result=score(a.dataset,a.predictions)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))

if __name__=='__main__':main()
