"""Single locked V2/V3 comparison on the new synthetic test; no parameter tuning."""
from __future__ import annotations
import argparse,html,json,time
from pathlib import Path
import numpy as np
import onnxruntime as ort
import torch
from model_v3 import StairV3,letterbox,decode
from models_v2 import TinyDetectorV2,image_tensor,classify,CLASS_IDS_V2,CLASS_NAMES
from train_v3 import verify_contract,metrics
from train_v2 import save_json
from train_small import sha256


def timing(values):
    return dict(medianMs=float(np.median(values)),p95Ms=float(np.percentile(values,95)),
                scope='CPU forward only; excludes image decode/preprocessing',images=len(values))


def examples(root,rows,old,new,folder):
    chosen=[];seen=set()
    for row,a,b in zip(rows,old,new):
        truth=row['objects'][0]['classId'] if row['objects'] else None
        key=(truth,b['classId'],a['classId']==truth,b['classId']==truth)
        if key not in seen:
            seen.add(key);chosen.append((row,a,b,truth))
    chosen=sorted(chosen,key=lambda item:(item[2]['classId']==item[3],item[1]['classId']==item[3]))[:12]
    cards=[]
    for row,a,b,truth in chosen:
        rectangles=[]
        for box,color in [(row['objects'][0]['box'] if row['objects'] else None,'#15934b'),(b['box'],'#d5383c')]:
            if box:
                x,y,w,h=box;rectangles.append(f'<rect x="{x*320}" y="{y*240}" width="{w*320}" height="{h*240}" stroke="{color}"/>')
        cards.append(f'<article><h2>{html.escape(row["kind"])} · {html.escape(row["view"])}</h2>'
            f'<div class="picture"><img src="../{html.escape(row["path"])}" width="320" height="240">'
            f'<svg viewBox="0 0 320 240">{"".join(rectangles)}</svg></div>'
            f'<p>Truth: {CLASS_NAMES[truth]}<br>V2: {CLASS_NAMES[a["classId"]]}<br>V3: {CLASS_NAMES[b["classId"]]}</p>'
            f'<small>{html.escape(row["scene_id"])}</small></article>')
    path=folder/'examples.html';path.write_text('<!doctype html><html><meta charset="utf-8"><title>V3 synthetic successes and failures</title>'
        '<style>body{font:15px system-ui;background:#eef2ef;margin:24px}main{display:flex;flex-wrap:wrap;gap:16px}'
        'article{background:white;padding:12px;max-width:340px}.picture{position:relative;width:320px;height:240px}'
        'svg{position:absolute;inset:0;width:320px;height:240px}rect{fill:none;stroke-width:3}small{overflow-wrap:anywhere}</style>'
        '<h1>V3 synthetic test examples</h1><p>Green: ground truth. Red: V3. Confidence is uncalibrated. No navigation validity.</p><main>'
        +''.join(cards)+'</main></html>',encoding='utf-8');return path


def compare(root,run,v2_report,output):
    root=root.resolve();run=run.resolve();output=output.resolve();torch.set_num_threads(2)
    if root not in output.parents or root not in run.parents:raise ValueError('Private experiment paths required')
    output.mkdir(parents=True,exist_ok=True);report_path=output/'comparison.json'
    data,freeze=verify_contract(root);lock=json.loads((run/'selection-lock.json').read_text(encoding='utf-8'))
    if lock['status']!='selected_before_test' or lock['testEvaluated'] or lock['manifestSha256']!=freeze['manifestSha256'] or lock['testFingerprint']!=freeze['testFingerprint']:
        raise ValueError('Model or test lock changed')
    if sha256(Path(lock['weights']))!=lock['weightsSha256'] or sha256(Path(lock['onnx']))!=lock['onnxSha256']:raise ValueError('V3 artifact hash changed')
    prior=json.loads(v2_report.read_text(encoding='utf-8'))
    if sha256(Path(prior['weights']))!=prior['weightsSha256']:raise ValueError('V2 weights changed')
    if report_path.exists():
        saved=json.loads(report_path.read_text(encoding='utf-8'))
        if saved['manifestSha256']!=freeze['manifestSha256'] or saved['v2WeightsSha256']!=prior['weightsSha256'] or saved['v3WeightsSha256']!=lock['weightsSha256']:
            raise ValueError('Saved comparison binding changed')
        return saved
    rows=[r for r in data['samples'] if r['split']=='test']
    for row in rows:
        if sha256(root/row['path'])!=row['sha256']:raise ValueError('Frozen test image changed')
    old=TinyDetectorV2(prior['selectedArchitecture']).eval();old.load_state_dict(torch.load(prior['weights'],map_location='cpu',weights_only=True))
    new=StairV3().eval();new.load_state_dict(torch.load(lock['weights'],map_location='cpu',weights_only=True))
    results={}
    for name,model in [('v2',old),('v3',new)]:
        file=output/f'predictions-{name}.json'
        if file.exists():
            saved=json.loads(file.read_text(encoding='utf-8'))
            if saved['manifestSha256']!=freeze['manifestSha256'] or saved['weightsSha256']!=(prior['weightsSha256'] if name=='v2' else lock['weightsSha256']):raise ValueError('Saved inference binding changed')
            predictions=saved['predictions'];times=saved['latency']
        else:
            predictions=[];elapsed=[]
            with torch.inference_mode():
                for row in rows:
                    if name=='v2':
                        tensor=image_tensor(root/row['path']).unsqueeze(0);started=time.perf_counter();logits,box=model(tensor)
                        elapsed.append((time.perf_counter()-started)*1000);pred=classify(logits[0],box[0],CLASS_IDS_V2,.5)
                    else:
                        tensor,_,meta=letterbox(root/row['path']);started=time.perf_counter();p,d,b=model(tensor.unsqueeze(0))
                        elapsed.append((time.perf_counter()-started)*1000);pred=decode(p[0].numpy(),d[0].numpy(),b[0].numpy(),meta,lock['thresholds'])
                    predictions.append(dict(id=row['id'],scene_id=row['scene_id'],imageSha256=row['sha256'],**pred))
            times=timing(elapsed[1:]);save_json(file,dict(predictions=predictions,latency=times,
                manifestSha256=freeze['manifestSha256'],weightsSha256=prior['weightsSha256'] if name=='v2' else lock['weightsSha256']))
        results[name]=dict(metrics=metrics(rows,predictions),latency=times,predictions=predictions)
    options=ort.SessionOptions();options.intra_op_num_threads=2
    session=ort.InferenceSession(lock['onnx'],sess_options=options,providers=['CPUExecutionProvider'])
    tensor,_,_=letterbox(root/rows[0]['path']);tensor=tensor.unsqueeze(0)
    with torch.inference_mode():expected=new(tensor)
    actual=session.run(None,{'image':tensor.numpy()});parity=max(float(np.max(np.abs(a.numpy()-b))) for a,b in zip(expected,actual))
    if not np.isfinite(parity) or any(not np.isfinite(a).all() for a in actual) or parity>1e-4:raise ValueError('ONNX fresh-test parity failed')
    path=examples(root,rows,results['v2']['predictions'],results['v3']['predictions'],output)
    result=dict(status='single_comparison_after_validation_lock',manifestSha256=freeze['manifestSha256'],testFingerprint=freeze['testFingerprint'],
        selectionLockSha256=sha256(run/'selection-lock.json'),v2WeightsSha256=prior['weightsSha256'],v3WeightsSha256=lock['weightsSha256'],
        v2=results['v2']['metrics'],v3=results['v3']['metrics'],latency={name:result['latency'] for name,result in results.items()},
        thresholds=lock['thresholds'],onnxFreshTestParity=parity,examples=str(path),
        realCameraEvaluation='not_performed',navigationSafety='not_established',confidenceCalibrated=False,productionEnabled=False,
        note='No subsequent tuning may use this consumed synthetic test')
    save_json(report_path,result);return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('root','run','v2-report','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();result=compare(args.root,args.run,args.v2_report,args.output)
    print(json.dumps(dict(status=result['status'],v2=result['v2']['fixedDetection'],v3=result['v3']['fixedDetection'],
        v2Direction=result['v2']['classRecall'],v3Direction=result['v3']['classRecall'])),flush=True)
