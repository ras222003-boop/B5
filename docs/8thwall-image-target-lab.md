# بصيرة × 8th Wall — مختبر Image Targets (المرحلة B)

**الحالة:** كود تجربة متصفح مع محرك 8th Wall مفتوح المصدر جاهز للمراجعة البرمجية. **لم تُثبت الوظيفة على هاتف فعلي أو تُنشر**. يتطلب فتح معاينة HTTPS وتفعيل علامة بيئة ووضع علامة مطبوعة أو على شاشة ثانية.

هذه تجربة تضاف إلى بصيرة؛ لا تغير صفحة الرؤية أو الملاحة أو مسافات LiDAR أو الاختبارات أو الصوت العام، ولا تحل محل أي منها.

## طريقة الاختبار

1. على فرع `codex/8thwall-image-target-lab`، ضع `VITE_BASIRA_AR_LAB_ENABLED=true` في **بيئة معاينة/اختبار** فقط، ثم أعد بناء التطبيق. لا تجعل هذا المتغير نشطًا في الإنتاج قبل الموافقات.
2. افتح `https://<PREVIEW_HOST>/navigation/ar-lab/image-targets` على iPhone Safari أو Android Chrome عبر HTTPS. حتى لو كان iPhone 14 Pro، فهذا المختبر لا يحتاج بيانات LiDAR.
3. افتح أو اطبع `https://<PREVIEW_HOST>/ar/targets/basira-lab-marker.svg` من جهاز **آخر**. لا تفترض أن الهاتف يستطيع تصوير الصورة المعروضة على شاشته.
4. ضع علامة الموافقة؛ واضغط «بدء اكتشاف العلامة». حينها فقط يجري تحميل `@8thwall/engine@0.1.0` من CDN وتطلب الكاميرا. المحرك هنا مفتوح المصدر ومحدود بـ Image Targets؛ لا يتم تحميل محرك SLAM الثنائي المقيد.
5. وجّه الكاميرا نحو العلامة في إضاءة مناسبة. يتابع التطبيق أحداث `reality.imagescanning` و`reality.imagefound` و`reality.imagelost`، ويعرض التغيرات. الإعلان الصوتي اختياري عبر الجهاز محليًا.
6. جرّب إيقاف الكاميرا والخروج من الصفحة وإخفاء التطبيق؛ تحقق من انطفاء مؤشر الكاميرا وعدم استمرار جلسة XR.
7. جرّب رفض الكاميرا وانقطاع CDN، والتأكد من أن الخدمات الأخرى في بصيرة تبقى سليمة.

## تنفيذ تقني

- `client/src/lib/ar/imageTargetEngine.ts`: تحميل متأخر للمحرك المفتوح المصدر المثبت الإصدار؛ جلسة كاميرا واحدة؛ تحميل وتحقق من مخطط العلامة؛ إيقاف الجلسة والإزالة عند انتهاء التجربة.
- `client/src/lib/ar/imageTargetLandmarks.ts`: قبول العلامة التجريبية المسجلة فقط. لا بيانات مسار أو مكان حقيقي تُستنتج من أحداث غير موثوقة.
- `client/src/pages/ArImageTargetsLab.tsx`: واجهة عربية/إنجليزية/صينية، موافقة صريحة، أحداث حيّة، نطق محلي، رابط للطباعة وحالة تعطيل واضحة.
- `client/public/ar/targets/basira-lab-marker.svg` و`basira-lab.json`: **علامة أولية هندسية**. ملف JSON يستعمل إحداثيات معروفة؛ لم تُعالج العلامة عبر `image-target-cli` بعد. **نجاح التتبع على أجهزة حقيقية غير مؤكد** إلى أن نختبر الاستجابة الفعلية؛ إن فشلت المعالجة، نعتمد CLI الرسمي لإنشاء نسخة PNG مع metadata، ولا ندّعي نجاح الميزة قبل ذلك.
- لا نستخدم بيانات الموقع أو الصور في الخادم. تنزّل ملفات SDK من CDN عند موافقة المستخدم؛ لاستضافة خاصة بعد مراجعة الترخيص وأمن التبعيات.

## حدود صارمة

- اكتشاف الصورة لا يعني التأكد من اسم المبنى أو تحديد موقع المستخدم، ولا كشف العوائق أو السلالم. لا تفعّل تنبيهات السير اعتمادًا عليه.
- **8th Wall Engine 0.1.0 تجريبي قبل الإصدار المستقر**، وقد يتغير API. لا اعتماد للإنتاج دون اختبارات Android وiPhone فعلية.
- **XR Engine Binary ليس ضمن هذه التجربة** ولا يجوز إلحاقه ضمن باقات الملاحة المدفوعة قبل مراجعة ترخيص منفصلة.
- لا نغيّر نظام التعليم/المعلمين/الصوت أو خريطة الأماكن الحالية.
- الاختبارات الآلية `pnpm check`, `pnpm test`, `pnpm build`, وCI ليست بديلًا عن اختبار العلامة باستخدام الكاميرا.

## مصادر مرجعية

- [Engine MIT README](https://github.com/8thwall/8thwall/blob/main/packages/engine/README.md)
- [AR Engine overview](https://8thwall.org/docs/engine/overview)
- [XR8.run](https://8thwall.org/docs/api/engine/xr8/run)
- [XrController event handling](https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule)
- [Image target CLI](https://github.com/8thwall/8thwall/blob/main/apps/image-target-cli/README.md)
- [مشروع التطوير الشامل #19](https://github.com/ras222003-boop/B5/issues/19)

## بعد نجاح اختبار العلامات

افتح PR منفصل لـ Face Effects ثم Sky Effects ومكوّنات fallbacks/coaching، ثم راجع ترخيص الـ binary قبل SLAM/Absolute Scale. لا دمج أو نشر تلقائي دون موافقة المستخدم.
