"""Read prior final errors for planning only; never reuse its media for fine-tuning."""
from pathlib import Path
from collections import Counter
import json,re,sys
old=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
manifest=read(old/'manifest.json'); raw=read(old/'assets/instances_val2017.json')
categories={c['id']:c['name'] for c in raw['categories']}; refs={str(a['id']):a for a in raw['annotations']}
installed=re.findall(r'^  \["([^"]+)",',Path('client/src/lib/vision/cocoLabels.ts').read_text(encoding='utf-8'),re.M)
assert installed==[categories[k] for k in sorted(categories)]
for row in manifest['samples']:
    for o in row['objects']:
        ref=refs[o['id']];assert categories[ref['category_id']]==o['class'] and ref['image_id']==row['cocoId']
        expected=[ref['bbox'][0]/row['width'],ref['bbox'][1]/row['height'],ref['bbox'][2]/row['width'],ref['bbox'][3]/row['height']]
        assert all(abs(x-y)<1e-9 for x,y in zip(expected,o['box']))
metric=read(old/'test-evaluation.json')['models']['yolox-tiny']['operating']['0.5']
counts=Counter(o['class'] for row in manifest['samples'] if row['split']=='test' for o in row['objects'] if not o['iscrowd'])
fn=Counter(e['reference'] for e in metric['errors'] if e['kind']=='miss');fp=Counter(e['prediction'] for e in metric['errors'] if e['kind']=='false_positive')
assert sum(fn.values())==metric['fn'] and sum(fp.values())==metric['fp']
by_class={name:dict(reference=counts[name],tp=counts[name]-fn[name],fn=fn[name],fp=fp[name],missReasons=dict(Counter(e['reason'] for e in metric['errors'] if e['kind']=='miss' and e['reference']==name)),smallMisses=sum(e.get('minEdgeAt320',999)<16 for e in metric['errors'] if e['kind']=='miss' and e['reference']==name)) for name in sorted(set(counts)|set(fp))}
assert sum(c['tp'] for c in by_class.values())==metric['tp']
record=dict(categoryMappingVerified=True,referenceBoxesMatchOriginal=True,source='prior final, diagnosis only; all media/authors excluded from new cohort',threshold=.5,aggregate={k:metric[k] for k in ['tp','fp','fn','precision','recall']},byClass=by_class,errors=metric['errors'],causality='Proposal/score/localization categories are observed diagnostics, not proven causal explanations')
(out/'previous-errors.json').write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record['byClass']))
