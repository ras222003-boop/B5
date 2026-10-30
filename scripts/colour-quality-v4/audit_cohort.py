from pathlib import Path
import hashlib,json,re,sys,urllib.parse
from collections import Counter
from PIL import Image
root=Path(sys.argv[1]).resolve();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();m=json.loads((root/'manifest.json').read_text(encoding='utf-8'));lock=json.loads((root/'cohort-lock.json').read_text());assert sha(root/'manifest.json')==lock['manifestSha256']
groups=set();ids=set();hashes=set();fingerprints=[];problems=[]
for r in m['samples']:
    assert r['groupId'] not in groups and r['id'] not in ids and r['sha256'] not in hashes;groups.add(r['groupId']);ids.add(r['id']);hashes.add(r['sha256'])
    assert sha(root/r['path'])==r['sha256'] and sha(root/r['licenceEvidence'])==r['licenceEvidenceSha256'] and sha(root/r['referenceDocument'])==r['referenceDocumentSha256']
    source=urllib.parse.urlparse(r['source']);assert source.scheme=='https' and source.hostname in {'www.flickr.com','flickr.com'} and not source.username and not source.password
    evidence=(root/r['licenceEvidence']).read_text(encoding='utf-8');photo=r['source'].rstrip('/').split('/')[-1];matches=[]
    for text in re.findall(r'<script[^>]+type=[\"\x27]application/ld\+json[\"\x27][^>]*>(.*?)</script>',evidence,re.S|re.I):
        try:d=json.loads(text)
        except ValueError:continue
        matches.extend(i for i in d.get('@graph',[d]) if i.get('@type')=='ImageObject' and '/'+photo+'_' in i.get('contentUrl','') and i.get('license')=='https://creativecommons.org/licenses/by/2.0/' and i.get('author',{}).get('name')==r['author'])
    assert len(matches)==1
    image=Image.open(root/r['path']).convert('L').resize((9,8));p=list(image.getdata());bits=sum((p[y*9+x]>p[y*9+x+1])<<(y*8+x) for y in range(8) for x in range(8));fingerprints.append((r['id'],r['split'],bits))
for i,(name,split,bits) in enumerate(fingerprints):
    for other,stage,value in fingerprints[:i]:
        if stage!=split and (value^bits).bit_count()<=4:problems.append([name,other])
assert not problems,'Potential near-duplicate scenes must be quarantined before evaluation'
result=dict(passed=True,images=len(m['samples']),references=sum(len(r['objects']) for r in m['samples']),sourceGroups=len(groups),counts=dict(Counter(r['split'] for r in m['samples'])),exactDuplicateFiles=0,crossSplitDHashWithinFourBits=problems,perPhotoLicencesVerified=True,privateMedia=False,referenceOrigin='Published human Visual Genome attributes, not model predictions',independentBasiraColourReview=False,criterion95Proven=False)
(root/'cohort-audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
