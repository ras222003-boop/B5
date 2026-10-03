# ربط حسابات بصيرة والدعم والنطاق

الموقع يعمل بواجهة React وخادم Express على HTTPS، وتخزن قاعدة MySQL المُدارة الحسابات وتذاكر الدعم. ثبتت مكتبة Better Auth على الإصدار 1.7.7. ينفذ الخادم مخططات `server/migrations/*.sql` قبل بدء الاستماع؛ لا تُدرج سلسلة اتصال قاعدة البيانات أو مفاتيح OAuth في المستودع.

## تسجيل الدخول

التسجيل بالبريد وكلمة المرور متاح عند تشغيل المشروع المُدار، وتظهر أزرار الدخول الاجتماعي **غير مفعلة بوضوح** إلى أن تُضبط مفاتيح موفريها. يحتاج كل مزود إلى إنشاء تطبيق OAuth خاص بمالك الموقع وإدخال بياناته عبر بطاقة أسرار WebDev، لا في المصدر. يُستعمل عنوان موقع HTTPS النهائي كأصل العودة المسموح به، ويضبط `BASIRA_PUBLIC_URL` كأصل HTTPS كامل من دون مسار، مثل `https://example.com`.

| المزود | متغيرات البيئة الخاصة | عنوان العودة لدى المزود |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://your-domain/api/auth/callback/google` |
| Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `https://your-domain/api/auth/callback/microsoft` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | `https://your-domain/api/auth/callback/apple` |
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | `https://your-domain/api/auth/callback/facebook` |

مزوّد Apple يحتاج Service ID ونطاقًا HTTPS معتمدًا في بوابة Apple Developer؛ لا يعمل على `localhost`. يستخدم الخادم مفتاح Apple الخاص لإنشاء JWT صالح زمنيًا. يتطلب Google وMicrosoft وFacebook أيضًا قبول عنوان العودة الفعلي في إعدادات التطبيقات. ترتبط ملفات تعريف الارتباط الآمنة بجلسات الحساب على HTTPS؛ لا يُدرج أي رمز دخول أو كلمة مرور في متغيرات الواجهة `VITE_*`.

## بريد الدعم

بريد استقبال التذاكر هو `aurum.nexus.r1@gmail.com`. تُخزن التذاكر أولًا في `basira_support_tickets`، ثم يحاول الخادم إرسال إشعار بها. تضبط إعدادات الخادم بأسماء المتغيرات الموجودة في `.env.example`: `SUPPORT_SMTP_HOST=smtp.gmail.com` و`SUPPORT_SMTP_PORT=587` و`SUPPORT_SMTP_SECURE=false` و`SUPPORT_SMTP_USER=aurum.nexus.r1@gmail.com` و`SUPPORT_EMAIL_FROM=aurum.nexus.r1@gmail.com` و`SUPPORT_EMAIL_TO=aurum.nexus.r1@gmail.com`. أضف `SUPPORT_SMTP_PASSWORD` بكلمة مرور تطبيق Gmail إلى أسرار الاستضافة فقط، لا إلى المستودع. يدعم الخادم أيضًا منفذ 465 مع `SUPPORT_SMTP_SECURE=true` عند استخدام مزود مناسب. إذا غابت أي قيمة مطلوبة، تبقى التذكرة محفوظة بحالة بريد معلقة، ويُظهر التطبيق أن إرسال البريد غير مفعّل. تعيد المهمة الخادمية محاولة التذاكر المعلقة أو المرفوضة عند تشغيل الخادم بإعدادات بريد صحيحة، ضمن حد ثلاث محاولات؛ أما نتائج الإرسال غير المؤكدة فلا تعاد تلقائيًا تجنبًا لرسالة مكررة. قبول خادم SMTP لا يؤكد وصول الرسالة إلى صندوق الوارد.

## النطاق والنشر

يوفر رابط المعاينة HTTPS مؤقتًا داخل بيئة العمل. أما النطاق المخصص فيتطلب أن يحدد المالك النطاق الذي يملكه ويضبط سجلات DNS المطلوبة من صفحة Domains للموقع المنشور. لا يمكن استنتاج ملكية نطاق من اسم المشروع. ثم يُضبط `BASIRA_PUBLIC_URL` ويوضع عنوان العودة المذكور أعلاه لدى كل مزود. لا يمثل دفع المصدر إلى GitHub، أو تشغيل المعاينة، دليلًا على نجاح النشر الدائم؛ يتطلب ذلك نقطة WebDev محفوظة ونتيجة Publish ناجحة.

مراجع التنفيذ: [Better Auth/Express](https://www.better-auth.com/docs/integrations/express)، [MySQL](https://www.better-auth.com/docs/adapters/mysql)، [Apple](https://www.better-auth.com/docs/authentication/apple)، [Nodemailer SMTP](https://nodemailer.com/smtp).
