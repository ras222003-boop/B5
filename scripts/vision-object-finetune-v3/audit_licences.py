"""Independent source-page audit: licence belongs to the requested photo itself."""
from pathlib import Path
import json,re,sys
from rights import read,sha

root=Path(sys.argv[1]).resolve();rows=[json.loads(l) for l in (root/'coco-acquisition.jsonl').read_text().splitlines()]
verified=[];errors=[]
for row in rows:
    evidence=read(root/row['rights']);page=(root/evidence['licenceEvidence']).read_text(encoding='utf-8')
    assert sha(root/evidence['licenceEvidence'])==evidence['licenceEvidenceSha256']
    photo=re.search(r'/photos/[^/]+/(\d+)',evidence['source']).group(1);matched=False
    for text in re.findall(r'<script[^>]+type=[\"\x27]application/ld\+json[\"\x27][^>]*>(.*?)</script>',page,re.S|re.I):
        # Script JSON is not HTML attribute JSON: unescaping &quot; first can corrupt
        # quoted descriptions. Parse the original valid JSON, then inspect fields.
        try:document=json.loads(text)
        except json.JSONDecodeError:continue
        for item in document.get('@graph',[document]):
            if (item.get('@type')=='ImageObject' and '/'+photo+'_' in item.get('contentUrl','')
                and item.get('license')=='https://creativecommons.org/licenses/by/2.0/'
                and item.get('author',{}).get('name')==evidence['author']):matched=True
    (verified if matched else errors).append(row['id'])
record=dict(passed=not errors,imagesVerified=len(verified),failures=errors,
    method='Matching photo ID, content URL, author and CC BY2 licence in the same ImageObject JSON-LD; archived page SHA checked',
    humanApproval=False,sourceCodeSha256=sha(Path(__file__)))
(root/'strict-coco-licence-audit.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record));assert not errors,'Commercial eligibility cannot be claimed for unverified photo rights'
