"""Readable per-class evidence; vocabulary membership is not proved accuracy."""
from pathlib import Path
import json,sys
root=Path(sys.argv[1]).resolve();source=root.parent/'object-finetune-v3-001'
registry=json.loads((source/'basira-knowledge.json').read_text(encoding='utf-8'));models={m['id']:m for m in registry['models']}
tiny={o['canonicalName']:o for o in models['yolox-tiny']['objects']};v3=models['objects-basira-v3']
percent=lambda x:'غير مقاس' if x is None else f'{100*x:.1f}%'
lines=['# معرفة بصيرة — مرجع الفئات للمرحلة التجريبية','',
    'هذه أرقام الاختبار المستقل المجمد السابق V3: 136 صورة و242 مرجعًا ضمن نطاق الوسوم. لم تُعَد الأوزان أو العتبات إلى الضبط في هذه الجولة. الأسماء الثمانون موروثة؛ لا تعني دقة مثبتة لكل فئة. 41 فئة لها أمثلة تدريب إضافي في V3 و32 فقط لها مرجع إيجابي في الاختبار.','',
    'V1 أعلى بفارق صغير في mAP على هذه العينة، لكنه يحتاج مراجعة حقوقه قبل أي تأهيل تجاري. Tiny هو المقارنة الأصلية العملية؛ V3 لم يتفوق عليه. V2 مشتق من BDD ومحلي بحثي فقط. لا نموذج مؤهل للملاحة أو الإنتاج.','',
    '| الاسم العربي | فئة COCO الفعلية | صور/أجسام تدريب V3 الإضافي | مراجع الاختبار | Tiny P / R / AP | V3 P / R / AP | فائت V3 |',
    '| --- | --- | ---: | ---: | --- | --- | ---: |']
for o in v3['objects']:
    t=tiny[o['canonicalName']]['independentFinal'];v=o['independentFinal'];training=o['additionalTraining']
    lines.append(f"| {o['arabicName']} | {o['canonicalName']} | {training['uniqueImages']}/{training['uniqueInstances']} | {v['referenceCount']} | {' / '.join(percent(t[k]) for k in ['precision','recall','ap'])} | {' / '.join(percent(v[k]) for k in ['precision','recall','ap'])} | {v['fn']} |")
lines+=['','غياب مرجع إيجابي يعني أن الاستدعاء وAP غير مثبتين، حتى إذا ظهر اسم الفئة في الأوزان. Precision عند وجود FP فقط قد يكون صفرًا؛ لا يُستبدل null بصفر عند عدم تعريف المقام. «طاولة» هي فئة dining table، ولا يثبت ذلك جميع أنواع الطاولات. لا يثبت اسم bottle وجود ماء.']
text='\n'.join(lines)+'\n';(root/'basira-knowledge-readiness.md').write_text(text,encoding='utf-8')
target=Path('ml/vision/OBJECT-KNOWLEDGE-READINESS.md');target.write_text(text,encoding='utf-8')
print(json.dumps(dict(classes=len(v3['objects']),newlyTrainedClasses=len(v3['furtherTrainedClasses']),evaluatedClasses=len(v3['evaluatedClasses']),output=str(target))))
