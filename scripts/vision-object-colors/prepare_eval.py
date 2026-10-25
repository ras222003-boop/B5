"""Bounded Open Images real subset; license evidence verified before photo download.
No detector is run here. Human dataset boxes are independent reference annotations.
Colour references remain pending until a separate blind review, never detector labels.
"""
import csv,hashlib,json,re,urllib.request,io
from pathlib import Path
from PIL import Image,ImageOps

MAPPING={'Chair':'chair','Table':'dining table','Backpack':'backpack','Handbag':'handbag','Coffee cup':'cup','Bottle':'bottle','Car':'car','Bicycle':'bicycle','Couch':'couch','Bed':'bed','Person':'person','Man':'person','Woman':'person','Boy':'person','Girl':'person','Bus':'bus','Truck':'truck','Dog':'dog','Cat':'cat','Laptop':'laptop','Book':'book','Television':'tv','Vase':'vase','Potted plant':'potted plant'}
TARGETS=['Chair','Table','Backpack','Handbag','Coffee cup','Bottle','Car','Bicycle','Couch','Bed','Person','Bus']
def sha(raw):return hashlib.sha256(raw).hexdigest()
def fetch(url,bound):
    request=urllib.request.Request(url,headers={'User-Agent':'BasiraLocalResearch/1.0'})
    raw=urllib.request.urlopen(request,timeout=20).read(bound+1)
    if len(raw)>bound:raise ValueError('Public download exceeded resource bound')
    return raw
def prepare(root):
    root=Path(root).resolve();sources=root/'sources';(root/'images').mkdir(exist_ok=True);(root/'license-evidence').mkdir(exist_ok=True)
    if (root/'manifest.json').exists():raise ValueError('Do not overwrite the frozen real cohort')
    classes=dict(csv.reader((sources/'classes.csv').open(encoding='utf-8')))
    metadata={r['ImageID']:r for r in csv.DictReader((sources/'metadata.csv').open(encoding='utf-8'))}
    groups={}
    for row in csv.DictReader((sources/'boxes.csv').open(encoding='utf-8')):
        if classes[row['LabelName']] not in MAPPING or row['IsGroupOf']!='0' or row['IsDepiction']!='0' or row['IsInside']=='1':continue
        groups.setdefault(row['ImageID'],[]).append(row)
    selected=[];used=set();rejections=[]
    for target in TARGETS:
        candidates=[(key,rows) for key,rows in groups.items() if key not in used and any(classes[r['LabelName']]==target for r in rows)]
        # Source annotation only: prefer several annotated objects, not successful predictions.
        candidates.sort(key=lambda item:(-min(len(item[1]),8),item[0]))
        for image_id,rows in candidates[:8]:
            m=metadata[image_id]
            if m['License']!='https://creativecommons.org/licenses/by/2.0/' or m['Rotation'] not in ('0','0.0',''):continue
            try:
                landing=m['OriginalLandingURL'];photo_id=landing.rstrip('/').split('/')[-1]
                if not re.fullmatch(r'https://www\.flickr\.com/photos/[^/]+/\d+/?',landing):raise ValueError('Unexpected original license source')
                page=fetch(landing,2*1024*1024).decode('utf-8')
                if not re.search(r'"license"\s*:\s*"https://creativecommons.org/licenses/by/2\.0/"',page):raise ValueError('Current source CC BY license could not be verified')
                original=m['OriginalURL']
                if not re.match(r'https://[^/]*staticflickr\.com/',original):raise ValueError('Unexpected image host')
                raw=fetch(original,12*1024*1024);image=ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGB');image.thumbnail((1280,1280))
                path=root/'images'/f'{image_id}.png';image.save(path)
                objects=[]
                for index,row in enumerate(rows):
                    x,y=float(row['XMin']),float(row['YMin']);w=float(row['XMax'])-x;h=float(row['YMax'])-y
                    label=MAPPING[classes[row['LabelName']]]
                    if any(o['class']==label and max(abs(a-b) for a,b in zip(o['box'],[x,y,w,h]))<.015 for o in objects):continue
                    objects.append(dict(id=f'{image_id}-{index}',**{'class':label},box=[x,y,w,h],occluded=row['IsOccluded']=='1',truncated=row['IsTruncated']=='1',color=None,colorReferenceStatus='pending_independent_blind_review'))
                evidence=dict(source=landing,license=m['License'],author=m['Author'],title=m['Title'],landingSha256=sha(page.encode()),photoSha256=sha(raw),verifiedMechanism='original_photo_JSON_LD_license',humanApproval=False,changes='EXIF upright; reduced to maximum 1280px; PNG without EXIF')
                (root/'license-evidence'/f'{image_id}.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
                selected.append(dict(id=image_id,path=f'images/{image_id}.png',sha256=sha(path.read_bytes()),width=image.width,height=image.height,sceneId=f'oid-{image_id}',siteId=f'flickr-{m["AuthorProfileURL"].rstrip("/").split("/")[-1]}',referenceSource='OpenImagesV5_validation_human_boxes_CC_BY_4.0',licenseEvidence=f'license-evidence/{image_id}.json',target=target,objects=objects))
                used.add(image_id);print(json.dumps({'selected':image_id,'target':target,'objects':len(objects)}),flush=True);break
            except Exception as e:rejections.append(dict(id=image_id,target=target,reason=str(e)))
    manifest=dict(schemaVersion=1,scope='independent_real_object_color_initial_evaluation',samples=selected,
        sourceAnnotationsSha256=sha((sources/'boxes.csv').read_bytes()),colorReferences='pending_independent_review',inferenceUsedForSelection=False,trainingUse='forbidden',limitations=['Open Images boxes are partial; score only mapped annotated classes per image.','Public dataset may overlap pretrained COCO by source; not proof of unseen training images.','No real camera motion video or phone evaluation in this photo subset.'])
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'source-rejections.json').write_text(json.dumps(rejections,indent=2),encoding='utf-8')
    print(json.dumps({'images':len(selected),'objects':sum(len(r['objects']) for r in selected),'rejected':len(rejections),'colors':'pending'}))
if __name__=='__main__':
    import sys;prepare(sys.argv[1])
