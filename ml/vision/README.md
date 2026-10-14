# Basira Vision AI — مختبر المرحلة الأولى

هذا المسار مستقل عن تطبيق بصيرة. لا يضيف جمع صور مستخدمين أو رفعها أو التعلم منها، ولا يبدّل محركات الإنتاج. البيانات المقبولة: تصوير فريق بصيرة المصرح به أو مجموعة بيانات ذات حقوق تدريب موثقة. لا يكفي أن تكون الصورة متاحة على الإنترنت.

**لا توجد مجموعة تدريب حقيقية مرفقة ولا نموذج مخصص مدرّب.** ملفات الاختبار الاصطناعية تثبت سلوك الأدوات فقط. تقرير التنفيذ: [المرحلة الأولى](../../docs/vision-ai-phase1-report.md).

## خريطة الأدوات

| المسار | الوظيفة |
| --- | --- |
| `taxonomy.v1.json` | 31 فئة أجسام/عوائق + 4 فئات أسطح، أسماء عربية، دعم النموذج القديم، ربط محافظ بالأنواع الحالية |
| `../../scripts/vision-ai/cli.mjs` | التجهيز، التحقق، التقسيم، تبادل COCO، التقييم، سجل النماذج |
| `../../scripts/vision-ai/extract-frames.mjs` | استخراج إطارات فريق/مصدر مرخص مع أوقات العرض الفعلية بواسطة FFmpeg |
| `../../scripts/vision-ai/train.py` | تدريب SSDLite320 MobileNetV3 بنقل التعلم، وتصدير ONNX مع فحص تطابق CPU |
| `../../scripts/vision-ai/benchmark.mjs` | إعادة تشغيل نفس الصور على الكاشف الحالي أو مرشح ONNX داخل Chrome محلي معزول |
| `../../scripts/vision-ai/evaluation.mjs` | مقارنة قابلة للتكرار، إعادة استخدام مقاييس المشروع، وبوابة متطلبات الهاتف |
| `../../scripts/vision-ai/registry.mjs` | إصدارات مختبر غير قابلة للاستبدال، SHA-256، سجل الاختيار والرجوع |

## البدء دون بيانات

من جذر المستودع، Node 24 و`pnpm install --frozen-lockfile`:

```powershell
node scripts/vision-ai/cli.mjs help
node scripts/vision-ai/cli.mjs init .vision-ai/team-dataset
pnpm test:vision-ai
python -m unittest discover -s scripts/vision-ai -p 'test_*.py'
```

الأمر `init` ينشئ مخزونًا فارغًا وحالة حقوق `pending`، ولا يوهم بوجود بيانات. إن كان المجلد موجودًا بالفعل، افتح `inventory.json` فيه بدل تشغيل `init` ثانية. جميع أوامر كتابة الأدلة ترفض استبدال الملفات الموجودة؛ اختر اسم مراجعة جديدًا. خزّن البيانات والحقوق والنماذج في `.vision-ai/` المستثنى من Git؛ لا تضعها في `client/public` أو ملفات تتبع الإنتاج. لا تُرفع البيانات إلى أدوات توسيم مستضافة تلقائيًا.

## عقد البيانات والتوسيم

تخطيط مجلد البيانات:

```text
.vision-ai/team-dataset/
  inventory.json           # مصادر وملفات قبل التوسيم
  dataset.draft.json       # SHA-256 وأبعاد وحالة مراجعة pending
  dataset.reviewed.json    # توسيم ومراجعات بشرية
  dataset.v1.json          # تقسيم مجمد
  media/                  # JPEG/PNG/WebP منزوعة البيانات التعريفية
  videos/                 # الأصول المصرح بها، لا فيديو مستخدم
  rights/                 # إثبات الإذن/الترخيص، محلي محدود الوصول
```

عنصر `sources` في inventory (القيم الفارغة مقصودة ولا تجتاز الفحص):

```json
{
  "id": "team-001", "kind": "basira_team", "origin": "",
  "license": "", "trainingAllowed": false, "containsUserData": false,
  "rightsReview": {
    "status": "pending", "reviewer": "", "at": "",
    "evidence": {"path": "rights/permission.txt", "sha256": ""}
  }
}
```

`kind` يقبل `basira_team` أو `licensed_dataset` فقط. يسجل مسؤول البيانات المصدر والإصدار والمالك ونطاق الإذن والتدريب والاستخدام التجاري وإعادة التوزيع/اشتقاق الأوزان والتزامات النسب والاحتفاظ/الحذف داخل ملف الحقوق. يُحسب SHA-256 بعد اعتماد الوثيقة. ثم تُملأ المراجعة باسم/معرف مراجع وتاريخ ISO، وتصبح `approved` و`trainingAllowed:true`. الأداة تتحقق من وجود الإثبات وثباته، ولا تستطيع إثبات صحة الإقرار أو منح ترخيص قانوني.

عنصر `samples` في inventory:

```json
{
  "id": "site-a-001", "path": "media/frame-001.png", "sourceId": "team-001",
  "leakageGroup": "site-a-route-a",
  "media": {"kind": "image"},
  "conditions": {"lighting": "indoor", "scene": "indoor", "motion": "static"},
  "hardNegatives": ["shadow"]
}
```

يجب أن تشترك صور الموقع/المسار نفسه والجلسات المتشابهة والنسخ المشتقة في `leakageGroup` واحد. لا تقسّم فيديو أو قصاصاته على مجموعات مختلفة. تجمع الأداة تلقائيًا المجموعات المرتبطة ببصمة الفيديو، وتمنع الصور المتطابقة بالبصمة. كشف القصاصات وإعادة الترميز والمشاهد شبه المتطابقة **ما زال يحتاج مراجعة بشرية**؛ البصمة وحدها لا تكشفها. لا تقطع الفيديو إلى مجموعات مختلفة بتغيير معرفه.

```powershell
node scripts/vision-ai/cli.mjs draft .vision-ai/team-dataset/inventory.json .vision-ai/team-dataset .vision-ai/team-dataset/dataset.draft.json
node scripts/vision-ai/cli.mjs annotation-pack .vision-ai/team-dataset/dataset.draft.json .vision-ai/labels-template.coco.json
```

يحسب `draft` أبعاد الصور وبصماتها ويهيئ حقول المراجعة. قالب COCO فارغ **للتوسيم**؛ الفراغ فيه لا يثبت صورة سالبة. استخدم أداة توسيم محلية مثل CVAT/Label Studio، أو حرر الصناديق في JSON. طابق `file_name` مع `path` واسم الفئة مع `key` في التصنيف دون إعادة ترقيم يدوية للهوية الأساسية. دعم COCO هنا للصناديق فقط؛ لا تحويل صامت للأقنعة أو crowd/ignore. يرفض المستورد crowd/ignore ويتطلب جميع الصور حتى الصور السالبة.

```powershell
node scripts/vision-ai/cli.mjs import-coco .vision-ai/team-dataset/dataset.draft.json .vision-ai/labels-complete.coco.json .vision-ai/team-dataset/dataset.imported.json
```

الاستيراد يعيد حالة الوسوم إلى `pending`، ولا يمنح اعتمادًا آليًا. يجب مراجعة `occluded` و`truncated` و`groundContact` بعد الاستيراد؛ قيمها الأولية ليست إقرارًا بصحتها. بعد المراجعة احفظ نسخة `dataset.reviewed.json` مع:

```json
{
  "privacy": {
    "status": "approved", "reviewer": "privacy-reviewer-id", "at": "2026-10-14",
    "faces": "redacted", "plates": "absent", "personalText": "redacted", "metadataStripped": true
  },
  "annotation": {
    "status": "reviewed", "annotator": "annotator-id", "reviewer": "different-reviewer-id", "exhaustive": true,
    "objects": [{
      "id": "object-1", "classId": 2, "box": [0.1, 0.2, 0.3, 0.4],
      "trackId": null, "occluded": false, "truncated": false, "groundContact": "unknown"
    }],
    "surfaces": [{"classId": 101, "points": [[0, 0.6], [1, 0.6], [1, 1], [0, 1]]}]
  }
}
```

الصناديق `x,y,width,height` مطبعة إلى `[0,1]`، لا أمتار. `objects:[]` مسموح بعد مراجعة مستقلة وشاملة فقط. الشخص الذي يوسم لا يراجع الوسم نفسه. المضلع اختياري للسطح؛ يُحفظ في manifest ولا يدخل تدريب كاشف الصناديق. تحقق المضلع هندسي أولي فقط؛ يلزم فحص ذاتية التقاطع والحواف والتغطية بصريًا. لا تُعد هذه الأدوات تدريبًا أو تقييمًا جديدًا لـSegFormer.

`lighting`: daylight/indoor/low_light/mixed؛ `scene`: indoor/outdoor؛ `motion`: static/moving. `groundContact`: yes/no/unknown بحسب الدليل المرئي فقط. لا تستنتج ارتفاع جسم أو عمق حفرة أو قابلية مرور من الصندوق. لا تجمع إحداثيات موقع دقيقة أو أسماء أشخاص في حقول المشهد. فحص الأداة يرفض EXIF/XMP/IPTC والتعليقات التعريفية، ويطلب مراجعة الوجه واللوحة والنص الشخصي؛ لا ينفذ اكتشافًا آليًا للهوية أو تنقيحًا تلقائيًا.

## الفيديو

يلزم FFmpeg وffprobe محليان في PATH. ملف سجل فيديو يحتوي `source` وفق العقد أعلاه، و`video:{id,path,sha256}` و`leakageGroup` و`conditions` و`stride` (مثل 10 إطارات). بعد مراجعة الحقوق:

```powershell
node scripts/vision-ai/cli.mjs extract-frames .vision-ai/approved-video.json .vision-ai/team-dataset media/clip-a .vision-ai/clip-a-inventory.json
```

تقرأ الأداة أوقات العرض من ffprobe، وتتحقق من تطابق عددها مع الصور المستخرجة؛ لا تفترض FPS ثابتًا. أضف المخزون الناتج إلى inventory ثم `draft`. الإطارات تحمل `media:{kind:"video_frame",video:{id,path,sha256},timestampMs}`. يلزم `trackId` ثابت داخل الفيديو لكل جسم، ومنع تكراره بين جسمين في الإطار أو تغيير فئته. يبدأ معرف جديد عند غياب دليل الهوية بعد احتجاب طويل. لا يُعتبر معرف المتتبع الحالي حقيقة أرضية. لا يستخرج هذا الأمر بيانات من كاميرا مستخدم.

## قواعد التصنيف

- حدد كل جسم مرئي ضمن الفئات المتفق عليها. استخدم صندوق الجزء المرئي دون تخمين الجزء المحجوب، وسجل الاحتجاب والقطع. لا تكرر نفس الجسم بفئتين متداخلتين؛ استخدم فئته المحددة، و`overhanging_obstacle` للجسم البارز الذي لا تنطبق عليه فئة أدق.
- `stairs_visible` يصف مجموعة درجات مرئية بلا اتجاه أو عدد. `curb_step_edge` لحافة/درجة منفردة ظاهرة. لا تنتج `STAIRS_UP/DOWN` من هذه الوسوم.
- `pothole_visible` تجويف ذو حدود/سطح داخلي مرئي؛ `open_hole_visible` فتحة أرضية واضحة. العمق مجهول في كليهما. الظلال والبقع والانعكاسات ليست أمثلة إيجابية لهما.
- السلك/الخرطوم فئة واحدة في التجربة، والركام/الحجر فئة أخرى. التشقّق السطحي منفصل عن التجويف أو البلاطة المرتفعة. دوّن الحالات الملتبسة للمراجعة ولا تحولها إلى «سلبية» مؤكدّة.
- فئات الأسطح لا تعني أن الطريق آمن. `runtimeType:null` يعني أن التصنيف غير متصل بالإنتاج. الفئات المدعومة من الكاشف القديم موضحة بـ`baselineLabels`؛ إضافة اسم لا تضيف قدرة إلى النموذج.
- راجع جميع العوائق الأرضية بمراجعين، وأضف صورًا سالبة صعبة: ظل، خطوط دهان، زخرفة بلاط، انعكاس، شبك مستوٍ، ضوء ضعيف، اهتزاز وعدسة محجوبة. اعتماد حدود الفئات النهائي يحتاج مختص توجيه وحركة.

## تقسيم وتجميد مجموعة البيانات

```powershell
node scripts/vision-ai/cli.mjs split .vision-ai/team-dataset/dataset.reviewed.json .vision-ai/team-dataset/dataset.v1.json 20261014
node scripts/vision-ai/cli.mjs validate .vision-ai/team-dataset/dataset.v1.json
node scripts/vision-ai/cli.mjs export .vision-ai/team-dataset/dataset.v1.json .vision-ai/export-v1
```

التقسيم تقريبي 70/15/15 **بالمجموعات المستقلة** لا بعدد الصور؛ يتطلب ثلاث مجموعات على الأقل. الترتيب بالبصمة والبذرة قابل للإعادة ولا يعتمد ترتيب الصفوف. لا يعاد تقسيم manifest مجمد. افحص تحذيرات تغطية الفئات والأحجام والظروف قبل اعتماد النسخة. احجز test قبل ضبط النموذج، ولا تستخدم نتائجه لتعديل العتبات أو اختيار عدد epochs. حافظ على benchmark ثابت لاحقًا بإضافة بيانات جديدة للتدريب منفصلة، ولا تعاود التقسيم مع كل إصدار.

التصدير يحفظ `train.json`, `validation.json`, `test.json` بصيغة COCO و`dataset.lock.json` ببصمات البيانات والتصنيف والملفات. ملفات الصور تبقى في مجلد البيانات؛ لا تنسخ إلى التطبيق أو Git.

## مسار Transfer Learning التجريبي

اختير **SSDLite320 + MobileNetV3 Large** كمرشح صغير ذي رأس كشف قابل لإعادة التدريب ومسار ONNX، وليس كبديل مثبت الأفضلية. يبقى EfficientDet-Lite0 هو الأساس. المرجع: [واجهة Torchvision 0.22](https://docs.pytorch.org/vision/0.22/models/generated/torchvision.models.detection.ssdlite320_mobilenet_v3_large.html)، و[مصدر التنفيذ 0.22.1](https://github.com/pytorch/vision/blob/v0.22.1/torchvision/models/detection/ssdlite.py). دعم تشغيل ONNX في المتصفح موثق في [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)؛ التوافق والسرعة لهذا المرشح يجب إثباتهما بالتجربة.

جهز Python 3.11 في بيئة منفصلة وثبت `requirements-training.txt`. لا تغير بيئة العمق الحالية. أوزان المصدر تُجلب يدويًا بواسطة مسؤول مخول من مصدر رسمي، بعد مراجعة شروط الأوزان وبيانات تدريبها. لا يفترض ترخيص مكتبة البرمجيات أنه إذن لكل البيانات. لا تنزل الأداة أوزانًا تلقائيًا. ملف `pretrained.json` المحلي:

```json
{
  "architecture": "ssdlite320_mobilenet_v3_large",
  "path": "ssdlite320_mobilenet_v3_large_coco-a79551df.pth",
  "sha256": "FULL_REVIEWED_SHA256",
  "sourceUrl": "https://download.pytorch.org/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth",
  "license": "REVIEW_AND_RECORD_TERMS", "trainingAllowed": false,
  "reviewStatus": "pending", "reviewer": "",
  "rightsEvidence": "weights-rights.txt", "rightsSha256": "FULL_REVIEWED_SHA256"
}
```

القيم أعلاه قالب غير قابل للقبول حتى تستكمل المراجعة. بعد توفر البيانات والأوزان المعتمدة:

```powershell
python scripts/vision-ai/train.py train --manifest .vision-ai/team-dataset/dataset.v1.json --data-root .vision-ai/team-dataset --export .vision-ai/export-v1 --pretrained .vision-ai/pretrained/pretrained.json --output .vision-ai/run-001 --preflight-only
python scripts/vision-ai/train.py train --manifest .vision-ai/team-dataset/dataset.v1.json --data-root .vision-ai/team-dataset --export .vision-ai/export-v1 --pretrained .vision-ai/pretrained/pretrained.json --output .vision-ai/run-001
python scripts/vision-ai/train.py export --run .vision-ai/run-001 --output .vision-ai/onnx-001
```

يحمّل المسار الأوزان المحلية مع `weights_only=True` ويستبدل رأس التصنيف، ويجمّد backbone في البداية، ويثبت إحصاءات BatchNorm، ثم يدرب باستخدام train فقط. يحفظ تنبؤات validation لكل epoch وسجل loss والبذرة والبيئة وبصمات الأوزان. الخطة الأولية خمسة epochs ثابتة؛ ليست وصفة دقة نهائية. يصدّر ONNX opset 17 ومدخل RGB float32 `[1,3,320,320]` بقيم `[0,1]`، تطبيع داخل الرسم، وصناديق normalized xyxy وlabels متصلة تبدأ من 1 ومربوطة بالتصنيف.

فحص تصدير ONNX يقارن ثلاثة tensors اصطناعية بين PyTorch وORT CPU، ولا يثبت دقة أو تطابق صور حقيقية/متصفح. يلزم ذلك لاحقًا قبل النشر، وكذلك مراجعة نتائج الفئات غير الممثلة جيدًا. في البيئة الحالية لم تُشغّل حلقة التدريب/تصدير نموذج مخصص: لا بيانات مرخصة معنونة ولا checkpoint معتمد، وإصدارات Python ML الموجودة تختلف عن البيئة المثبتة المطلوبة.

## المقارنة القابلة للإعادة

```powershell
node scripts/vision-ai/benchmark.mjs .vision-ai/team-dataset/dataset.v1.json test baseline .vision-ai/baseline-run.json
node scripts/vision-ai/benchmark.mjs .vision-ai/team-dataset/dataset.v1.json test baseline-worker .vision-ai/worker-run.json
node scripts/vision-ai/benchmark.mjs .vision-ai/team-dataset/dataset.v1.json test candidate .vision-ai/candidate-run.json .vision-ai/onnx-001
node scripts/vision-ai/cli.mjs compare .vision-ai/baseline-run.json.report.json .vision-ai/candidate-run.json.report.json .vision-ai/comparison.json
```

يبدأ الأمر خادم loopback معزولًا ويغلقه مع المتصفح؛ لا يفتح صفحة التطبيق أو الكاميرا أو API أو env. كل عينة تُعرض على canvas ثابت 640×480 بالترتيب نفسه، خمس مرات إحماء، واستدلال متسلسل مع إتاحة 25 ms. حالة Worker لا تعود سرًا إلى المسار الرئيسي. تظل اختلافات runtime والمعالجة الداخلية مسجلة؛ الهدف مقارنة الناتج المنشور لكل نموذج. يُرفض اختلاف نسخة البيانات/الوسوم/التصنيف/الهاتف أو الحاسوب/المتصفح/البروتوكول. شغّل ثلاث جولات متتابعة بترتيب A/B ثم B/A على الجهاز نفسه بعد الإحماء ودون البناء أو اختبارات أخرى بالتزامن.

المقاييس: Precision/Recall عند IoU=.5، AP50 وAP50:95 باستخدام evaluator القائم (ليس COCO الرسمي)، نتائج كل فئة، تقسيم الظروف، recall للصغير/المتوسط/الكبير بمساحة نسبية `<1%` / `<10%` / الباقي، الأخطاء في الصور السالبة، p50/p95، زمن التحميل، أكبر انقطاع لمؤقت الواجهة. **درجات المصدر محدودة بعتبة .45 وأقصى 12 نتيجة**؛ AP هنا خاص بهذا الناتج، ولا يُقارن بـCOCO AP كامل الدرجات. تنبؤات الفئات غير المربوطة تُحسب false positives بدل إخفائها.

لا يمثل replay FPS الكاميرا الحية أو صوتًا مسموعًا أو الحرارة. `mobile/tracking/approach/segmentation:null` متعمد. تقييم segmentation القائم في `scripts/perception-evaluation.mjs` متاح للأقنعة المعنونة؛ لا نتائج دون أقنعة. HOTA/IDF1 وتقييم توقيت تنبيهات الاقتراب مهام مرحلة ثانية.

لاختبار الأنابيب دون بيانات:

```powershell
node scripts/vision-ai/create-smoke-fixture.mjs .vision-ai/browser-smoke-fixture
node scripts/vision-ai/benchmark.mjs .vision-ai/browser-smoke-fixture/dataset.json test baseline .vision-ai/smoke-run.json --synthetic-smoke
```

هذه مستطيلات لونية مصطنعة؛ التقرير موسوم `synthetic-arithmetic-only`. لا يجوز التدريب عليها أو وصف نتيجتها كدقة.

اختبار عقد ONNX الإضافي يتطلب مكتبة `onnx` فقط، وينتج رسمًا ثابتًا بصندوق واحد، بلا تعلم أو أوزان مدربة:

```powershell
python scripts/vision-ai/create-smoke-model.py .vision-ai/onnx-contract-fixture
node scripts/vision-ai/benchmark.mjs .vision-ai/browser-smoke-fixture/dataset.json test candidate .vision-ai/smoke-onnx.json .vision-ai/onnx-contract-fixture --synthetic-smoke
```

هذا يختبر تحميل WASM وفك صناديق/فئات/درجات ONNX فقط. لا يثبت تصدير SSDLite نفسه. الموديل الثابت مميز بـ`syntheticOnly`، وتمنعه الأداة من تقييم بيانات حقيقية. هوية جهاز القياس تُشتق من بصمة اسم الجهاز ومواصفاته دون حفظ الاسم نفسه، وتُحفظ بصمات ملفات أدوات القياس وlockfile لتمييز التغييرات.

## الإصدارات والرجوع

سجل محلي `.vision-ai/registry` فقط، لا يقرأه التطبيق الحالي. ملف وصف إصدار يحمل:

```json
{
  "version": "0.1.0", "format": "onnx", "status": "experimental-candidate",
  "sourceCommit": "FULL_40_CHARACTER_COMMIT",
  "modelPath": "model.onnx", "modelSha256": "FULL_SHA256",
  "taxonomySha256": "FULL_SHA256",
  "metricsPath": "metrics.json", "metricsSha256": "FULL_SHA256",
  "licenseEvidence": "license-evidence.txt", "licenseSha256": "FULL_SHA256",
  "datasetSha256": "FULL_SHA256", "trainingRunSha256": "FULL_SHA256",
  "compatibility": {"input": "RGB float32 NCHW 1x3x320x320 [0,1], stretch", "output": "normalized xyxy, category labels, scores", "runtime": "onnxruntime-web WASM, opset17"}
}
```

كل المسارات نسبية لمجلد الوصف. دليل الأداء يجب أن يحمل `schemaVersion:1` و`scope` وبصمة النموذج (مباشرة أو ضمن `run`). خط الأساس يقبل `existing-baseline` مع مقاييس غير مقاسة `null` بوضوح، ولا تملأها أرقامًا تقديرية. يشمل الإصدار نسخة التصنيف والمقاييس والترخيص وبصمات الملفات.

```powershell
node scripts/vision-ai/cli.mjs register .vision-ai/registry .vision-ai/onnx-001/release.json
node scripts/vision-ai/cli.mjs verify .vision-ai/registry 0.1.0
node scripts/vision-ai/cli.mjs select .vision-ai/registry 0.1.0 "local baseline replay"
# بعد تسجيل واختيار نسخة أخرى، الرجوع إلى السابقة:
node scripts/vision-ai/cli.mjs rollback .vision-ai/registry "candidate regression"
```

الاختيار والرجوع يتحققان من البصمات، ويحدثان مؤشرًا محليًا ذريًا وسجل التاريخ والسبب، ويمنع قفل الكتابة تضارب عمليتين. الإصدار لا يُستبدل بالاسم نفسه. إذا انقطع التسجيل يبقى مجلد ناقص غير قابل للتحقق؛ راجعه ثم استخدم إصدارًا جديدًا. لا تحذف قفلًا إلا بعد التأكد من توقف العملية. SHA-256 يكشف تغير المحتوى؛ ليس توقيع هوية الناشر. الربط بمحمّل الإنتاج أو CDN واعتماد/توقيع الناشر يحتاج موافقة مستقلة.

## بوابة الهاتف قبل الاقتراب

`phone-gate` يستهلك trace لفون فعلي (10 دقائق على الأقل) يحتوي الهوية وإصدار المتصفح وبصمة النموذج، وframes بمعرفات فريدة و`capturedAtMs/completedAtMs` بالنسبة لبداية القياس، و`durationMs`. يلزم `tracking:{idSwitches,labeledMinutes,groundTruthSha256}` من فيديو معنَّون، و`physicalDevice:true`, `thermalStable`, `batteryMeasured`, `zoomRotationOcclusionTestsPassed`, `falseApproachReviewPassed` من تجارب موثقة.

الأهداف المقترحة: ≥4 إطارات مكتملة/ث، p95 gap≤300 ms، أقصى gap≤350 ms، p95 age≤500 ms، لا إطار فوق800 ms، ≤1 تبديل هوية/دقيقة معنونة. النجاح يعيد `PASS_PENDING_FIELD_REVIEW` مع `enableApproach:false` دائمًا. الأداة لا تعتمد سلامة الحركة ولا تفعّل الميزة. يجب إبقاء رفض الإطار المتكرر/القديم والهوية الملتبسة والzoom/الدوران وضعف التدفق البصري في المحرك الحالي.
