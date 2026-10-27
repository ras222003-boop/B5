# معاينة HTTPS المستقلة لمحرك الاقتراب

المعاينة على مستودع `ras222003-boop/basira-iphone-research-preview` وفرعه `codex/preview`. عنوانها بعد التحقق من الإصدار الجديد:

`https://ras222003-boop.github.io/basira-iphone-research-preview/#/navigation/vision`

هذا المسار منفصل عن موقع الإنتاج. سير عمل Pages في المستودع المستقل يدوي (`workflow_dispatch`) ويجمع نموذج V3 من أجزاء موثقة قبل النشر؛ دفع الفرع وحده لا ينشر نسخة جديدة. لا تدمج هذا الفرع في `main` ولا تستخدم نشر الإنتاج.

## تحضير بناء قابل للنشر

من نسخة B5 نظيفة وبعد تثبيت commit المصدر:

```powershell
$sourceCommit = (git rev-parse HEAD).Trim()
git status --porcelain
$build = '.vision-ai/adaptive-approach-iphone-preview-release'
node scripts/github-preview/build.mjs $sourceCommit .vision-ai/object-quality /basira-iphone-research-preview/ $build
node scripts/github-preview/approach-ui-smoke.mjs $build "$build/approach-ui-smoke.json"
$photo = 'C:\Users\Asus\Documents\ChatGPT\بصيرة\.vision-test-fixtures\object-colors-development-001\images\de8a8b01519aea3d.png'
node scripts/github-preview/smoke.mjs $build $photo "$build/full-smoke.json"
```

يجب أن تكون نتيجة `git status --porcelain` فارغة، وأن يذكر البناء `publishable: true`. مجلد `$build` يجب أن يكون جديدًا. البناء الذي يستعمل `--development` غير قابل للتغليف أو النشر. اختبار الواجهة يفحص عرض 390 بكسل، وجود إعدادات الاقتراب والحالة عند اختيار Lite0 وTiny وV3، وتنبيه Safari، وعدم إصدار طلبات كتابة أو طلبات خارج نطاق المعاينة. اختبار `smoke` الكامل يستخدم صورة الكرسي المحلية المرخّصة التي استُخدمت سابقًا للتحقق من النماذج الثلاثة، ويشغّل مسار كاميرا وميكروفون برمجيين، ثم يتحقق من الإيقاف والتراجع. لا تُرفع الصورة إلى Pages. هذه اختبارات متصفح مكتبي، وليست تجربة iPhone أو LiDAR أو اهتزازات.

## تحديث المستودع المستقل

استخدم استنساخًا نظيفًا جديدًا من مستودع Pages، ثم خذ `parent` من الفرع البعيد نفسه. سكربت التحديث يرفض تغيّر الفرع البعيد أو النموذج، ويجهز commit مستقلًا دون دفعه. سكربت النقل يتحقق من النموذج والملفات قبل دفع commits متتابعة دون force push.

```powershell
$pages = '.vision-ai/adaptive-approach-pages-clean'
git clone --branch codex/preview https://github.com/ras222003-boop/basira-iphone-research-preview.git $pages
$parent = ((git -C $pages ls-remote origin refs/heads/codex/preview) -split '\s+')[0]
$update = node scripts/github-preview/update-delivery.mjs $build $pages $parent | ConvertFrom-Json
node scripts/github-preview/upload-stages.mjs $pages $update.commit '.vision-ai/adaptive-approach-pages-delivery.json' $parent
```

يتطلب النشر الفعلي تشغيل `Research Pages preview` يدويًا من فرع `codex/preview` في المستودع المستقل. لا تعتبر رابط الإصدار الجديد جاهزًا حتى تنجح Action ثم تنجح المطابقة عبر HTTPS:

```powershell
node scripts/github-preview/check-hosted.mjs https://ras222003-boop.github.io/basira-iphone-research-preview/ "$build/static-build-receipt.json" '.vision-ai/adaptive-approach-hosted.json'
node scripts/github-preview/approach-ui-smoke.mjs $build '.vision-ai/adaptive-approach-hosted-ui.json' https://ras222003-boop.github.io/basira-iphone-research-preview/
```

`check-hosted` يطابق تجزئة كل ملف منشور مع إيصال البناء ويطابق commit المصدر وحالة غياب الخادم وLiDAR الأصلي والاهتزازات الأصلية. تقرير النجاح النهائي يجب أن يحتوي commit المصدر وcommit النشر ورابط Action ورابط المعاينة. Safari لا يدعم اهتزازات المتصفح، والنسخة المستقلة لا تستعمل جسر LiDAR الأصلي؛ هذان المساران يحتاجان التطبيق الموقّع على iPhone حقيقي.
