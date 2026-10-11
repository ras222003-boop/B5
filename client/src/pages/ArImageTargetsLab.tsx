import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n } from '@/i18n';
import {
  startBasiraImageTargetSession,
  type BasiraImageTargetSession,
} from '@/lib/ar/imageTargetEngine';
import { BASIRA_LAB_LANDMARK, type LandmarkDetection } from '@/lib/ar/imageTargetLandmarks';

const LAB_ENABLED = import.meta.env.VITE_BASIRA_AR_LAB_ENABLED === 'true';
const markerUrl = '/ar/targets/basira-lab-marker.svg';
const button = 'min-h-12 rounded-xl border border-amber-300 px-5 py-3 font-semibold text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:opacity-40';

export default function ArImageTargetsLab() {
  const { lang } = useI18n();
  const isArabic = lang === 'ar';
  const isChinese = lang === 'zh-CN';
  const s = (ar: string, en: string, zh: string) => isArabic ? ar : isChinese ? zh : en;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<BasiraImageTargetSession | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const lastSpoken = useRef(0);
  const [consented, setConsented] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [working, setWorking] = useState(false);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState('');
  const [detection, setDetection] = useState<LandmarkDetection | null>(null);
  const [error, setError] = useState('');
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const cameraSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const stop = () => {
    generation.current++;
    sessionRef.current?.stop();
    sessionRef.current = null;
    if (mounted.current) {
      setWorking(false);
      setStarted(false);
      setDetection(null);
      setStatus(s('الكاميرا متوقفة.', 'Camera stopped.', '相机已停止。'));
    }
  };

  useEffect(() => {
    mounted.current = true;
    const onHidden = () => { if (document.visibilityState === 'hidden') stop(); };
    const onPageHide = () => stop();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mounted.current = false;
      generation.current++;
      sessionRef.current?.stop();
      sessionRef.current = null;
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  const handleDetection = (event: LandmarkDetection) => {
    if (!mounted.current) return;
    setDetection(event);
    if (event.state === 'found' && voiceEnabledRef.current && Date.now() - lastSpoken.current > 7000) {
      lastSpoken.current = Date.now();
      if (typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
        const announcement = new SpeechSynthesisUtterance(s(
          BASIRA_LAB_LANDMARK.description,
          'Basira test marker found. This does not confirm your location inside a real building.',
          '检测到 Basira 测试标记。这不代表已确认您在真实建筑物中的位置。',
        ));
        announcement.lang = isArabic ? 'ar-SA' : isChinese ? 'zh-CN' : 'en-US';
        try { window.speechSynthesis.speak(announcement); } catch { /* voice is optional */ }
      }
    }
  };

  const start = async () => {
    if (!LAB_ENABLED || !consented || !secure || !cameraSupported || working || started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const key = ++generation.current;
    setWorking(true);
    setError('');
    setDetection(null);
    setStatus(s('جارٍ تهيئة محرك التعرف على العلامات…', 'Loading image target engine…', '正在加载图像识别引擎…'));
    try {
      const session = await startBasiraImageTargetSession(canvas, {
        onStatus: newStatus => { if (mounted.current && generation.current === key) setStatus(newStatus); },
        onDetection: event => { if (mounted.current && generation.current === key) handleDetection(event); },
        onError: () => { if (mounted.current && generation.current === key) setError('AR camera pipeline error'); },
      });
      if (!mounted.current || generation.current !== key) {
        session.stop();
        return;
      }
      sessionRef.current = session;
      setStarted(true);
    } catch (reason) {
      if (mounted.current && generation.current === key) {
        setError(reason instanceof Error ? reason.message : 'ar_session_failed');
        setStatus(s('لم تبدأ التجربة؛ يمكنك استخدام بقية خدمات بصيرة.', 'Demo could not start; Basira remains available.', '实验无法启动；Basira 的其他功能仍可使用。'));
      }
    } finally {
      if (mounted.current && generation.current === key) setWorking(false);
    }
  };

  return <Layout>
    <main className="container max-w-5xl space-y-6 py-8 text-stone-100" dir={isArabic ? 'rtl' : 'ltr'} lang={lang}>
      <Link href="/navigation" className="inline-block min-h-10 text-amber-300 underline">
        {s('العودة إلى الملاحة', 'Back to navigation', '返回导航')}
      </Link>
      <h1 className="text-3xl font-black">{s('مختبر بصيرة — التعرف على العلامات بـ 8th Wall', 'Basira lab — 8th Wall Image Targets', 'Basira 实验室 — 8th Wall 图像识别')}</h1>
      <p className="rounded-xl border border-amber-500 bg-stone-900 p-4" role="note">
        {s(
          'تجربة معملية للتعرف على علامة مطبوعة ومحددة مسبقًا، وليست نظام تحديد موقع حقيقيًا أو أداة آمنة لتجنب الاصطدام. لا تختبرها أثناء المشي.',
          'Experimental recognition of a pre-registered printed marker. Not real building localization or safe obstacle avoidance. Test while stationary.',
          '仅用于识别预先登记的测试标记。不代表已实现室内定位或安全避障。请保持静止进行测试。',
        )}
      </p>
      {!LAB_ENABLED && <p className="rounded-xl border p-4" role="status">
        {s('المختبر معطل في هذا النشر. يتطلب تفعيل VITE_BASIRA_AR_LAB_ENABLED=true في بيئة معاينة خاصة، ثم إعادة البناء.', 'This lab is disabled in this deployment. Enable VITE_BASIRA_AR_LAB_ENABLED=true in a private preview build.', '此版本未启用实验功能。')}
      </p>}
      {!secure && <p role="alert">{s('يجب فتح الصفحة عبر HTTPS.', 'HTTPS is required.', '需要 HTTPS。')}</p>}
      {!cameraSupported && <p role="alert">{s('الكاميرا غير متاحة لهذا المتصفح.', 'Camera is unavailable in this browser.', '浏览器无法使用相机。')}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-amber-200/25 bg-stone-900 p-4">
          <h2 className="text-xl font-bold">{s('علامة التدريب', 'Training marker', '训练标记')}</h2>
          <img src={markerUrl} width={240} height={320} loading="lazy" alt={s('علامة تدريب سوداء وبيضاء مميزة مكتوب عليها BASIRA LAB A1', 'Black and white BASIRA LAB A1 training marker', 'BASIRA LAB A1 黑白训练标记')} className="mx-auto max-h-72 w-auto rounded-xl border border-stone-400 bg-white"/>
          <a className="inline-block rounded-lg bg-amber-300 px-4 py-3 font-bold text-stone-950" target="_blank" rel="noopener noreferrer" href={markerUrl}>{s('افتح العلامة للطباعة أو العرض على جهاز ثانٍ', 'Open marker to print or show on second device', '打开标记进行打印或在另一设备上展示')}</a>
          <p className="text-sm text-stone-300">{s('وجّه كاميرا الجهاز نحو نسخة مطبوعة أو ظاهرة على شاشة أخرى. عرض العلامة على الهاتف نفسه لا يكفي.', 'Point the camera at a print or another screen. The same phone screen is not a camera target.', '请将相机对准纸质标记或另一屏幕。')}</p>
        </section>
        <section className="space-y-4 rounded-2xl border border-amber-200/25 bg-stone-900 p-4">
          <h2 className="text-xl font-bold">{s('تجربة الكاميرا', 'Camera lab', '相机实验')}</h2>
          <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black">
            <canvas ref={canvasRef} aria-label={s('معاينة كاميرا الاختبار', 'Test camera preview', '测试相机预览')} className="h-full w-full object-cover"/>
          </div>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={consented} onChange={event => setConsented(event.target.checked)} disabled={working || started}/>
            <span>{s('أوافق على تشغيل الكاميرا وتحميل محرك 8th Wall التجريبي من CDN عند الضغط على البدء.', 'I consent to camera access and loading the experimental 8th Wall engine from a CDN when I press Start.', '我同意在点击开始后访问相机并从 CDN 加载实验性引擎。')}</span>
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={voiceEnabled} onChange={event => { voiceEnabledRef.current = event.target.checked; setVoiceEnabled(event.target.checked); }} disabled={working}/>
            <span>{s('الإعلان الصوتي المحلي عند اكتشاف العلامة', 'Local voice announcement when marker is found', '识别标记时本地语音播报')}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={button} onClick={() => void start()} disabled={!LAB_ENABLED || !secure || !cameraSupported || !consented || working || started}>
              {working ? s('جارٍ التشغيل…', 'Starting…', '启动中…') : s('بدء اكتشاف العلامة', 'Start image target', '启动图像识别')}
            </button>
            <button type="button" className={button} onClick={stop} disabled={!started && !working}>{s('إيقاف الكاميرا', 'Stop camera', '停止相机')}</button>
          </div>
          <p role="status" aria-live="polite">{status || s('الكاميرا مغلقة.', 'Camera is off.', '相机已关闭。')}</p>
          {error && <p role="alert" className="text-red-300">{s('تعذر التشغيل: ', 'Unable to start: ', '无法启动：')}{error}</p>}
          {detection && <div role="status" aria-live="polite" className="rounded-xl border border-amber-400 p-4">
            <strong>{detection.state === 'found' ? s('تم اكتشاف علامة الاختبار', 'Training marker found', '检测到训练标记') : s('فُقد تتبع العلامة', 'Marker tracking lost', '丢失标记跟踪')}</strong>
            <p>{s(BASIRA_LAB_LANDMARK.description, 'Test marker only, not verified building location.', '仅限测试标记，非真实建筑物定位。')}</p>
            <p className="text-sm text-stone-300">{new Date(detection.observedAt).toLocaleTimeString(lang)}</p>
          </div>}
        </section>
      </div>
      <p className="text-sm text-stone-300">{s('الصور وبيانات العلامة تبقى في جلسة الكاميرا المحلية، ولا تسجل هذه الصفحة موقعك الجغرافي. يتطلب تشغيل SDK تنزيل ملفات من CDN؛ يجب مراجعة سياسة الخصوصية والتراخيص قبل إطلاق عام.', 'The page does not log GPS location or upload camera frames. Engine scripts are fetched from a CDN; privacy and licensing review is needed before public release.', '本页面不记录 GPS 位置或上传摄像头画面。引擎从 CDN 加载，公开发布前需审查隐私与许可。')}</p>
    </main>
  </Layout>;
}
