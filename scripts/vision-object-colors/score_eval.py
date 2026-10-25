"""Partial-class photo evaluation; provisional colour agreement is never human approval."""
import json,math,hashlib,html,statistics
from pathlib import Path
from collections import Counter
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def iou(a,b):
    inter=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]))*max(0,min(a[1]+a[3],b[1]+b[3])-max(a[1],b[1]))
    return inter/(a[2]*a[3]+b[2]*b[3]-inter) if inter else 0.
def ratio(a,b):return a/b if b else None
def score(root):
    root=Path(root).resolve();data=read(root/'manifest.json');refs=read(root/'color-references.json');lock=read(root/'evaluation-lock.json')
    if sha(root/'manifest.json')!=lock['manifestSha256'] or sha(root/'color-references.json')!=lock['referenceSha256']:raise ValueError('Frozen test/reference changed')
    reference={r['objectId']:r for r in refs['references']};results={}
    for name in ['lite0','lite2','ssd']:
        run=read(root/f'predictions-{name}.json')
        if run['modelSha256']!=lock['models'][name] or run.get('referencesUsedInInference') is not False:raise ValueError('Prediction identity/reference leakage')
        predictions={r['id']:r for r in run['predictions']};tp=fp=fn=0;gt_count=0;ignored=0;overlaps=[];errors=[];colors=Counter();matrix=Counter();perclass=Counter();times=[]
        for row in data['samples']:
            if sha(root/row['path'])!=row['sha256']:raise ValueError('Image changed')
            predicted=predictions[row['id']]
            if predicted['imageSha256']!=row['sha256']:raise ValueError('Prediction/image mismatch')
            truth=row['objects'];all_preds=predicted['predictions'];classes={o['class'] for o in truth};scored=[p for p in all_preds if p.get('cocoClass') in classes];ignored+=len(all_preds)-len(scored)
            boxes=[list(p['boundingBox'].values()) for p in scored];pairs=[]
            for gi,g in enumerate(truth):
                for pi,p in enumerate(scored):
                    overlap=iou(g['box'],boxes[pi])
                    if g['class']==p['cocoClass'] and overlap>=.5:pairs.append((overlap,gi,pi))
            used_g=set();used_p=set();matches={}
            for overlap,gi,pi in sorted(pairs,reverse=True):
                if gi in used_g or pi in used_p:continue
                used_g.add(gi);used_p.add(pi);matches[gi]=(pi,overlap)
            tp+=len(matches);fp+=len(scored)-len(matches);fn+=len(truth)-len(matches);gt_count+=len(truth);times.append(predicted['totalMs'])
            for gi,g in enumerate(truth):
                perclass[(g['class'],'reference')]+=1;match=matches.get(gi);overlap=match[1] if match else 0.;overlaps.append(overlap)
                matrix[(g['class'],g['class'] if match else 'miss')]+=1
                if match:perclass[(g['class'],'detected')]+=1
                else:errors.append(dict(image=row['id'],objectId=g['id'],reason='missed_or_wrong_class_or_IoU_below_0.5',truth=g['class']))
                if g['id'] in reference and match:
                    expected=reference[g['id']]['color'];actual=scored[match[0]].get('color',{}).get('name');colors['matchedReferenceObjects']+=1
                    colors['decided']+=actual is not None;colors['correct']+=actual==expected;colors['abstained']+=actual is None
                    if actual!=expected:errors.append(dict(image=row['id'],objectId=g['id'],reason='provisional_color_disagreement_or_abstention',expected=expected,actual=actual))
            for pi,p in enumerate(scored):
                if pi not in used_p:errors.append(dict(image=row['id'],reason='unmatched_prediction_in_evaluated_class',prediction=p['cocoClass']))
        ordered=sorted(times)
        results[name]=dict(modelSha256=run['modelSha256'],photos=len(data['samples']),referenceObjects=gt_count,detected=tp,falsePositivesInEvaluatedClasses=fp,missed=fn,
            precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),f1=ratio(2*tp,2*tp+fp+fn),unscoredPredictionsInUnannotatedClasses=ignored,
            meanIoUWithMissesZero=ratio(sum(overlaps),len(overlaps)),latency=dict(scope='desktop main-thread CPU detector + pixel analysis; excludes file decode/model load',medianMs=statistics.median(times),p95Ms=ordered[min(len(ordered)-1,math.ceil(len(ordered)*.95)-1)]),
            conditionalColor=dict(colors,referenceAuthority=refs['status'],decidedCoverage=ratio(colors['decided'],colors['matchedReferenceObjects']),agreementIncludingAbstentions=ratio(colors['correct'],colors['matchedReferenceObjects']),agreementAmongDecisions=ratio(colors['correct'],colors['decided']),humanValidatedAccuracy=None),
            confusion=[dict(reference=t,prediction=p,count=n) for (t,p),n in sorted(matrix.items())],
            classRecall={label:ratio(perclass[(label,'detected')],perclass[(label,'reference')]) for label in sorted({k[0] for k in perclass})},errors=errors)
    report=dict(schemaVersion=1,scope='small_real_photo_evaluation_with_partial_classes_and_provisional_color_reference',models=results,
        manifestSha256=lock['manifestSha256'],referenceSha256=lock['referenceSha256'],colorSourceSha256=lock['colorSourceSha256'],modelSelected='existing_lite0_unchanged',heavierModelAdopted=False,phoneTestPerformed=False,trainingPerformed=False,
        limitations=data['limitations']+refs['limitations']+['Not COCO mAP or population accuracy; images deliberately crowded and selected by reference annotation support.','No blinded human colour adjudication; colour numbers are provisional agreement only.','No threshold tuning used these results.'])
    (root/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    table='| نموذج | TP | FP* | FN | Precision* | Recall* | وسيط ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n'
    for name,m in results.items():table+=f'| {name} | {m["detected"]} | {m["falsePositivesInEvaluatedClasses"]} | {m["missed"]} | {m["precision"]:.3f} | {m["recall"]:.3f} | {m["latency"]["medianMs"]:.1f} |\n'
    (root/'COMPARISON.md').write_text('# مقارنة أولية على صور حقيقية مرخصة\n\n'+table+'\n* مقاييس على الفئات المعلّمة داخل كل صورة فقط؛ الفئات غير المعلّمة مستبعدة. ليست mAP أو دقة شاملة.\n\nمرجع الكشف من Open Images، أما مرجع اللون فمراجعة بصرية أولية مستقلة للمساعد قبل الاستدلال، بلا اعتماد بشري؛ لا تُسمى أرقامه دقة لونية بشرية مثبتة. بقي Lite0 افتراضيًا ولم يعتمد نموذج أثقل من اختبار كمبيوتر.\n\n[النتائج والأخطاء والمصفوفات](comparison.json)\n',encoding='utf-8')
    print(json.dumps({name:{k:v[k] for k in ['detected','missed','precision','recall','latency','conditionalColor']} for name,v in results.items()},ensure_ascii=False))
if __name__=='__main__':
    import sys;score(sys.argv[1])
