"""V3 rights and lineage gate. Exclusion is provenance, never weight 'unlearning'."""
from pathlib import Path
from collections import Counter
import hashlib, json, sys

ROOT=Path('../.vision-test-fixtures/object-finetune-v3-001').resolve()
PREVIOUS=ROOT.parent/'object-finetune-v2-001'
TINY_SHA='9de513de589ac98bb92d3bca53b5af7b9acfa9b0bacb831f7999d0f7afaee8f0'
ALLOWED={'MIT','CC-BY-2.0','CC-BY-4.0','CC0-1.0'}
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        while chunk:=stream.read(4*1024*1024):digest.update(chunk)
    return digest.hexdigest()

def check_initial(path, audit):
    value=sha(path)
    if value!=TINY_SHA or value in audit['deniedWeightHashes']:
        raise ValueError('Only the audited original publisher Tiny checkpoint may initialize/teach V3; V1/V2 states and caches are forbidden')
    return value

def check_row(root,row):
    evidence=read(Path(root)/row['rights'])
    if evidence.get('commercialTrainingAllowed') is not True or evidence.get('licenseId') not in ALLOWED:
        raise ValueError('Commercial training rights not positively recorded')
    if evidence.get('humanApproval') is not False or row.get('source')=='bdd100k':
        raise ValueError('BDD excluded; no manufactured approval')
    if not evidence.get('licenceEvidenceSha256') or not evidence.get('source'):
        raise ValueError('Source and licence evidence required')
    licence=Path(root)/evidence.get('licenceEvidence','missing')
    if not licence.is_file() or sha(licence)!=evidence['licenceEvidenceSha256']:
        raise ValueError('Actual source licence evidence missing or changed')
    if sha(Path(root)/row['path'])!=row['sha256']:
        raise ValueError('Source image changed')
    return evidence

def audit(root=ROOT):
    root.mkdir(parents=True,exist_ok=True)
    old=read(PREVIOUS/'manifest.json');counts=Counter()
    for row in old['samples']:
        evidence=read(PREVIOUS/row['rights'])
        counts[(row['source'],evidence.get('licence',evidence.get('license')))]+=1
    denied={sha(p):str(p.relative_to(PREVIOUS)) for p in (PREVIOUS/'training').rglob('*')
            if p.is_file() and p.suffix in ['.pth','.onnx']}
    record=dict(schemaVersion=1,baseCommit='8bf3576',originalTinySha256=TINY_SHA,
        initialWeightPolicy='Original publisher Tiny only; no V1/V2 weight, optimizer, teacher or feature-cache reuse',
        publisherWeightLicense='Apache-2.0; official linked release, upstream notices retained. This is publisher permission, not an audit of every original pretraining photograph.',
        sources=[dict(source=s,recordedLicense=licence,images=n,
            status='RESEARCH_ONLY_EXCLUDED' if s=='bdd100k' else 'REQUIRES_PER_ROW_ACCEPTANCE') for (s,licence),n in sorted(counts.items())],
        deniedWeightHashes=denied,deniedCacheRoots=[str(PREVIOUS/'training')],
        priorV2Status='LOCAL_RESEARCH_ONLY',deletingImagesDoesNotCleanDerivedWeights=True,
        productionEligible=False,humanApprovalsCreated=0)
    check_initial(PREVIOUS/'assets/yolox_tiny.pth',record)
    (root/'rights-audit.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    registry=Path('.vision-ai/object-quality');registry.mkdir(parents=True,exist_ok=True)
    (registry/'lineage-quarantine.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(sources=record['sources'],restrictedDerivedFiles=len(denied),initialTinyVerified=True)))
    return record

if __name__=='__main__':audit()
