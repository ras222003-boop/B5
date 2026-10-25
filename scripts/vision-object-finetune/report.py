"""Generate the honest local/committable report from measured artifacts, never from target counts."""
from pathlib import Path
from collections import Counter
import json,sys
from common import read,sha
root=Path(sys.argv[1]).resolve()
final=read(root/'test-evaluation.json');validation=read(root/'validation-evaluation.json');audit=read(root/'data-audit.json')
prior=read(root/'previous-errors.json');choice=read(root/'training-choice.json');export=read(root/'training/onnx-report.json')
manifest=read(root/'manifest.json');runs=[read(root/c['directory']/'training-report.json') for c in choice['candidates']]
suite=read(root/'vitest.json');selected=choice['selected'];new=final['models']['objects-basira-v1'];old=final['models']['yolox-tiny']
def pct(x):return f'{100*x:.2f}%'
def breakdown(model):
    errors=model['operating']['0.5']['errors'];rows=[r for r in manifest['samples'] if r['split']=='test']
    gt=Counter(o['class'] for r in rows for o in r['objects']);miss=Counter(e['reference'] for e in errors if e['kind']=='miss');fp=Counter(e['prediction'] for e in errors if e['kind']=='false_positive')
    return {c:dict(reference=gt[c],tp=gt[c]-miss[c],fn=miss[c],fp=fp[c]) for c in sorted(set(gt)|set(fp))}
classes={name:breakdown(model) for name,model in final['models'].items()}
unrepresented=[name for name in ['car','traffic light','backpack','bicycle','couch'] if name not in classes['objects-basira-v1'] or classes['objects-basira-v1'][name]['reference']==0]
summary=dict(initialCheckpointSha256=runs[0]['initialWeightsSha256'],selected=selected,totalOptimizerSteps=choice['totalOptimizerSteps'],finalComparison={name:{k:model[k] for k in ['map','ap50','apSmall','latency','memory','groups']}|{'operating':{k:model['operating']['0.5'][k] for k in ['tp','fp','fn','precision','recall','f1']}} for name,model in final['models'].items()},perClass=classes,finalTargetClassesWithoutReference=unrepresented,improvementDemonstrated=False,remainingMissReasons=dict(Counter(e['reason'] for e in new['operating']['0.5']['errors'] if e['kind']=='miss')),actualTrainingImagesInSelectedCheckpoint=selected['checkpointTrainImages'],allRunTrainingImages=18,phoneTested=False,colourMaskEnabled=False)
(root/'comparison-analysis.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
lines=['# بصيرة: Fine-tuning الأشياء V1 — تجربة فعلية، دون تحسن مثبت','',
'القاعدة `codex/basira-object-quality-v2` / `4934908`؛ فرع العمل `codex/basira-object-finetune-v1`.',
'',
'نُفّذ تدريب حقيقي وحُفظت الأوزان وONNX وشُغّل داخل صفحة رؤية بصيرة القائمة. النتيجة السلبية مهمة: النسخة المدرّبة لم تتفوق على Tiny السابق في التحقق داخل المتصفح أو في الاختبار النهائي الجديد. أبقيت اختيارًا محليًا بحثيًا باسم «تحسن غير مثبت»، وبقي Lite0 افتراضيًا. لم يحدث نشر أو دمج أو تدريب سلالم أو تفعيل ملاحة بحثية.',
'',
'## البيانات الفعلية وحدود الاستقلال',
'',
'كان هدف الجلب 112 صورة. تحقق الجلب من CC BY 2.0 على صفحة Flickr الأصلية قبل تنزيل الصور من مصدر COCO الرسمي. توقّف بسبب HTTP 429؛ حُفظ سجل الجلب واحترمت إعادة المحاولة دون تجاوز التقييد. جُمّدت الصور الـ36 المقبولة فقط قبل تدريب/استدلال الفوج، مع حفظ الخطة الأصلية وتعديل موثق لأعداد التجربة المصغرة.',
'',
'| التقسيم | الصور | المربعات المرجعية |', '| --- | ---: | ---: |']
for split in ['train','validation','test']:
    a=audit['bySplit'][split];lines.append(f"| {split} | {a['images']} | {a['objects']} |")
lines += ['',
'كل صورة من مؤلف Flickr مستقل؛ استُبعدت صور ومؤلفو أفواج التقييم السابقة. اجتاز الفوج مقارنة بصمات الصور وdHash وفصل المجموعات. فصل المؤلفين لا يثبت اختلاف المواقع المادية. هذه عينة جديدة مقسمة محليًا من COCO val2017؛ قد يكون الناشر قد استخدم صور COCO العامة في تطوير النموذج، فلا ندعي استقلالًا عن كامل تاريخ تدريب الناشر.',
'',
'الوسوم هي فئات COCO الأصلية ومربعاتها، لا تنبؤات Tiny. تحقق تدقيق مستقل برمجيًا من تطابق category IDs والترتيب المتصل للفئات الثمانين والإحداثيات مع المصدر. لم تُخترع موافقات بشرية أو موافقات خصوصية. ترخيص الصور العام لا يعادل موافقة شخصية؛ تبقى الأصول محلية وفي نطاق البحث المصرح. لم تُستخدم بيانات اصطناعية في هذا التشغيل.',
'',
f"**قصور الاختبار:** لا توجد مراجع نهائية لفئات {', '.join(unrepresented)}. لا تثبت هذه الجولة علاج أخطاء السيارات وإشارات المرور والحقائب، ولا دعم فئات جديدة. تغطية الصغير والمتداخل محدودة جدًا؛ تحتاج بيانات إضافية بحقوق ومراجع مستقلة.",
'',
'## تحليل الأخطاء السابقة ومطابقة المرجع','',
'جميع صفوف الجدول التالي من اختبار Tiny السابق عند 0.5، للتشخيص فقط؛ لم تدخل صوره أو مصادره التدريب الجديد. أوصاف «دون العتبة/بلا اقتراح/تموضع» تصف المخرجات، ولا تثبت سببًا فيزيائيًا وحيدًا للفشل.',
'', '| الفئة | المرجع | TP | FN | FP |', '| --- | ---: | ---: | ---: | ---: |']
for name,c in prior['byClass'].items():lines.append(f"| {name} | {c['reference']} | {c['tp']} | {c['fn']} | {c['fp']} |")
lines += ['',
'الأولوية كانت الصغير والاحتجاب: 15 من أخطاء السيارات و13 من أخطاء إشارات المرور و17 من أخطاء الأشخاص لها ضلع أصغر من 16 بكسلًا عند حجم إدخال 320. هذه أحجام قياس تشخيصية، وليست عتبات أهلية. لم نجد تحويل فئات خاطئًا في مرجع COCO يفسرها. يحتفظ `previous-errors.json` بالأسباب والأجسام صورةً بصورة.',
'',
'## ما دُرّب فعليًا','',
f"الأوزان الابتدائية الرسمية YOLOX-Tiny 0.1.1rc0، Apache 2.0؛ SHA-256: `{runs[0]['initialWeightsSha256']}`. تحقق تطابق تهيئة PyTorch مع ONNX السابق على المدخل نفسه؛ أقصى فرق {export['officialCheckpointVersusPreviousOnnxMaxError']:.8f}.",
'',
'استخدمت بيئة Python الموجودة: PyTorch CPU 2.5.1، دون GPU أو خدمة سحابية. بقيت بنية 416×416 والفئات الثمانون. جُمّد backbone وثبتت إحصاءات BN، مع خسائر YOLOX الرسمية SimOTA وIoU وobjectness/class. استُخدمت معاينة متوازنة للصور وقص هندسي مشتق من المربعات لتكبير الصغير؛ لم تستخدم تنبؤات النموذج لإنتاج وسوم التدريب.',
'',
'| المحاولة | المعاملات القابلة للتدريب | LR | الحقب المنفذة | خطوات optimizer | قمة RSS MiB | توقف |',
'| --- | ---: | ---: | ---: | ---: | ---: | --- |']
for candidate,run in zip(choice['candidates'],runs):
    lines.append(f"| {candidate['directory']} | {run['trainedParameters']} | {run['learningRate']} | {run['epochs']} | {run['optimizerSteps']} | {run['peakRssMiB']:.1f} | {run['stopReason']} |")
lines += ['',
'المحاولة الأولى بدأت بـ8 صور وحقبتين، ثم توسعت إلى 18 صورة بعد تحسن طفيف في F1 التحقق الأصلي. تراجع التحقق بعد التوسع فتوقفت بعد ثلاث حقب دون مكسب. المحاولة الثانية عدّلت طبقات مخرجات التنبؤ فقط بمعدل تعلم أقل استجابةً لهذا الإفراط في التكيّف؛ لم تحسن F1 فلم تتوسع.',
'',
f"نُفذت إجمالًا {choice['totalOptimizerSteps']} خطوة backward/optimizer عبر {choice['totalEpochs']} حقب، لكن **checkpoint المختار من نهاية الحقبة {selected['checkpointEpoch']}، بعد {selected['checkpointOptimizerSteps']} خطوات وعلى {selected['checkpointTrainImages']} صور تدريب فقط**. لا ننسب إليه كل تدريب محاولة التوسع. بقيت جميع أوزان المحاولات وlast/checkpoint والمُحسّن والسجلات محفوظة. تحقق تغير 63 مصفوفة في الرأس وبقاء backbone دون تغير، ثم إعادة تحميل مستقلة واستدلال جديد.",
'',
f"زمن الحلقتين المقاس بعد استيراد المكتبات نحو {sum(r['wallSeconds'] for r in runs):.1f} ثانية جدارية، و{sum(r['cpuSeconds'] for r in runs):.1f} CPU ثانية. لا يشمل ذلك تنزيل البيانات أو بدء Python. الحدود: خيطا CPU، 1800 ثانية، RSS 4096 MiB، تخزين 2048 MiB. تُفحص الحدود أثناء التدريب. يوجد STOP/--resume لحفظ آخر checkpoint؛ لم يُنفذ اختبار إيقاف واستئناف حي في هذه الجولة، فلا يعد مؤهلًا بعد.",
'',
'## ONNX والاستدلال داخل بصيرة','',
f"الملف `training/basira_objects_v1.onnx`، {export['bytes']:,} بايت؛ SHA-256 `{export['modelSha256']}`. مدخل `images` من نوع float32 `[1,3,416,416]`، ومخرج `output` `[1,3549,85]`. المعالجة BGR 0–255، CHW وletterbox علوي أيسر بقيمة114؛ يفك محوّل بصيرة الشبكة ويضرب objectness في درجة الفئة دون معايرة.",
'',
f"نجح ONNX checker وONNX Runtime CPU على صورة تحقق فعلية، وأقصى فرق عن PyTorch {export['torchOnnxMaxAbsoluteError']:.8f}. فحص البنية لا يثبت جودة الكشف. توجد فروق بين تقييم PyTorch وتقييم المتصفح؛ الأول يستعمل إعادة تحجيم Pillow والثاني Canvas، ولا نعد درجتيهما متطابقتين لمجرد تطابق الأوزان. جدول المقارنة التالي كله من المتصفح بالمدخلات والمعالجة الفعلية ذاتها.",
'',
'أضيف `objects-basira-v1` إلى قائمة الأشياء المحلية القائمة بمسار أصول معزول وبصمات مستقلة ودليل تدريب/ONNX/اختبار مطلوب. يوجد رجوع مباشر إلى Tiny السابق وإلى Lite0. لا يدخل النموذج ObjectOnlyPipeline إلا للاستكشاف؛ بقيت مسارات V3 والتحذير والملاحة الأصلية مستقلة. أقنعة الألوان معطلة إجباريًا لهذا النموذج، واللون غير مثبت، ولا يقدم مربع الكشف كقناع جسم دقيق.',
'',
'## المقارنة النهائية المستقلة','',
f"{final['images']} صور / {final['objects']} جسمًا، قُفلت قبل التدريب، واستُخدمت مرة بعد قفل اختيار checkpoint والعتبة. لم تختَر نتائجها أي إعداد. المراجع خارج النموذج؛ TP يتطلب الفئة وIoU≥0.5. جميع الصفوف عند ثقة0.5 غير معايرة، وAP بواسطة pycocotools: IoU0.50:0.95 وmaxDets100. هذه عينة صغيرة، وليست نتيجة COCO القياسية.",
'',
'| النموذج | TP | FP | FN | Precision | Recall | mAP | AP صغير | وسيط/P95 ms | RSS بعد التحميل MiB |',
'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
for name in ['lite0','yolox-tiny','objects-basira-v1']:
    model=final['models'][name];op=model['operating']['0.5'];lat=model['latency']
    lines.append(f"| {name} | {op['tp']} | {op['fp']} | {op['fn']} | {pct(op['precision'])} | {pct(op['recall'])} | {pct(model['map'])} | {pct(model['apSmall'])} | {lat['medianMs']:.1f}/{lat['p95Ms']:.1f} | {model['memory']['after']['rssMiB']:.1f} |")
lines += ['',
'الأزمنة Chrome/Windows، WASM بخيط واحد بعد الإحماء، لا قياس iPhone. RSS عائلة عمليات المتصفح يشمل التطبيق وWASM وأداة القياس، وليس ذاكرة الأوزان وحدها. مجموع قمم العمليات ليس قمة متزامنة. النموذج المدرّب لم يحسن F1 أو mAP العام ولم يخفض FP؛ ارتفاع AP الصغير من23% إلى25% لا يكفي لإعلان تحسن على خمسة أمثلة أو عينة صغيرة.',
'', '| المشاهد النهائية | Lite0 TP/FP | Tiny TP/FP | V1 TP/FP |', '| --- | ---: | ---: | ---: |']
for group in ['simple','crowded']:
    line=f'| {group} |'
    for name in ['lite0','yolox-tiny','objects-basira-v1']:
        op=final['models'][name]['groups'][group]['0.5'];line+=f" {op['tp']}/{op['fp']} |"
    lines.append(line)
lines += ['', '| الفئة النهائية | المرجع | Tiny TP/FN/FP | V1 TP/FN/FP |', '| --- | ---: | ---: | ---: |']
for c in sorted(set(classes['yolox-tiny'])|set(classes['objects-basira-v1'])):
    a=classes['yolox-tiny'].get(c,dict(reference=0,tp=0,fn=0,fp=0));b=classes['objects-basira-v1'].get(c,dict(reference=0,tp=0,fn=0,fp=0))
    lines.append(f"| {c} | {max(a['reference'],b['reference'])} | {a['tp']}/{a['fn']}/{a['fp']} | {b['tp']}/{b['fn']}/{b['fp']} |")
lines += ['',
'تفاصيل الأجسام الفائتة والإنذارات والمربعات في `test-evaluation.json` و`comparison-analysis.json`. لا تعاد هذه الصور إلى التدريب؛ أي تجربة تطوير لاحقة تحتاج تحققًا جديدًا وقفل اختبار جديد.',
'',
'## الفيديو والهاتف والفحوص','',
'أعيد استخدام مقطعي CC0 الحقيقيين و26 لقطة من فوج الفيديو السابق، للتشخيص والتراجع فقط؛ ليسا اختبارًا نهائيًا جديدًا. رُبطت كل اللقطات بمعرّف المشهد نفسه. حزمة `video-reference-intake.json` تحفظ المراجع كـnull وبحالة PENDING، ولا تحول اللقطة غير الموسومة إلى صورة سلبية. تبقى دقة تبديل الهوية null حتى تتوفر هويات مرجعية مستقلة؛ لا تساوي كثرة/قلة المعرفات صحة التتبع.',
'',
f"نجحت {suite['numPassedTests']} حالة اختبار في {len(suite['testResults'])} ملفًا للرؤية وحدود الخادم، وفحص TypeScript. يحفظ اختبار المتصفح صورًا فعلية ونتائج الكاميرا البرمجية والإلغاء ورفض الأوزان المعدلة والرجوع وتشغيل Tiny وLite0، دون رفع وسائط أو صوت سلامة/اهتزاز. انظر أدلة المتصفح الفعلية؛ لا يثبت البناء أو الكاميرا البرمجية نجاح كاميرا مادية.",
'',
'قالب `iphone-trial.json` بحالة NOT_RUN وبصمة ONNX الحالية. لم يختبر iPhone أو Safari أو الحرارة أو كاميرا مادية. يتطلب الاختبار أصل HTTPS محليًا موثوقًا ووصولًا مصادقًا ومصرحًا؛ الخادم الحالي loopback وواجهة الأصول ترفض LAN. لا يُدعى تجاوز هذا العائق، ولا تعطّل Norton أو التحقق من الشهادات. سجّل التحميل وP50/P95 والإطارات والهوية والرجوع والإيقاف على الهاتف الفعلي.',
'',
'## الخطوة التالية المبنية على النتائج','',
'التوسع المبرر الآن في البيانات والتحقق، لا زيادة الحقب على الصور نفسها: جمع مصادر مرخصة إضافية بعد رفع تقييد المصدر، مع تغطية صريحة للسيارات والإشارات والحقائب والدراجات والأرائك، وزيادة الصغير والاحتجاب والسلبيات الصعبة. توفير جلسات ومواقع موثقة ومراجعة بشرية مستقلة للألوان وهويات الفيديو. اجمع تحققًا جديدًا كافيًا قبل اختيار رأس التدريب أو معدل التعلم، وطابق إعادة التحجيم بين التدريب والمتصفح أو قس أثر اختلافها. لا يبدأ تدريب مكلف ولا يُدعى حل ضعف Tiny بهذه الجولة.',
'',
'## الملفات وإعادة التشغيل','',
'الأوزان والحقوق والصور والسجلات خارج Git في `../.vision-test-fixtures/object-finetune-v1-001`؛ النسخة المحلية المعروضة في `.vision-ai/object-quality/finetuned`. يحتوي `training-choice.json` الاختيار الفعلي، و`training/best.pth` و`last.pth` و`weights-only.pth` وONNX المخرجات الفعلية؛ لم تُرفع هذه الأصول إلى GitHub.',
'',
'```powershell',
'./.metric-venv/Scripts/python.exe scripts/vision-object-finetune/check_data.py ../.vision-test-fixtures/object-finetune-v1-001',
'./.metric-venv/Scripts/python.exe scripts/vision-object-finetune/test_contracts.py',
'node scripts/vision-object-quality/browser-test.mjs http://127.0.0.1:4350 ../.vision-test-fixtures/new-browser-evidence objects-basira-v1',
'```','',
'لا تعد التدريب على فوج نهائي مفتوح أو تستبدل أقفاله. للبيانات الجديدة استخدم مجلدًا جديدًا وbootstrap/prepare_data ثم تجميد البروتوكول؛ freeze_available يتيح تجربة صغيرة فقط قبل أي تدريب إذا تعذر إكمال الجلب. `STOP` ثم `--resume` لا يتجاوز قفل الاختبار أو الأهلية. تثبت السجلات العمل الذي حدث، لا اعتمادًا بشريًا أو إنتاجيًا.',
'',
'المصادر: [YOLOX الرسمي وتدريب البيانات الخاصة](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/docs/train_custom_data.md)، [Apache2](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/LICENSE)، [شروط COCO](https://github.com/cocodataset/cocodataset.github.io/blob/master/dataset/termsofuse.htm). تحفظ إسنادات Flickr وروابط CC BY2 مع كل صورة، ومصادر CC0 مع الفيديو الأصلي.',
'']
lines += ['## أدلة تنفيذ إضافية','',
'الاختبار يضم تسعة مشاهد مستقلة بالمصدر، وليس 87 تجربة مستقلة إحصائيًا. لا ندعي دلالة إحصائية لفارق جسم واحد أو للتحسن المحدود في AP الصغير. أمثلة المربعات المرجعية والتوقعات في `examples/final-contact-sheet.jpg` داخل مجلد الأدلة، مع الإسناد والحقوق.','']
motion=read(root/'motion-comparison.json')
lines += ['| النموذج/الفيديو | ملاحظات | معرفات آلية | التباس | نصوص صوتية | تكرار نص مطابق |', '| --- | ---: | ---: | ---: | ---: | ---: |']
for item in motion['results']:
    s=item['summary'];lines.append(f"| {s['model']}/{s['clip']} | {s['observations']} | {s['uniqueIds']} | {s['ambiguous']} | {s['speech']} | {s['repeatedExactSpeech']} |")
lines += ['', 'نتائج الفيديو وصفية ومتطابقة عدديًا بين Tiny وV1 في هذه الجولة؛ لا تثبت صحة الهوية دون المرجع المستقل. امتنع اللون في جميع ملاحظات المقطعين.','']
diagnostic=read(root/'preprocess-diagnostic.json')
lines += [f"قياس بكسلات على صورة تحقق واحدة: متوسط الفرق المطلق بين Pillow وCanvas {diagnostic['meanAbsoluteInputPixelDifference']:.3f}/255، والحد الأقصى {diagnostic['maxAbsoluteInputPixelDifference']:.0f}، ونسبة القنوات المختلفة {pct(diagnostic['fractionInputChannelsChanged'])}. أثره على objectness بلغ حتى {diagnostic['maxObjectnessDifference']:.3f}. هذا دليل اختلاف عددي فعلي، وليس إثباتًا أنه السبب الوحيد لتراجع الجودة؛ لم تتغير الإعدادات أو الأوزان بعد قياس الاختبار النهائي.", '']
build=read(root/'build-check.json')
lines += [f"بناء الواجهة: {build['client']}؛ الخادم: {build['server']}. بقي تحذير حجم الحزم. نجحت أيضًا أربعة اختبارات Python، منها منع بدء التدريب على فوج مقفل للتقييم. V3 اجتاز اختبار ONNX الفعلي للصور والفيديو والكاميرا البرمجية في `../object-finetune-v1-stairs-regression-001/browser-validation.json`، دون نطق أو اهتزاز بحثي، مع بقاء بصمته دون تغيير. هذه فحوص مساحة العمل، مع تغييرات Studio السابقة محفوظة خارج نطاق حفظ هذه المهمة.",'']
text='\n'.join(lines)
text=text.replace('على خمسة أمثلة أو عينة صغيرة','على هذه العينة الصغيرة')
text=text.replace('قمة RSS MiB','أعلى RSS مرصودة MiB').replace('RSS بعد التحميل MiB','RSS بعد الاستدلال MiB')
text=text.replace('تُفحص الحدود أثناء التدريب.','تُفحص الحدود بين خطوات التدريب؛ RSS أعلى عينة مرصودة وليست قمة OS مستمرة أو حجز ذاكرة صلبًا.')
text=text.replace('جميع الصفوف عند ثقة0.5 غير معايرة،','Lite0 بحد100 نتيجة للمقارنة؛ لم تتغير إعدادات واجهته الأصلية. جميع الصفوف عند ثقة0.5 غير معايرة،')
text=text.replace('## تحليل الأخطاء السابقة ومطابقة المرجع','لا يتضمن هذا الفوج مشاهد خالية موثقة من الأجسام المستهدفة. FP هنا توقعات غير مطابقة داخل الصور الموجبة، وليست معدل إنذارات على ساعات كاميرا أو اختبار سلبيات مستقل.\n\n## تحليل الأخطاء السابقة ومطابقة المرجع')
(root/'REPORT.md').write_text(text,encoding='utf-8')
Path('ml/vision/OBJECT-FINETUNE-V1.md').write_text(text,encoding='utf-8')
print(json.dumps(dict(report='ml/vision/OBJECT-FINETUNE-V1.md',models=list(summary['finalComparison']),improvementDemonstrated=False)))
