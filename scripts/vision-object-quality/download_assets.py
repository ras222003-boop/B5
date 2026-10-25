"""Bounded public downloads. TLS verification stays enabled. No uploads or executable checkpoints."""
import io,json,hashlib,urllib.request,zipfile,sys,time
from pathlib import Path
ROOT=Path(sys.argv[1]).resolve();ROOT.mkdir(parents=True,exist_ok=True)
def get(url,limit=2_000_000,headers=None):
    r=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BasiraLocalResearch/2',**(headers or {})}),timeout=45)
    data=r.read(limit+1)
    if len(data)>limit:raise ValueError('Download resource bound')
    return data,r.headers
def save(name,url,limit):
    p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True)
    if not p.exists():p.write_bytes(get(url,limit)[0])
    return dict(path=name,url=url,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size)
class RemoteZip(io.RawIOBase):
    url='https://s3.amazonaws.com/images.cocodataset.org/annotations/annotations_trainval2017.zip'
    def __init__(self):
        _,h=get(self.url,256,{'Range':'bytes=0-255'});self.size=int(h['Content-Range'].split('/')[-1]);self.pos=0
    def seekable(self):return True
    def readable(self):return True
    def tell(self):return self.pos
    def seek(self,n,whence=0):self.pos=n if whence==0 else self.pos+n if whence==1 else self.size+n;return self.pos
    def read(self,n=-1):
        n=min(self.size-self.pos,n if n>=0 else self.size-self.pos)
        if not n:return b''
        if n>30_000_000:raise ValueError('ZIP range bound')
        # Query isolates intermediary caches that otherwise return an unrelated byte range.
        url=self.url+'?range='+str(self.pos)+'-'+str(n)
        data,h=get(url,n,{'Range':f'bytes={self.pos}-{self.pos+n-1}'})
        if h.get('Content-Range')!=f'bytes {self.pos}-{self.pos+n-1}/{self.size}':raise ValueError('Server did not honour byte range')
        self.pos+=len(data);return data
records=[]
annotations=ROOT/'instances_val2017.json'
if not annotations.exists():
    with zipfile.ZipFile(RemoteZip()) as archive:
        info=archive.getinfo('annotations/instances_val2017.json')
        if info.file_size>30_000_000:raise ValueError('Annotation bound')
        annotations.write_bytes(archive.read(info)) # ZIP CRC also verified.
records.append(dict(path=annotations.name,url=RemoteZip.url+'#annotations/instances_val2017.json',sha256=hashlib.sha256(annotations.read_bytes()).hexdigest(),bytes=annotations.stat().st_size))
records.append(save('yolox/LICENSE','https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/LICENSE',30_000))
records.append(save('yolox/README.md','https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/demo/ONNXRuntime/README.md',30_000))
if 'Apache License' not in (ROOT/'yolox/LICENSE').read_text():raise ValueError('YOLOX licence changed')
for name in ['tiny','nano']:
    records.append(save(f'yolox/yolox_{name}.onnx',f'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_{name}.onnx?basira=20261025',25_000_000))
api=json.loads(get('https://huggingface.co/api/models/Xenova/slimsam-77-uniform')[0])
if api['cardData']['license']!='apache-2.0':raise ValueError('SlimSAM weights licence is not Apache 2.0')
revision=api['sha']
for name in ['README.md','config.json','preprocessor_config.json','onnx/vision_encoder_quantized.onnx','onnx/prompt_encoder_mask_decoder_quantized.onnx']:
    records.append(save('slimsam/'+name,f'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/{revision}/{name}',15_000_000))
(ROOT/'assets.json').write_text(json.dumps(dict(records=records,slimSamRevision=revision,slimSamWeightsLicense='apache-2.0',yoloxLicense='Apache-2.0; publisher project and its linked official model release',purpose='local_research_only',training=False),indent=2),encoding='utf-8')
print(json.dumps({'assets':len(records),'bytes':sum(x['bytes'] for x in records)}))
