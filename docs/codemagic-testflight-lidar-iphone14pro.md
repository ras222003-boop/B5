# تجهيز بصيرة الأصلية للتوقيع وTestFlight على iPhone 14 Pro

## نطاق هذه النسخة

فرع iOS الأصلي يبدأ بواجهة SwiftUI ومختبر ARKit لقياس عمق سطح ثابت. يستخدم معرّف التطبيق المسجل `sa.nasjalufuq.basira` في سجل «بصيرة - نسج الأفق» الحالي؛ لا يُنشأ تطبيق ثانٍ. لم تُنقل خدمات المنصة أو نموذج Core ML إلى نقطة الدخول الأصلية بعد. لا تثبت اختبارات المحاكي توفر LiDAR أو دقة الأمتار على iPhone حقيقي، ولا تستخدم هذه النسخة للملاحة.

## مسارات البناء المنفصلة في Codemagic

1. `basira-native-ios-validation`: يولّد مشروع Xcode ويشغّل اختبارات المحاكي بدون توقيع أو نشر.
2. `basira-native-ios-signed-ipa-check`: بعد تجهيز التكامل ومواد التوقيع، ينشئ IPA موقّعًا ويفحص Bundle ID والفريق وملف التهيئة والتوقيع. يبقى IPA في آثار Codemagic ولا يُرفع إلى Apple.
3. `basira-iphone14pro-testflight`: ينشئ IPA ثم يرفعه إلى TestFlight ومجموعة `Basira Internal Testers` تلقائيًا. لا تشغّله قبل موافقة صريحة على الرفع. `submit_to_app_store: false` ولا توجد أحداث تشغيل تلقائي لأي سير.

## مواد التوقيع المتحقَّق منها في Codemagic

- يعرض **Developer Portal** تكاملًا متصلًا بالاسم المرجعي `basira_apple`، وهو الاسم الذي يستخدمه سيرا التوقيع في `codemagic.yaml`.
- يعرض **Code signing identities** الشهادة `basira_distribution` من نوع production وملف `basira_appstore_profile` من نوع `app_store`. الفريق المعروض لكليهما واحد، وتاريخ الانتهاء المعروض 28 أكتوبر 2027.
- يعرض ملف التهيئة Bundle ID ‏`sa.nasjalufuq.basira` ورسالة Codemagic بأن الشهادة المرفوعة المطابقة له هي `basira_distribution`. يختار `ios_signing` الأصول حسب نوع `app_store` ومعرّف التطبيق، وهي صيغة Codemagic الموثقة؛ ويفحص سير IPA التوقيع والفريق ومعرّف التطبيق داخل الحزمة الناتجة. تطابق العرض في الواجهة وحده لا يثبت نجاح إنشاء IPA.
- لا تزال صلاحية مفتاح API للنشر، ووجود مجموعة `Basira Internal Testers` في التطبيق نفسه، وبيانات TestFlight وامتثال التشفير بحاجة إلى فحص قبل أي رفع.

## متطلبات Apple التي يفحصها مالك الحساب

- عضوية Apple Developer فعالة وسجل تطبيق iOS الحالي في App Store Connect مرتبطان بمعرّف `sa.nasjalufuq.basira` وSKU `BASIRA-IOS-001`.
- مفتاح App Store Connect API باسم `basira-codemagic` بصلاحية مناسبة للتوقيع والرفع. يراجع المالك نطاق الوصول قبل ربطه؛ مفاتيح الفريق قد تغطي تطبيقات الحساب كلها.
- شهادة `Apple Distribution` صالحة ومفتاحها الخاص متاحان للتوقيع في Codemagic، وملف `App Store Connect provisioning profile` صالح يطابق App ID الصريح وفريق Apple والشهادة. لا تكفي رؤية شهادة في بوابة Apple إذا لم يكن مفتاحها الخاص متاحًا لـCodemagic.
- مجموعة اختبار داخلي باسم `Basira Internal Testers` في TestFlight للتطبيق نفسه، مع إضافة المختبرين المصرح لهم. راجع بيانات الاختبار وامتثال التشفير إن طلبته Apple.
- رقم `CFBundleVersion` جديد مقارنة بما استُخدم سابقًا لنفس إصدار التطبيق في App Store Connect. يستخدم Codemagic `PROJECT_BUILD_NUMBER`، لذا تُراجع قيمته قبل الرفع إذا كانت هناك أبنية سابقة.

## إعداد Codemagic الآمن

1. افتح حساب Codemagic الذي يستضيف مستودع `ras222003-boop/B5`، ثم **Settings → Integrations → Developer Portal**.
2. استخدم التكامل الموجود `basira_apple`؛ إذا احتاج المفتاح إلى تجديد فليُدخل المالك بياناته داخل واجهة Codemagic الآمنة فقط. لا تضع ملف `.p8` في المحادثة أو GitHub أو `codemagic.yaml`.
3. في **Settings → Code signing identities** راجع صلاحية `basira_distribution` و`basira_appstore_profile` وتطابق الفريق والمعرّف `sa.nasjalufuq.basira`. عند تغيير App ID أو الإمكانيات أو الشهادة، يلزم إعادة التحقق من ملف التهيئة.
4. من الفرع المستقل الجديد شغّل `basira-native-ios-validation` وراجع نجاح الاختبارات. ثم شغّل `basira-native-ios-signed-ipa-check` فقط بعد اكتمال مواد التوقيع، وراجع نتيجة فحص IPA في السجل وأثر البناء.
5. بعد مراجعة IPA والمجموعة والبيانات في App Store Connect، اطلب موافقة صريحة منفصلة قبل تشغيل `basira-iphone14pro-testflight`. تشغيله يرفع نسخة فعلية إلى Apple ويتيحها للمختبرين الداخليين بعد المعالجة.

## اختبار الجهاز

ثبّت iPhone 14 Pro في مكان آمن، وامنح إذن الكاميرا، وقارن قراءات سطح واضح بمسافات مرجعية مستقلة مثل 0.5 و1 و2 و3 أمتار. سجّل حالة التتبع والثقة وأسباب رفض القياس، ثم تحقق من إيقاف القراءة عند إيقاف الكاميرا أو مغادرة التطبيق. لا تُجرِ تجارب مشي أو تتعامل مع القراءة بوصفها دليل ملاحة.

## مراجع

- [Codemagic: توقيع iOS](https://docs.codemagic.io/yaml-code-signing/signing-ios/)
- [Codemagic: نشر TestFlight](https://docs.codemagic.io/yaml-publishing/app-store-connect/)
- [Apple: ملف توزيع App Store Connect](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile)
- [Apple: المختبرون الداخليون](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
