# بناء وتجربة مختبر LiDAR على iPhone 14 Pro باستخدام Codemagic وTestFlight

## حالة التنفيذ

ملف `codemagic.yaml` داخل هذا المستودع يجهز بناء iOS وتوقيعه عبر Codemagic ورفعه إلى **TestFlight الداخلي فقط**. لا توجد مفاتيح Apple أو شهادات في GitHub. يجب على مالك حساب Apple القيام بخطوات الربط والتفويض في Codemagic وApp Store Connect.

**ليست هذه نسخة الملاحة الحقيقية.** تطبيق iOS التجريبي يعرض مختبرًا أصليًا يعمل دون موقع ويب، ويقيس عمق مركز الصورة من جلسة ARKit/LiDAR على جهاز ثابت؛ يسجل القراءات محليًا ويصدر CSV. لا يصدر تعليمات سير أو تحذيرات مرور أو أجراس درجات.

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
5. من صفحة المشروع في Codemagic اختر الفرع `codex/native-depth-calibration-lab` والتدفق `basira-iphone14pro-testflight` واضغط **Start new build** يدويًا.
6. سيُنشأ مشروع Xcode باستخدام XcodeGen، ثم تُطبّق ملفات التوقيع، ثم يُنشأ `.ipa` موقّع ويرفع إلى App Store Connect/TestFlight إذا نجحت صلاحيات الحساب والتوقيع.
7. بعد معالجة Apple للبناء، افتح **App Store Connect → TestFlight → Basira Internal Testers** وتأكد من إضافته للمجموعة. افتح رابط الدعوة على iPhone وثبّت التطبيق عبر TestFlight.

**ملاحظة:** `codemagic.yaml` لا يشغل بناءً تلقائيًا عند كل تحديث ولا يرفع التطبيق إلى متجر App Store. الهدف TestFlight فقط. إن رُفض الرفع الأول بسبب نقص بيانات سجل التطبيق، أكمل الحقول المطلوبة في App Store Connect وأعد البناء.

## (ج) تجربة العمق على الآيفون

1. افتح `بصيرة | مختبر LiDAR` المثبت عبر TestFlight.
2. ثبّت الهاتف في مكان داخلي آمن. قِس المسافة بين عدسة الكاميرا وسطح كبير مستوٍ بشريط قياس.
3. اختر مسافة مرجعية من 0.5 أو 1 أو 2 أو 3 أو 5 أمتار.
4. اختر ظروف الإضاءة، ثم اضغط **التقاط قياس من LiDAR**.
5. امنح إذن الكاميرا. عند فتح معاينة ARKit وجّه علامة المنتصف إلى السطح المرجعي، انتظر استقرار التعقب، ثم اضغط **التقاط قراءة LiDAR**.
6. سيعرض المختبر المسافة المقاسة والخطأ المطلق. كرر نحو 20 تجربة على الأقل لكل مسافة، وعلى حالتين مختلفتين من الإضاءة كحد أدنى.
7. اضغط **تصدير البيانات CSV** واحفظ الملف في تطبيق الملفات لمراجعته. لا تتضمن البيانات أي صور شخصية؛ هي قياسات وأوقات ومعرّفات إطارات.
8. لا تختبره وأنت تمشي أو تصعد السلالم. النتيجة بالمتر مرتبطة بالسطح الموجود عند مركز كاميرا الهاتف، وليس بالضرورة المسافة الآمنة أمام القدم أو الجسم كله.

## حدود المرحلة

- التوقيع السحابي **مهيأ في GitHub** لكنه لن يعمل حتى يربط صاحب الحساب Apple Developer/Codemagic.
- نجاح بناء محاكي iOS على GitHub يثبت قابلية الترجمة فقط؛ لا يثبت قياسات LiDAR على جهاز فعلي.
- لا توجد حتى الآن بيانات معايرة فعلية من iPhone 14 Pro.
- تطبيق المختبر مستقل تمامًا عن تنبيهات الرؤية والملاحة الفعلية في بصيرة؛ ربط الكائنات المكتشفة بإحداثيات خريطة العمق خطوة هندسية لاحقة تحتاج اختبار محاذاة ومعايرة أمان.

## مراجع رسمية

- Codemagic, [iOS native apps](https://docs.codemagic.io/yaml-quick-start/building-a-native-ios-app/)
- Codemagic, [automatic signing](https://docs.codemagic.io/yaml-code-signing/signing-ios/)
- Codemagic, [TestFlight and App Store Connect publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/)
- Apple, [TestFlight internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
