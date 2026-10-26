"""Bounded verified downloads from pinned, public, lawfully redistributable sources.
No Flickr requests, cloud inference, login bypass, or disabled TLS verification.
"""
from pathlib import Path
import hashlib,json,time,urllib.request,urllib.error

ROOT=Path('../.vision-test-fixtures/object-finetune-v2-001').resolve()
BDD_REV='69e9f9a60103df97e151e2606a6ad182db824f55'
YCB_REV='5c2c4aa229800355648cd268040aa814f8dc94f0'
BDD_BASE=f'https://huggingface.co/datasets/dronefreak/BDD100K/resolve/{BDD_REV}/'
YCB_BASE=f'https://huggingface.co/datasets/bop-benchmark/ycbv/resolve/{YCB_REV}/'

def sha(data):return hashlib.sha256(data).hexdigest()
def request(url,limit=3_000_000):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BasiraLocalResearch/4'}),timeout=60) as r:
                raw=r.read(limit+1)
            if len(raw)>limit:raise ValueError('Public download bound exceeded')
            return raw
        except urllib.error.HTTPError as e:
            if e.code!=429 or attempt==2:raise
            delay=min(60,max(20,int(e.headers.get('Retry-After','30'))));time.sleep(delay)

def save(path,url,limit):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists():
        raw=request(url,limit);path.write_bytes(raw)
    return dict(path=str(path.relative_to(ROOT)),url=url,sha256=sha(path.read_bytes()),bytes=path.stat().st_size)

def prepare_sources(root=ROOT):
    global ROOT
    ROOT=root;assets=root/'assets';assets.mkdir(parents=True,exist_ok=True)
    records=[]
    records.append(save(assets/'bdd-data-license.rst','https://raw.githubusercontent.com/bdd100k/bdd100k/master/doc/source/license.rst',30_000))
    text=(assets/'bdd-data-license.rst').read_text(encoding='utf-8')
    assert 'research, and not-for-profit purposes' in text and 'commercial licensing' in text
    records.append(save(assets/'bdd-mirror-card.md',BDD_BASE+'README.md',60_000))
    assert '2018' in (assets/'bdd-mirror-card.md').read_text(encoding='utf-8')
    records.append(save(assets/'ycb-license.txt','https://raw.githubusercontent.com/yuxng/YCB_Video_toolbox/master/LICENSE',30_000))
    records.append(save(assets/'ycb-readme.md','https://raw.githubusercontent.com/yuxng/YCB_Video_toolbox/master/README.md',30_000))
    assert 'dataset is released under the MIT License' in (assets/'ycb-readme.md').read_text(encoding='utf-8')
    records.append(save(assets/'ycb-classes.txt','https://raw.githubusercontent.com/yuxng/YCB_Video_toolbox/master/classes.txt',10_000))
    metadata=dict(bddRevision=BDD_REV,ycbRevision=YCB_REV,records=records,
        bddUse='research/not-for-profit only; no commercial eligibility granted',
        ycbUse='MIT, publisher explicitly covers dataset',humanApprovalsCreated=0)
    (assets/'sources.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    target=assets/'ycbv_test_bop19.zip';expected='c0c11251849877e7b2f373f6c7acf54739dc69d0fb2649c20050ca977bf5513d';size=660198701
    if target.exists():
        assert sha(target.read_bytes())==expected;return
    part=assets/'ycbv_test_bop19.zip.partial';offset=part.stat().st_size if part.exists() else 0
    headers={'User-Agent':'BasiraLocalResearch/4'}
    if offset:headers['Range']=f'bytes={offset}-'
    with urllib.request.urlopen(urllib.request.Request(YCB_BASE+'ycbv_test_bop19.zip',headers=headers),timeout=90) as response:
        if offset and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):raise ValueError('Resume range not honoured')
        with part.open('ab' if offset else 'wb') as f:
            last=offset
            while chunk:=response.read(1024*1024):
                f.write(chunk);offset+=len(chunk)
                if offset>size:raise ValueError('Archive byte budget exceeded')
                if offset-last>=32*1024*1024:
                    print(json.dumps(dict(source='YCB',downloadedBytes=offset,totalBytes=size)),flush=True);last=offset
    assert offset==size and sha(part.read_bytes())==expected,'YCB archive size/hash mismatch'
    part.replace(target)
    print(json.dumps(dict(source='YCB',bytes=size,sha256=expected,verified=True)),flush=True)

if __name__=='__main__':prepare_sources()
