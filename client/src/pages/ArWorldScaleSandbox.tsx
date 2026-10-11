import {useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'wouter';
import Layout from '@/components/Layout';
import {useI18n} from '@/i18n';
import {
  BINARY_LAB_ENABLED,BINARY_LICENSE_APPROVED,startWorldScaleResearchSession,
  type WorldLabSession,
} from '@/lib/ar/worldTrackingEngine';
import {
  WORLD_REFERENCE_TARGETS,displacementMetres,summarizeWorldTrials,
  type WorldPose,type WorldReferenceTarget,type WorldResearchTrial,
} from '@/lib/ar/worldScaleResearch';

const button='min-h-12 rounded-xl border border-amber-300 px-4 py-3 font-bold text-amber-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';
export default function ArWorldScaleSandbox(){
  const {lang}=useI18n();
  const s=(ar:string,en:string,zh:string)=>lang==='ar'?ar:lang==='zh-CN'?zh:en;
  const canvas=useRef<HTMLCanvasElement|null>(null);
  const session=useRef<WorldLabSession|null>(null);
  const abort=useRef<AbortController|null>(null);
  const currentPose=useRef<WorldPose|null>(null);
  const startPose=useRef<WorldPose|null>(null);
  const live=useRef(true);
  const [consent,setConsent]=useState(false);
  const [working,setWorking]=useState(false);
  const [started,setStarted]=useState(false);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [refMeters,setRefMeters]=useState<WorldReferenceTarget>(1);
  const [trials,setTrials]=useState<WorldResearchTrial[]>([]);
  const [currentDistance,setCurrentDistance]=useState<number|null>(null);
  const summary=useMemo(()=>summarizeWorldTrials(trials),[trials]);
  const ready=BINARY_LAB_ENABLED&&BINARY_LICENSE_APPROVED;

  const stop=()=>{
    abort.current?.abort();
    abort.current=null;
    session.current?.stop();
    session.current=null;
    currentPose.current=null;
    startPose.current=null;
    if(live.current){
      setStarted(false);setWorking(false);setCurrentDistance(null);
      setStatus(s('تم إيقاف جلسة البحث.','Research session stopped.','研究会话已停止。'));
    }
  };
  useEffect(()=>{
    live.current=true;
    const onHide=()=>{if(document.visibilityState==='hidden')stop()};
    const onPageHide=()=>stop();
    document.addEventListener('visibilitychange',onHide);
    window.addEventListener('pagehide',onPageHide);
    return ()=>{
      live.current=false;
      abort.current?.abort();
      session.current?.stop();
      document.removeEventListener('visibilitychange',onHide);
      window.removeEventListener('pagehide',onPageHide);
    };
  },[]);

  const begin=async()=>{
    if(!ready||!consent||working||started||!canvas.current)return;
    setWorking(true);setError('');
    const controller=new AbortController();abort.current=controller;
    try{
      const current=await startWorldScaleResearchSession(canvas.current,{
        onStatus:value=>{if(live.current&&!controller.signal.aborted)setStatus(value)},
        onError:value=>{if(live.current&&!controller.signal.aborted)setError(value)},
        onPose:pose=>{
          if(!live.current||controller.signal.aborted)return;
          currentPose.current=pose;
          if(startPose.current)setCurrentDistance(displacementMetres(startPose.current,pose));
        },
      },consent,controller.signal);
      if(!live.current||controller.signal.aborted){current.stop();return}
      session.current=current;
      setStarted(true);
    }catch(e){if(live.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'WORLD_LAB_ERROR')}
    finally{if(live.current)setWorking(false);if(abort.current===controller)abort.current=null}
  };

  const baseline=()=>{
    startPose.current=currentPose.current;
    setCurrentDistance(null);
    setStatus(s('سُجل موضع البداية. ضع علامة أرضية مرجعية واجعل الاختبار تحت إشراف مبصر.','Baseline recorded. Use a physical reference and a sighted supervisor.','已设置起始点，请在安全监督下进行。'));
  };
  const record=()=>{
    if(!startPose.current||!currentPose.current)return;
    const m=displacementMetres(startPose.current,currentPose.current);
    if(m===null)return;
    setTrials(prev=>[...prev,{referenceMeters:refMeters,cameraDisplacementMeters:m,observedAt:Date.now(),device:navigator.userAgent.slice(0,90)}]);
    startPose.current=null;
    setCurrentDistance(null);
    setStatus(s('سُجلت محاولة معايرة بحثية؛ لم يتم اعتماد أمان المشي.','Research calibration trial saved; walking safety is not certified.','已记录研究数据，不代表可安全行走。'));
  };
  const csv=()=>{
    const columns=['reference_m','camera_displacement_m','absolute_error_m','observed_at_ms','device'];
    const rows=trials.map(x=>[x.referenceMeters,x.cameraDisplacementMeters,Math.abs(x.referenceMeters-x.cameraDisplacementMeters),x.observedAt,x.device]);
    const value=[columns,...rows].map(row=>row.map(item=>JSON.stringify(String(item))).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+value],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='basira-world-scale-research.csv';a.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1200);
  };
  return <Layout><main className="container max-w-4xl space-y-5 py-8 text-stone-100" dir={lang==='ar'?'rtl':'ltr'} lang={lang}>
    <Link href="/navigation/ar-lab/world" className="text-amber-300 underline">{s('متطلبات الترخيص','License requirements','许可要求')}</Link>
    <h1 className="text-3xl font-black">{s('مختبر حركة الكاميرا بالمقياس المترّي','Meter-scale camera movement research','米制相机运动实验')}</h1>
    <p role="note" className="rounded-xl border border-amber-300 bg-stone-900 p-4">{s(
      'تجربة باحثين مع إشراف مبصر وقياس مرجعي فقط، وليست أداة لتجنب العوائق أو تحديد مسافة شخص أو كرسي. قياس انتقال الكاميرا لا يساوي المسافة إلى الأجسام. لا تتحرك مستقلًا أثناء الاختبار.',
      'Research-only supervised experiment with physical reference distances. Camera movement is NOT distance to a chair/person/obstacle. Do not walk independently during this test.',
      '仅供研究人员监督测试；相机位移并非到物体的距离。禁止依赖它独自行走。')}</p>
    {!ready && <p role="alert" className="rounded-xl border p-4">{s(
      'محرك SLAM المقيّد غير مفعّل. يلزم تأكيد مراجعة الترخيص وإعداد متغيري VITE_BASIRA_AR_BINARY_LAB_ENABLED وVITE_BASIRA_AR_BINARY_LICENSE_APPROVED في بيئة اختبار خاصة فقط.',
      'Restricted SLAM disabled. License review and both VITE_BASIRA_AR_BINARY_LAB_ENABLED and VITE_BASIRA_AR_BINARY_LICENSE_APPROVED must be explicitly set in a private test environment.',
      '受限 SLAM 已禁用，需经过许可审查并在私人测试环境显式启用。')}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-3 rounded-2xl border border-amber-200/30 bg-stone-900 p-4">
        <h2 className="text-xl font-bold">{s('الكاميرا والموضع','Camera and pose','摄像头和位姿')}</h2>
        <canvas ref={canvas} className="aspect-[3/4] w-full rounded-xl bg-black" aria-label={s('كاميرا المختبر','Lab camera','研究相机')}/>
        <p role="status" aria-live="polite">{status||s('جلسة غير نشطة','Inactive session','未启动')}</p>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={consent} disabled={working||started} onChange={e=>setConsent(e.target.checked)}/><span>{s('أوافق على فتح الكاميرا وتحميل المحرك الثنائي المرخص بعد مراجعة شروطه، ضمن اختبار بحثي فقط.','I consent to camera access and loading the separately licensed binary only for approved research.','我同意仅在获授权的研究环境中使用摄像头。')}</span></label>
        <div className="flex flex-wrap gap-2">
          <button className={button} type="button" disabled={!ready||!consent||started||working} onClick={()=>void begin()}>{s('بدء المختبر','Start lab','启动实验')}</button>
          <button className={button} type="button" disabled={!started&&!working} onClick={stop}>{s('إيقاف','Stop','停止')}</button>
        </div>
      </section>
      <section className="space-y-4 rounded-2xl border border-amber-200/30 bg-stone-900 p-4">
        <h2 className="text-xl font-bold">{s('معايرة المسافة المرجعية','Reference calibration','基准距离校准')}</h2>
        <label className="block">{s('مسافة مرجعية مستقلة بشريط قياس','Ground truth with measuring tape','使用卷尺测量实际距离')}
          <select className="mt-2 block w-full rounded-lg bg-stone-950 p-3" value={refMeters} onChange={e=>setRefMeters(Number(e.target.value) as WorldReferenceTarget)}>
            {WORLD_REFERENCE_TARGETS.map(v=><option key={v} value={v}>{v} m</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={button} type="button" disabled={!started||!currentPose.current} onClick={baseline}>{s('تثبيت نقطة البداية','Set baseline','设置起点')}</button>
          <button className={button} type="button" disabled={!started||currentDistance===null} onClick={record}>{s('تسجيل المسافة بعد التوقف','Record trial when stationary','静止后记录距离')}</button>
        </div>
        <p role="status" aria-live="polite">{s('انتقال الكاميرا التقديري','Estimated camera travel','估计相机位移')}: {currentDistance===null?'—':currentDistance.toFixed(3)+' m'}</p>
        <p>{s('القراءات الصالحة','Valid trials','有效记录')}: {summary.attempts}</p>
        <p>{s('وسيط الخطأ المطلق','Median absolute error','绝对误差中位数')}: {summary.medianAbsoluteErrorMetres===null?'—':summary.medianAbsoluteErrorMetres.toFixed(3)+' m'}</p>
        <p>{s('الخطأ P95','P95 absolute error','P95 误差')}: {summary.p95AbsoluteErrorMetres===null?'—':summary.p95AbsoluteErrorMetres.toFixed(3)+' m'}</p>
        <button className={button} type="button" onClick={csv} disabled={!trials.length}>{s('تصدير CSV','Export CSV','导出 CSV')}</button>
        <p className="text-amber-200">{s('حالة السلامة: غير معتمد للمشي','Walking safety: NOT APPROVED','步行安全：未经认证')}</p>
      </section>
    </div>
  </main></Layout>;
}
