# المرحلة الثانية: إضافة البيانات وأول تجربة تدريب

لا توجد حاليًا بيانات تدريب معتمدة أو GPU جاهز أو نموذج مخصص مدرب. هذا المسار يوسع أدوات المرحلة الأولى ويحافظ على محركات بصيرة. تدريب SSDLite مخصص لصناديق الأشياء والعوائق الأرضية؛ وسوم الأسطح والحركة والمسافة تجهيز للمراحل اللاحقة، ولا تعني تدريب هذه القدرات.

## التخزين الخاص

أُنشئ `Basira-Vision-Datasets` داخل Documents، خارج جميع مستودعات Git. بنيته:

```text
Basira-Vision-Datasets/
  storage.json                     # حالة التخزين، لا يحتوي مفاتيح
  bundle-inventory.template.json   # قالب فارغ غير معتمد
  images/ videos/ labels/ distances/ rights/
  collections/<bundle-id>/         # النسخة المستوردة وmanifest بجوار الملفات
  splits/train/ validation/ test/  # فهارس خاصة، دون نسخ إطارات عشوائية
  exports/ runs/ registry/         # exports المقفلة، checkpoints والنتائج
```

مراجعة ACL وتشفير القرص والنسخة الاحتياطية الخاصة مطلوبة؛ `storage.json` يسجلها pending ولا يدعي توفير تشفير. لا تضع المجلد في مشاركة عامة. لم تُجهز أو تُستخدم خدمة cloud. عند الانتقال إلى [GCS](https://docs.cloud.google.com/storage/docs/public-access-prevention) فعّل Public Access Prevention وIAM محدودًا. وفي [R2](https://developers.cloudflare.com/r2/buckets/public-buckets/) أبقِ r2.dev وCustom Domains العامة معطلة. بيانات الاعتماد خارج مجلد البيانات، مع سياسة احتفاظ وحذف.

من جذر المستودع بعد تثبيت اعتماديات Node بقفل المشروع:

```powershell
$datasets = Join-Path $env:USERPROFILE 'Documents/Basira-Vision-Datasets'
# على جهاز جديد فقط؛ يرفض المجلد الموجود أو الواقع داخل Git:
node scripts/vision-ai/cli.mjs storage-init $datasets
```

## إضافة الصور والفيديوهات

1. ضع صور الفريق أو المجموعة المرخصة في `images/` والفيديوهات في `videos/`، وأدلة حقوق التدريب في `rights/`. لا تستخدم صور المستخدمين أو تسجيلاتهم.
2. انسخ القالب الفارغ إلى `bundle-inventory.json`. عرّف المصدر `basira_team|licensed_dataset` مع origin والترخيص. لكل ملف سجل `path,kind,sourceId,originalId,origin`. الأنواع `image,video,labels,distance,rights` تقابل المجلدات المذكورة. استخدم مرجعًا دائمًا في origin، لا رابطًا موقّعًا أو مفتاحًا.
3. أضف كل صورة/إطار إلى samples، مع sourceId وleakageGroup ثابت للمكان/الجلسة وكل المقاطع المترابطة. SHA يكشف تطابق البايتات فقط؛ الصور المتشابهة أو المعاد ترميزها تحتاج مراجعة بشرية وربطها بالمجموعة نفسها.
4. أدرج ملف الحقوق نفسه في files. أداة bundle-draft تحسب البصمات وتعيد الحقوق إلى pending؛ المراجع البشري يعتمد الحقوق لاحقًا.

مثال عنصر files وعنصر samples، وليسا بيانات فعلية:

```json
{
  "file": {"path":"images/frame-001.png","kind":"image","sourceId":"team-001","originalId":"session-001-frame-001","origin":"Basira controlled capture session 001"},
  "sample": {"id":"frame-001","path":"images/frame-001.png","sourceId":"team-001","leakageGroup":"site-001-session-001","split":null,
    "media":{"kind":"image"},"conditions":{"lighting":"indoor","scene":"indoor","motion":"static"},"hardNegatives":[]}
}
```

القالب الفعلي يحتوي مصفوفتَي `files` و`samples`. لإضافة بيانات موسومة: أدرج COCO كملف labels واضبط `cocoPath`. أسماء الفئات يجب أن تطابق مفاتيح taxonomy، وCOCO يغطي كل الصور بأبعادها الصحيحة؛ الفئات المجهولة وcrowd/ignore مرفوضة. لا يوجد استيراد CVAT XML مباشر.

```powershell
node scripts/vision-ai/cli.mjs bundle-draft "$datasets/bundle-inventory.json" $datasets "$datasets/bundle.pending.json"
# المراجع يحفظ bundle.approved.json بعد مراجعة source.trainingAllowed=true،
# rightsReview.status=approved وreviewer وat وevidence الحقيقي.
node scripts/vision-ai/cli.mjs import-bundle "$datasets/bundle.approved.json" $datasets $datasets
$collection = "$datasets/collections/basira-pilot-001"
node scripts/vision-ai/cli.mjs spatial-draft "$collection/dataset.draft.json" "$collection/dataset.spatial-draft.json"
```

الاستيراد يفحص البصمات والمصدر لكل ملف، ويمنع تكرار الوسائط داخل الحزمة وبين collections، ويحتفظ بـprovenance. لا يعتمد الخصوصية أو الوسوم. المجموعة الجزئية عند فشل النسخ تبقى للفحص، ولا تصبح بيانات معتمدة. لا يكتب فوق ملفات موجودة. لإصدار مصحح راجع سبب الفشل وأعد التجهيز باسم جديد؛ لا تعاود خلط test داخل train.

استخدم annotation-pack وimport-coco من المرحلة الأولى. نظّف EXIF/XMP/IPTC واطمس الوجوه واللوحات والنص الشخصي قبل الاعتماد، وأعد حساب SHA والمراجعة إذا تغير الملف. يجب مراجعة الصور السلبية بالكامل؛ غياب الوسم لا يعني غياب الأجسام.

الفيديو يحتاج FFmpeg وffprobe محليين. ملف `video-record.json` يحتوي source معتمدًا، و`video:{id,path,sha256}` وleakageGroup وconditions وstride:

```powershell
node scripts/vision-ai/cli.mjs extract-frames "$datasets/video-record.json" $datasets images/clip-001 "$datasets/clip-001.inventory.json"
```

أدرج الصور الناتجة وأصل الفيديو في فهرس الحزمة. تحفظ الأداة presentation timestamps الأصلية ولا تفترض FPS ثابتًا. استخدم track_id ثابتًا في COCO. يجب أن يتضمن `media.video.privacy` مراجعة الأصل: status=approved وreviewer وat وmetadataStripped=true وfaces/plates/personalText/voices بقيمة absent أو redacted. مراجعة إطار لا تثبت خصوصية الصوت. جميع إطارات الفيديو الواحد والجلسات المترابطة تبقى في split واحد.

## المسافة والاتجاه والحركة

لكل جسم spatial مستقل عن حجم الصندوق وثقة الكشف. مثال قياس **توضيحي فقط**:

```json
{
  "distance": {"status":"measured","meters":1.5,"uncertaintyMeters":0.05,"method":"laser",
    "reference":"camera-optical-center-to-nearest-visible-object-surface",
    "operator":"measurement-review-id","instrumentId":"instrument-internal-id",
    "measuredAt":"2026-10-14T08:00:00Z","capturedAt":"2026-10-14T08:00:00Z",
    "validity":"valid_at_capture","validForMs":100,
    "evidence":{"path":"distances/session-measurements.json","sha256":"REPLACE_WITH_SHA256"},
    "videoTimestampMs":1000,"syncErrorMs":10},
  "proximity":"near",
  "direction":{"reference":"camera","sector":"center","facing":"side_on"}
}
```

المرجع من مركز الكاميرا البصري لأقرب سطح ظاهر **يمكن قياسه**، وليس مركز الجسم أو أقرب جزء مخفي. سجل خطأ الأداة وموضعها والتزامن في uncertaintyMeters. الطرق tape/laser/calibrated_depth؛ الأخيرة تحتاج calibrationEvidence:{path,sha256}. الفيديو يحتاج خطأ تزامن ≤50ms. صلاحية 0–800ms حد تجريبي، لا إثبات أن الجسم بقي ساكنًا. يجب أن يقع القياس داخل نافذة صلاحية الالتقاط.

sector = left/center/right/unknown بالنسبة للصورة؛ ليس اتجاه حركة المستخدم. facing = toward_camera/away_from_camera/side_on/unknown لاتجاه الجسم. اجعله unknown عند غياب الدليل.

عند غياب القياس: `distance:{status:"uncertain",reason:"not_measured"}` دون رقم؛ الأسباب الأخرى occluded/calibration_missing/out_of_range/unsynchronized. proximity تصبح distance_uncertain. الحدود التي اعتمدها المستخدم تجريبيًا:

| الرمز | المجال |
|---|---|
| very_near | أقل من 1م |
| near | 1 إلى أقل من 2م |
| medium | 2 إلى أقل من 3.5م |
| far | 3.5 إلى أقل من 5م |
| very_far | 5م فأكثر |
| distance_uncertain | غياب الدليل أو امتداد مجال الخطأ عبر حد فئتين |

ملامسة الحد الأعلى لفئة أخرى تُعامل تحفظيًا كعدم يقين إن كان الطرف الأدنى في الفئة السابقة. far/very_far لا يعنيان «آمن». تغيير الحدود يحتاج إصدار سياسة ومراجعة وتقييم جديدًا؛ بصمة السياسة مربوطة بموافقة التدريب.

motionSegments في manifest يربط videoSha256 وtrackId وstartMs/endMs. الحقول:

- relativeMotion: approaching/receding/lateral_left/lateral_right/stationary/uncertain.
- cameraMotion: stationary/translation/rotation/zoom/mixed/unknown.
- objectRotation: rotation/none/unknown.
- evidence:{path,sha256} وreview:{status:"reviewed",annotator,reviewer,at} بمراجع مختلف.

وجود track في إطارَي البداية والنهاية إلزامي. الاقتراب والابتعاد يحتاجان قياسين متزامنين لا تتداخل مجالات خطئهما. الزوم وحده لا ينشئ اقترابًا؛ يمكن أن يصاحبه اقتراب حقيقي موثق بالقياس. الحركة الجانبية والدوران يحتاجان مراجعة المقطع، لا انجراف الصندوق فقط. الوسم نسبي للكاميرا ولا يحدد وحده من تحرك في العالم.

## تجميد البيانات

راجع الحقوق والخصوصية وكل الصناديق والسلبيات. annotation.status=reviewed، annotator/reviewer مختلفان، exhaustive=true. احفظ dataset.reviewed.json بجوار الوسائط، وكل split=null، ثم:

```powershell
node scripts/vision-ai/cli.mjs split "$collection/dataset.reviewed.json" "$collection/dataset.frozen.json" 20261014
node scripts/vision-ai/cli.mjs validate "$collection/dataset.frozen.json"
node scripts/vision-ai/cli.mjs data-needs "$datasets/needs-current.json" "$collection/dataset.frozen.json"
node scripts/vision-ai/cli.mjs export "$collection/dataset.frozen.json" "$datasets/exports/pilot-001"
```

70/15/15 نسب مجموعات مستقلة وليست إطارات؛ النسب الفعلية قد تختلف. راجع تغطية الفئات والجلسات قبل تجميد الإصدار، واجمع جلسات جديدة لتغطية النقص بدل نقل الاختبار إلى التدريب. قائمة الاحتياجات لكل [35 فئة وسطح](../../docs/vision-ai-data-requirements.json) أهداف تخطيطية لا دليل دقة. ابدأ بنطاق تجريبي 5–8 فئات إن لزم، ووثق أن البقية غير مدربة. عدد annotations لا يساوي عدد الصور. اجمع تنوع الإضاءة والحركة والحجب والحجم وسلبيات صعبة، في تصوير منظم لا يعرض المشاركين للخطر.

## GPU وأول تدريب حقيقي

المرشح SSDLite320 MobileNetV3 Large من checkpoint COCO محلي معتمد؛ يُنقل backbone/regression ويستبدل رأس التصنيف. مدخل 320×320 وتصدير ONNX opset17 إلى ONNX Runtime Web. تفوقه على EfficientDet الحالي غير مثبت. مرجع [Torchvision 0.22](https://docs.pytorch.org/vision/0.22/models/generated/torchvision.models.detection.ssdlite320_mobilenet_v3_large.html).

**تقدير تخطيط لم يُقَس:** GPU NVIDIA بذاكرة 12–16GB مفضل، 8GB قد تكفي مع batch2 بعد تعديل الإعدادات واعتمادها؛ RAM32GB، نحو 8vCPU، SSD خاص 200GB مع احتياطي. ابدأ بجلسة مستأجرة قصيرة بعد اعتماد البيانات لقياس الزمن وpeak VRAM قبل الالتزام بموارد أكبر.

10,000 صورة×5 epochs÷batch4 = نحو12,500 خطوة. افتراض 0.1–0.5 ثانية/خطوة يعطي21–104 دقائق للتحديثات فقط؛ مع التهيئة والتحقق وفك الصور، خصص مبدئيًا2–6 ساعات GPU للمحاولة الأولى دون ضمان. الصور10,000×1–3MB ≈10–30GB، والفيديو10ساعات×8Mbps ≈36GB. الأصل والنسخة المنقحة والإطارات والسجلات قد تحتاج150–250GB ونسخة احتياطية منفصلة. الأرقام افتراضات موارد وليست benchmark.

بيئة جديدة Python3.11. أبقينا إصدارات المرحلة الأولى، وفق [أوامر PyTorch الرسمية](https://pytorch.org/get-started/previous-versions/). يلزم driver يناسب CUDA12.6:

```powershell
py -3.11 -m venv .vision-ai-venv
$python = '.vision-ai-venv/Scripts/python.exe'
& $python -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu126
& $python -m pip install -r ml/vision/requirements-training.txt
& $python scripts/vision-ai/train.py gpu-check --output "$datasets/runs/gpu-check.json"
```

على Linux: `python3.11 -m venv .vision-ai-venv` ثم `source .vision-ai-venv/bin/activate`، واستخدم python ومسارًا مثل `/data/Basira-Vision-Datasets`. نفس المستودع والـcommit وملفات القفل تعمل محليًا أو على خادم GPU؛ لا اعتماد على مزود cloud. لم يُختبر CUDA هنا؛ البيئة المكتشفة CPU بإصدارات أقدم.

جهز checkpoint الرسمي محليًا بعد مراجعة الترخيص في `$datasets/pretrained/`. descriptor يحتاج path/sha256/architecture/reviewStatus=approved/reviewer/license/trainingAllowed=true/sourceUrl/rightsEvidence/rightsSha256؛ المسارات بالنسبة لمجلده، كما في دليل المرحلة الأولى. لا يوجد تنزيل تلقائي ولا موافقة تلقائية.

بعد وجود بيانات وأوزان معتمدة فقط:

```powershell
$manifest = "$collection/dataset.frozen.json"
$export = "$datasets/exports/pilot-001"
$pretrained = "$datasets/pretrained/approved-checkpoint.json"
& $python scripts/vision-ai/train.py approval-template --manifest $manifest --data-root $collection --export $export --pretrained $pretrained --output "$datasets/runs/approval.pending.json"
# مراجع البيانات ومراجع التدريب المختلفان يعتمدان الخطة بشريًا:
# status=approved، reviewer/dataReviewer، at بتوقيت ISO، testSetSealed=true.
# احفظ نسخة approval.approved.json؛ لا تغيّر binding ولا تتجاوز المراجعة.
$approval = "$datasets/runs/approval.approved.json"
& $python scripts/vision-ai/train.py train --manifest $manifest --data-root $collection --export $export --pretrained $pretrained --approval $approval --output "$datasets/runs/pilot-001" --device cuda --preflight-only
& $python scripts/vision-ai/train.py train --manifest $manifest --data-root $collection --export $export --pretrained $pretrained --approval $approval --output "$datasets/runs/pilot-001" --device cuda
```

preflight-only لا يستورد ML ولا يدرب؛ gpu-check منفصل. الموافقة مربوطة ببصمات البيانات وexport والإعدادات والأوزان والتصنيف وسياسة القرب. ليست توقيعًا رقميًا، ولا تثبت صحة إقرار المراجع. أي تغيير يحتاج اعتمادًا جديدًا. غياب CUDA يرفض الطلب دون التحول إلى CPU.

السجلات JSON محلية: البداية والبيئة، خسارة ووقت كل epoch وpeak CUDA memory وبصمة checkpoint، تنبؤات validation، training-run النهائي أو run-failure. checkpoints للتشخيص؛ لا يوجد استئناف optimizer تلقائي. epochs ثابتة ولا يستخدم test لاختيارها. خسارة التدريب لا تثبت تحسن الدقة.

## التقييم وأولوية التنبيهات

بعد التدريب، قارن المرشح والنموذج الحالي على اختبار مستقل بنفس الجهاز والبروتوكول:

```powershell
& $python scripts/vision-ai/train.py export --run "$datasets/runs/pilot-001" --output "$datasets/runs/pilot-001-onnx"
node scripts/vision-ai/benchmark.mjs $manifest test baseline "$datasets/runs/baseline-test.json"
node scripts/vision-ai/benchmark.mjs $manifest test candidate "$datasets/runs/candidate-test.json" "$datasets/runs/pilot-001-onnx"
node scripts/vision-ai/cli.mjs evaluate $manifest "$datasets/runs/baseline-test.json" "$datasets/runs/baseline-report.json"
node scripts/vision-ai/cli.mjs evaluate $manifest "$datasets/runs/candidate-test.json" "$datasets/runs/candidate-report.json"
node scripts/vision-ai/cli.mjs compare "$datasets/runs/baseline-report.json" "$datasets/runs/candidate-report.json" "$datasets/runs/comparison.json"
```

للقرب: `proximity-evaluate <manifest> <run> <report>`. run يحتوي datasetSha256/policyVersion/split=test/modelVersion، وcalibration:{reviewStatus:approved,reviewer,datasetSha256,calibrationPath,calibrationSha256,errorValidationPath,errorValidationSha256}. المعايرة على dataset آخر؛ الأدلة ملفات ذات SHA يراجعها البشر. كل observation يحتوي sampleId/objectId/evaluatedAtMs/estimate؛ estimate=null للغياب. التقدير: source=depth_sensor|calibrated_model، status=valid، meters/uncertaintyMeters/capturedAtMs/validForMs/calibrationSha256/errorValidationSha256. لا يدعم تقدير المسافة من الصندوق أو ثقة الكشف.

يحتاج calibration أيضًا `rangeMeters:[min,max]`، ويحتاج كل estimate نفس المجال في `calibrationRangeMeters`. إذا خرج مجال التقدير مع هامش الخطأ عن نطاق المعايرة تصبح المسافة غير مؤكدة.

التقرير يحسب coverage وMAE للحالات المقارنة ومصفوفة الفئات والدقة مع احتساب الامتناع واليقين مقابل مرجع غير مؤكد. مطابقة object ID يدوية لعزل الخطأ المتري؛ ليست دقة كشف ومسافة من طرف إلى طرف. SHA يثبت هوية دليل المعايرة لا صحته؛ فصل الجلسات ومراجعة الخطأ حسب المجال والجهاز إلزاميان.

`priority <observations.json> <now-ms> <report>` تجربة ترتيب فقط. الملاحظة: id/classId/confidence/observedAtMs/spatial.direction.sector، وmetricEstimate بالعقد السابق أو null، وrelativeMotion مع motionEvidenceVerified فقط بعد مراجعة الدليل. الأوزان: نوع العائق60 للأرضي/المتدلي،40 للمركبات،10 لغيرها؛ اتجاه الصورة5–15؛ اقتراب موثق25؛ القرب5–50 وعدم اليقين30؛ الثقة0–10؛ الحداثة0–10. تُستبعد البيانات الأقدم من800ms أو المستقبلية مع سبب مسجل. الثقة ليست احتمال اصطدام، ولا تعني المسافة البعيدة السلامة.

الاتجاه الفعلي للمستخدم غير معلوم، ولا توجد تعليمات سير آمن أو صوت مفعّل أو تبديل للنموذج من هذا المسار. يلزم خطأ معايرة مقاس، FPS وتتبع وجوال فعلي ومراجعة مختص تنقل واختبارات مستقلة وموافقة منفصلة على النشر. مصادر العمق المستقبلية تستطيع استخدام العقد نفسه، لكن الدقة المترية لم تُثبت هنا.

خطة نقل لاحقة دون رفع:

```powershell
node scripts/vision-ai/cli.mjs transfer-plan $datasets gcs basira-private-datasets "$datasets/transfer-gcs.json"
node scripts/vision-ai/cli.mjs transfer-plan $datasets r2 basira-private-datasets "$datasets/transfer-r2.json"
```

الخطة تسجل مفاتيح نسبية وحجمًا وSHA لكل ملف؛ ليست نسخة احتياطية ولا إثبات صلاحيات cloud. ينفذ المسؤول النقل عبر الأدوات الرسمية إلى bucket خاص ويتحقق من SHA بعد الاسترجاع. لا تضع الوسائط أو الحقوق أو الموافقات في PR. قبل رفع الكود: `node scripts/vision-ai/publication-audit.mjs f4ca091`.
