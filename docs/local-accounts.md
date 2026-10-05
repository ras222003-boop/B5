# تشغيل حسابات بصيرة محليًا

## البدء على Windows

1. ثبّت Docker Desktop وشغّله حتى تصبح خدمة Docker جاهزة. ثبّت Node.js 24 و pnpm.
2. من جذر المستودع شغّل `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-local-basira.ps1`. يولّد الأمر كلمات مرور MySQL وسر توقيع الجلسات عشوائيًا، وينشئ `.env.local` المتجاهل في Git، ويشغّل MySQL 8.4 باسم `basira-mysql` على `127.0.0.1:3307` وينتظر فحص الصحة. تحفظ قاعدة `basira` بياناتها في volume مستقل.
3. لتمكين الصوت الحقيقي، أعد تشغيل الإعداد مع `-PromptForAzureKey` وأدخل مفتاح Azure Speech في الحقل المخفي. يُحفظ محليًا في `.env.local` فقط. منطقة الصوت `uaenorth` ومفاتيح التمكين مضبوطة في الإعداد. يمكن ترك المفتاح فارغًا واستخدام الصوت المحلي للمتصفح.
4. شغّل `pnpm install` ثم `pnpm dev` وافتح `http://localhost:3000/account`. اختر «إنشاء حساب»، وأدخل الاسم والبريد وكلمة مرور من عشرة أحرف على الأقل، ثم وافق على الشروط. بعد ظهور اسمك، حدّث الصفحة للتأكد من بقاء الجلسة، ثم جرّب الخروج والدخول مجددًا.
5. افتح `/settings/voice-validation` واختر `ar-SA-ZariyahNeural` أو `ar-SA-HamedNeural` للاستماع. يظهر `PREMIUM` عند نجاح الطلب الحي، و`LOCAL` عند الرجوع إلى صوت المتصفح. لا يُعدّ اختبار المزود البديل في الاختبارات تحققًا حيًا من Azure.

يقرأ أمر `pnpm dev` المتغيرات عبر Node قبل تحميل إعداد Vite أو خادم API. لا تحمل واجهة React أي متغير سرّي؛ لا تستخدم بادئة `VITE_` مع الأسرار. مسارات `/api/auth/*` و`/api/auth/providers` و`/api/speech/*` في التطوير تستخدم Better Auth وقاعدة البيانات نفسيهما اللذين يستخدمهما خادم الإنتاج. تُنفّذ migrations الإضافية من `server/migrations/` عند أول طلب API في التطوير وقبل فتح منفذ خادم الإنتاج. لا يحذف بدء التشغيل حسابات موجودة. ملفات الارتباط المحلية تعمل مع HTTP على localhost؛ أمر `pnpm start` يفرض وضع الإنتاج وملفات ارتباط Secure عبر HTTPS.

للتحقق الآلي بعد تشغيل `pnpm dev`: `node --env-file-if-exists=.env.local --import tsx scripts/auth-integration.ts` ثم `node --env-file-if-exists=.env.local --import tsx scripts/auth-browser-e2e.ts`. ينشئ الاختباران حسابًا مؤقتًا في MySQL ويحذفانه بعد التحقق. اختبار الصوت يستخدم مزودًا بديلًا دون أي مفتاح سحابي. نفّذ أيضًا `pnpm check` و`pnpm test` و`pnpm build`.

## إعداد OAuth لاحقًا

المسار مأخوذ من Better Auth 1.7.7 المستخدم هنا: `/api/auth/callback/:id`، ويستعمل معرّف المزود `google` أو `microsoft` أو `facebook` أو `apple`. سجّل عناوين العودة التالية في بوابات المزودين، ثم أضف بيانات الاعتماد إلى أسرار الخادم فقط. تعرض `/api/auth/providers` حالة اكتمال الإعداد؛ الأزرار الناقصة معطلة.

| المزود | localhost، إذا سمحت بوابته | الإنتاج |
| --- | --- | --- |
| Google | `http://localhost:3000/api/auth/callback/google` | `https://basira-ve3h8rof.manus.space/api/auth/callback/google` |
| Microsoft | `http://localhost:3000/api/auth/callback/microsoft` | `https://basira-ve3h8rof.manus.space/api/auth/callback/microsoft` |
| Facebook | `http://localhost:3000/api/auth/callback/facebook`، وفق قيود Meta الحالية | `https://basira-ve3h8rof.manus.space/api/auth/callback/facebook` |
| Apple | استخدم نطاق تطوير HTTPS مسجّلًا لدى Apple؛ لا تعتمد على HTTP localhost | `https://basira-ve3h8rof.manus.space/api/auth/callback/apple` |

المتغيرات: `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET`؛ `MICROSOFT_CLIENT_ID` و`MICROSOFT_CLIENT_SECRET`؛ `FACEBOOK_CLIENT_ID` و`FACEBOOK_CLIENT_SECRET`؛ و`APPLE_CLIENT_ID` و`APPLE_TEAM_ID` و`APPLE_KEY_ID` و`APPLE_PRIVATE_KEY`. يدعم مفتاح Apple الخاص أسطرًا حقيقية أو `\\n` داخل متغير بيئة واحد. حالة الزر «متاح» تعني اكتمال المتغيرات، ثم يلزم اختبار التدفق الحقيقي بعد اعتماد إعدادات البوابة. يتطلب Apple نطاق HTTPS مسجّلًا، وقد لا يقبل localhost. راجع متطلبات كل بوابة عند التسجيل.

## الإنتاج

وفّر `DATABASE_URL` لقاعدة MySQL دائمة، و`MANUS_JWT_SECRET` عشوائيًا قويًا، و`NODE_ENV=production` أو استخدم `pnpm start`، وبيانات Azure (`AZURE_SPEECH_KEY`، `AZURE_SPEECH_REGION=uaenorth`، `AZURE_TTS_ENABLED=true`، `PREMIUM_TTS_ENABLED=true`) عبر مخزن أسرار الاستضافة. أضف بيانات OAuth عند توفرها. اضبط `BASIRA_PUBLIC_URL` إذا تغير النطاق. لا ترفع `.env.local` أو ملفات المفاتيح إلى Git، ولا تضع الأسرار في متغيرات `VITE_`. اختبر `GET /api/readiness` بعد النشر.
