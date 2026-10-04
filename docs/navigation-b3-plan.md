نفّذ المحطة الثالثة من منظومة التنقل في منصة «بصيرة»:

# B3 — Localization & Auto Mapping
## تحديد الموقع داخل المباني وبناء الخريطة تلقائيًا

ابدأ من آخر commit مكتمل في B2:

`f488807322f5cc6c7436ad2c9536727a9adac5c7`

أنشئ فرعًا مستقلًا:

`codex/b3-localization-auto-mapping`

لا تعدّل `main`.
لا تدمج أي فرع في `main`.
لا تستخدم force push.
لا تبدأ B4.

---

# الهدف

نريد أن تصبح بصيرة قادرة على الإجابة عن:

**أين أنا داخل المبنى؟**

وأن تتعلم أثناء حركة المستخدم:

- الممرات.
- التقاطعات.
- القاعات.
- الأبواب.
- المصاعد.
- السلالم.
- نقاط الانتقال بين الطوابق.
- المسار الذي سار فيه المستخدم.

ثم تربط هذه المعلومات تلقائيًا بخريطة B1.

B3 لا تنفذ التوجيه الكامل إلى الوجهة؛ ذلك في B4.

---

# 1. Indoor Localization Engine

أنشئ:

`BasiraLocalizationEngine`

تكون مهمته دمج عدة مصادر لتقدير الموقع.

لا تعتمد على مصدر واحد.

المصادر المحتملة:

- GPS عند المبنى وخارجه.
- Device Motion.
- Accelerometer.
- Gyroscope.
- Compass / Heading.
- Step Detection.
- Camera/Vision من B2.
- OCR Place Recognition.
- الأماكن المعروفة في B1.
- Bluetooth Beacons مستقبلًا.
- Wi-Fi / Wi-Fi RTT مستقبلًا.
- QR/NFC anchors.
- Barometer إن توفر.
- Native AR position إن توفر.

---

# 2. Sensor Fusion

أنشئ طبقة:

`LocalizationFusionEngine`

كل مصدر يعطي:

- position estimate
- heading
- confidence
- timestamp
- source

ثم تنتج بصيرة:

`LocalizationEstimate`

مثال:

- buildingId
- floorId
- x
- y
- headingDegrees
- confidence
- uncertaintyRadius
- sources[]
- timestamp

لا تعرض دقة مترية كاذبة.

---

# 3. Current Building Detection

حسن ما تم في B1.

خارج المبنى:

استخدم الموقع الجغرافي لتحديد المباني القريبة.

عند الاقتراب من مبنى معروف:

اقترح:

**يبدو أنك عند كلية التربية. هل تريد استخدام خريطتها الداخلية؟**

إذا كان هناك تطابق موثوق:
يصبح المبنى Current Building.

لا تستخدم GPS لتحديد القاعة داخل المبنى.

---

# 4. نقطة الدخول

عند دخول مبنى نحتاج Anchor أولي.

دعم الطرق التالية:

1. Entrance Location.
2. QR.
3. NFC.
4. Visual OCR.
5. Known Place.
6. Beacon مستقبلًا.
7. Manual confirmation.

مثال:

الكاميرا تقرأ:

**المدخل الرئيسي**

أو لوحة قاعة معروفة.

فتستخدمها بصيرة لإعادة تثبيت الموقع.

---

# 5. Visual Anchors

استخدم B2 لربط الموقع بالخريطة.

مثال:

OCR يقرأ:

`قاعة 121`

وتوجد في B1.

عندها:

`Place 121`
→ known MapNode
→ localization correction

هذا يسمى:

**Relocalization**

ويجب أن يكون من أهم مصادر تصحيح خطأ الحركة.

---

# 6. Pedestrian Dead Reckoning

أنشئ:

`PedestrianMotionProvider`

يستخدم عند توفر البيانات:

- step events
- accelerometer
- gyroscope
- heading

ليقدّر حركة المستخدم بين Anchors.

لا تستخدم أرقامًا ثابتة غير قابلة للتعديل لطول الخطوة.

استخدم Config أو Calibration.

---

# 7. معايرة طول الخطوة

أضف إعدادًا اختياريًا:

**معايرة المشي**

يمكن للمستخدم السير مسافة معروفة لاحقًا لتقدير طول خطوته.

إذا لم تتم المعايرة:
استخدم تقديرًا محافظًا ولا تدّع دقة عالية.

---

# 8. Heading

أنشئ:

`HeadingProvider`

ويعطي اتجاه المستخدم.

ادمج:

- compass
- gyro
- visual corrections إن توفرت

تعامل مع انحراف البوصلة داخل المباني.

إذا كانت الثقة ضعيفة:
خفض Confidence بدل تقديم اتجاه مؤكد.

---

# 9. Floor Detection

أنشئ:

`FloorEstimator`

يعتمد على أكثر من معلومة:

- Visual Place.
- معروف مسبقًا أن القاعة في طابق معين.
- elevator transition.
- stairs transition.
- barometer إن توفر.
- manual confirmation.
- native altitude data إن توفر.

لا تعتمد على GPS altitude وحده.

إذا لم يمكن تحديد الطابق:
أعد:

`floorId = null`
أو uncertainty واضحة.

---

# 10. الانتقال بين الطوابق

سجل أحداث:

- ENTER_ELEVATOR
- EXIT_ELEVATOR
- STAIRS_TRANSITION
- FLOOR_CONFIRMED

إذا شاهدت بصيرة لوحة:

`الدور الثاني`

يمكن استخدامها Anchor.

---

# 11. Auto Mapping Session

أنشئ وضعًا داخل لوحة بناء الخرائط:

**بدء مسح تلقائي للمبنى**

عند تشغيله:

- يبدأ تتبع الحركة.
- يسجل المسار.
- يلتقط Anchors.
- يربط نتائج Vision.
- يقترح MapNodes.
- يقترح MapEdges.

---

# 12. Mapping Session Model

أنشئ نموذج:

`MappingSession`

يحتوي:

- id
- buildingId
- startedBy
- startedAt
- endedAt
- status
- startAnchor
- confidence
- deviceCapabilities

وحالة:

- ACTIVE
- COMPLETED
- CANCELLED
- REVIEW_REQUIRED

---

# 13. Trajectory

أنشئ:

`MappingTrackPoint`

يخزن عند الحاجة:

- sessionId
- timestamp
- x
- y
- floorId
- heading
- confidence
- sourceSummary

لا تخزن GPS دقيقًا بشكل غير ضروري إذا كان المستخدم داخل مبنى.

---

# 14. Auto Map Suggestions

لا تعدل خريطة B1 الرسمية مباشرة.

أنشئ:

`MapSuggestion`

الأنواع:

- NEW_NODE
- NEW_EDGE
- PLACE_ANCHOR
- CORRIDOR
- INTERSECTION
- DOOR
- ELEVATOR
- STAIRS
- ENTRANCE
- EXIT
- FLOOR_TRANSITION

الحالة:

- PENDING
- ACCEPTED
- REJECTED

---

# 15. اكتشاف الممر

ادمج Walkable Area من B2 مع الحركة.

إذا تحرك المستخدم مسافة متصلة عبر منطقة قابلة للمشي:
اقترح Corridor/Edge.

لا تعتبره رسميًا تلقائيًا.

---

# 16. اكتشاف التقاطع

إذا ظهر تغير واضح في المسارات المتاحة أو حركة المستخدم:

اقترح:

`INTERSECTION`

مع درجة ثقة.

لا تنشئ عشرات النقاط المتكررة.

---

# 17. إزالة التكرار

أنشئ:

`MapDeduplicationService`

حتى لا تصبح لدينا:

- قاعة 121 مرتين.
- المصعد نفسه 3 مرات.
- تقاطعات متلاصقة بلا داعٍ.

استخدم:

- المكان.
- المسافة التقريبية.
- الاسم.
- floor.
- visual anchor.
- confidence.

---

# 18. Loop Closure

إذا عاد المستخدم إلى مكان معروف أثناء نفس الجولة:

استخدم ذلك لتصحيح Drift.

مثال:

بدأ عند المدخل.
دار داخل المبنى.
عاد للمدخل.

صحح المسار بدل ترك خطأ الحركة يتراكم.

أنشئ abstraction باسم:

`LoopClosureService`

---

# 19. حفظ الأماكن أثناء الجولة

إذا اكتشفت B2:

`قاعة 121`

وكانت معروفة:
اربطها بالخريطة.

إذا لم تكن معروفة:
استخدم PlaceCandidate من B2 وأنشئ MapSuggestion.

لا تجعلها Shared/Official مباشرة.

---

# 20. خيار يدوي أثناء المسح

المستخدم/المسؤول يستطيع قول أو اختيار:

- هذا مدخل.
- هذا مصعد.
- هذه قاعة.
- هذا درج.
- هذا تقاطع.
- احفظ هذا المكان.

تكون هذه المعلومة أعلى ثقة من الاستنتاج الآلي، لكن ليست أعلى من اعتماد رسمي.

---

# 21. شاشة المسح

أنشئ شاشة بسيطة باسم:

**مسح المبنى**

وتعرض:

- المبنى الحالي.
- الطابق المتوقع.
- حالة تحديد الموقع.
- دقة/ثقة الموقع.
- عدد النقاط المكتشفة.
- عدد الأماكن المعروفة.
- عدد الاقتراحات.
- بدء المسح.
- إيقاف المسح.
- إضافة نقطة يدويًا.

---

# 22. خريطة المسار أثناء المسح

للمستخدم المبصر/المشرف:
اعرض تمثيلًا بصريًا مبسطًا للمسار الحالي.

لكن لا تعتمد عليه للمستخدم الكفيف.

للمستخدم الكفيف:
أعلن فقط معلومات مهمة مثل:

«تم التعرف على قاعة 121.»

«تم تسجيل تقاطع جديد.»

«فقدت بصيرة الثقة بموقعك. ابحث عن لوحة أو نقطة معروفة.»

---

# 23. Lost Localization

أنشئ حالة:

`LOCALIZATION_LOST`

إذا انخفضت الثقة بشدة.

لا تستمر وكأن المكان معروف.

اعرض:

**تعذر تحديد موقعك بدقة داخل المبنى.**

واقترح:

- توجيه الكاميرا نحو لوحة.
- العودة لنقطة معروفة.
- مسح QR.
- اختيار مكان معروف يدويًا.

---

# 24. Relocalization

عند العثور على:

- Room sign.
- Elevator sign.
- Entrance.
- QR.
- NFC.
- known visual anchor.

أعد تثبيت الموقع.

ثم:

`LOCALIZATION_RECOVERED`

---

# 25. أذونات الحركة

فعّل الأذونات التي جُهزت في B1 عند الحاجة فقط.

اطلب:

- Motion/Orientation
- Bluetooth عند استخدامه مستقبلًا
- Location عند الحاجة

لا تطلب Background Location.

---

# 26. Bluetooth Layer

أنشئ:

`BeaconLocalizationProvider`

كـ abstraction قابل للتنفيذ لاحقًا.

إذا كان Web Bluetooth متاحًا ويمكن استخدامه بشكل مناسب:
استخدمه ضمن الحدود المسموح بها.

لكن لا تجعل B3 تعتمد عليه.

---

# 27. Wi-Fi Layer

أنشئ:

`WifiLocalizationProvider`

كتجريد للمستقبل.

نسخة الويب غالبًا لن تملك وصولًا كافيًا لبيانات Wi-Fi.

لا تختلق بيانات.

جهز adapter للنسخة Native مستقبلًا.

---

# 28. QR Anchor

أضف دعم QR كطريقة رخيصة ودقيقة للمباني.

مثال QR يحمل معرفًا مثل:

`basira://building/12/floor/1/node/81`

عند مسحه:
تثبت بصيرة موقعها مباشرة.

لا تخزن أسرارًا داخل QR.

---

# 29. NFC Anchor

جهز:

`NfcAnchorProvider`

إن لم يكن مدعومًا في الويب الحالي:
ضع adapter فقط.

---

# 30. بيانات الخصوصية

لا نريد بناء سجل مراقبة لحركة المستخدم.

فرق بين:

### Mapping Mode
يجوز حفظ المسار لأنه المستخدم أو المشرف اختار بناء خريطة.

### Normal Mode
لا تخزن Track history المستمر افتراضيًا.

بعد انتهاء Localization session:
احتفظ فقط بما يلزم للتشغيل.

---

# 31. المستخدم الشخصي

إذا قال المستخدم:

**احفظ هذا المكان باسم قاعتي**

يتم ربط SavedPlace من B1 بأفضل LocalizationEstimate الحالية.

هذه البيانات تبقى Private.

---

# 32. الثقة

أنشئ Confidence Model واضحًا.

مثال:

Visual Anchor = ثقة قوية.
QR = ثقة قوية جدًا.
Manual Anchor = قوية.
Motion Dead Reckoning = تقل مع الوقت.
GPS indoor = منخفضة.
Compass alone = منخفضة.

لا تجعل القيم مجرد Labels مبهمة؛ اجعل لها منطقًا واختبارات.

---

# 33. Uncertainty

يجب أن تعرف بصيرة أنها غير متأكدة.

أرجع:

- confidence
- uncertaintyRadius
- lastStrongAnchorAt

كلما ابتعد المستخدم عن Anchor دون تصحيح:
تقل الثقة تدريجيًا.

---

# 34. ربط B1 + B2 + B3

B1:
الخريطة المعروفة.

B2:
ما تراه الكاميرا.

B3:
أين يوجد المستخدم بالنسبة إلى الخريطة.

يجب أن تستخدم نفس:
- Building
- Floor
- Place
- MapNode
- MapEdge

لا تنشئ خريطة مستقلة.

---

# 35. العقود

أضف/حدث:

- LocalizationEstimate
- LocalizationSource
- LocalizationState
- MotionSample
- VisualAnchor
- MappingSession
- MappingTrackPoint
- MapSuggestion
- FloorEstimate
- HeadingEstimate
- RelocalizationEvent

Typed بالكامل.

---

# 36. API

أضف ما يلزم تحت:

`/api/navigation`

مثل:

- mapping sessions
- map suggestions
- accept/reject suggestion
- visual anchors
- mapping track upload إن لزم
- session finalize

لا تسمح للمستخدم العادي باعتماد خريطة عامة.

---

# 37. صلاحيات الإدارة

`mapper` و`admin` يستطيعان:

- تشغيل Mapping Mode الرسمي.
- مراجعة الاقتراحات.
- قبول/رفض MapSuggestion.

المستخدم العادي يستطيع:

- حفظ أماكنه الشخصية.
- استخدام خريطة موجودة.
- تقديم اقتراح محدود إن كان النظام يسمح بذلك.

---

# 38. لا تبدأ الملاحة

ممنوع في B3 تنفيذ:

- حساب الطريق الكامل.
- turn-by-turn.
- rerouting.
- destination guidance.
- voice navigation commands.

هذه B4.

يمكن فقط إظهار:

**موقعك الحالي: بالقرب من قاعة 121**

إذا كانت الثقة مناسبة.

---

# 39. الاختبارات

لا نريد E2E كامل حتى B6.

لكن يجب أن ينجح:

- `pnpm check`
- `pnpm build`
- جميع الاختبارات الحالية.

أضف Unit Tests لـ:

- confidence decay
- visual anchor correction
- QR relocalization
- deduplication
- loop closure
- lost/recovered state
- floor estimation
- mapping suggestions
- authorization

---

# 40. سيناريو B3 المطلوب

يجب أن يكون النظام قادرًا منطقيًا على هذا السيناريو:

1. المستخدم يدخل كلية التربية.
2. بصيرة تتعرف على المبنى.
3. يبدأ «مسح المبنى».
4. يثبت موقعه عند المدخل.
5. يبدأ بالمشي.
6. الحساسات تتبع الحركة.
7. B2 تقرأ «قاعة 118».
8. بصيرة تربطها بمكان معروف أو اقتراح جديد.
9. يواصل السير.
10. تكتشف 119 و120 و121.
11. تُبنى نقاط ومسارات مقترحة.
12. يعود المستخدم إلى نقطة معروفة.
13. Loop Closure يصحح الانحراف.
14. ينهي المسح.
15. تظهر الاقتراحات للمراجعة.
16. لا تدخل الخريطة الرسمية إلا بعد اعتمادها.

---

# GitHub

بعد اكتمال B3:

أنشئ commit واضحًا.

ارفع الفرع إلى:

`origin/codex/b3-localization-auto-mapping`

لا تدمجه مع main.

وفي التقرير النهائي أعطني:

- ما تم تنفيذه.
- مصادر تحديد الموقع المستخدمة فعليًا.
- ما يعمل على الويب.
- ما يحتاج Native.
- دقة الموقع التي يمكن قياسها فعليًا، إن تم قياسها.
- كيف يعمل Sensor Fusion.
- كيف يتم Lost/Relocalization.
- كيف تعمل Mapping Sessions.
- كيف تبنى MapSuggestions.
- كيف يمنع التكرار.
- كيف يعمل Loop Closure.
- الملفات الجديدة والمعدلة.
- APIs.
- migrations.
- الاختبارات.
- نتيجة build/check.
- اسم الفرع.
- commit.
- رابط GitHub.
- تأكيد أن main لم يتغير.

لا تبدأ B4.