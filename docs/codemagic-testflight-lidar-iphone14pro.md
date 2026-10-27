# بناء وتجربة مختبر LiDAR على iPhone 14 Pro باستخدام Codemagic وTestFlight

## حالة التنفيذ

ملف `codemagic.yaml` داخل هذا المستودع يجهز بناء iOS وتوقيعه عبر Codemagic ورفعه إلى **TestFlight** عند تشغيل التدفق يدويًا؛ `submit_to_app_store: false`. لا توجد مفاتيح Apple أو شهادات في GitHub. لا يثبت فحص المستودع وحده وجود تكامل Apple أو ملفات التوقيع في Codemagic؛ يجب التحقق منها داخل حساب المالك قبل البناء والنشر التجريبي.

**ليست هذه نسخة ملاحة معتمدة.** تطبيق iOS التجريبي يفتح صفحة `/navigation/vision` عبر HTTPS داخل `WKWebView` ويتيح لها إطارات ARKit/LiDAR وCore Haptics من الجسر الأصلي. يتضمن أيضًا مختبرًا منفصلًا لقياس عمق مركز الصورة على جهاز ثابت. لا يثبت البناء أو القياس صلاحية التحذيرات للتنقل.

## المتطلبات

1. اشتراك نشط في [Apple Developer Program](https://developer.apple.com/programs/enroll/).
2. صلاحية مناسبة على [App Store Connect](https://appstoreconnect.apple.com/) لإعداد التطبيق ومفتاح API والمختبرين.
3. حساب [Codemagic](https://codemagic.io/) مع صلاحية الوصول إلى مستودع GitHub `ras222003-boop/B5`.
4. iPhone 14 Pro مثبت عليه تطبيق [TestFlight](https://apps.apple.com/app/testflight/id899247664).

لا تحتاج إلى Mac على جهازك؛ يقوم Codemagic بالبناء والتوقيع سحابيًا. لا ترسل مفتاح `.p8` أو كلمات مرور أو شهادة `.p12` عبر محادثة أو ضمن الكود.

## (أ) تجهيز Apple

1. من [Apple Developer — Identifiers](https://developer.apple.com/account/resources/identifiers/list) سجّل **App ID صريحًا** بمعرّف `sa.basira.depthcalibration` إذا كان متاحًا ومملوكًا لك. إذا كان محجوزًا، اختر معرّفًا فريدًا وغيّره **في الملفين معًا** `ios/DepthCalibrationLab/project.yml` و`codemagic.yaml` قبل البناء.
2. من [App Store Connect](https://appstoreconnect.apple.com/) افتح **Apps → + → New App**. الاسم المقترح: `Basira LiDAR Lab`؛ نوع المنصة iOS؛ اختر نفس Bundle ID، ثم أنشئ سجل التطبيق. لا تنشره في متجر App Store.
3. في **Users and Access → Integrations → App Store Connect API** أنشئ API Key مستقلًا باسم `basira-codemagic` ودور `App Manager` إن كان متاحًا ومناسبًا لصلاحياتك. احفظ `Issuer ID` و`Key ID` وأنزل ملف `.p8` مرة واحدة في مكان آمن.
4. داخل سجل التطبيق افتح **TestFlight → Internal Testing → +** وأنشئ مجموعة بالاسم الحرفي `Basira Internal Testers`. أضف حسابك كعضو داخلي له صلاحية مناسبة في App Store Connect. قد يلزم إكمال بيانات اختبار أولية أو اتفاقيات Apple عندما تطلبها المنصة.

## (ب) إعداد Codemagic

1. افتح [Codemagic](https://codemagic.io/) وسجل الدخول باستخدام GitHub.
2. اختر **Add application** ثم مستودع `ras222003-boop/B5` ونمط `codemagic.yaml`.
3. من **Team settings → Integrations → Developer Portal** صِل App Store Connect بالمفتاح الذي أنشأته: `Issuer ID` و`Key ID` وملف `.p8`. سمِّ التكامل **`basira_apple` بالضبط**، كما ورد في `codemagic.yaml`.
4. إذا طلبت الخدمة شهادة توزيع Apple أو provisioning profile فاستعمل إعدادات **Code signing identities**/التوقيع التلقائي المعتمدة؛ يجب أن يطابق ملف التوزيع Bundle ID وأن يكون للتوزيع على App Store/TestFlight. أبقها داخل Codemagic فقط.
5. بعد مراجعة الفرع `codex/basira-adaptive-approach` وتأكيد متطلبات الحساب والتوقيع، احصل على الموافقة المطلوبة لرفع نسخة TestFlight، ثم اختر هذا الفرع والتدفق `basira-iphone14pro-testflight` واضغط **Start new build** يدويًا. لا حاجة إلى دمج الفرع في `main`.
6. سيُنشأ مشروع Xcode باستخدام XcodeGen، ثم تُطبّق ملفات التوقيع، ثم يُنشأ `.ipa` موقّع ويرفع إلى App Store Connect/TestFlight إذا نجحت صلاحيات الحساب والتوقيع.
7. بعد معالجة Apple للبناء، افتح **App Store Connect → TestFlight → Basira Internal Testers** وتأكد من إضافته للمجموعة. افتح رابط الدعوة على iPhone وثبّت التطبيق عبر TestFlight.

**ملاحظة:** `codemagic.yaml` لا يشغل بناءً تلقائيًا عند كل تحديث ولا يرفع التطبيق إلى متجر App Store. الهدف TestFlight فقط. إن رُفض الرفع الأول بسبب نقص بيانات سجل التطبيق، أكمل الحقول المطلوبة في App Store Connect وأعد البناء.

## (ج) تفعيل وضع أسماء الأجسام مع القياس على موقع بصيرة نفسه

عند نشر واجهة الاختبار على مضيف HTTPS مستقل يخدم مسار الرؤية من الجذر:

1. تأكد أن الرابط `https://<المضيف>/navigation/vision` يعمل كصفحة React؛ تعذر LiDAR والاهتزازات الأصلية في Safari متوقع ويجب إظهاره للمستخدم.
2. داخل Codemagic → Environment Variables ضع `BASIRA_VISION_URL` بقيمة الرابط الفعلي من الخطوة السابقة. **ليس المفتاح ولا الرمز السري**؛ هو رابط علني. يتوقع ملف البناء صفحة HTTPS ومسار `/navigation/vision` بالضبط، دون بادئة مسار مثل `/B5/`.
3. اضبط تكامل `basira_apple` وBundle ID، ثم ابنِ `basira-iphone14pro-testflight`.
4. عند وصول نسخة TestFlight إلى جهاز iPhone 14 Pro شغّل «الكاميرا مع أسماء الأجسام ومسافاتها». يحصل التطبيق على صورة الكاميرا وعمق LiDAR من نفس `ARFrame` مباشرة، ولا يستخدم كاميرا Safari.
5. قِس باستخدام شريط عند 0.5 و1 و2 و3 و5 أمتار في مكان ثابت، ثم جرب وضع الكرسي والباب على خلفيات مختلفة. إذا رفض البرنامج العمق المختلط فلا تُجبِر الأمتار على الظهور.
6. لا توجد أي تصاريح تمنح Safari قدرة LiDAR الخام؛ هذه الميزة مخصصة للتطبيق الأصلي فقط، بينما يظل موقع بصيرة يعمل دونها.

> **تنبيه هندسي:** نجاح بناء المحاكي ورفع تطبيق TestFlight لا يثبت نجاح LiDAR أو دقة ربط اسم الجسم بمسافة الرقعة. اتبع [بروتوكول اختبار iPhone 14 Pro الثابت](iphone-adaptive-approach-test-protocol.md) لقياس التنبيهات والاهتزازات، دون تجارب مشي.

## (د) تجربة العمق على الآيفون

1. افتح `بصيرة | مختبر LiDAR` المثبت عبر TestFlight.
2. ثبّت الهاتف في مكان داخلي آمن. قِس المسافة بين عدسة الكاميرا وسطح كبير مستوٍ بشريط قياس.
3. اختر مسافة مرجعية من 0.5 أو 1 أو 2 أو 3 أو 5 أمتار.
4. اختر ظروف الإضاءة، ثم اضغط **التقاط قياس من LiDAR**.
5. امنح إذن الكاميرا. عند فتح معاينة ARKit وجّه علامة المنتصف إلى السطح المرجعي، انتظر استقرار التعقب، ثم اضغط **التقاط قراءة LiDAR**.
6. سيعرض المختبر المسافة المقاسة والخطأ المطلق. كرر نحو 20 تجربة على الأقل لكل مسافة، وعلى حالتين مختلفتين من الإضاءة كحد أدنى.
7. اضغط **تصدير البيانات CSV** واحفظ الملف في تطبيق الملفات لمراجعته. لا تتضمن البيانات أي صور شخصية؛ هي قياسات وأوقات ومعرّفات إطارات.
8. لا تختبره وأنت تمشي أو تصعد السلالم. النتيجة بالمتر مرتبطة بالسطح الموجود عند مركز كاميرا الهاتف، وليس بالضرورة المسافة الآمنة أمام القدم أو الجسم كله.

## حدود المرحلة

- التوقيع السحابي **محدد في `codemagic.yaml`**، لكن حالة تكامل `basira_apple`، ملف التوقيع، سجل التطبيق، ومجموعة المختبرين غير قابلة للتحقق من نسخة المستودع المحلية. يجب التحقق منها داخل Codemagic وApp Store Connect قبل التشغيل.
- نجاح بناء محاكي iOS على GitHub يثبت قابلية الترجمة فقط؛ لا يثبت قياسات LiDAR على جهاز فعلي.
- لا توجد حتى الآن بيانات معايرة فعلية من iPhone 14 Pro.
- شاشة مختبر العمق الأصلية منفصلة عن صفحة الرؤية المدمجة في الغلاف. تقاطع رقعة العمق مع الجسم المكتشف وتحذيرات الاقتراب والاهتزازات يحتاج قياس محاذاة وزمن استجابة على الجهاز الحقيقي؛ لا تكفي قراءة عمق المركز لإثبات ذلك.
- لم يُشغّل تدفق Codemagic ضمن هذا الفحص، ولا يوجد رابط TestFlight مؤكد لهذه النسخة. تشغيله يرفع نسخة تجريبية فعلية، لذلك يبقى خطوة تتطلب موافقة صريحة بعد مراجعة البناء.

## مراجع رسمية

- Codemagic, [iOS native apps](https://docs.codemagic.io/yaml-quick-start/building-a-native-ios-app/)
- Codemagic, [automatic signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/)
- Codemagic, [TestFlight and App Store Connect publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/)
- Apple, [TestFlight internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
