import {useState} from 'react';
import type {PerceptionSnapshot} from '@/lib/vision/perception';
import type {VisionCopy} from '@/lib/vision/scene';
import {objectLabel} from '@/lib/vision/cocoLabels';
import {colorDescription} from '@/lib/vision/objectColors';

export function VisualRadar({snapshot,copy,visible,onToggle,onDescribe}:{snapshot:PerceptionSnapshot|null;copy:VisionCopy;visible:boolean;onToggle:()=>void;onDescribe:()=>void}){
 const [details,setDetails]=useState(false);
 const objects=snapshot?.observations??[];
 return <section lang="ar" aria-label="خريطة مجال رؤية الكاميرا" className="rounded-2xl border border-amber-300/40 bg-stone-900 p-5">
   <h2 className="text-xl font-bold">خريطة مجال رؤية الكاميرا</h2>
   <p className="mt-2 text-stone-300">المواضع اتجاهات داخل الصورة. جميع الرموز على قوس واحد؛ لا يمثل نصف القطر مسافة حقيقية أو مسارًا آمنًا.</p>
   <div className="mt-3 flex flex-wrap gap-3">
     <button type="button" className="min-h-12 rounded-lg border border-amber-300 px-4" aria-pressed={visible} onClick={onToggle}>{visible?'إخفاء الخريطة المرئية':'إظهار الخريطة المرئية'}</button>
     <button type="button" className="min-h-12 rounded-lg border border-amber-300 px-4" onClick={onDescribe}>وصف محتوى الخريطة</button>
   </div>
   {visible&&<svg viewBox="0 0 600 310" aria-hidden="true" className="mx-auto mt-4 w-full max-w-xl" data-testid="visual-radar">
     <path d="M40 275 A260 260 0 0 1 560 275" fill="none" stroke="#fbbf24" strokeWidth="2"/>
     <path d="M40 275H560M300 270V20" fill="none" stroke="#a8a29e" strokeDasharray="6 6"/>
     <text x="35" y="303" fill="white" fontSize="16">يسار</text><text x="540" y="303" fill="white" fontSize="16">يمين</text>
     {objects.map(({detection,validity},index)=>{
       const angle=Math.PI*(1-(detection.boundingBox.x+detection.boundingBox.width/2));
       const x=300+260*Math.cos(angle),y=275-260*Math.sin(angle);
       const approaching=snapshot?.approach.some(item=>item.trackId===detection.trackId&&['POSSIBLE_APPROACH','STRONG_APPROACH'].includes(item.state));
       return <g key={detection.trackId??detection.id} data-track-id={detection.trackId}>
         <circle cx={x} cy={y} r="15" fill={approaching?'#fb923c':validity==='UNCERTAIN'?'#a8a29e':'#fde68a'} stroke="#1c1917" strokeWidth="2"/>
         <text x={x} y={y+5} textAnchor="middle" fill="#1c1917" fontSize="15">{index+1}</text>
       </g>;
     })}
   </svg>}
   {!snapshot?<p className="mt-3" data-testid="perception-empty">لا توجد قراءة حديثة للكاميرا.</p>:<>
     <p className="mt-3" data-testid="tracking-status">{snapshot.tracking==='TRACKING'?'التتبع يعمل ضمن الإطارات المرصودة.':snapshot.tracking==='LIMITED'?'موثوقية التتبع منخفضة؛ معدل التحليل أو الإضاءة غير كافيين.':'يجري تثبيت التتبع.'}</p>
     <ol className="mt-3 list-inside list-decimal space-y-2" aria-label="الأجسام المرصودة حاليًا" data-testid="perception-objects">
       {objects.map(({detection,validity})=><li key={detection.trackId??detection.id}>
         {validity==='UNCERTAIN'?'جسم غير مؤكد':detection.tracking&&detection.tracking.state!=='TRACKED'?'جسم قيد تثبيت التسمية':objectLabel(detection,copy)} {copy.direction[detection.horizontalDirection]}
         {detection.color&&<span> — {detection.cocoClass==='person'?'ألوان الملابس غير محددة':colorDescription(detection)}</span>}
         <span className="text-stone-300"> — {detection.tracking?.state==='TRACKED'?'هوية متتبعة':detection.tracking?.state==='AMBIGUOUS'?'هوية ملتبسة':'تثبيت الهوية'}، درجة النموذج {Math.round(detection.confidence*100)}٪</span>
         {snapshot.approach.some(item=>item.trackId===detection.trackId&&['POSSIBLE_APPROACH','STRONG_APPROACH'].includes(item.state))&&<strong>، مؤشرات اقتراب تجريبية</strong>}
       </li>)}
     </ol>
     {!objects.length&&<p>لم يُرصد جسم بثقة كافية؛ هذا لا يثبت خلو المحيط.</p>}
     <h3 className="mt-4 font-bold">ملاحظات الجزء السفلي والأرضية</h3>
     <ul className="mt-2 space-y-2">{snapshot.ground.observations.map(item=><li key={item.id}>{item.labelAr}</li>)}</ul>
     {!snapshot.ground.observations.length&&<p className="mt-2 text-stone-300">لا تتوفر ملاحظة أرضية مؤكدة في هذا الإطار.</p>}
     <button type="button" className="mt-4 min-h-12 underline" onClick={()=>setDetails(!details)} aria-expanded={details}>تفاصيل جودة التحليل</button>
     {details&&<p data-testid="perception-telemetry">الإطارات المعالجة: {snapshot.performance.processedFrames}؛ المعدل الفعلي {snapshot.performance.effectiveFps.toFixed(1)} إطار/ثانية؛ زمن الدورة عند المئين 95: {Math.round(snapshot.performance.p95InferenceMs)} مللي ثانية. درجة التصنيف ليست احتمال اصطدام.</p>}
   </>}
 </section>;
}
