import {useState} from 'react';
import type {VisionDetection} from '@shared/vision';
import {useI18n,useMessages} from '@/i18n';
import {visionMessages} from '@/i18n/locales/vision';
import {createObjectDepthTrial,objectDepthTrialsCsv,summarizeObjectDepthTrials,type ObjectDepthTrial} from './objectDepthValidation';

const storageKey='basira-native-object-depth-trials-v1';
const button='rounded-lg border border-amber-300/60 px-4 py-3 font-bold text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50';
const localized=(lang:string,ar:string,en:string,zh:string)=>lang==='ar'?ar:lang==='zh-CN'?zh:en;
export function NativeDepthTrialPanel({frozen,frameId,objects}:{
  frozen:boolean;frameId:string;objects:VisionDetection[];
}){
  const {lang}=useI18n();
  const t=useMessages(visionMessages);
  const [reference,setReference]=useState('1');
  const [selected,setSelected]=useState(0);
  const [matched,setMatched]=useState(true);
  const [notice,setNotice]=useState('');
  const [trials,setTrials]=useState<ObjectDepthTrial[]>(()=>{
    try{
      const value=localStorage.getItem(storageKey);
      if(!value)return [];
      const parsed:unknown=JSON.parse(value);
      return Array.isArray(parsed)?parsed.filter(v=>
        v&&typeof v==='object'&&typeof v.frameId==='string'&&
        typeof v.referenceMeters==='number'&&typeof v.objectType==='string').slice(-500):[];
    }catch{return [];}
  });
  const stats=summarizeObjectDepthTrials(trials);
  const save=()=>{
    const object=objects[selected];
    const trial=frozen&&object?createObjectDepthTrial(frameId,object,Number(reference),matched):null;
    if(!trial){setNotice(localized(lang,'ثبّت لقطة وأدخل مسافة حقيقية بين 0.5 و5 أمتار.','Freeze a frame and enter a measured distance between 0.5 and 5 m.','请先冻结画面，并输入0.5至5米之间的真实距离。'));return;}
    const updated=[...trials,trial].slice(-500);
    try{localStorage.setItem(storageKey,JSON.stringify(updated));}
    catch{setNotice(localized(lang,'تعذر حفظ السجل على الجهاز. استخدم تصدير CSV للبيانات السابقة.','Could not save locally. Export any existing trials.','无法在本机保存，请导出数据。'));return;}
    setTrials(updated);
    setNotice(localized(lang,'حُفظت المحاولة محليًا، بما في ذلك غياب قراءة العمق.','Trial saved locally, including missing-depth failures.','记录已本地保存，包括深度读取失败。'));
  };
  const exportCsv=()=>{
    if(!trials.length)return;
    const url=URL.createObjectURL(new Blob([String.fromCharCode(0xFEFF),objectDepthTrialsCsv(trials)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='basira-lidar-object-accuracy.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="space-y-3 rounded-xl border border-amber-300/40 p-4" aria-label={localized(lang,'توثيق معايرة الأجسام','Object calibration records','物体测量记录')}>
    <h2 className="text-lg font-bold">{localized(lang,'فحص دقة المسافة لكل جسم','Measure each object’s distance accuracy','测量物体距离精度')}</h2>
    <p className="text-sm text-amber-100">{localized(lang,'تتطلب التجربة ثبات الهاتف ومساعدة شخص مبصر: قِس المسافة من العدسة إلى الجسم بشريط قياس، ثم ثبّت لقطة وطابق مربع التعرف مع الجسم. لا تمشِ أثناء التجربة.','Keep the phone stationary with a sighted assistant. Measure lens-to-object distance with a tape, freeze a frame, and compare the recognition box. Do not walk while testing.','固定手机，由明眼助手测量相机到物体的真实距离，冻结画面并核对识别框。请勿边走边测试。')}</p>
    {frozen&&objects.length>0&&<div className="space-y-3">
      <label className="block">{localized(lang,'الجسم المحدد','Selected object','选择物体')}
        <select className="mt-1 w-full rounded-lg bg-stone-950 p-3" value={Math.min(selected,objects.length-1)} onChange={e=>setSelected(Number(e.target.value))}>
          {objects.map((o,i)=><option key={i} value={i}>{i+1}. {t.object[o.type]??o.type}: {o.approximateDistance?.distanceMeters??'—'} {localized(lang,'متر','m','米')}</option>)}
        </select>
      </label>
      <label className="block">{localized(lang,'المسافة المرجعية من العدسة بالمتر','Tape-measured distance from lens (metres)','卷尺测量的相机距离（米）')}
        <input type="number" min="0.5" max="5" step="0.1" className="mt-1 w-full rounded-lg bg-stone-950 p-3" value={reference} onChange={e=>setReference(e.target.value)}/>
      </label>
      <label className="flex items-center gap-3"><input type="checkbox" checked={matched} onChange={e=>setMatched(e.target.checked)}/>
        {localized(lang,'تحققت من أن الاسم والمربع يطابقان الجسم','A person verified the object label and box match the target','已人工确认名称和检测框匹配物体')}
      </label>
      <button className={button} type="button" onClick={save}>{localized(lang,'سجل هذه المقارنة على الجهاز','Record this trial locally','保存本次测量')}</button>
    </div>}
    <p role="status" aria-live="polite">{notice}</p>
    <p>{localized(lang,'إجمالي المحاولات','Trials','记录数')}: {stats.total} · {localized(lang,'قراءات مطابقة موثوقة','Accepted matched readings','可靠读数')}: {stats.readings} · {localized(lang,'التغطية','Coverage','覆盖率')}: {Math.round(stats.coverage*100)}%</p>
    <p>{localized(lang,'الخطأ المطلق الوسيط','Median absolute error','绝对误差中位数')}: {stats.medianAbsoluteErrorMeters===null?'—':stats.medianAbsoluteErrorMeters.toFixed(3)+' m'} · P95: {stats.p95AbsoluteErrorMeters===null?'—':stats.p95AbsoluteErrorMeters.toFixed(3)+' m'}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className={button} disabled={!trials.length} onClick={exportCsv}>{localized(lang,'تصدير CSV','Export CSV','导出 CSV')}</button>
      <button type="button" className={button} disabled={!trials.length} onClick={()=>{
        if(!window.confirm(localized(lang,'حذف السجلات المحلية؟','Delete local records?','删除本地记录？')))return;
        try{localStorage.removeItem(storageKey);}catch{return;}
        setTrials([]);
      }}>{localized(lang,'حذف السجلات','Delete local records','删除记录')}</button>
    </div>
    <p className="text-xs text-stone-400">{localized(lang,'تظل الأرقام محليًا ما لم تصدّرها بنفسك. لا تحفظ الصفحة صورًا ولا تُفعّل تنبيهات المشي من هذه النتائج.','Numbers remain on device unless exported. No image recording or walking-alert activation.','仅在本机保存数据，不存储图像，也不会激活步行提示。')}</p>
  </section>;
}
