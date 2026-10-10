import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { DEPTH_TARGETS, evaluateCalibration, rejectNativeSample, type CalibrationTarget, type LabCondition, type LabObservation } from '@/lib/vision/depthCalibration';

const button='rounded-lg border border-amber-400 px-4 py-3 font-bold text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50';
const pct=(value:number)=>Math.round(value*100)+'%';
const metres=(value:number|null)=>value===null?'—':value.toFixed(3)+' م';

export default function DepthCalibrationLab(){
  const [available,setAvailable]=useState(false);
  const [target,setTarget]=useState<CalibrationTarget>(1);
  const [condition,setCondition]=useState<LabCondition>('INDOOR_BRIGHT');
  const [samples,setSamples]=useState<LabObservation[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const report=useMemo(()=>evaluateCalibration(samples),[samples]);
  useEffect(()=>{setAvailable(typeof window.BasiraDepthLab?.captureSample==='function');},[]);
  const capture=async()=>{
    if(!window.BasiraDepthLab?.captureSample)return;
    setBusy(true);setNotice('');
    try{
      const sample=await window.BasiraDepthLab.captureSample();
      setSamples(prev=>[...prev,{targetMeters:target,condition,sample}]);
      setNotice(rejectNativeSample(sample) ? 'رُفضت قراءة غير موثوقة أو غير متاحة؛ احتُسبت كمحاولة فاشلة.' : 'سُجلت قراءة صالحة للفحص.');
    }catch{
      setSamples(prev=>[...prev,{targetMeters:target,condition,sample:null}]);
      setNotice('تعذر الحصول على عمق من الجهاز. لم تُقدَّر المسافة من الكاميرا العادية.');
    }finally{setBusy(false);}
  };
  const exportCsv=()=>{
    const headers=['reference_m','condition','source','frame_id','timestamp_ms','measured_m','confidence','aligned','native_session','fresh','rejection'];
    const cells=samples.map(row=>{
      const s=row.sample;
      return [row.targetMeters,row.condition,s?.source??'',s?.frameId??'',s?.frameTimestampMs??'',s?.distanceMeters??'',s?.confidence??'',s?.alignedToCameraFrame??'',s?.capturedWithNativeSession??'',s?.rawDepthFresh??'',rejectNativeSample(s)??''];
    });
    const csv=[headers,...cells].map(row=>row.map(item=>JSON.stringify(String(item))).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='basira-native-depth-lab.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <Layout><main className="container max-w-4xl space-y-6 py-8 text-stone-100" lang="ar" dir="rtl">
    <Link href="/vision" className="text-amber-300 underline">العودة إلى الرؤية</Link>
    <h1 className="text-3xl font-black">مختبر معايرة المسافات — نسخة بحثية</h1>
    <p className="rounded-xl border border-amber-500 p-4" role="note">هذه الصفحة مخصصة لاختبارات الأجهزة داخل بيئة مضبوطة. نتائجها لا تُشغّل تحذيرات الملاحة، ولا تثبت سلامة التجول. لا تختبرها أثناء السير أو عند الدرج أو الطريق.</p>
    <p role="status" className="font-bold">{available?'تم اكتشاف موصل مختبر عمق أصلي. تحقق من الجهاز والإذن قبل القياس.':'غير متاح في المتصفح الحالي: يلزم تطبيق أصلي متوافق يثبت قراءة الكاميرا والعمق من إطار واحد. لا توجد قياسات وهمية.'}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">المسافة المرجعية المقاسة بمتر أو شريط قياس
        <select className="mt-2 w-full rounded-lg bg-stone-900 p-3" value={target} onChange={e=>setTarget(Number(e.target.value) as CalibrationTarget)}>
          {DEPTH_TARGETS.map(value=><option key={value} value={value}>{value} متر</option>)}
        </select>
      </label>
      <label className="block">ظروف القياس
        <select className="mt-2 w-full rounded-lg bg-stone-900 p-3" value={condition} onChange={e=>setCondition(e.target.value as LabCondition)}>
          <option value="INDOOR_BRIGHT">داخل المبنى — إضاءة جيدة</option>
          <option value="INDOOR_DIM">داخل المبنى — إضاءة خافتة</option>
          <option value="OUTDOOR">خارج المبنى — بعيدًا عن المركبات</option>
        </select>
      </label>
    </div>
    <div className="flex flex-wrap gap-3">
      <button className={button} type="button" disabled={!available||busy} onClick={()=>void capture()}>{busy?'جارٍ القياس…':'سجّل قراءة من المستشعر'}</button>
      <button className={button} type="button" disabled={!samples.length} onClick={exportCsv}>تصدير النتائج CSV</button>
      <button className={button} type="button" disabled={!samples.length} onClick={()=>{setSamples([]);setNotice('حُذفت القراءات من الذاكرة.');}}>بدء اختبار جديد</button>
    </div>
    <p role="status" aria-live="polite">{notice}</p>
    <h2 className="text-2xl font-bold">تقرير الدقة (20 محاولة على الأقل لكل مسافة)</h2>
    <div className="overflow-x-auto"><table className="w-full border-collapse text-right text-sm">
      <thead><tr>{['المسافة','المحاولات','الصالحة','التغطية','الخطأ الوسيط','الخطأ P95','الشروط','النتيجة'].map(label=><th key={label} scope="col" className="border-b p-2">{label}</th>)}</tr></thead>
      <tbody>{report.targets.map(row=><tr key={row.targetMeters}><th scope="row" className="border-b p-2">{row.targetMeters} م</th><td className="border-b p-2">{row.attempts}</td><td className="border-b p-2">{row.valid}</td><td className="border-b p-2">{pct(row.coverage)}</td><td className="border-b p-2">{metres(row.medianAbsoluteError)}</td><td className="border-b p-2">{metres(row.p95AbsoluteError)}</td><td className="border-b p-2">{row.conditions}</td><td className="border-b p-2">{row.pass?'مطابق لمعيار المختبر':'غير مكتمل / غير مطابق'}</td></tr>)}</tbody>
    </table></div>
    <p className="font-bold" role="status">{report.labCriteriaMet?'اجتاز الجهاز المعايير البحثية الأولية فقط؛ ما زالت اختبارات الميدان والسلامة والمواءمة مع اكتشاف الأجسام مطلوبة.':'لم تجتز بيانات هذا الجهاز معايير المعايرة الأولية بعد.'}</p>
    <p className="text-stone-300">يُقاس البعد من الكاميرا إلى السطح؛ وليس من قدم المستخدم إلى العائق. كرر القياسات على كل طراز جهاز، وفي ظروف مختلفة، وبإشراف شخص مبصر في مساحة آمنة.</p>
  </main></Layout>;
}
