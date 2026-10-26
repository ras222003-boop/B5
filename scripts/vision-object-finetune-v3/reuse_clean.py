"""Reuse only individually evidenced, permissively licensed development data.
No BDD row, V2 optimizer/cache/weight, or prior final scene is copied.
"""
from pathlib import Path
import hashlib,json,shutil
from rights import ROOT,PREVIOUS,read,sha,check_row

root=ROOT
assert not (root/'cohort-lock.json').exists()
for folder in ['assets','images','rights','rights-evidence','source-labels']:(root/folder).mkdir(parents=True,exist_ok=True)
old=root.parent/'object-finetune-v1-001'
for item in (old/'assets/upstream').rglob('*'):
    if item.is_file() and '__pycache__' not in item.parts:
        out=root/'assets/upstream'/item.relative_to(old/'assets/upstream');out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(item,out)
for name in ['upstream.json','yolox_tiny.pth']:shutil.copyfile(old/'assets'/name,root/'assets'/name)
for name in ['ycb-license.txt','ycb-readme.md','bdd-data-license.rst']:
    # BDD licence text is audit evidence only, no BDD photos or annotations.
    shutil.copyfile(PREVIOUS/'assets'/name,root/'rights-evidence'/name)
rows=[]
excluded=[]
for source in read(PREVIOUS/'manifest.json')['samples']:
    if source['split']=='test' or source['source']=='bdd100k':continue
    if source['source']=='coco-replay':
        excluded.append(dict(imageId=source['id'],reason='Prior verified licence record has a page hash but archived source HTML was not retained; use fresh currently verified COCO instead'))
        continue
    row=dict(source);evidence=read(PREVIOUS/row['rights'])
    row['id']='clean-'+row['id'];row['path']='images/'+row['id']+'.png';row['rights']='rights/'+row['id']+'.json'
    shutil.copyfile(PREVIOUS/source['path'],root/row['path'])
    if source['source']=='ycb-video':
        licence=root/'rights-evidence/ycb-license.txt'
        assert evidence['licence']=='MIT'
        evidence.update(licenseId='MIT',licenceEvidence='rights-evidence/ycb-license.txt',licenceEvidenceSha256=sha(licence))
        # Preserve published geometry references and hashes. Masks remain reference-only.
        for key in ['sourceAnnotation','sourceInfo']:
            target=root/source[key];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(PREVIOUS/source[key],target)
        for obj in row['objects']:
            if obj.get('mask'):
                target=root/obj['mask'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(PREVIOUS/obj['mask'],target)
    else:
        assert evidence['license']=='https://creativecommons.org/licenses/by/2.0/'
        # V1 kept the actual checked original source HTML; carry its evidence forward.
        original_id=str(source.get('cocoId',source['id'].removeprefix('coco-')))
        matches=[p for p in (old/'rights').glob('*.json') if read(p).get('sourcePageSha256')==evidence['sourcePageSha256']]
        assert matches,'Original source evidence was not found'
        html_path=old/'source-pages'/(original_id+'.html')
        if not html_path.exists():
            candidates=[p for p in old.rglob('*.html') if sha(p)==evidence['sourcePageSha256']]
            assert candidates,'Actual source licence HTML required, not a copied assertion';html_path=candidates[0]
        destination=root/'rights-evidence'/(row['id']+'.html');shutil.copyfile(html_path,destination)
        assert sha(destination)==evidence['sourcePageSha256']
        evidence.update(licenseId='CC-BY-2.0',licenceEvidence=str(destination.relative_to(root)),licenceEvidenceSha256=sha(destination))
        row['source']='coco-replay'
    evidence.update(commercialTrainingAllowed=True,humanApproval=False)
    (root/row['rights']).write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
    check_row(root,row);rows.append(row)
(root/'clean-reuse.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
(root/'clean-reuse-exclusions.json').write_text(json.dumps(excluded,indent=2),encoding='utf-8')
print(json.dumps(dict(images=len(rows),training=sum(r['split']=='train' for r in rows),
    validation=sum(r['split']=='validation' for r in rows),bddImages=0,weights='original publisher Tiny only')))
