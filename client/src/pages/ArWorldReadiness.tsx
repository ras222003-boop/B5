import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n } from '@/i18n';
export default function ArWorldReadiness() {
  const {lang}=useI18n();
  const s=(ar:string,en:string,zh:string)=>lang==='ar'?ar:lang==='zh-CN'?zh:en;
  return <Layout><main className="container max-w-4xl space-y-5 py-10 text-stone-100" dir={lang==='ar'?'rtl':'ltr'} lang={lang}>
    <Link href="/navigation/ar-lab" className="text-amber-300 underline">{s('عودة إلى المختبرات','Back to AR labs','返回 AR 实验室')}</Link>
    <h1 className="text-3xl font-black">{s('تتبع العالم ومقياس الأمتار — قيد اعتماد الترخيص','World tracking and meter scale — license review required','世界跟踪和米制估算 — 等待授权审核')}</h1>
    <p role="note" className="rounded-2xl border border-amber-300 bg-stone-900 p-5">{s(
      'هذه صفحة توضيحية وليست محرك SLAM قيد التشغيل. لا يتم تحميل المحرك الثنائي المقيّد أو قياس أي مسافات أو تفعيل أي تنبيه ملاحة.',
      'This is an information page, not a running SLAM engine. No restricted binary is fetched, no metres are measured, and no mobility alerts are enabled.',
      '这是信息页面，并非 SLAM 实时功能。不会加载受限引擎或测量距离。')}</p>
    <h2 className="text-xl font-bold">{s('قبل التفعيل التجريبي','Before an experiment may be enabled','启用实验前')}</h2>
    <ol className="list-inside list-decimal space-y-3 rounded-xl border border-amber-200/20 bg-stone-900 p-5">
      <li>{s('مراجعة قانونية لترخيص XR Engine Binary والاستخدام التجاري في اشتراكات بصيرة.','Review the XR Engine Binary license for Basira subscriptions.','审查商业许可。')}</li>
      <li>{s('الحصول على موافقة صريحة لتفعيل محرك منفصل في بيئة تجريبية فقط.','Obtain explicit approval for a separate private test environment.','取得明确的实验许可。')}</li>
      <li>{s('مقارنة أمتار المشهد مع مسافات مرجعية حقيقية عند 0.5 و1 و2 و3 و5 أمتار على كل جهاز.','Compare coordinates with 0.5, 1, 2, 3 and 5m physical measurements per device.','分别对每台设备校验真实距离。')}</li>
      <li>{s('تسجيل معدلات الفشل والخطأ الوسيط وP95، وتجنب التعامل مع المقياس العالمي كعمق جسم بعينه.','Record failures, median and P95 error; world-scale coordinates are not per-object depth.','记录误差；世界尺度并不等于物体深度。')}</li>
    </ol>
    <p><Link href="/navigation/ar-lab/world-scale-sandbox" className="inline-flex min-h-12 items-center rounded-lg border border-amber-300 px-4 py-2 font-semibold text-amber-100">{s('فحص بيئة المختبر المقيّد','Restricted research lab readiness','受限实验准备')}</Link></p>
    <p>{s('يظل LiDAR وARKit الموجودان في تجربة بصيرة الأصلية منفصلين عن هذه التجربة.','The existing Basira ARKit/LiDAR pilot remains separate.','现有 ARKit/LiDAR 功能保持独立。')}</p>
  </main></Layout>;
}
