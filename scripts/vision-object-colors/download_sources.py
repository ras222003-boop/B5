"""Optional public sources only. Reuse verified local files; bounded download and hash verification."""
import hashlib,json,sys,urllib.request
from pathlib import Path
SOURCES=[
 ('classes.csv','https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv','1839e0e7e84130ae281f7f67413768601b031581c0c42e7fc17527b8e2a99aa9'),
 ('metadata.csv','https://storage.googleapis.com/openimages/2018_04/validation/validation-images-with-rotation.csv','ed93a0e121fe345effdfc7359b848dbc64a1ff6778c8c73563157cb500b33a17'),
 ('boxes.csv','https://storage.googleapis.com/openimages/v5/validation-annotations-bbox.csv','d8bbd59410af14835d7733165a7bb8a3f0213981b22dd5077b0b9f7878991ff2'),
 ('lite2.tflite','https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite','b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896'),
 ('ssd.tflite','https://storage.googleapis.com/mediapipe-models/object_detector/ssd_mobilenet_v2/float16/1/ssd_mobilenet_v2.tflite','ee21e12bfdc464100c6008c865ab8294f6a04162e6ed2e11986f1175b02cfab2'),
]
root=Path(sys.argv[1]).resolve();sources=root/'sources';sources.mkdir(parents=True,exist_ok=True);records=[]
for name,url,expected in SOURCES:
    path=sources/name
    if path.exists():raw=path.read_bytes()
    else:
        raw=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BasiraLocalResearch/1.0'}),timeout=60).read(32*1024*1024+1)
    if len(raw)>32*1024*1024 or hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('Public source size/hash mismatch: '+name)
    if not path.exists():path.write_bytes(raw)
    records.append(dict(file=name,url=url,sha256=expected,bytes=len(raw)))
(root/'public-source-downloads.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
print(json.dumps(dict(verified=len(records),directory=str(sources))))
