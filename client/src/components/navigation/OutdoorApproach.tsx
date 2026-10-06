import { useEffect, useRef, useState } from 'react';
import { geoBearing, geoDistance, gpsQuality, type GeoFix, type GpsQuality } from '@/lib/guidance/outdoor';

type Target={name:string;latitude:number;longitude:number;kind:'BUILDING'|'SAVED'};
type Props={target:Target;announce:(text:string,priority?:'INFORMATION'|'RELOCALIZATION',key?:string)=>unknown};
const control='min-h-12 rounded-xl border border-amber-300/60 px-4 py-2 font-bold text-amber-100';
export default function OutdoorApproach({target,announce}:Props){
  const [fix,setFix]=useState<GeoFix|null>(null),[active,setActive]=useState(false),[error,setError]=useState(''),[tick,setTick]=useState(Date.now());
  const watch=useRef<number|null>(null),trace=useRef<GeoFix[]>([]),lastGood=useRef<GeoFix|null>(null),nearCount=useRef(0),announcedNear=useRef(false),lastQuality=useRef<GpsQuality>('LOST');
  const stop=()=>{if(watch.current!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watch.current);watch.current=null;setActive(false);};
  const start=()=>{if(!navigator.geolocation){setError('الموقع غير متاح في هذا الجهاز.');return;}if(watch.current!==null)return;
    setError('');watch.current=navigator.geolocation.watchPosition(position=>{
      const next:GeoFix={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,heading:Number.isFinite(position.coords.heading)?position.coords.heading:null,timestamp:position.timestamp};
      // Ignore poorer jitter while retaining its visible accuracy state.
      setFix(next);const quality=gpsQuality(next);
      if(quality!==lastQuality.current){lastQuality.current=quality;if(quality==='LOW')announce('دقة GPS منخفضة. توقف وأعد تحديد موقعك قبل اتباع اتجاه دقيق.','RELOCALIZATION','gps-low');}
      if(quality==='HIGH'||quality==='MEDIUM'){
        if(!lastGood.current||geoDistance(next,lastGood.current)>=4||next.timestamp-lastGood.current.timestamp>=8000){trace.current=[...trace.current.slice(-59),next];lastGood.current=next;}
        if(quality==='HIGH'&&geoDistance(next,target)<=25)nearCount.current++;else nearCount.current=0;
        if(nearCount.current>=2&&!announcedNear.current){announcedNear.current=true;announce(target.kind==='BUILDING'?'أنت قرب المبنى. ثبّت موقعك عند مدخل معروف أو امسح QR لبدء الملاحة الداخلية.':'أنت قرب المكان المحفوظ. أكّد موضعه من معلم معروف.','RELOCALIZATION','approach-target');}
      }
    },geolocationError=>{setError(geolocationError.code===1?'رُفض إذن الموقع. فعّله من إعدادات المتصفح.':'تعذر تحديث GPS. أعد تحديد موقعك.');lastQuality.current='LOST';},
    {enableHighAccuracy:true,maximumAge:0,timeout:15000});setActive(true);
  };
  useEffect(()=>{const timer=window.setInterval(()=>setTick(Date.now()),5000);const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',hidden);stop();};},[]);
  const quality=gpsQuality(fix,tick),distance=fix&&quality!=='LOST'&&quality!=='LOW'?geoDistance(fix,target):null,bearing=fix&&distance!==null?geoBearing(fix,target):null;
  useEffect(()=>{if(active&&quality==='LOST'&&lastQuality.current!=='LOST'){lastQuality.current='LOST';announce('فُقد تحديد الموقع. توقف في مكان مناسب وأعد تحديد موقعك قبل متابعة الاتجاه.','RELOCALIZATION','gps-lost');}},[quality,active]);
  const displayedFix=quality==='HIGH'||quality==='MEDIUM'?fix:lastGood.current;
  const scale=displayedFix?Math.max(50,geoDistance(displayedFix,target)*1.4):100,meters=(point:GeoFix|Target)=>({x:(point.longitude-target.longitude)*111320*Math.cos(target.latitude*Math.PI/180),y:(target.latitude-point.latitude)*111320});
  const current=displayedFix?meters(displayedFix):null,points=trace.current.map(meters),visualScale=220/(scale*2);
  return <section className="rounded-2xl border border-sky-300/30 bg-stone-900 p-5" aria-labelledby="outdoor-heading"><h2 id="outdoor-heading" className="text-xl font-bold">متابعة الموقع خارج المبنى</h2>
    <p className="mt-2 text-sm text-stone-300">يعرض GPS الموقع والاتجاه العام فقط. لا توجد في هذه الخريطة شبكة مشي خارجية معتمدة أو تعليمات عبور.</p>
    <div className="mt-3 flex gap-2"><button className={control} onClick={active?stop:start}>{active?'إيقاف متابعة GPS':'بدء متابعة GPS'}</button></div>
    <p className="mt-3" role="status">دقة الموقع: <strong>{quality==='HIGH'?'مرتفعة':quality==='MEDIUM'?'متوسطة':quality==='LOW'?'منخفضة':'مفقودة'}</strong>{fix?` · نصف قطر الدقة المبلغ عنه ${Math.round(fix.accuracy)} متر · آخر قراءة ${Math.round((tick-fix.timestamp)/1000)} ثانية`:''}</p>
    {lastGood.current&&<p className="text-sm text-stone-300">آخر تثبيت موثوق قبل {Math.max(0,Math.round((tick-lastGood.current.timestamp)/1000))} ثانية{fix?.heading!=null?` · اتجاه الجهاز ${Math.round(fix.heading)}°`:''}</p>}
    {error&&<p role="alert" className="text-amber-200">{error}</p>}
    {distance!==null&&<p>المسافة في خط مستقيم: نحو {Math.round(distance)} متر · الاتجاه العام: {Math.round(bearing!)}° من الشمال. اختر ممرًا معروفًا وتحقق من العوائق.</p>}
    {quality==='LOW'&&<p role="alert" className="text-amber-200">الموقع غير دقيق للتوجيه القريب. لا تتبع توجيهًا بالمتر حتى يتحسن التحديد.</p>}
    <svg role="img" aria-label={`رسم تقريبي ${quality==='LOW'||quality==='LOST'?'لآخر موضع موثوق':'للموقع الحالي'} و${target.name}، وليس مسار مشي`} viewBox="-110 -110 220 220" className="mt-3 h-56 w-full rounded-xl bg-stone-950"><circle cx="0" cy="0" r="5" fill="#fbbf24"/><text x="8" y="-8" fontSize="7" fill="white">{target.name}</text>{points.length>1&&<polyline points={points.map(point=>`${point.x*visualScale},${point.y*visualScale}`).join(' ')} fill="none" stroke="#34d399" strokeWidth="2"/>}{current&&<g>{displayedFix&&<circle cx={current.x*visualScale} cy={current.y*visualScale} r={Math.min(80,displayedFix.accuracy*visualScale)} fill="#38bdf8" fillOpacity=".12" stroke="#38bdf8"/>}<circle cx={current.x*visualScale} cy={current.y*visualScale} r="4" fill={quality==='LOW'||quality==='LOST'?'#a8a29e':'#38bdf8'}/></g>}{current&&distance!==null&&<line x1={current.x*visualScale} y1={current.y*visualScale} x2="0" y2="0" stroke="#fbbf24" strokeDasharray="4 4" strokeWidth="1"/>}</svg>
    <p className="mt-2 text-xs text-stone-300">الخط المتقطع يشير إلى الوجهة مباشرة وليس طريقًا قابلًا للمشي. النقاط الخضراء تبقى مؤقتة في هذه الجلسة.</p>
  </section>;
}
