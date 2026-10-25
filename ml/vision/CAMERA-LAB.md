# مختبر كاميرا السلالم المحلي

لإدخال بيانات واقعية مصرح بها وتجميد مرجع مستقل وتقييم ONNX الحالي، راجع
[مسار التقييم الواقعي المستقل](REAL-EVALUATION.md). لا توجد بيانات واقعية
جاهزة في التجربة الحالية. أصبح حفظ القياسات والتوقعات محليًا مرتبطًا
بمعرّفات الموقع والجلسة والمشهد، ولا يحول التوقعات إلى وسوم مرجعية.

المختبر صفحة مستقلة عن تطبيق الإنتاج وStudio، وتشغل ONNX Runtime Web المثبت
محليًا. لا تستورد محرك الرؤية الأصلي ولا تحتوي على صوت أو توجيه ملاحي. لا
يملك الخادم مسار رفع صور أو فيديو؛ الكاميرا والملفات المختارة تُقرأ في المتصفح
وتبقى في ذاكرته. يتطلب فتح المصدر تأكيد صلاحية استخدام الوسائط ومراجعات
الحقوق والخصوصية المطلوبة للبيانات الحقيقية.

## تشغيل الكمبيوتر

من جذر B5، عيّن مسار entry للنموذج البحثي الموجود خارج Git:

```powershell
$entry = Join-Path (Resolve-Path ..) '.vision-test-fixtures\synthetic-stairs-v3-002\training\entry.json'
node scripts/vision-ai/camera-lab/server.mjs --entry $entry --port 4329
```

افتح `http://127.0.0.1:4329`. يسمح المتصفح بطلب الكاميرا بعد إذنك على loopback؛
الكاميرا تحتاج سياقًا آمنًا، ويجب استخدام HTTPS موثوق عند الوصول من الهاتف.
راجع [توثيق getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
زر الإيقاف يوقف مسارات الكاميرا ويحرر Object URLs. ملفات الوسائط لا تُحفظ
تلقائيًا، وملف النتائج المنزل يحتوي على التنبؤات والقياسات فقط.

## عقد النموذج

`adapter.mjs` يرفض نموذجًا غير موسوم `researchOnly:true` و
`productionEnabled:false`، ويتحقق من بصمة ONNX وأسماء tensors وأبعادها وقيمها
المنتهية. يدعم عقدين محددين:

- V2: RGB/NCHW/float32 بحجم ‎128×128‎، stretch، ومخرجات
  `class_logits[1,5]` و`box_xywh[1,4]` مع ترتيب الفئات الصريح.
- V3: RGB/NCHW/float32 بحجم ‎160×160‎، letterbox بحشو byte127، ومخرجات
  `presence_logits[1,3]` للخلفية/الدرج الثابت/الكهربائي،
  `direction_logits[1,3]` للصعود/الهبوط/غير المؤكد، و`box_xywh[1,4]`.
  يفصل حضور الدرج عن اتجاهه، ويعرض `2303` عند ضعف ثقة الاتجاه أو الهامش.
  تُزال إزاحة letterbox قبل رسم المربع على الصورة الأصلية.

الثقة المعروضة غير معايرة ما لم يذكر العقد معايرة فعلية. يعرض المختبر
الفئة والمربع وثقة الحضور والاتجاه عند توفرها، وزمن تجهيز الصورة مع الاستدلال،
والإطارات التي تُخطى عند انشغال النموذج، وإطارات المتصفح المفقودة. هذه قياسات
تشغيل، ولا تقيس دقة الكاميرا الواقعية أو سلامة الاستخدام الملاحي.

## iPhone عبر شبكة محلية آمنة

لم يُنفذ اختبار iPhone فعلي. أُعد مسار HTTPS محلي فقط؛ لا يوجد tunnel أو نشر
عام أو تعديل تلقائي لجدار الحماية أو مخزن الثقة.

1. استخدم عنوان IPv4 الخاص للحاسوب على شبكة موثوقة ومصرح بها، مثل
   `192.168.1.98`، وحدد مجلدًا خاصًا جديدًا خارج Git للشهادات. يعيد helper
   شهادة CA محلية وشهادة خادم بمدة سبعة أيام؛ يحتفظ بالمفاتيح في ذلك المجلد.

   ```powershell
   node scripts/vision-ai/camera-lab/make-local-cert.mjs --output '<private-cert-folder>' --ip '<private-ip>' --openssl 'C:\Program Files\Git\usr\bin\openssl.exe'
   ```

2. انقل **ملف `basira-local-root.cer` العام فقط** بطريقة محلية معتمدة إلى
   iPhone، وراجع بصمته قبل تثبيته. يبقى `root-key.pem` و`server-key.pem` على
   الحاسوب. تثبيت CA وتفعيل الثقة قرار يدوي لمالك الجهاز أو مسؤول الأجهزة.
   توضح Apple أن الشهادة المثبتة يدويًا لا تُوثق تلقائيًا لـTLS؛ يمكن مراجعة
   Settings → General → About → Certificate Trust Settings بعد تثبيتها.
   [تعليمات Apple الرسمية](https://support.apple.com/102390).

3. أنشئ رمز وصول محليًا عشوائيًا لا يقل عن 32 حرفًا في المتغير
   `BASIRA_LAB_ACCESS_TOKEN`، واحتفظ به خارج Git. ابدأ المستمع الخاص صراحةً:

   ```powershell
   node scripts/vision-ai/camera-lab/server.mjs --entry $entry --lan --host '<private-ip>' --port 4329 --cert '<private-cert-folder>\server-chain.pem' --key '<private-cert-folder>\server-key.pem'
   ```

4. على iPhone افتح `https://<private-ip>:4329` من Safari، وتحقق من الاتصال
   الموثوق، ثم أدخل رمز الوصول. لا تقبل تجاوز تحذير شهادة. اسمح بالكاميرا
   فقط عند بدء تجربتك. اختر وسائط مصرحًا بها، ثم احفظ نتائج الأداء محليًا.
   أنهِ العملية بعد الاختبار وأزل الثقة المؤقتة وفق سياسة جهازك.

الخادم يرفض LAN دون عنوان خاص موجود على الجهاز وشهادة/مفتاح ورمز وصول.
يرفض Host/Origin غير المطابقين، ويستخدم cookie من نوع Secure/HttpOnly/
SameSite=Strict. تنص CSP على `connect-src 'self'`، وتعطّل الميكروفون والموقع.
لا يفتح helper منفذ LAN ولا يُثبت شهادة ولا يغير جدار الحماية.

## ما تم اختباره

اختبارات الكمبيوتر استخدمت Chrome وONNX حقيقيًا وملفات اصطناعية وكاميرا
مزيفة اصطناعية فقط؛ لم تُرسل وسائط خاصة. تحقق اختبار V3 من صورة تحقق، وخمسة
إطارات فيديو تدريب، وستة إطارات كاميرا مزيفة، ومن وقف المسارات وعدم طلب
الميكروفون. فُحص عرض بعرض 390px دون تجاوز أفقي، وهو **ليس اختبار Safari أو
iPhone فعليًا**. تحفظ الأدلة في مجلد تجارب خاص خارج Git.

```powershell
node --test scripts/vision-ai/camera-lab/adapter.test.mjs scripts/vision-ai/camera-lab/server.test.mjs
node scripts/vision-ai/camera-lab/browser-test.mjs --entry $entry --image '<synthetic-validation-image>' --output '<private-evidence-folder>'
node scripts/vision-ai/camera-lab/https-test.mjs --entry $entry --cert-dir '<private-cert-folder>'
```

نجح توليد سلسلة الشهادة والتحقق منها محليًا بوساطة OpenSSL. في هذه البيئة
استبدل Norton Web/Mail Shield شهادة HTTPS حتى على loopback بشهادة صادرة عن
`Norton Web/Mail Shield Untrusted Root`؛ رفض عميل TLS الصارم تلك الشهادة.
لم تُعطل عملية التحقق ولم تُثبت ثقة أو تُغير إعدادات Norton. لذلك تبقى
سلامة الاتصال HTTPS من الطرف إلى الطرف واختبار أداء iPhone قيد التنفيذ على
اتصال يمر بسلسلة الشهادة المصرح بها دون هذا الاستبدال.
