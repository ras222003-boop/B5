"""Measured final predictions versus independent boxes, for reporting only; no tuning."""
from pathlib import Path
from collections import Counter
import json,sys
from PIL import Image,ImageDraw,ImageFont
from common import read
root=Path(sys.argv[1]).resolve();manifest=read(root/'manifest.json')
evaluation=read(root/'test-evaluation.json')['models']['objects-basira-v1']['operating']['0.5']
predictions={r['id']:r['detections'] for r in read(root/'results/test/objects-basira-v1.json')['predictions']}
errors=Counter(e['imageId'] for e in evaluation['errors'])
rows=sorted([r for r in manifest['samples'] if r['split']=='test'],key=lambda r:-errors[r['id']])[:6]
sheet=Image.new('RGB',(1280,1680),'#18181b');draw=ImageDraw.Draw(sheet)
font_path=Path('C:/Windows/Fonts/arial.ttf')
font=ImageFont.truetype(str(font_path),16) if font_path.exists() else ImageFont.load_default()
for index,row in enumerate(rows):
    image=Image.open(root/row['path']).convert('RGB');image.thumbnail((620,470));x0=(index%2)*640+10;y0=(index//2)*560+10
    sheet.paste(image,(x0,y0))
    for kind,boxes,color in [('GT',row['objects'],'#22c55e'),('V1',predictions[row['id']],'#fb7185')]:
        for obj in boxes:
            if kind=='V1' and obj['confidence']<.5:continue
            b=obj['box'] if kind=='GT' else [obj['boundingBox'][k] for k in ['x','y','width','height']]
            x,y,w,h=b;points=[x0+x*image.width,y0+y*image.height,x0+(x+w)*image.width,y0+(y+h)*image.height]
            draw.rectangle(points,outline=color,width=2)
    rights=read(root/row['rights'])
    caption=f"COCO {row['id']} | {len(row['objects'])} GT | {errors[row['id']]} FP/misses"
    draw.text((x0,y0+478),caption,font=font,fill='white')
    draw.text((x0,y0+501),'Green=independent GT; pink=V1 score>=0.5',font=font,fill='white')
    draw.text((x0,y0+524),rights['author'][:58]+' | CC BY 2.0; annotated',font=font,fill='white')
out=root/'examples';out.mkdir(exist_ok=True);sheet.save(out/'final-contact-sheet.jpg',quality=90)
print(json.dumps(dict(examples=len(rows),file=str(out/'final-contact-sheet.jpg'),modelPredictionsNotReferences=True)))
