import {useEffect,useRef,useState} from 'react';
import type {ExperimentalModel} from '@shared/experimentalModels';
import {CameraService} from '@/lib/vision/camera';
import {DEFAULT_VISION_CONFIG} from '@/lib/vision/config';
import {ExperimentalStairsProvider} from '@/lib/vision/experimentalStairs';
import type {ResearchResult} from '../../../../scripts/vision-ai/camera-lab/adapter.mjs';

const labels:Record<number,string>={2301:'درج صاعد',2302:'درج هابط',2303:'درج — الاتجاه غير مؤكد',2304:'سلم كهربائي'};
const button='min-h-12 rounded-xl border border-amber-300/50 px-5 py-3 font-bold text-amber-100 disabled:opacity-40';
/** A mode inside Basira's Vision page, using its camera service and VisionProvider contract. */
export function ExperimentalVision({model,onOriginal}:{model:ExperimentalModel;onOriginal:()=>void}){
  const video=useRef<HTMLVideoElement>(null),preview=useRef<HTMLCanvasElement>(null),frame=useRef<HTMLCanvasElement|null>(null);
  const camera=useRef(new CameraService(DEFAULT_VISION_CONFIG)),provider=useRef<ExperimentalStairsProvider|null>(null);
  const pending=useRef<AbortController|null>(null),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),objectUrl=useRef<string|null>(null);
  const mounted=useRef(true),consent=useRef(false),records=useRef<unknown[]>([]);
  const [allowed,setAllowed]=useState(false),[status,setStatus]=useState('اختر الكاميرا أو وسيطًا مصرحًا به.'),[running,setRunning]=useState(false),[busy,setBusy]=useState(false);
  const [result,setResult]=useState<ResearchResult|null>(null),[count,setCount]=useState(0),[latency,setLatency]=useState<number|null>(null),[sourceKind,setSourceKind]=useState('');
  const stop=(notice=true)=>{
    generation.current++;pending.current?.abort();pending.current=null;clearTimeout(timer.current);
    camera.current.stop(video.current??undefined);if(video.current){video.current.removeAttribute('src');video.current.load();}
    if(objectUrl.current){URL.revokeObjectURL(objectUrl.current);objectUrl.current=null;}
    void provider.current?.close();provider.current=null;
    if(mounted.current){setRunning(false);setBusy(false);setResult(null);if(notice)setStatus('توقفت التجربة؛ النتائج ليست قراءة مباشرة.');}
  };
  useEffect(()=>{mounted.current=true;const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);return()=>{mounted.current=false;stop(false);document.removeEventListener('visibilitychange',hidden);};},[]);
  const open=async(run:number)=>{
    const abort=new AbortController();pending.current=abort;setBusy(true);setStatus('جارٍ تحميل النموذج التجريبي والتحقق منه…');
    const opened=await ExperimentalStairsProvider.open(model,abort.signal);
    if(run!==generation.current||!consent.current){await opened.close();return false;}provider.current=opened;pending.current=null;return true;
  };
  const analyze=async(source:CanvasImageSource,run:number,mediaTimeSeconds:number|null)=>{
    if(!frame.current)frame.current=document.createElement('canvas');
    const sourceSize=source as HTMLVideoElement&HTMLImageElement;
    const width=sourceSize.videoWidth||sourceSize.naturalWidth||sourceSize.width,height=sourceSize.videoHeight||sourceSize.naturalHeight||sourceSize.height;
    const canvas=frame.current;canvas.width=width;canvas.height=height;canvas.getContext('2d')!.drawImage(source,0,0,width,height);
    const start=performance.now();await provider.current!.detect(canvas,start);
    if(run!==generation.current||!consent.current)return;
    const value=provider.current!.lastResult!,milliseconds=performance.now()-start;
    setResult(value);setLatency(milliseconds);setCount(n=>n+1);setStatus('عرض تجريبي محلي — لا قرار ملاحي أو اعتماد مرجعي.');setBusy(false);
    const display=preview.current!;display.width=width;display.height=height;const ctx=display.getContext('2d')!;ctx.drawImage(canvas,0,0);
    if(value.box){const[x,y,w,h]=value.box;ctx.strokeStyle=value.directionAbstained?'#fbbf24':'#5eead4';ctx.lineWidth=Math.max(2,width/200);ctx.strokeRect(x*width,y*height,w*width,h*height);}
    records.current.push({frame:records.current.length+1,at:new Date().toISOString(),mediaTimeSeconds,width,height,inferenceMs:milliseconds,...value});
    if(records.current.length>=10000)stop();
  };
  const loop=async(run:number)=>{
    if(run!==generation.current||!video.current)return;
    try{if(video.current.readyState>=2&&!video.current.paused&&!video.current.ended)await analyze(video.current,run,video.current.currentTime);
      if(run===generation.current&&!video.current.ended)timer.current=setTimeout(()=>void loop(run),100);
      else if(run===generation.current){setRunning(false);setStatus('انتهى الفيديو. النتائج وصف تجريبي فقط.');}}
    catch(error){if(run===generation.current){stop(false);setStatus(`تعذر الاستدلال: ${error instanceof Error?error.message:'unknown'}. يمكنك الرجوع للأصلي.`);}}
  };
  const startCamera=async()=>{
    if(!allowed)return;stop(false);records.current=[];setCount(0);const run=generation.current;
    try{if(!await open(run))return;await camera.current.start(video.current!);if(run!==generation.current){camera.current.stop(video.current!);return;}setSourceKind('camera');setRunning(true);void loop(run);}
    catch(error){if(run===generation.current){stop(false);setStatus(`تعذر بدء الكاميرا: ${error instanceof Error?error.message:'unknown'}`);}}
  };
  const file=async(file:File)=>{
    if(!allowed)return;stop(false);records.current=[];setCount(0);const run=generation.current;
    try{
      if(file.size>512*1024*1024)throw new Error('حد الوسيط 512 MiB');
      if(!file.type.startsWith('image/')&&!file.type.startsWith('video/'))throw new Error('اختر صورة أو فيديو مدعومًا');
      if(!await open(run))return;objectUrl.current=URL.createObjectURL(file);
      if(file.type.startsWith('image/')){const image=new Image();image.src=objectUrl.current;await image.decode();if(run!==generation.current)return;setSourceKind('image');await analyze(image,run,null);}
      else{video.current!.src=objectUrl.current;await video.current!.play();if(run!==generation.current)return;setSourceKind('video');setRunning(true);void loop(run);}
    }catch(error){if(run===generation.current){stop(false);setStatus(`تعذر فتح الوسيط: ${error instanceof Error?error.message:'unknown'}`);}}
  };
  const exportResults=()=>{
    const report={schemaVersion:1,scope:'basira-experimental-inference',modelId:model.id,modelSha256:model.modelSha256,sourceKind,records:records.current,
      predictionsAreGroundTruth:false,mediaIncluded:false,trainingEnrollmentPerformed:false,navigationEnabled:false,confidenceCalibrated:false};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='basira-experimental-results.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="space-y-4 rounded-xl border border-amber-300/50 bg-stone-900 p-4" data-testid="basira-experimental-vision" data-model-id={model.id} data-processed={count}>
    <h2 className="text-xl font-bold">{model.name} — وضع تجريبي داخل بصيرة</h2>
    <p>الثقة غير معايرة. الأداء الواقعي وصلاحية التنقل غير مثبتين. لا توجيه أو تحذير سقوط من هذا النموذج.</p>
    <p className="text-sm">التقييم المسجل: {model.evaluationScope==='development_validation'?'تحقق تطويري فقط':model.evaluationScope==='independent_synthetic_test'?'اختبار اصطناعي مستقل':'تقييم واقعي مستقل لا يعني اعتمادًا ملاحيًا'} · {model.evaluation.images} صورة</p>
    <label className="flex min-h-12 gap-3"><input type="checkbox" checked={allowed} onChange={e=>{consent.current=e.target.checked;setAllowed(e.target.checked);if(!e.target.checked)stop();}}/>أؤكد صلاحية استخدام الوسائط لهذا الاستدلال المحلي. لا تُضاف إلى التدريب.</label>
    <div className="flex flex-wrap gap-3"><button className={button} disabled={!allowed||busy} onClick={()=>void startCamera()}>تشغيل كاميرا بصيرة بالنموذج التجريبي</button>
      <label className={button}>تحليل صورة أو فيديو<input aria-label="وسيط النموذج التجريبي" type="file" accept="image/*,video/*" disabled={!allowed||busy} onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void file(selected);}}/></label>
      <button className={button} disabled={!running&&!busy} onClick={()=>stop()}>إيقاف</button><button className={button} onClick={()=>{stop(false);onOriginal();}}>الرجوع فورًا إلى النموذج الأصلي</button></div>
    <video ref={video} muted playsInline hidden/>
    <canvas ref={preview} width={640} height={480} className="max-h-[60vh] w-full rounded-xl bg-black object-contain" aria-label="معاينة بصيرة التجريبية والمربع"/>
    <p role="status">{status}</p>
    <p data-testid="experimental-result">{result?result.classId?`${labels[result.classId]} · ثقة الحضور ${(result.score*100).toFixed(1)}%${result.directionAbstained?' · امتنع عن تحديد الاتجاه':''}`:'لم يكتشف النموذج درجًا ثابتًا أو كهربائيًا؛ لا يعني خلو المكان.':'لا توجد قراءة حالية.'}</p>
    {result?.box&&<p>المربع النسبي x/y/w/h: {result.box.map(n=>n.toFixed(3)).join(' / ')}</p>}
    <p>إطارات معالجة: {count} · تجهيز واستدلال: {latency===null?'—':`${latency.toFixed(1)} ms`}</p>
    <button className={button} disabled={!count} onClick={exportResults}>تنزيل نتائج الاستدلال دون الوسائط</button>
    <p>إضافة الصور إلى التدريب تتطلب إجراءً مستقلًا في Studio ومراجعات الحقوق والوسوم. هذا الوضع لا يحفظ الصور أو ينشئ وسومًا مرجعية أو موافقات.</p>
  </section>;
}
