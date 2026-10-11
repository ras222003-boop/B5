import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n } from '@/i18n';
import { startBasiraEffectsSession, type BasiraEffectsSession } from '@/lib/ar/effectsEngine';
import { effectHint, type EffectKind, type EffectState } from '@/lib/ar/effectEvents';

const ENABLED = import.meta.env.VITE_BASIRA_AR_LAB_ENABLED === 'true';
const buttonClass = 'min-h-12 rounded-xl border border-amber-300 px-5 py-3 text-amber-100 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-40';

function EffectsLab({kind}:{kind: EffectKind}) {
  const {lang} = useI18n();
  const localized = (ar: string, en: string, zh: string) => lang === 'ar' ? ar : lang === 'zh-CN' ? zh : en;
  const label = kind === 'face'
    ? localized('تتبع الوجه التجريبي', 'Experimental face tracking', '实验性人脸跟踪')
    : localized('فصل السماء التجريبي', 'Experimental sky segmentation', '实验性天空分割');
  const preview = useRef<HTMLCanvasElement | null>(null);
  const current = useRef<BasiraEffectsSession | null>(null);
  const pending = useRef<AbortController | null>(null);
  const live = useRef(true);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle'|'starting'|'running'>('idle');
  const [observation, setObservation] = useState<EffectState | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceRef = useRef(false);
  const lastVoice = useRef(0);
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const camera = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const stop = () => {
    pending.current?.abort();
    pending.current = null;
    current.current?.stop();
    current.current = null;
    if (live.current) {
      setState('idle');
      setObservation(null);
      setNotice(localized('تم إيقاف الكاميرا.', 'Camera stopped.', '相机已停止。'));
    }
  };

  useEffect(() => {
    live.current = true;
    const onVisibilityChange = () => {if (document.visibilityState !== 'visible') stop()};
    const onPageHide = () => stop();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      live.current = false;
      pending.current?.abort();
      current.current?.stop();
      current.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  const announce = (value: EffectState) => {
    if (!voiceRef.current || value === 'updated' || value === 'loading') return;
    if (Date.now() - lastVoice.current < 7000) return;
    if (typeof SpeechSynthesisUtterance === 'undefined' || !window.speechSynthesis) return;
    lastVoice.current = Date.now();
    try {
      const message = new SpeechSynthesisUtterance(effectHint(kind,value,lang));
      message.lang = lang === 'ar' ? 'ar-SA' : lang === 'zh-CN' ? 'zh-CN' : 'en-US';
      window.speechSynthesis.speak(message);
    } catch { /* voice not guaranteed on all devices */ }
  };

  const start = async () => {
    if (!ENABLED || !secure || !camera || !consent || state !== 'idle' || !preview.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setState('starting');
    setError('');
    setNotice(localized('جارٍ تحميل محرك الواقع المعزز…', 'Loading AR engine…', '正在加载 AR 引擎…'));
    try {
      const session = await startBasiraEffectsSession(kind,preview.current,{
        onObservation: event => {
          if (!live.current || controller.signal.aborted) return;
          setObservation(event.state);
          announce(event.state);
        },
        onCameraStatus: status => {if (live.current && !controller.signal.aborted) setNotice(status);},
        onError: message => {if (live.current && !controller.signal.aborted) setError(message);},
      },controller.signal);
      if (!live.current || controller.signal.aborted) {
        session.stop();
        return;
      }
      current.current = session;
      setState('running');
    } catch (e) {
      if (live.current && !controller.signal.aborted) {
        setError(e instanceof Error ? e.message : 'UNKNOWN_XR_ERROR');
        setState('idle');
        setNotice(localized('لا يمكن بدء التجربة. الخدمات الأخرى في بصيرة لا تزال متاحة.', 'Experiment could not start; other Basira services still work.', '实验无法启动。Basira 的其他服务仍可使用。'));
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };

  return <Layout><main className="container max-w-4xl space-y-5 py-8 text-stone-100" dir={lang==='ar'?'rtl':'ltr'} lang={lang}>
    <Link href="/navigation/ar-lab" className="inline-block min-h-10 text-amber-300 underline">{localized('عودة إلى مختبرات الواقع المعزز','Back to AR labs','返回 AR 实验室')}</Link>
    <h1 className="text-3xl font-black">{label}</h1>
    <p role="note" className="rounded-xl border border-amber-300 bg-stone-900 p-4">
      {kind==='face' ? localized(
        'هذه تجربة لتتبع ظهور وجه بالكاميرا الأمامية؛ لا تتعرف على هوية أي شخص ولا تخزن الوجه، وليست جزءًا من الملاحة الآمنة.',
        'Front camera face tracking demonstration only. No identity recognition, face storage, or mobility safety guarantee.',
        '仅测试前置摄像头人脸跟踪，不识别身份或储存人脸。'
      ) : localized(
        'هذه تجربة لتعرف طبقة السماء بالكاميرا الخلفية، ولا تكتشف الطرق أو السيارات أو العوائق. اختبرها من مكان ثابت وآمن.',
        'Back camera sky-layer detection only. Not a road, vehicle or obstacle detector. Remain stationary in a safe place.',
        '仅测试后置摄像头天空区域检测，不可用于识别道路或障碍物。'
      )}
    </p>
    {!ENABLED && <p role="status" className="rounded-xl border p-4">{localized('تجربة معطلة افتراضيًا. فعّل VITE_BASIRA_AR_LAB_ENABLED=true في بيئة المعاينة وأعد البناء.','Disabled by default. Set VITE_BASIRA_AR_LAB_ENABLED=true in a preview build and rebuild.','实验默认禁用，请在预览构建中启用功能标志。')}</p>}
    {!secure && <p role="alert">{localized('يفترض استخدام HTTPS.','HTTPS required.','必须使用 HTTPS。')}</p>}
    {!camera && <p role="alert">{localized('كاميرا المتصفح غير مدعومة.','Browser camera unavailable.','浏览器相机不可用。')}</p>}
    <div className="grid gap-5 md:grid-cols-2">
      <section className="space-y-3 rounded-2xl border border-amber-200/30 bg-stone-900 p-4">
        <h2 className="text-xl font-bold">{localized('معاينة الكاميرا','Live camera','实时相机')}</h2>
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black">
          <canvas className="h-full w-full object-cover" ref={preview} aria-label={localized('معاينة الكاميرا التجريبية','Experimental camera preview','实验相机预览')} />
          {kind==='sky' && observation==='found' && <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 top-2 rounded-lg border border-sky-300/50 bg-sky-700/40 px-4 py-2 text-center text-white">
            {localized('رُصدت طبقة السماء','Sky layer detected','检测到天空层')}
          </div>}
        </div>
        <p className="text-xs text-stone-300">{localized('المشهد مباشر ولا تُنشئ هذه الصفحة تسجيلات أو صورًا محفوظة.','The feed is live; this page does not record or save images.','本页面不记录或保存摄像头图像。')}</p>
      </section>
      <section className="space-y-4 rounded-2xl border border-amber-200/30 bg-stone-900 p-4">
        <h2 className="text-xl font-bold">{localized('التحكم وإمكانية الوصول','Controls and accessibility','控制与无障碍')}</h2>
        <label className="flex min-h-12 items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={consent} disabled={state!=='idle'} onChange={e=>setConsent(e.target.checked)}/><span>{localized('أوافق على تشغيل الكاميرا وتحميل محرك 8th Wall من CDN لتجربة مؤقتة.','I consent to camera access and loading 8th Wall from a CDN for this temporary experiment.','我同意实验期间访问相机并从 CDN 加载 8th Wall。')}</span></label>
        <label className="flex min-h-12 items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={voiceOn} onChange={e=>{voiceRef.current=e.target.checked;setVoiceOn(e.target.checked)}}/><span>{localized('إعلانات صوتية محلية اختيارية','Optional local speech updates','可选的本地语音提示')}</span></label>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonClass} onClick={()=>void start()} disabled={!ENABLED||!secure||!camera||!consent||state!=='idle'}>{state==='starting'?localized('جارٍ التشغيل','Starting','正在启动'):localized('بدء التجربة','Start experiment','启动实验')}</button>
          <button type="button" className={buttonClass} onClick={stop} disabled={state==='idle'}>{localized('إيقاف الكاميرا','Stop camera','停止相机')}</button>
        </div>
        <p role="status" aria-live="polite">{notice || localized('الكاميرا متوقفة.','Camera is off.','相机已关闭。')}</p>
        {observation && <p role="status" aria-live="polite" className="rounded-lg border border-amber-200/30 p-3">{effectHint(kind,observation,lang)}</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <p className="text-sm text-stone-300">{localized('يدعم النموذج ثلاث لغات، ويحفظ اختيار الصوت أثناء الجلسة فقط. تتطلب دقة المحرك اختبارًا على جهاز حقيقي.','Supports three languages; speech preference is session-only. Engine reliability requires device testing.','支持三种语言。需在真实设备上测试可靠性。')}</p>
      </section>
    </div>
  </main></Layout>;
}

export function ArFaceLab() {return <EffectsLab kind="face"/>}
export function ArSkyLab() {return <EffectsLab kind="sky"/>}
