"""The original 12 images remain diagnostics, never the new final test or model selector."""
from pathlib import Path
import json,sys,io,contextlib,statistics,math
from evaluate import read,operating,overlap,box
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
root=Path(sys.argv[1]).resolve();old=root.parent/'object-colors-001';manifest=read(old/'manifest.json');rows=manifest['samples']
for r in rows:
    for g in r['objects']:g.update(iscrowd=0,area=g['box'][2]*g['box'][3]*r['width']*r['height'])
categories=read(root/'assets/instances_val2017.json')['categories'];class_ids={c['name']:c['id'] for c in categories}
dataset=dict(info={},licenses=[],images=[dict(id=i+1,width=r['width'],height=r['height']) for i,r in enumerate(rows)],categories=categories,annotations=[])
for i,r in enumerate(rows):
    for g in r['objects']:
        x,y,w,h=g['box'];dataset['annotations'].append(dict(id=len(dataset['annotations'])+1,image_id=i+1,category_id=class_ids[g['class']],bbox=[x*r['width'],y*r['height'],w*r['width'],h*r['height']],area=g['area'],iscrowd=0))
summaries={}
for path in sorted((root/'results/legacy').glob('*.json')):
    if path.name.endswith('failure.json'):continue
    report=read(path);predictions={r['id']:r for r in report['predictions']};dt=[]
    for i,r in enumerate(rows):
        classes={g['class'] for g in r['objects']};predictions[r['id']]['detections']=[p for p in predictions[r['id']]['detections'] if p.get('cocoClass') in classes]
        for p in predictions[r['id']]['detections']:
            x,y,w,h=box(p);dt.append(dict(image_id=i+1,category_id=class_ids[p['cocoClass']],score=p['confidence'],bbox=[x*r['width'],y*r['height'],w*r['width'],h*r['height']]))
    with contextlib.redirect_stdout(io.StringIO()):
        gt=COCO();gt.dataset=dataset;gt.createIndex();scorer=COCOeval(gt,gt.loadRes(dt),'bbox');scorer.evaluate();scorer.accumulate();scorer.summarize()
    summaries[report['config']['id']]=dict(partialClassAP=float(scorer.stats[0]),partialClassAP50=float(scorer.stats[1]),
        operating={str(t):operating(rows,predictions,t) for t in [.25,.4,.5,.65]},medianMs=statistics.median(p['detectorMs'] for p in report['predictions']))
referenceEdges=[min(g['box'][2]*r['width'],g['box'][3]*r['height'])*320/max(r['width'],r['height']) for r in rows for g in r['objects']]
baseline=summaries['lite0-cap12']['operating']['0.65'];reasons={}
for e in baseline['errors']:
    if e['kind']=='miss':reasons[e['reason']]=reasons.get(e['reason'],0)+1
result=dict(images=12,referenceObjects=132,models=summaries,diagnosis=dict(
    referenceMinEdgeBelow16PixelsAtLite0=sum(e<16 for e in referenceEdges),referenceMinEdgeBelow32PixelsAtLite0=sum(e<32 for e in referenceEdges),
    broadTableCrosswalk=sum(g['class']=='dining table' for r in rows for g in r['objects']),
    nearDuplicateSameClassGTpairs=sum(g['class']==h['class'] and overlap(g['box'],h['box'])>.6 for r in rows for i,g in enumerate(r['objects']) for h in r['objects'][i+1:]),
    missedProposalReasons=reasons,
    preprocessing='Exact same immutable upright RGB PNG bytes; aspect preserved, MediaPipe metadata preprocessing; YOLOX uses publisher BGR top-left letterbox. No extra channel normalization applied to TFLite.',
    causalLimit='Miss attribution describes observable proposals; no claim that absence alone proves an architectural cause.'),
    methodology='Conditional partial-image-class AP, not full COCO mAP. Drop predictions of unannotated image classes; Open Images Table->dining table is broader than exact COCO semantics.',selectionUse='diagnostics only; not new validation or final test')
(root/'legacy-audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(dict(diagnosis=result['diagnosis'],models={k:dict(partialClassAP=v['partialClassAP'],thresholds={t:{q:m[q] for q in ['tp','fp','fn','precision','recall']} for t,m in v['operating'].items()}) for k,v in summaries.items()})))
