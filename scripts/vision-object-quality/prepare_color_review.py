"""Blind colour-review cards from independent reference polygons, never detector predictions."""
from PIL import Image,ImageDraw
from pathlib import Path
import json,sys
root=Path(sys.argv[1]).resolve();stage=sys.argv[2]
if (root/'masks'/stage/'results.json').exists():raise ValueError('Mask/colour inference already exists; no retrospective reference creation')
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'));chosen=[]
for row in manifest['samples']:
    if row['split']!=stage:continue
    eligible=[o for o in row['objects'] if o['class']!='person' and 'mask' in o and not o['iscrowd'] and o['box'][2]*o['box'][3]>=.025]
    if eligible:chosen.append((row,max(eligible,key=lambda o:o['box'][2]*o['box'][3])))
chosen=chosen[:12];sheet=Image.new('RGB',(1200,300*((len(chosen)+3)//4)),'white');draw=ImageDraw.Draw(sheet);refs=[]
for i,(row,obj) in enumerate(chosen):
    image=Image.open(root/row['path']);mask=Image.open(root/obj['mask']).resize(image.size,Image.Resampling.NEAREST)
    foreground=Image.composite(image,Image.new('RGB',image.size,(160,160,160)),mask)
    x,y,w,h=obj['box'];crop=foreground.crop((max(0,int(x*image.width)-4),max(0,int(y*image.height)-4),min(image.width,int((x+w)*image.width)+4),min(image.height,int((y+h)*image.height)+4)));crop.thumbnail((290,240));left=(i%4)*300;top=(i//4)*300
    sheet.paste(crop,(left+(300-crop.width)//2,top+45));draw.text((left+6,top+6),f'{i+1}: {row["id"]}/{obj["id"]} {obj["class"]}',fill='black');refs.append(dict(imageId=row['id'],objectId=obj['id'],category=obj['class'],color=None,humanApproval=False))
sheet.save(root/f'{stage}-color-reference-cards.png');(root/f'{stage}-color-reference-draft.json').write_text(json.dumps(dict(status='pending_independent_visual_review',references=refs,humanApproval=False),indent=2));print(json.dumps({'cards':len(refs)}))
