import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n } from '@/i18n';
import { readBasiraArPreflight, basiraArFeatureState, type ArBrowserPreflight } from '@/lib/ar/browserCapabilities';
import { BASIRA_AR_FEATURES, type BasiraArFeatureId } from '@/lib/ar/featurePolicy';

const featureCopy: Record<BasiraArFeatureId, {ar:string;en:string;zh:string;url:string|null}> = {
 'image-targets': {ar:'التعرف على العلامات البصرية',en:'Recognize prepared visual markers',zh:'识别预先登记的图像标记',url:'/navigation/ar-lab/image-targets'},
 'face-effects': {ar:'تتبع الوجه — تجربة خصوصية اختيارية',en:'Face tracking — private opt-in experiment',zh:'人脸跟踪可选实验',url:'/navigation/ar-lab/face'},
 'sky-effects': {ar:'فصل طبقة السماء — تجربة بصرية',en:'Sky segmentation — visual experiment',zh:'天空分割视觉实验',url:'/navigation/ar-lab/sky'},
 'world-tracking': {ar:'تتبع العالم — يتطلب محركًا بترخيص منفصل',en:'World tracking — separate binary license required',zh:'世界跟踪 — 需要单独授权',url:'/navigation/ar-lab/world'},
 'world-effects': {ar:'مؤثرات العالم ثلاثية الأبعاد — تحتاج ترخيص SLAM',en:'3D world effects — SLAM license required',zh:'三维世界特效 — 需要 SLAM 许可',url:'/navigation/ar-lab/world'},
 'absolute-scale': {ar:'تقدير المقياس بالأمتار — ليس قياسًا مباشرًا للأجسام',en:'Meter-scale world coordinates — not object depth',zh:'世界坐标米制估计 — 并非物体深度',url:'/navigation/ar-lab/world'},
};
const enabled=import.meta.env.VITE_BASIRA_AR_LAB_ENABLED !== 'false';
export default function ArLabsHub() {
  const {lang}=useI18n();
  const s=(ar:string,en:string,zh:string)=>lang==='ar'?ar:lang==='zh-CN'?zh:en;
  const [preflight,setPreflight]=useState<ArBrowserPreflight|null>(null);
  useEffect(()=>setPreflight(readBasiraArPreflight()),[]);
  return <Layout><main className="container max-w-5xl space-y-6 py-8 text-stone-100" lang={lang} dir={lang==='ar'?'rtl':'ltr'}>
    <Link href="/navigation" className="inline-block min-h-10 text-amber-300 underline">{s('العودة إلى الملاحة', 'Back to navigation', '返回导航')}</Link>
    <h1 className="text-3xl font-black">{s('مختبرات 8th Wall في بصيرة','Basira 8th Wall experimental labs','Basira 8th Wall 实验室')}</h1>
    <p role="note" className="rounded-xl border border-amber-300 bg-stone-900 p-4">
    {s('هذه صفحات بحثية إضافية لا تستبدل الخرائط أو التعرف على الأشياء أو LiDAR أو الاختبارات، ولا تؤكد سلامة التجول أو دقة الأمتار.',
        'Optional research labs; they do not replace maps, object recognition, LiDAR, exams, or establish walking safety and meter accuracy.',
        '这些是附加研究实验，不取代现有导航、目标识别或考试功能。')}
    </p>
    {!enabled && <p role="status" className="rounded-xl border border-amber-300/30 p-4">{s('التجارب معطلة في النسخة الحالية. فعّل VITE_BASIRA_AR_LAB_ENABLED=true في معاينة خاصة وأعد البناء.','Labs are disabled here. Enable VITE_BASIRA_AR_LAB_ENABLED=true in a private preview and rebuild.','当前构建未启用实验功能。')}</p>}
    <section className="space-y-3 rounded-2xl border border-amber-200/30 bg-stone-900 p-5">
      <h2 className="text-xl font-bold">{s('فحص توافق الجهاز (دون طلب الكاميرا)', 'Device preflight (without requesting the camera)', '设备预检查（无需打开相机）')}</h2>
      {preflight ? <ul className="space-y-1">
        <li>{s('اتصال HTTPS آمن','Secure origin','安全连接')}: {preflight.secureOrigin ? '✓' : '×'}</li>
        <li>{s('واجهة الكاميرا','Camera API','相机 API')}: {preflight.cameraApi ? '✓' : '×'}</li>
        <li>WebGL: {preflight.webgl ? '✓' : '×'}</li>
        <li>{s('جاهز لطلب الإذن (ليس إثبات دعم SDK)','Ready for permission prompt (not proof of SDK support)','准备申请权限（不代表支持 SDK）')}: {preflight.readyForPermissionRequest?'✓':'×'}</li>
      </ul>:<p>{s('يجري الفحص…','Checking…','检查中…')}</p>}
      <p className="text-sm text-stone-300">{s('إذا تعذرت التجارب، تظل خدمات بصيرة الأخرى متاحة. لا تستخدم هذه المختبرات أثناء المشي.','If AR is unsupported, the rest of Basira remains available. Do not test these labs while walking.','如果设备不支持 AR，仍可使用 Basira 其他功能。')}</p>
    </section>
    <section className="grid gap-4 md:grid-cols-2">
      {BASIRA_AR_FEATURES.map(feature=>{
        const copy=featureCopy[feature.id];
        const state=basiraArFeatureState(feature.id);
        return <article key={feature.id} className="space-y-2 rounded-xl border border-amber-200/25 bg-stone-900 p-5">
          <h2 className="text-lg font-bold">{s(copy.ar,copy.en,copy.zh)}</h2>
          <p className="text-sm text-stone-300">{state==='license-gated' ? s('محرك ثنائي مقيّد: غير مفعّل للإنتاج أو الاشتراكات','Restricted binary: not enabled for production/subscriptions','受限引擎：未在生产环境启用') : s('مكوّن MIT: مختبر تجريبي، غير معتمد على أجهزة فعلية','MIT component: experimental, not yet validated on devices','MIT 组件：实验性，尚未在真实设备验证')}</p>
          {copy.url && <Link href={copy.url} className="inline-flex min-h-12 items-center rounded-lg border border-amber-300 px-4 py-2 font-semibold text-amber-100">{state==='license-gated'?s('متطلبات الاختبار والترخيص','Review readiness','审核要求'):s('فتح المختبر','Open experiment','打开实验室')}</Link>}
        </article>;
      })}
    </section>
    <section className="space-y-4 rounded-2xl border border-amber-300/40 bg-stone-900 p-5" aria-label={s('طرق حساب المسافات بالأمتار','How metres are measured','米制测距方式')}>
      <h2 className="text-xl font-bold">{s('الأمتار في بصيرة: اختر القياس الصحيح','Metres in Basira: choose the right measurement','Basira 米制测量')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-amber-200/20 p-4 space-y-2">
          <h3 className="font-semibold">{s('حركة الهاتف بالأمتار — Absolute Scale','Camera movement in metres — Absolute Scale','相机位移（米）')}</h3>
          <p className="text-sm text-stone-200">{s('يقدّر المسافة بين موضعي الكاميرا بعد استقرار SLAM، وليس بُعد الأجسام. يتطلب ترخيص المحرك الثنائي واختبارًا خاصًا.','Estimates movement between camera poses after tracking. Does not measure objects. Requires restricted binary approval and a separate test.','估计相机的位移，不等于到物体的距离。')}</p>
          <a className="text-amber-200 underline" href="/navigation/ar-lab/world-scale-sandbox">{s('فتح معايرة الأمتار المكانية','Open spatial metre calibration','打开空间米数校准')}</a>
        </article>
        <article className="rounded-xl border border-amber-200/20 p-4 space-y-2">
          <h3 className="font-semibold">{s('بعد الأسطح عن الكاميرا — LiDAR / ARCore','Surface depth — LiDAR / ARCore','物体表面深度')}</h3>
          <p className="text-sm text-stone-200">{s('يحتاج تطبيقًا أصليًا ومستشعر عمق متوافقًا للتحقق من المسافة إلى سطح الجسم. Safari وحده لا يقرأ LiDAR الخام.','Needs a native application and validated camera-depth sensor. Safari alone cannot read iPhone LiDAR depth.','需要原生应用和可信的深度数据。')}</p>
          <Link className="text-amber-200 underline" href="/navigation/vision">{s('فتح رؤية بصيرة وحالة قياس العمق','Open Basira Vision depth status','打开 Basira Vision 深度状态')}</Link>
        </article>
      </div>
      <p className="text-sm text-amber-100">{s('لا يُسمح لقياس حركة الكاميرا بإصدار تنبيه اقتراب كرسي أو درج. المختبرات ليست أدوات تنقل آمن.','Camera movement must never trigger chair or stair obstacle-distance alerts. Labs are not safe-navigation tools.','相机位移不可用于椅子或楼梯的避障警告。')}</p>
    </section>
    <section className="space-y-3 rounded-2xl border border-amber-200/30 bg-stone-900 p-5">
      <h2 className="text-xl font-bold">{s('إعداد معالم المؤسسات المعتمدة','Prepare verified institutional landmarks','准备已验证机构标记')}</h2>
      <p>{s('اطلع على الغرف العامة المعتمدة في خرائط بصيرة، وجهز قائمة تسجيل للعلامات البصرية دون ادعاء تحديد موقع فعلي.',
        'Read approved public rooms from existing Basira maps and prepare a draft marker-registration list without claiming physical localization.',
        '查看官方验证的公共房间并准备标记登记草稿。')}</p>
      <Link href="/navigation/ar-lab/venues" className="inline-flex min-h-12 items-center rounded-lg border border-amber-300 px-4 py-2 font-bold text-amber-100">
        {s('فتح مخطط المعالم','Open landmark planner','打开标记规划')}
      </Link>
    </section>
    <section className="rounded-2xl border border-amber-200/20 p-5">
      <h2 className="text-xl font-bold">{s('توجيه المستخدم وبدائل الأجهزة غير المدعومة','Coaching and unsupported-device fallback','使用指导与不支持设备回退')}</h2>
      <p>{s('قبل كل تجربة: اجلس أو قف بثبات في مكان آمن، افتح الموقع عبر HTTPS، وافق على الكاميرا عند الحاجة، واستخدم جهازًا ثانيًا لعرض علامات الاختبار. يمكن إيقاف الجلسة في أي وقت.','Before experimenting: remain stationary in a safe location, open over HTTPS, opt in to camera use, and display test markers on a second device. Stop any time.','请在安全固定的位置测试，使用 HTTPS，并主动授权相机。')}</p>
    </section>
  </main></Layout>;
}
