"""Read actual appended TFLite labels; fail if the Arabic catalogue invents/omits classes."""
import hashlib,json,re,sys,zipfile
from pathlib import Path

repo=Path(__file__).resolve().parents[2]
model=repo/'client/public/vision/efficientdet_lite0_int8.tflite'
with zipfile.ZipFile(model) as archive:
    labels=archive.read('labels.txt').decode('utf-8').splitlines()
catalogue=(repo/'client/src/lib/vision/cocoLabels.ts').read_text(encoding='utf-8')
names=re.findall(r'\[\s*"([^"\n]+)"\s*,\s*"[^"\n]+"\s*,\s*(?:true|false)\s*,?\s*\]',catalogue)
valid=[name for name in labels if name and name!='???']
if set(names)!=set(valid) or len(names)!=80:raise ValueError('Installed model labels/catalogue differ')
report=dict(modelSha256=hashlib.sha256(model.read_bytes()).hexdigest(),metadataEntries=len(labels),supportedClasses=len(valid),
    arabicNames=len(names),placeholdersExcluded=len(labels)-len(valid),labels=valid,trainingPerformed=False)
if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='labels'}))
