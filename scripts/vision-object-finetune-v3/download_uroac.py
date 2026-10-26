"""Download the publisher's nested ZIP with resume and full SHA256 verification."""
from pathlib import Path
import hashlib,json,time,urllib.request
from rights import ROOT,sha,read

ROOT.mkdir(parents=True,exist_ok=True);assets=ROOT/'assets';assets.mkdir(exist_ok=True)
record=read(ROOT/'rights-evidence/uroac-files.json')[0];details=record['content_details']
size=record['size'];expected=details['sha256_hash'];target=assets/'UrOAC_anon.zip'
if target.exists():
    assert sha(target)==expected
    print(json.dumps(dict(existing=True,fullSha256Verified=True)));raise SystemExit()
partial=assets/'UrOAC_anon.zip.partial';offset=partial.stat().st_size if partial.exists() else 0
assert offset<=size and size<3_300_000_000
headers={'User-Agent':'BasiraResearch/3'}
if offset:headers['Range']=f'bytes={offset}-'
started=time.monotonic();last=offset
with urllib.request.urlopen(urllib.request.Request(details['download_url'],headers=headers),timeout=90) as response:
    if offset and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):
        raise ValueError('Resume was not honoured; preserve partial, never append a full response')
    with partial.open('ab' if offset else 'wb') as out:
        while chunk:=response.read(1024*1024):
            out.write(chunk);offset+=len(chunk)
            assert offset<=size,'Archive byte limit'
            if offset-last>=128*1024*1024:
                print(json.dumps(dict(downloadedMiB=round(offset/2**20,1),totalMiB=round(size/2**20,1),elapsedSeconds=round(time.monotonic()-started))),flush=True);last=offset
            if time.monotonic()-started>1800:raise TimeoutError('Acquisition time budget; verified resume is available')
assert offset==size
digest=hashlib.sha256()
with partial.open('rb') as source:
    while chunk:=source.read(4*1024*1024):digest.update(chunk)
assert digest.hexdigest()==expected,'Full publisher SHA256 mismatch'
partial.replace(target)
(ROOT/'uroac-download.json').write_text(json.dumps(dict(bytes=size,sha256=expected,fullSha256Verified=True,source='https://data.mendeley.com/datasets/fcrmp92ckn/2',elapsedSeconds=time.monotonic()-started),indent=2))
print(json.dumps(dict(downloadedMiB=round(size/2**20),fullSha256Verified=True)),flush=True)
