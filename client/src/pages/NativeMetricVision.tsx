import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n, useMessages } from '@/i18n';
import { visionMessages } from '@/i18n/locales/vision';
import { useTextToSpeech } from '@/hooks/useSpeech';
import { DEFAULT_VISION_CONFIG, getVisionAlertDistance } from '@/lib/vision/config';
import { MediaPipeVisionProvider } from '@/lib/vision/providers';
import { estimateNativeObjectDepth } from '@/lib/vision/nativeObjectDepth';
import { NativeDepthTrialPanel } from '@/lib/vision/NativeDepthTrialPanel';
import { checkAtomicFrame, rotateNativeDepthClockwise } from '@/lib/vision/nativeFramePair';
import type { VisionDetection } from '@shared/vision';

type MeasuredObject = VisionDetection & { depthReason?: string | null; depthValid?: number; depthSpread?: number | null };
const button='rounded-xl border border-amber-300/60 px-5 py-3 font-bold text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50';

function localized(lang:'ar'|'en'|'zh-CN',ar:string,en:string,zh:string) {
  return lang==='ar'?ar:lang==='en'?en:zh;
}

/** Research-only view. This uses a native ARKit session as the ONLY camera source.
 * Camera RGB + LiDAR depth arrive in one atomic sample, then both are rotated identically.
 * Nothing feeds the production safety announcement engine or stair detector.
 */
export default function NativeMetricVision() {
  const t=useMessages(visionMessages);
  const {lang}=useI18n();
  const {speak,stop:stopSpeech}=useTextToSpeech();
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const cancelRef=useRef<(()=>void)|null>(null);
  const lastFrameRef=useRef('');
  const [active,setActive]=useState(false);
  const [frozen,setFrozen]=useState(false);
  const [status,setStatus]=useState('');
  const [objects,setObjects]=useState<MeasuredObject[]>([]);
  const [frameId,setFrameId]=useState('');
  const [coverage,setCoverage]=useState<number|null>(null);
  const [lastUpdated,setLastUpdated]=useState(0);
  const [distanceLimit]=useState(()=>getVisionAlertDistance());

  useEffect(()=>()=>{cancelRef.current?.();stopSpeech();},[]);
  useEffect(()=>{
    const onVisibility=()=>{if(document.hidden){cancelRef.current?.();cancelRef.current=null;setActive(false);setFrozen(false);setObjects([]);}};
    document.addEventListener('visibilitychange',onVisibility);
    return()=>document.removeEventListener('visibilitychange',onVisibility);
  },[]);

  const stop=()=>{
    cancelRef.current?.(); cancelRef.current=null;
    stopSpeech();setActive(false);setFrozen(false);setObjects([]);setCoverage(null);
    setStatus(localized(lang,'أوقفت قراءة المستشعر.','Sensor reading stopped.','已停止传感器读取。'));
  };

  const start=async()=>{
    if(active)return;
    if(!window.BasiraNativeFrames){
      setStatus(localized(lang,'هذا المتصفح لا يوفّر مصدر ARKit أصليًا. افتح التطبيق التجريبي على iPhone 14 Pro.','Native ARKit is unavailable in this browser. Open the iPhone test app.','浏览器不支持原生 ARKit。请打开 iPhone 测试应用。'));
      return;
    }
    lastFrameRef.current='';
    setFrozen(false);setObjects([]);setFrameId('');
    setActive(true);setStatus(localized(lang,'تهيئة الكشف المحلي…','Preparing on-device detection…','正在准备设备端检测…'));
    let cancelled=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let detector:MediaPipeVisionProvider|null=null;
    cancelRef.current=()=>{cancelled=true;if(timer)clearTimeout(timer);void detector?.close();};
    try {
      detector=await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
      if(cancelled){await detector.close();return;}
      const loop=async()=>{
        if(cancelled)return;
        try {
          const sample=await window.BasiraNativeFrames?.nextFrame()??null;
          if(cancelled)return;
          const reject=checkAtomicFrame(sample);
          if(reject||!sample) {
            setObjects([]);setCoverage(null);setFrameId('');
            setStatus(localized(lang,'العمق غير متاح أو الإطار غير موثوق. لا يوجد قياس بالأمتار.','No trustworthy paired frame; metres unavailable.','图像与深度帧不可靠，无法测量米数。'));
          } else if(lastFrameRef.current===sample.frameId) {
            setObjects([]);setCoverage(null);
            setStatus(localized(lang,'لم تصل صورة جديدة من ARKit؛ أُخفيت قياسات الإطار القديم.','Waiting for a new ARKit frame; previous measurements hidden.','等待新的 ARKit 帧，已隐藏旧测量结果。'));
          } else {
            lastFrameRef.current=sample.frameId;
            const canvas=canvasRef.current;
            const context=canvas?.getContext('2d');
            if(!canvas||!context)throw new Error('preview_unavailable');
            const image=new Image();
            image.src='data:image/jpeg;base64,'+sample.imageBase64;
            await image.decode();
            if(cancelled)return;
            canvas.width=480;canvas.height=640;
            context.clearRect(0,0,480,640);
            context.save();
            context.translate(480,0);
            context.rotate(Math.PI/2);
            context.drawImage(image,0,0,640,480);
            context.restore();
            const captured=performance.now();
            const depth=rotateNativeDepthClockwise(sample,captured);
            const detections=await detector!.detect(canvas,captured);
            if(cancelled)return;
            const mapped:MeasuredObject[]=detections.map(d=>{
              const evidence=estimateNativeObjectDepth(d,depth);
              return {...d,approximateDistance:evidence.reading,depthReason:evidence.reason,depthValid:evidence.valid,depthSpread:evidence.spreadMeters};
            });
            setObjects(mapped);setFrameId(sample.frameId);
            setCoverage(sample.validCoverage);setLastUpdated(Date.now());
            setStatus(localized(lang,'كاميرا LiDAR ومجسمات المشهد من إطار واحد. القياسات بحثية.','LiDAR and camera paired from one frame. Research measurements only.','LiDAR 深度与相机图像来自同一帧，仅供研究。'));
          }
        } catch {
          if(cancelled)return;
          setObjects([]);setCoverage(null);setFrameId('');
          setStatus(localized(lang,'تعذر تحليل الإطار. توقف القياس إلى أن تتوفر قراءة صحيحة.','Frame analysis failed; no measurement is shown.','帧分析失败，未显示任何距离。'));
        } finally {
          if(!cancelled)timer=setTimeout(()=>void loop(),750);
        }
      };
      await loop();
    }catch{
      if(!cancelled){
        setActive(false);setStatus(localized(lang,'تعذر تحميل نموذج التعرف على الأشياء. تحقق من الملفات المحلية واتصال التطبيق.','Could not load the object detector.','无法加载物体识别模型。'));
      }
      await detector?.close();
    }
  };

  const freezeForCalibration=()=>{
    if(!active||!frameId||!objects.length)return;
    cancelRef.current?.();cancelRef.current=null;
    setActive(false);setFrozen(true);
    setStatus(localized(lang,'ثُبّتت اللقطة للفحص بشريط قياس؛ لا تستخدم القياسات للمشي.','Frame frozen for tape-measure comparison, not for walking.','画面已冻结供卷尺测试，勿用于行走。'));
  };
  const speakReading=()=>{
    if(Date.now()-lastUpdated>2500){
      speak(localized(lang,'قراءات الأجسام قديمة. لا توجد مسافات حديثة مؤكدة.','Object measurements are stale. No recent confirmed distances.','物体读数已过期，没有可信的最新距离。'),0.9,lang);
      return;
    }
    const named=objects.filter(o=>o.approximateDistance?.source==='ARKIT_DEPTH'&&(o.approximateDistance?.confidence??0)>=0.7);
    const words=named.length
      ? named.slice(0,3).map(item=>{
          const label=t.object[item.type]??item.type;
          return `${label} ${t.direction[item.horizontalDirection]}، ${t.distance(item.approximateDistance!.distanceMeters)}`;
        }).join('، ')
      : localized(lang,'لا توجد مسافات مؤكدة للأشياء في الإطار الحالي.','No confirmed object distances in this frame.','当前画面没有可靠的物体距离。');
    speak(localized(lang,'قياس تجريبي لا يُستخدم للمشي. ','Research-only reading; do not walk using this information. ','实验读数，不用于行走。')+words,0.9,lang);
  };

  return <Layout><main className="container max-w-4xl space-y-5 py-7 text-stone-100">
    <Link href="/navigation/vision" className="text-amber-300 underline">
      {localized(lang,'العودة إلى كاميرا بصيرة','Return to Basira camera','返回视力辅助摄像头')}
    </Link>
    <h1 className="text-3xl font-black">{localized(lang,'كاميرا بصيرة مع قياس LiDAR','Basira camera with LiDAR metres','BASIRA 相机与 LiDAR 米数')}</h1>
    <p className="rounded-xl border border-amber-500 bg-amber-400/10 p-4 text-amber-100" role="note">
      {localized(lang,'نموذج بحثي لجهاز ثابت في بيئة آمنة. الأمتار من العدسة إلى السطح المرئي وليست ضمانًا لخلو الطريق. لا تستخدم هذه الشاشة أثناء المشي أو عند السلالم أو الطرق.','Research prototype for stationary trials only. Distance is lens to visible surface. Do not use while walking, near stairs or roads.','仅用于静止实验。测量的是相机至表面的距离。请勿边走边用。')}
    </p>
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={active} onClick={()=>void start()}>
        {localized(lang,'تشغيل الكاميرا وقياس الأمتار','Start native LiDAR camera','启动 LiDAR 摄像头')}
      </button>
      <button className={button} disabled={!active} onClick={stop}>{localized(lang,'إيقاف المستشعر','Stop sensor','停止传感器')}</button>
      <button className={button} disabled={!active||!objects.length} onClick={speakReading}>
        {localized(lang,'انطق المسافات الحالية','Speak current distances','播报当前距离')}
      </button>
      <button className={button} disabled={!active||!objects.length} onClick={freezeForCalibration}>
        {localized(lang,'تثبيت لقطة للفحص','Freeze frame for accuracy test','冻结画面测试精度')}
      </button>
    </div>
    <p role="status" aria-live="polite">{status}</p>
    <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-xl border-2 border-amber-400 bg-black">
      <canvas ref={canvasRef} width={480} height={640} className="absolute inset-0 h-full w-full" aria-label={t.preview} role="img"/>
      {objects.slice(0,12).map((object,index)=>{
        const d=object.approximateDistance;
        const trusted=d?.source==='ARKIT_DEPTH'&&d.confidence>=.7;
        const caption=`${t.object[object.type]??object.type} ${trusted?'· '+t.distance(d.distanceMeters):'· '+localized(lang,'بلا قياس مؤكد','Unmeasured','无可信距离')}`;
        return <div key={index} className="pointer-events-none absolute rounded border-2 border-amber-400" style={{
          left:`${object.boundingBox.x*100}%`,top:`${object.boundingBox.y*100}%`,
          width:`${object.boundingBox.width*100}%`,height:`${object.boundingBox.height*100}%`
        }}><span className="absolute bottom-full right-0 min-w-max rounded bg-stone-950/90 px-1 text-xs text-white">{caption}</span></div>;
      })}
    </div>
    <section className="space-y-2 rounded-xl border border-amber-300/40 p-4" aria-label={t.recognizedObjects}>
      <h2 className="text-lg font-bold">{t.recognizedObjects}</h2>
      {objects.length===0?<p>{localized(lang,'لا توجد أجسام موثوقة في الإطار الحالي.','No objects found in the current frame.','当前画面未识别到物体。')}</p>:
        <ul className="space-y-1">{objects.slice(0,8).map((o,i)=><li key={i}>{t.object[o.type]??o.type}، {t.direction[o.horizontalDirection]}: {o.approximateDistance?.source==='ARKIT_DEPTH'&&(o.approximateDistance?.confidence??0)>=.7?t.distance(o.approximateDistance!.distanceMeters):localized(lang,'المسافة غير مؤكدة','Distance unavailable','距离不可用')}{o.depthReason?` · ${o.depthReason}`:''}</li>)}</ul>}
      <p className="text-xs text-amber-200">{localized(lang,'قد تخطئ مطابقة مسافة الجسم إذا ظهرت خلفيته داخل مربع الكشف؛ تُحجب القراءات المختلطة ولا تُعتبر البيانات اعتمادًا للسلامة.','Bounding boxes may contain background surfaces; mixed depths are withheld and measurements are not safety certification.','检测框可能包含背景表面；混合深度将被隐藏，这并非安全认证。')}</p>
      <p className="text-sm text-stone-300">{localized(lang,'مدى التحذير المحفوظ','Saved alert threshold','已保存的警告阈值')}: {distanceLimit} {localized(lang,'متر، غير مفعّل للملاحة في هذه التجربة.','metres — NOT enabled for navigation.','米（此实验不用于导航）。')}</p>
      <p className="text-xs text-stone-400">{frameId? `ARKit frame: ${frameId} · High-confidence depth coverage: ${Math.round((coverage??0)*100)}% · ${new Date(lastUpdated).toLocaleTimeString()}`:''}</p>
    </section>
    <NativeDepthTrialPanel frozen={frozen} frameId={frameId} objects={objects}/>
  </main></Layout>;
}
