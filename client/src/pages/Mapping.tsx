import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useTextToSpeech } from '@/hooks/useSpeech';
import { navApi, navigationRequest, json, type BuildingGraph } from '@/lib/navigationApi';
import { sharedMapApi } from '@/lib/sharedMap';
import { permissionService } from '@/lib/permissionService';
import { DEFAULT_VISION_CONFIG } from '@/lib/vision/config';
import { CameraService } from '@/lib/vision/camera';
import { MediaPipeVisionProvider, TesseractOCRProvider, UnavailableDepthProvider } from '@/lib/vision/providers';
import { SegFormerSceneProvider } from '@/lib/vision/modelProviders';
import { VisionPipeline } from '@/lib/vision/pipeline';
import { VisionAnnouncementService, BrowserHapticFeedbackProvider } from '@/lib/vision/scene';
import { visionMessages } from '@/i18n/locales/vision';
import { useI18n, useMessages } from '@/i18n';
import { MappingSessionEngine } from '@/lib/localization/mapping';
import { BrowserNfcAnchorProvider, PedestrianMotionProvider, decodeQrFrame, parseQrAnchor } from '@/lib/localization/providers';
import type { Building, Floor, MapNode, Place } from '@shared/navigation';
import type { LocalizationEstimate, MapSuggestion, MapSuggestionType, MappingSession, PositionObservation } from '@shared/localization';

const button='min-h-12 rounded-xl bg-amber-300 px-5 py-2 font-bold text-stone-950 disabled:opacity-50';
const secondary='min-h-12 rounded-xl border border-amber-300 px-5 py-2 text-amber-100 disabled:opacity-50';
const input='min-h-12 w-full rounded-xl border border-stone-500 bg-stone-950 p-2 text-white';
const panel='rounded-2xl border border-amber-200/20 bg-stone-900/80 p-5';
const empty:LocalizationEstimate={buildingId:null,floorId:null,x:null,y:null,headingDegrees:null,confidence:0,uncertaintyRadius:null,sources:[],timestamp:0,lastStrongAnchorAt:null,state:'UNANCHORED'};
const labels:Record<MapSuggestionType,string>={NEW_NODE:'نقطة',NEW_EDGE:'مسار',PLACE_ANCHOR:'مكان',CORRIDOR:'ممر',INTERSECTION:'تقاطع',DOOR:'باب',ELEVATOR:'مصعد',STAIRS:'درج',ENTRANCE:'مدخل',EXIT:'مخرج',FLOOR_TRANSITION:'انتقال بين الطوابق'};

export default function Mapping(){
  const {lang}=useI18n(),visionCopy=useMessages(visionMessages),{speak}=useTextToSpeech();
  const [access,setAccess]=useState<'loading'|'forbidden'|'allowed'>('loading');
  const [buildings,setBuildings]=useState<Building[]>([]),[buildingId,setBuildingId]=useState('');
  const [floors,setFloors]=useState<Floor[]>([]),[places,setPlaces]=useState<Place[]>([]),[graph,setGraph]=useState<BuildingGraph|null>(null);
  const [floorId,setFloorId]=useState(''),[nodeId,setNodeId]=useState(''),[anchorPlaceId,setAnchorPlaceId]=useState(''),[anchorX,setAnchorX]=useState(''),[anchorY,setAnchorY]=useState(''),[qr,setQr]=useState('');
  const [session,setSession]=useState<MappingSession|null>(null),[estimate,setEstimate]=useState<LocalizationEstimate>(empty);
  const [recentSessions,setRecentSessions]=useState<MappingSession[]>([]);
  const [trackCount,setTrackCount]=useState(0),[knownCount,setKnownCount]=useState(0),[suggestions,setSuggestions]=useState<MapSuggestion[]>([]);
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[cameraOn,setCameraOn]=useState(false),[motionOn,setMotionOn]=useState(false);
  const [manualType,setManualType]=useState<MapSuggestionType>('ENTRANCE'),[manualName,setManualName]=useState('');
  const [savedName,setSavedName]=useState('');
  const engineRef=useRef<MappingSessionEngine|null>(null),motionRef=useRef<PedestrianMotionProvider|null>(null);
  const videoRef=useRef<HTMLVideoElement|null>(null),canvasRef=useRef<HTMLCanvasElement|null>(null);
  const cameraRef=useRef(new CameraService(DEFAULT_VISION_CONFIG)),pipelineRef=useRef<VisionPipeline|null>(null),qrTimer=useRef<number|null>(null);
  const cameraGeneration=useRef(0);
  const lastQr=useRef({value:'',at:0});
  const lastLost=useRef(false);
  const update=()=>{
    const engine=engineRef.current;if(!engine)return;
    const e=engine.localization.fusion.current(Date.now());setEstimate(e);
    setTrackCount(engine.track.length);setKnownCount(engine.knownPlaces);setSuggestions([...engine.suggestions]);
    if(e.state==='LOCALIZATION_LOST'&&!lastLost.current){setNotice('تعذر تحديد موقعك بدقة داخل المبنى. وجّه الكاميرا نحو لوحة، أو امسح QR، أو اختر مكانًا معروفًا.');speak('فقدت بصيرة الثقة بموقعك. ابحث عن لوحة أو نقطة معروفة.',.9,lang);}
    if(e.state==='TRACKING'&&lastLost.current)speak('استعادت بصيرة موقعك.',.9,lang);
    lastLost.current=e.state==='LOCALIZATION_LOST';
  };
  useEffect(()=>{navApi.access().then(a=>{if(a.role==='mapper'||a.role==='admin'){setAccess('allowed');return navApi.buildings().then(b=>setBuildings(b.buildings));}setAccess('forbidden');}).catch(()=>setAccess('forbidden'));},[]);
  useEffect(()=>{if(!buildingId){setFloors([]);setPlaces([]);setGraph(null);setSuggestions([]);setRecentSessions([]);return;}
    Promise.all([navApi.floors(buildingId),navApi.places(buildingId),navApi.graph(buildingId),navigationRequest<{sessions:MappingSession[]}>(`/buildings/${buildingId}/mapping-sessions`),navigationRequest<{suggestions:MapSuggestion[]}>(`/buildings/${buildingId}/map-suggestions`)]).then(([f,p,g,h,s])=>{setFloors(f.floors);setPlaces(p.places);setGraph(g);setRecentSessions(h.sessions);setSuggestions(s.suggestions);}).catch(()=>setNotice('تعذر تحميل الخريطة أو جولات المسح.'));
  },[buildingId]);
  useEffect(()=>{const timer=window.setInterval(()=>{if(engineRef.current)update();},5000);return()=>window.clearInterval(timer);},[lang]);
  useEffect(()=>()=>{cameraGeneration.current++;motionRef.current?.stop();if(qrTimer.current)window.clearInterval(qrTimer.current);void pipelineRef.current?.stop();cameraRef.current.stop(videoRef.current??undefined);},[]);
  useEffect(()=>{const hidden=()=>{if(!document.hidden)return;cameraGeneration.current++;motionRef.current?.stop();setMotionOn(false);if(qrTimer.current){window.clearInterval(qrTimer.current);qrTimer.current=null;}void pipelineRef.current?.stop();pipelineRef.current=null;cameraRef.current.stop(videoRef.current??undefined);setCameraOn(false);if(engineRef.current)setNotice('أُوقفَت الحساسات عند إخفاء الصفحة. استأنف الحركة أو أنهِ الجولة عند العودة.');};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[]);
  const findBuilding=async()=>{try{const p=await permissionService.currentLocation();if(p.accuracy>75){setNotice('دقة GPS الحالية ضعيفة لتحديد المبنى. اختره يدويًا.');return;}const found=await navigationRequest<{building:(Building&{distanceMeters:number})|null}>(`/buildings/current?latitude=${p.latitude}&longitude=${p.longitude}`);if(found.building&&found.building.distanceMeters<=70){setBuildingId(found.building.id);setNotice(`يبدو أنك عند ${found.building.name}. يمكنك استخدام خريطتها الداخلية.`);}else setNotice('لم يُعثر على مبنى بتطابق موثوق. اختره يدويًا.');}catch{setNotice('تعذر استخدام الموقع الجغرافي. اختر المبنى يدويًا.');}};
  const start=async()=>{if(!buildingId||busy)return;setBusy(true);setNotice('');
    try{
      const motion=new PedestrianMotionProvider(sample=>{if(sample.stepDetected){engineRef.current?.step(sample.timestamp);update();}},(degrees,source,absolute)=>{engineRef.current?.localization.heading.observe(degrees,source,Date.now(),absolute);});
      let available=false;try{available=await motion.start();}catch{/* manual and visual anchors remain available */}
      motionRef.current=motion;setMotionOn(available);
      const response=await navigationRequest<{session:MappingSession}>('/mapping-sessions',json('POST',{buildingId,startAnchor:null,confidence:0,deviceCapabilities:{motion:available,orientation:available,camera:!!navigator.mediaDevices?.getUserMedia,nfc:new BrowserNfcAnchorProvider().available()}}));
      const engine=new MappingSessionEngine(response.session.id,buildingId,graph?.nodes??[]);engineRef.current=engine;setSession(response.session);setEstimate(empty);setTrackCount(0);setSuggestions([]);setKnownCount(0);setNotice(available?'بدأ المسح. ثبّت موقعك عند مدخل أو مكان معروف.':'بدأ المسح دون حساس حركة. ثبّت موقعك يدويًا.');
    }catch{motionRef.current?.stop();motionRef.current=null;setMotionOn(false);setNotice('تعذر بدء جلسة المسح.');}finally{setBusy(false);}
  };
  const resumeMotion=async()=>{try{const available=await motionRef.current?.start();setMotionOn(Boolean(available));setNotice(available?'استؤنف رصد الحركة.':'حساس الحركة غير متاح.');}catch{setNotice('تعذر استئناف حساس الحركة.');}};
  const anchorNode=(node:MapNode,source:'MANUAL'|'QR'|'NFC')=>{
    const engine=engineRef.current;if(!engine)return;
    const observation:PositionObservation={buildingId:node.buildingId,floorId:node.floorId,x:node.x,y:node.y,
      headingDegrees:null,confidence:source==='QR'?.97:source==='NFC'?.95:.9,uncertaintyRadius:1.5,source,timestamp:Date.now(),nodeId:node.id,placeId:node.placeId};
    engine.anchor(observation);setFloorId(node.floorId);setNotice('تم تثبيت موقعك عند نقطة معروفة.');update();
  };
  const anchorLocal=()=>{const x=Number(anchorX),y=Number(anchorY);if(!floorId||!anchorX.trim()||!anchorY.trim()||!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>100000||Math.abs(y)>100000){setNotice('اختر الطابق وأدخل إحداثيات محلية صالحة.');return;}engineRef.current?.anchor({buildingId,floorId,x,y,headingDegrees:null,confidence:.75,uncertaintyRadius:3,source:'MANUAL',timestamp:Date.now()});setNotice('ثُبّتت نقطة الأصل المحلية يدويًا.');update();};
  const anchorPlace=()=>{const place=places.find(p=>p.id===anchorPlaceId);if(!place||place.localX===null||place.localY===null)return;engineRef.current?.anchor({buildingId:place.buildingId,floorId:place.floorId,x:place.localX,y:place.localY,headingDegrees:null,confidence:.85,uncertaintyRadius:2,source:'MANUAL',timestamp:Date.now(),placeId:place.id});setFloorId(place.floorId);setNotice(`ثُبّت الموقع عند ${place.name}.`);update();};
  const applyQr=(value:string,source:'QR'|'NFC'='QR')=>{const node=parseQrAnchor(value,graph?.nodes??[]);if(!node){setNotice('رمز التثبيت غير معروف في خريطة هذا المبنى.');return;}anchorNode(node,source);setQr('');};
  const scanNfc=async()=>{const provider=new BrowserNfcAnchorProvider();if(!provider.available()){setNotice('NFC غير متاح في هذا المتصفح.');return;}const value=await provider.scan();if(value)applyQr(value,'NFC');else setNotice('لم تُقرأ علامة NFC.');};
  const startCamera=async()=>{if(!videoRef.current||cameraOn)return;const run=++cameraGeneration.current;setBusy(true);
    try{
      await cameraRef.current.start(videoRef.current);if(run!==cameraGeneration.current){cameraRef.current.stop(videoRef.current);return;}setCameraOn(true);
      qrTimer.current=window.setInterval(()=>{if(videoRef.current&&canvasRef.current){const code=decodeQrFrame(videoRef.current,canvasRef.current);if(code?.startsWith('basira://')&&(code!==lastQr.current.value||Date.now()-lastQr.current.at>15_000)){lastQr.current={value:code,at:Date.now()};applyQr(code);}}},1500);
      try{
      const provider=await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
      if(run!==cameraGeneration.current){await provider.close();return;}
      let segmentation:SegFormerSceneProvider|undefined;
      try{segmentation=await SegFormerSceneProvider.open();}catch{setNotice('الكاميرا تعمل، لكن تحليل المنطقة القابلة للمشي غير متاح.');}
      if(run!==cameraGeneration.current){await Promise.allSettled([provider.close(),segmentation?.close()]);return;}
      const pipeline=new VisionPipeline({video:videoRef.current,vision:provider,ocr:new TesseractOCRProvider(),depth:new UnavailableDepthProvider(),segmentation,
        config:DEFAULT_VISION_CONFIG,copy:visionCopy,mode:'EXPLORATION',buildingId,floorId:floorId||null,
        announcement:new VisionAnnouncementService(visionCopy,()=>{},new BrowserHapticFeedbackProvider(),DEFAULT_VISION_CONFIG.alertCooldownMs),
        callbacks:{
          scene:scene=>{if(run===cameraGeneration.current)engineRef.current?.observeWalkable(scene.walkableArea??null);},alert:()=>{},
          candidate:candidate=>{if(run!==cameraGeneration.current)return;const result=engineRef.current?.candidate(candidate);if(result){setNotice(`اقتراح مكان جديد: ${candidate.detectedText}`);update();}},
          recognized:recognized=>{if(run!==cameraGeneration.current)return;const place=places.find(p=>p.id===recognized.placeId);if(place&&engineRef.current?.recognized(place,recognized.confidence,Date.now())){setNotice(`تم التعرف على ${place.name}.`);speak(`تم التعرف على ${place.name}.`,.9,lang);update();}},
          OCRFailure:()=>{},segmentationFailure:()=>{},depthFailure:()=>{},fatal:()=>{if(run===cameraGeneration.current){setNotice('توقف تحليل الصورة.');void stopCamera();}},
        }});
      pipelineRef.current=pipeline;await pipeline.start();if(run!==cameraGeneration.current)await pipeline.stop();
      }catch{if(run===cameraGeneration.current)setNotice('الكاميرا وQR يعملان؛ تحليل OCR غير متاح على هذا الجهاز.');}
    }catch{if(run===cameraGeneration.current){setNotice('تعذر تشغيل الكاميرا أو نموذج الرؤية.');await stopCamera();}}finally{setBusy(false);}
  };
  const stopCamera=async()=>{cameraGeneration.current++;if(qrTimer.current){window.clearInterval(qrTimer.current);qrTimer.current=null;}const pipeline=pipelineRef.current;pipelineRef.current=null;if(pipeline)await pipeline.stop();cameraRef.current.stop(videoRef.current??undefined);setCameraOn(false);};
  const finish=async(cancel=false)=>{const engine=engineRef.current;if(!engine||!session||busy)return;setBusy(true);motionRef.current?.stop();setMotionOn(false);await stopCamera();
    try{
      if(!cancel){for(let i=0;i<engine.track.length;i+=2000)await navigationRequest(`/mapping-sessions/${session.id}/track`,json('POST',{points:engine.track.slice(i,i+2000)}));
        for(let i=0;i<engine.anchors.length;i+=500)await navigationRequest(`/mapping-sessions/${session.id}/anchors`,json('POST',{anchors:engine.anchors.slice(i,i+500)}));
        for(let i=0;i<engine.floorEvents.length;i+=500)await navigationRequest(`/mapping-sessions/${session.id}/floor-events`,json('POST',{events:engine.floorEvents.slice(i,i+500)}));
        for(let i=0;i<engine.suggestions.length;i+=100)await navigationRequest(`/mapping-sessions/${session.id}/suggestions`,json('POST',{suggestions:engine.suggestions.slice(i,i+100)}));}
      const result=await navigationRequest<{status:MappingSession['status']}>(`/mapping-sessions/${session.id}/finalize`,json('POST',{cancel}));
      setSession({...session,status:result.status});engineRef.current=null;setNotice(cancel?'أُلغيت الجولة.':'حُفظت الجولة. الاقتراحات بانتظار المراجعة.');
      setRecentSessions(previous=>[{...session,status:result.status},...previous.filter(s=>s.id!==session.id)]);
      if(!cancel){try{const list=await navigationRequest<{suggestions:MapSuggestion[]}>(`/buildings/${buildingId}/map-suggestions`);setSuggestions(list.suggestions);}catch{setNotice('حُفظت الجولة، لكن تعذر تحديث قائمة الاقتراحات. أعد فتح الصفحة لعرضها.');}}
      else setSuggestions(previous=>previous.filter(s=>s.sessionId!==session.id));
    }catch{setNotice('تعذر حفظ الجولة بالكامل. أعد المحاولة قبل مغادرة الصفحة.');}finally{setBusy(false);}
  };
  const cancelOld=async(item:MappingSession)=>{setBusy(true);try{await navigationRequest(`/mapping-sessions/${item.id}/finalize`,json('POST',{cancel:true}));setRecentSessions(previous=>previous.map(s=>s.id===item.id?{...s,status:'CANCELLED'}:s));setNotice('أُلغيت الجولة السابقة وحُذفت بيانات مسارها.');}catch{setNotice('تعذر إلغاء الجولة السابقة.');}finally{setBusy(false);}};
  const review=async(s:MapSuggestion,decision:'ACCEPTED'|'REJECTED')=>{setBusy(true);try{await navigationRequest(`/map-suggestions/${s.id}/review`,json('POST',{decision}));setSuggestions(previous=>previous.map(p=>p.id===s.id?{...p,status:decision}:p));setNotice(decision==='ACCEPTED'?'اعتُمد الاقتراح وأُضيف إلى خريطة B1 حيث ينطبق.':'رُفض الاقتراح.');}catch{setNotice('تعذرت المراجعة. تحقق من بيانات المقترح.');}finally{setBusy(false);}};
  const savePersonal=async()=>{const e=engineRef.current?.localization.fusion.current(Date.now())??estimate;if(!savedName.trim()||e.state!=='TRACKING'||!e.floorId||e.x===null||e.y===null)return;
    try{await navigationRequest('/saved-places',json('POST',{name:savedName.trim(),category:'OTHER',buildingId:e.buildingId,floorId:e.floorId,localX:e.x,localY:e.y,localizationConfidence:e.confidence}));setSavedName('');setNotice('حُفظ المكان في أماكنك الخاصة.');}catch{setNotice('تعذر حفظ المكان الشخصي.');}
  };
  const points=engineRef.current?.track.filter(p=>p.floorId===floorId)??[];
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs,0),maxX=Math.max(...xs,1),minY=Math.min(...ys,0),maxY=Math.max(...ys,1);
  const scaleX=(x:number)=>20+(x-minX)/Math.max(1,maxX-minX)*360,scaleY=(y:number)=>280-(y-minY)/Math.max(1,maxY-minY)*260;
  if(access==='loading')return <Layout><div className="container py-10 text-white">جارٍ التحميل…</div></Layout>;
  if(access==='forbidden')return <Layout><div className="container space-y-4 py-10 text-white"><h1 className="text-3xl font-bold">مسح المبنى</h1><p role="alert">يتطلب المسح الرسمي صلاحية mapper أو admin.</p><Link href="/navigation" className="text-amber-300 underline">العودة إلى التنقل</Link></div></Layout>;
  return <Layout><div dir="rtl" className="container space-y-6 py-10 text-white"><Link href="/navigation/admin" className="text-amber-300 underline">لوحة بناء الخرائط</Link><h1 className="text-3xl font-black">مسح المبنى</h1><p>يسجّل وضع المسح المسار والاقتراحات لهذه الجولة فقط. لا تُضاف إلى الخريطة العامة قبل المراجعة.</p><p role="status" aria-live="polite" className="min-h-7 text-amber-200">{notice}</p>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">المبنى والطابق</h2><div className="grid gap-3 md:grid-cols-3"><label>المبنى<select className={input} disabled={!!engineRef.current} value={buildingId} onChange={e=>{setBuildingId(e.target.value);setFloorId('');}}><option value="">اختر المبنى</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>الطابق المتوقع<select className={input} value={floorId} onChange={e=>setFloorId(e.target.value)}><option value="">غير معروف</option>{floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><button className={secondary} disabled={!!engineRef.current} onClick={findBuilding}>البحث عن مبنى قريب</button></div></section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الجولة</h2><div className="flex flex-wrap gap-3">{!engineRef.current?<button className={button} disabled={!buildingId||!graph||busy} onClick={start}>بدء المسح التلقائي</button>:<><button className={button} disabled={busy} onClick={()=>void finish(false)}>إيقاف وحفظ للمراجعة</button><button className={secondary} disabled={busy} onClick={()=>void finish(true)}>إلغاء الجولة</button>{!motionOn&&<button className={secondary} disabled={busy} onClick={resumeMotion}>استئناف رصد الحركة</button>}</>}</div><p className="mt-3">الحركة: {motionOn?'متاحة':'غير متاحة أو لم تُطلب'} · حالة الجولة: {session?.status??'لم تبدأ'}</p></section>
    {recentSessions.length>0&&<section className={panel}><h2 className="mb-3 text-xl font-bold">الجولات السابقة</h2><ul className="space-y-2">{recentSessions.map(item=><li key={item.id} className="flex flex-wrap items-center gap-3"><span>{new Date(item.startedAt).toLocaleString('ar-SA')} · {item.status}</span>{item.status==='ACTIVE'&&item.id!==session?.id&&<button className={secondary} disabled={busy} onClick={()=>void cancelOld(item)}>إلغاء جولة غير مكتملة</button>}</li>)}</ul></section>}
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الموقع الحالي</h2><p>الحالة: {estimate.state==='TRACKING'?'قيد التتبع':estimate.state==='LOCALIZATION_LOST'?'تعذر تحديد موقعك بدقة داخل المبنى':'لم يُثبّت الموقع بعد'}</p><p>الطابق: {floors.find(f=>f.id===estimate.floorId)?.name??'غير معروف'} · الثقة: {Math.round(estimate.confidence*100)}٪ · عدم اليقين النموذجي غير المقاس: {estimate.uncertaintyRadius===null?'غير معروف':`نحو ${estimate.uncertaintyRadius.toFixed(1)} م`}</p><p>المصادر: {estimate.sources.join('، ')||'لا يوجد'} · آخر تثبيت قوي: {estimate.lastStrongAnchorAt?new Date(estimate.lastStrongAnchorAt).toLocaleTimeString('ar-SA'):'لا يوجد'}</p><p>النقاط: {trackCount} · الأماكن المعروفة: {knownCount} · الاقتراحات: {suggestions.length}</p>{estimate.state==='LOCALIZATION_LOST'&&<p role="alert" className="mt-2 text-amber-200">وجّه الكاميرا نحو لوحة، امسح QR أو NFC، أو اختر نقطة معروفة.</p>}</section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">تثبيت الموقع</h2><div className="grid gap-3 md:grid-cols-2"><label>نقطة معروفة<select className={input} value={nodeId} onChange={e=>setNodeId(e.target.value)}><option value="">اختر نقطة</option>{(graph?.nodes??[]).map(n=><option key={n.id} value={n.id}>{places.find(p=>p.id===n.placeId)?.name??n.nodeType} · {floors.find(f=>f.id===n.floorId)?.name}</option>)}</select></label><button className={secondary} disabled={!engineRef.current||!nodeId} onClick={()=>{const n=graph?.nodes.find(n=>n.id===nodeId);if(n)anchorNode(n,'MANUAL');}}>تأكيد موقعي هنا</button><label>رمز QR<input className={input} value={qr} onChange={e=>setQr(e.target.value)} placeholder="basira://building/.../floor/.../node/..."/></label><button className={secondary} disabled={!engineRef.current||!qr} onClick={()=>applyQr(qr)}>استخدام QR</button><button className={secondary} disabled={!engineRef.current} onClick={scanNfc}>قراءة NFC إن توفر</button></div></section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">نقطة دخول يدوية</h2><p>استخدم مكانًا معروفًا بإحداثيات B1، أو أدخل نقطة أصل محلية متفقًا عليها للطابق. لا تدخل خطوط الطول والعرض هنا.</p><div className="mt-3 grid gap-3 md:grid-cols-3"><label>مكان معروف<select className={input} value={anchorPlaceId} onChange={e=>setAnchorPlaceId(e.target.value)}><option value="">اختر مكانًا</option>{places.filter(p=>p.localX!==null&&p.localY!==null).map(p=><option key={p.id} value={p.id}>{p.name} · {floors.find(f=>f.id===p.floorId)?.name}</option>)}</select></label><button className={secondary} disabled={!engineRef.current||!anchorPlaceId} onClick={anchorPlace}>تثبيت عند المكان</button><span/><label>X المحلي بالمتر<input className={input} type="number" step="any" value={anchorX} onChange={e=>setAnchorX(e.target.value)}/></label><label>Y المحلي بالمتر<input className={input} type="number" step="any" value={anchorY} onChange={e=>setAnchorY(e.target.value)}/></label><button className={secondary} disabled={!engineRef.current||!floorId} onClick={anchorLocal}>تثبيت نقطة الدخول</button></div></section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الانتقال بين الطوابق</h2><p>بعد دخول المصعد أو الدرج يصبح الطابق غير معروف حتى تؤكده عند نقطة معروفة.</p><div className="mt-3 flex flex-wrap gap-3"><button className={secondary} disabled={!engineRef.current} onClick={()=>{engineRef.current?.transition('ENTER_ELEVATOR',Date.now());setFloorId('');update();}}>دخلت المصعد</button><button className={secondary} disabled={!engineRef.current} onClick={()=>{engineRef.current?.transition('EXIT_ELEVATOR',Date.now());setFloorId('');update();}}>خرجت من المصعد</button><button className={secondary} disabled={!engineRef.current} onClick={()=>{engineRef.current?.transition('STAIRS_TRANSITION',Date.now());setFloorId('');update();}}>استخدمت الدرج</button></div></section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الكاميرا والتعرف على اللوحات</h2><div className="flex flex-wrap gap-3">{cameraOn?<button className={secondary} onClick={()=>void stopCamera()}>إيقاف الكاميرا</button>:<button className={secondary} disabled={!engineRef.current||busy} onClick={startCamera}>تشغيل الكاميرا وOCR وQR</button>}</div><video ref={videoRef} className="mt-3 max-h-72 w-full rounded-xl bg-black object-contain" muted playsInline aria-label="معاينة الكاميرا"/><canvas ref={canvasRef} hidden/></section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">إضافة نقطة يدويًا</h2><div className="grid gap-3 md:grid-cols-3"><label>النوع<select className={input} value={manualType} onChange={e=>setManualType(e.target.value as MapSuggestionType)}>{Object.entries(labels).filter(([key])=>key!=='NEW_EDGE'&&key!=='CORRIDOR').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>الاسم إن وجد<input className={input} value={manualName} onChange={e=>setManualName(e.target.value)}/></label><button className={secondary} disabled={!engineRef.current||estimate.state!=='TRACKING'} onClick={()=>{const result=engineRef.current?.manual(manualType,manualName||null);setNotice(result?'سُجل اقتراح للمراجعة.':'تعذر تسجيل النقطة؛ ثبّت موقعك أولًا.');setManualName('');update();}}>سجل النقطة</button></div></section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">معايرة المشي</h2><p>استخدم عدد الخطوات المقاس لمسافة معروفة. التقدير الافتراضي محافظ ولا يمثل دقة مقاسة.</p><Calibration engine={engineRef.current} onNotice={setNotice}/></section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">مكان شخصي</h2><div className="flex gap-3"><input className={input} value={savedName} onChange={e=>setSavedName(e.target.value)} placeholder="اسم المكان الخاص"/><button className={secondary} disabled={!savedName.trim()||estimate.state!=='TRACKING'} onClick={savePersonal}>احفظ هذا المكان</button></div></section>
    {points.length>0&&<section className={panel}><h2 className="mb-3 text-xl font-bold">المسار الحالي في الطابق المختار</h2><svg viewBox="0 0 400 300" className="h-72 w-full rounded-xl bg-stone-950" role="img" aria-label="رسم تقريبي لمسار الجولة"><polyline fill="none" stroke="#fbbf24" strokeWidth="3" points={points.map(p=>`${scaleX(p.x)},${scaleY(p.y)}`).join(' ')}/>{points.map((p,i)=><circle key={`${p.timestamp}-${i}`} cx={scaleX(p.x)} cy={scaleY(p.y)} r={i===points.length-1?5:2} fill="#fff"/>)}</svg><p className="mt-2 text-sm">رسم تقريبي للمشرف. إعلان الحالة والنقاط المهمة متاح نصيًا وصوتيًا.</p></section>}
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الاقتراحات للمراجعة</h2>{suggestions.length===0?<p>لا اقتراحات بعد.</p>:<ul className="space-y-3">{suggestions.map(s=><li key={s.id} className="rounded-xl border border-stone-600 p-3"><p>{labels[s.type]}{s.name?` — ${s.name}`:''} · {floors.find(f=>f.id===s.floorId)?.name??'طابق غير معروف'} · ثقة {Math.round(s.confidence*100)}٪ · {s.status==='PENDING'?'قيد المراجعة':s.status==='ACCEPTED'?'معتمد':'مرفوض'}</p>{s.status==='PENDING'&&!engineRef.current&&<div className="mt-2 flex gap-2"><button className={button} disabled={busy} onClick={()=>void review(s,'ACCEPTED')}>اعتماد</button><button className={secondary} disabled={busy} onClick={()=>void review(s,'REJECTED')}>رفض</button></div>}{s.status==='ACCEPTED'&&<button className={secondary} disabled={busy} onClick={()=>void sharedMapApi.importSuggestion(s.id).then(()=>setNotice('استورد الاقتراح إلى سجل B5 للمراجعة دون تكرار كتابته في B1.')).catch(()=>setNotice('تعذر استيراد الاقتراح.'))}>أضف مصدر B3 إلى سجل المساهمات</button>}</li>)}</ul>}</section>
  </div></Layout>;
}

function Calibration({engine,onNotice}:{engine:MappingSessionEngine|null;onNotice:(message:string)=>void}){
  const [distance,setDistance]=useState(''),[steps,setSteps]=useState('');
  return <div className="mt-3 flex flex-wrap gap-3"><input className={input} type="number" min="1" step="0.1" placeholder="المسافة بالمتر" value={distance} onChange={e=>setDistance(e.target.value)}/><input className={input} type="number" min="3" step="1" placeholder="عدد الخطوات" value={steps} onChange={e=>setSteps(e.target.value)}/><button className={secondary} disabled={!engine} onClick={()=>{try{const length=engine?.localization.calibrate(Number(distance),Number(steps));onNotice(`طول الخطوة المُعاير: ${length?.toFixed(2)} م.`);}catch{onNotice('قيم المعايرة غير صالحة أو خارج النطاق المقبول.');}}}>اعتمد المعايرة</button></div>;
}
