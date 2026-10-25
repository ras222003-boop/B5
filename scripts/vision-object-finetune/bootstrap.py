"""Pinned official YOLOX sources/checkpoint; TLS on, bounded downloads, no pickle execution."""
from pathlib import Path
import hashlib, io, json, sys, urllib.request, zipfile

root = Path(sys.argv[1]).resolve()
assets = root / 'assets'
assets.mkdir(parents=True, exist_ok=True)

def get(url, limit):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'BasiraResearch/3'}), timeout=90) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Download exceeds resource budget')
    return data

def sha(data):
    return hashlib.sha256(data).hexdigest()

lock = assets / 'upstream.json'
if lock.exists():
    record = json.loads(lock.read_text(encoding='utf-8'))
    for row in record['files']:
        assert sha((assets / row['path']).read_bytes()) == row['sha256']
    if not any(r['path'].endswith('/demo_utils.py') for r in record['files']):
        url=f"https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/{record['revision']}/yolox/utils/demo_utils.py"
        target=assets/'upstream/yolox/utils/demo_utils.py'; data=get(url,150_000);target.write_bytes(data)
        record['files'].append(dict(path=target.relative_to(assets).as_posix(),url=url,sha256=sha(data),bytes=len(data)))
        shim=assets/'upstream/yolox/utils/__init__.py'
        shim.write_text('from .boxes import bboxes_iou, cxcywh2xyxy\nfrom .compat import meshgrid\nfrom .demo_utils import visualize_assign\n',encoding='utf-8')
        row=next(r for r in record['files'] if r['path']=='upstream/yolox/utils/__init__.py');row.update(sha256=sha(shim.read_bytes()),bytes=shim.stat().st_size)
        lock.write_text(json.dumps(record,indent=2),encoding='utf-8')
    print(json.dumps(record)); sys.exit(0)
revision = '6ddff4824372906469a7fae2dc3206c7aa4bbaee'  # Actual source revision used for this study.
base = f'https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/{revision}/'
names = ['LICENSE', 'docs/train_custom_data.md', 'exps/default/yolox_tiny.py', 'yolox/__init__.py']
names += ['yolox/models/' + n + '.py' for n in ['__init__', 'network_blocks', 'darknet', 'yolo_pafpn', 'yolo_fpn', 'yolo_head', 'losses', 'yolox']]
names += ['yolox/utils/' + n + '.py' for n in ['boxes', 'compat', 'visualize', 'demo_utils']]
records = []
for name in names:
    target = assets / 'upstream' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    data = get(base + name, 150_000)
    target.write_bytes(data)
    records.append(dict(path=target.relative_to(assets).as_posix(), url=base+name, sha256=sha(data), bytes=len(data)))
assert 'Apache License' in (assets/'upstream/LICENSE').read_text()
# Import only the official helpers needed for CPU head training. Avoid GPU/distributed trainer imports.
shim = assets/'upstream/yolox/utils/__init__.py'
shim.write_text('from .boxes import bboxes_iou, cxcywh2xyxy\nfrom .compat import meshgrid\nfrom .demo_utils import visualize_assign\n', encoding='utf-8')
records.append(dict(path=shim.relative_to(assets).as_posix(), source='Basira minimal import shim, no math changes', sha256=sha(shim.read_bytes()), bytes=shim.stat().st_size))
url = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.pth'
target = assets/'yolox_tiny.pth'
if not target.exists():
    target.write_bytes(get(url, 50_000_000))
records.append(dict(path=target.name, url=url, sha256=sha(target.read_bytes()), bytes=target.stat().st_size))
record = dict(revision=revision, license='Apache-2.0 official publisher code and linked checkpoint', checkpointLoading='torch.load(weights_only=True, map_location=cpu)', files=records)
lock.write_text(json.dumps(record, indent=2), encoding='utf-8')
print(json.dumps(record))
