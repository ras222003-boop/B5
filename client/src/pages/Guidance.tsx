import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n, useMessages } from '@/i18n';
import { visionMessages } from '@/i18n/locales/vision';
import { navApi, navigationRequest, json, type BuildingGraph, type SearchResult } from '@/lib/navigationApi';
import { BasiraLocalizationEngine } from '@/lib/localization/engine';
import { PedestrianMotionProvider, decodeQrFrame, parseQrAnchor } from '@/lib/localization/providers';
import { BasiraNavigationEngine } from '@/lib/guidance/engine';
import { authorizedSavedPlace } from '@/lib/guidance/destination';
import { RoutePlanner, resolveDestination, trustedOrigin } from '@/lib/guidance/route';
import { VoiceCommandListener, VoiceNavigationService, HapticNavigationService, NavigationIntentService } from '@/lib/guidance/voice';
import type { DirectionStyle, GuidanceLanguage } from '@/lib/guidance/instructions';
import { DEFAULT_VISION_CONFIG } from '@/lib/vision/config';
import { CameraService } from '@/lib/vision/camera';
import { MediaPipeVisionProvider, TesseractOCRProvider, UnavailableDepthProvider } from '@/lib/vision/providers';
import { SegFormerSceneProvider, MonocularRelativeDepthProvider, NativeMetricDepthProvider } from '@/lib/vision/modelProviders';
import { detectVisionCapabilities } from '@/lib/vision/capabilities';
import { VisionPipeline } from '@/lib/vision/pipeline';
import { VisionAnnouncementService } from '@/lib/vision/scene';
import type { Floor, MapNode, Place, SavedPlace } from '@shared/navigation';
import type { LocalizationEstimate } from '@shared/localization';
import type { NavigationDestination, NavigationIntent, NavigationSession, RouteType } from '@shared/guidance';
import type { SceneDescription } from '@shared/vision';

const primary='min-h-14 rounded-xl bg-amber-300 px-5 py-3 font-bold text-stone-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-50';
const secondary='min-h-14 rounded-xl border border-amber-300/50 px-5 py-3 font-bold text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-50';
const input='min-h-14 w-full rounded-xl border border-amber-200/40 bg-stone-950 px-4 py-3 text-white';
const panel='rounded-2xl border border-amber-200/25 bg-stone-900 p-5';
const disclaimerKey='basira-b4-safety-disclaimer-v1';
const useSession=()=>{const [session,setSession]=useState<NavigationSession|null>(null);return {session,sync:(engine:BasiraNavigationEngine|null)=>setSession(engine?{...engine.session,progress:engine.session.progress?{...engine.session.progress}:null}:null)};};
const nodeLabel=(n:MapNode,places:Place[],floors:Floor[])=>`${places.find(p=>p.id===n.placeId)?.name??n.nodeType} — ${floors.find(f=>f.id===n.floorId)?.name??n.floorId}`;
const kindOf=(query:string)=>/مصعد|elevator|lift|电梯/i.test(query)?'ELEVATOR':/مخرج|exit|出口/i.test(query)?'EXIT':/دورة مياه|حمام|restroom|washroom|洗手间/i.test(query)?'RESTROOM':query;

export default function Guidance(){
  const {lang:platformLanguage}=useI18n(),visionCopy=useMessages(visionMessages);
  const [language,setLanguage]=useState<GuidanceLanguage>(platformLanguage),[style,setStyle]=useState<DirectionStyle>('LEFT_RIGHT'),[screenReader,setScreenReader]=useState(false);
  const [query,setQuery]=useState(''),[results,setResults]=useState<SearchResult[]>([]),[selected,setSelected]=useState<SearchResult|null>(null),[destination,setDestination]=useState<NavigationDestination|null>(null);
  const [graph,setGraph]=useState<BuildingGraph|null>(null),[floors,setFloors]=useState<Floor[]>([]),[places,setPlaces]=useState<Place[]>([]),[estimate,setEstimate]=useState<LocalizationEstimate|null>(null);
  const [notice,setNotice]=useState(''),[safetyText,setSafetyText]=useState(''),[scene,setScene]=useState<SceneDescription|null>(null),[cameraStatus,setCameraStatus]=useState('الكاميرا متوقفة'),[micStatus,setMicStatus]=useState('التحكم الصوتي متوقف'),[motionStatus,setMotionStatus]=useState('حساسات الحركة متوقفة');
  const [busy,setBusy]=useState(false),[cameraOn,setCameraOn]=useState(false),[micOn,setMicOn]=useState(false),[showPreview,setShowPreview]=useState(false),[routeType,setRouteType]=useState<RouteType>('RECOMMENDED'),[showOptions,setShowOptions]=useState(false);
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'?true:navigator.onLine);
  const [disclaimer,setDisclaimer]=useState(()=>typeof window!=='undefined'&&!localStorage.getItem(disclaimerKey));
  const speechAvailable=typeof window!=='undefined'&&'speechSynthesis'in window&&typeof SpeechSynthesisUtterance!=='undefined';
  const {session,sync}=useSession();
  const localization=useRef(new BasiraLocalizationEngine()),navigation=useRef<BasiraNavigationEngine|null>(null),voice=useRef(new VoiceNavigationService(platformLanguage)),haptic=useRef(new HapticNavigationService()),intent=useRef(new NavigationIntentService());
  const motion=useRef<PedestrianMotionProvider|null>(null),listener=useRef<VoiceCommandListener|null>(null),camera=useRef(new CameraService(DEFAULT_VISION_CONFIG)),pipeline=useRef<VisionPipeline|null>(null),video=useRef<HTMLVideoElement|null>(null),canvas=useRef<HTMLCanvasElement|null>(null),qrTimer=useRef<number|null>(null),generation=useRef(0);
  const graphRef=useRef<BuildingGraph|null>(null),placesRef=useRef<Place[]>([]),floorsRef=useRef<Floor[]>([]),latestScene=useRef<SceneDescription|null>(null),lastInstruction=useRef('');
  const hazardActive=useRef(false);
  const languageRef=useRef(language),styleRef=useRef(style),selectedRef=useRef<SearchResult|null>(null);
  const handlerRef=useRef<(command:NavigationIntent)=>Promise<void>>(async()=>{});
  useEffect(()=>{languageRef.current=language;voice.current.setLanguage(language);navigation.current?.configure(language,style);sync(navigation.current);},[language,style]);
  useEffect(()=>{styleRef.current=style;navigation.current?.configure(language,style);sync(navigation.current);},[style]);
  useEffect(()=>{selectedRef.current=selected;},[selected]);

  const announce=(text:string,priority:'CRITICAL_SAFETY'|'HIGH_SAFETY'|'RELOCALIZATION'|'TURN'|'ARRIVAL'|'INFORMATION'='INFORMATION',key=text,force=false)=>{setNotice(text);return voice.current.announce(text,priority,key,force);};
  const emitInstruction=(force=false)=>{const instruction=navigation.current?.session.instruction;if(!instruction||hazardActive.current&&instruction.kind!=='ARRIVAL')return;if(!force&&lastInstruction.current===instruction.id)return;lastInstruction.current=instruction.id;announce(instruction.text,instruction.kind==='ARRIVAL'?'ARRIVAL':'TURN',instruction.id,force);haptic.current.pulse(instruction.kind==='TURN_LEFT'?'LEFT':instruction.kind==='TURN_RIGHT'?'RIGHT':instruction.kind==='ARRIVAL'?'ARRIVAL':'CONTINUE');};
  const updateLocation=(value:LocalizationEstimate)=>{
    setEstimate(value);const engine=navigation.current;if(!engine)return;
    const result=engine.updateLocation(value,Date.now());sync(engine);
    if(result==='LOST'){announce('تعذر تحديد موقعك بدقة. سأحاول إعادة تحديد موقعك. استخدم لوحة معروفة أو QR أو أكد موقعك يدويًا.','RELOCALIZATION','location-lost');haptic.current.pulse('STOP');}
    if(result==='RECOVERED'){announce('تم تحديد موقعك، وسأتابع التوجيه.','RELOCALIZATION','location-recovered');emitInstruction(true);}
    if(result==='OFF_ROUTE'){announce('ابتعدت عن المسار الحالي. سأعيد حساب الطريق.','RELOCALIZATION','off-route');emitInstruction(true);}
    if(result==='PROGRESS')emitInstruction();
  };
  const anchorNode=(node:MapNode,source:'MANUAL'|'QR'|'NFC'='MANUAL')=>{
    const location=localization.current.anchor({buildingId:node.buildingId,floorId:node.floorId,x:node.x,y:node.y,headingDegrees:null,confidence:source==='MANUAL'?.82:.95,uncertaintyRadius:source==='MANUAL'?2.5:1.5,source,timestamp:Date.now(),nodeId:node.id,placeId:node.placeId});
    updateLocation(location);announce(`تم تثبيت الموقع عند ${nodeLabel(node,placesRef.current,floorsRef.current)}.`,'RELOCALIZATION','anchor');
  };
  const loadBuilding=async(buildingId:string)=>{
    let data:BuildingGraph;
    try{data=await navApi.graph(buildingId);sessionStorage.setItem(`basira-b4-graph-${buildingId}`,JSON.stringify(data));}
    catch{const cached=sessionStorage.getItem(`basira-b4-graph-${buildingId}`);if(!cached)throw new Error('map_unavailable');data=JSON.parse(cached) as BuildingGraph;setNotice('تعمل الخريطة المحملة سابقًا دون اتصال؛ قد لا تكون معلومات الإغلاق حديثة.');}
    const [floorResult,placeResult]=await Promise.allSettled([navApi.floors(buildingId),navApi.places(buildingId)]);
    const floorList=floorResult.status==='fulfilled'?floorResult.value.floors:JSON.parse(sessionStorage.getItem(`basira-b4-floors-${buildingId}`)??'[]') as Floor[];
    const placeList=placeResult.status==='fulfilled'?placeResult.value.places:JSON.parse(sessionStorage.getItem(`basira-b4-places-${buildingId}`)??'[]') as Place[];
    if(floorResult.status==='fulfilled')sessionStorage.setItem(`basira-b4-floors-${buildingId}`,JSON.stringify(floorList));
    if(placeResult.status==='fulfilled')sessionStorage.setItem(`basira-b4-places-${buildingId}`,JSON.stringify(placeList));
    setGraph(data);graphRef.current=data;setFloors(floorList);floorsRef.current=floorList;setPlaces(placeList);placesRef.current=placeList;
    return data;
  };
  const choose=async(result:SearchResult)=>{
    const item=result.item;if(!item.buildingId){announce('هذه الوجهة لا تحتوي على موقع داخلي مربوط بالخريطة.');return;}
    setBusy(true);
    try{
      if(result.kind==='saved'&&!await authorizedSavedPlace(item.id))throw new Error('private_place_unavailable');
      const data=await loadBuilding(item.buildingId);
      const value=resolveDestination(item,result.kind,data.nodes);
      if(!value){announce('الخريطة الداخلية لهذا الجزء غير مكتملة، أو لا توجد عقدة موثوقة للوجهة.');return;}
      if(result.kind==='place'&&!placesRef.current.some(place=>place.id===item.id)){placesRef.current=[...placesRef.current,item as Place];setPlaces(placesRef.current);}
      setSelected(result);setDestination(value);sessionStorage.setItem('basira-navigation-destination',JSON.stringify({kind:result.kind,id:item.id}));
      announce(`اختيرت الوجهة: ${item.name}. ثبت موقع البداية ثم ابدأ التوجيه.`);
    }catch{announce('تعذر تحميل الوجهة أو التحقق من صلاحية المكان الشخصي.');}finally{setBusy(false);}
  };
  const search=async(event?:FormEvent)=>{event?.preventDefault();if(!query.trim())return;setBusy(true);try{setResults((await navApi.search(query,graphRef.current?.building.id??sessionStorage.getItem('basira-current-building'),true)).results);setNotice('');}catch{const local=placesRef.current.filter(p=>[p.name,p.roomNumber??'',...p.aliases].some(v=>v.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(item=>({kind:'place' as const,item,priority:0}));setResults(local);announce(local.length?'تعذر البحث الشبكي؛ تظهر الأماكن العامة المحملة لهذه الجلسة.':'تعذر البحث الآن. تحقق من الاتصال أو الخريطة المحملة.');}finally{setBusy(false);}};
  const begin=async()=>{
    if(disclaimer){announce('اقرأ تنبيه الاستخدام الأول ثم قل فهمت أو اضغط متابعة.');return;}
    if(!destination||!graphRef.current){announce('اختر وجهة وخريطة أولًا.');return;}
    const location=localization.current.fusion.current(Date.now());setEstimate(location);
    const engine=new BasiraNavigationEngine(new RoutePlanner(graphRef.current.building,graphRef.current.nodes,[...graphRef.current.edges]),floorsRef.current,languageRef.current,styleRef.current);
    navigation.current=engine;const place=selectedRef.current?.kind==='place'?selectedRef.current.item as Place:null;
    if(!engine.prepare(destination,location,routeType,place)){sync(engine);announce(engine.session.failureReason==='incomplete_map'?'الخريطة الداخلية لهذا الجزء غير مكتملة.':engine.session.failureReason==='no_route'?'لا أستطيع إيجاد مسار موثوق إلى هذه الوجهة حاليًا.':'أحتاج أولًا إلى تحديد موقعك بشكل أفضل.','RELOCALIZATION');return;}
    engine.start();sync(engine);emitInstruction(true);
    if(!motion.current){const provider=new PedestrianMotionProvider(sample=>{if(sample.stepDetected)updateLocation(localization.current.step(sample.timestamp));},(degrees,source,absolute)=>{const heading=localization.current.heading.observe(degrees,source,Date.now(),absolute);const current=localization.current.fusion.current(Date.now());if(heading.confidence>=.3&&current.state==='TRACKING'&&navigation.current)navigation.current.session.location={...current,headingDegrees:heading.degrees};});
      try{if(await provider.start()){motion.current=provider;setMotionStatus('حساسات الحركة تعمل.');}else setMotionStatus('حساسات الحركة غير متاحة؛ استخدم علامات QR أو تأكيد المواقع.');}catch{setMotionStatus('لم يُسمح بحساسات الحركة؛ يمكنك استخدام العلامات المعروفة.');}}
    void startCamera();
  };
  const stopCamera=async()=>{generation.current++;if(qrTimer.current!==null){window.clearInterval(qrTimer.current);qrTimer.current=null;}const active=pipeline.current;pipeline.current=null;camera.current.stop(video.current??undefined);setCameraOn(false);setCameraStatus('الكاميرا متوقفة');latestScene.current=null;setScene(null);hazardActive.current=false;if(navigation.current)navigation.current.session.safety='ROUTE_UNCERTAIN';if(active)await active.stop();};
  const startCamera=async()=>{
    if(!video.current||cameraOn)return;const run=++generation.current;setCameraStatus('جارٍ تشغيل الكاميرا ونماذج الرؤية');
    try{
      await camera.current.start(video.current);if(run!==generation.current)return;setCameraOn(true);
      qrTimer.current=window.setInterval(()=>{if(!video.current||!canvas.current||!graphRef.current)return;const code=decodeQrFrame(video.current,canvas.current);const node=code?parseQrAnchor(code,graphRef.current.nodes):null;if(node)anchorNode(node,'QR');},2000);
      const provider=await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
      if(run!==generation.current){await provider.close();return;}
      const capabilities=detectVisionCapabilities();let segmentation:SegFormerSceneProvider|undefined,relativeDepth:MonocularRelativeDepthProvider|undefined,metricDepth:NativeMetricDepthProvider|undefined;
      try{segmentation=await SegFormerSceneProvider.open();}catch{setCameraStatus('كشف الأجسام يعمل، وتقسيم المشهد غير متاح.');}
      if(window.BasiraNativeDepth&&capabilities.nativeDepth)metricDepth=new NativeMetricDepthProvider(window.BasiraNativeDepth);
      else if(capabilities.performanceTier==='HIGH'&&segmentation)try{relativeDepth=await MonocularRelativeDepthProvider.open();}catch{/* relative depth is optional */}
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close(),relativeDepth?.close()]);return;}
      const vision=new VisionPipeline({video:video.current!,vision:provider,ocr:new TesseractOCRProvider(),depth:new UnavailableDepthProvider(),segmentation,relativeDepth,metricDepth,segmentationIntervalMs:capabilities.segmentationIntervalMs,depthIntervalMs:capabilities.depthIntervalMs,
        config:DEFAULT_VISION_CONFIG,copy:visionCopy,mode:'NAVIGATION',buildingId:graphRef.current?.building.id??null,floorId:null,localPlaces:placesRef.current,
        announcement:new VisionAnnouncementService(visionCopy,()=>{},{critical:()=>{}},DEFAULT_VISION_CONFIG.alertCooldownMs),callbacks:{
          scene:description=>{if(run!==generation.current)return;latestScene.current=description;setScene(description);const engine=navigation.current;if(!engine)return;const previousRoute=engine.session.route?.id;const decision=engine.observeScene(description);sync(engine);if(decision.priority>=3&&engine.session.state!=='PAUSED'){hazardActive.current=true;setSafetyText(decision.message);if(announce(decision.message,decision.priority>=7?'CRITICAL_SAFETY':'HIGH_SAFETY',`hazard:${decision.hazard?.trackId??decision.hazard?.type??'path'}`))haptic.current.pulse('HAZARD');if(previousRoute!==engine.session.route?.id&&engine.session.lastRerouteReason==='PERSISTENT_OBSTACLE')announce('سأعيد حساب المسار بسبب العائق المستمر.','RELOCALIZATION','obstacle-reroute');}else{const wasActive=hazardActive.current;hazardActive.current=false;setSafetyText('');if(wasActive&&decision.state==='ROUTE_CLEAR'&&engine.session.state==='NAVIGATING')emitInstruction(true);}},
          alert:(text,risk)=>{if(run===generation.current&&!navigation.current&&(risk==='CRITICAL'||risk==='HIGH'))announce(text,risk==='CRITICAL'?'CRITICAL_SAFETY':'HIGH_SAFETY',`vision:${text}`);},candidate:()=>{},recognized:recognized=>{if(run!==generation.current)return;const engine=navigation.current;
            const completed=engine?.considerArrival(recognized.placeId,true,recognized.doorDirection??null)??false;
            if(completed){sync(engine!);emitInstruction(true);haptic.current.pulse('ARRIVAL');void stopCamera();motion.current?.stop();motion.current=null;return;}
            const place=placesRef.current.find(p=>p.id===recognized.placeId);if(place){localization.current.visualAnchor(place,graphRef.current?.nodes??[],recognized.confidence,Date.now());updateLocation(localization.current.fusion.current(Date.now()));}},
          OCRFailure:()=>setCameraStatus('OCR غير متاح؛ يستمر كشف العوائق.'),segmentationFailure:()=>setCameraStatus('تقسيم المشهد غير متاح؛ يستمر كشف الأجسام.'),depthFailure:()=>{},fatal:()=>{void stopCamera().then(()=>setCameraStatus('توقف مزود الرؤية. تستمر الملاحة بالموقع والخريطة عند الإمكان.'));},
        }});
      pipeline.current=vision;await vision.start();if(run===generation.current)setCameraStatus('الكاميرا وتحليل NAVIGATION يعملان');
    }catch{if(run===generation.current){await stopCamera();setCameraStatus('الكاميرا غير متاحة. تستمر الخريطة والتوجيه مع تحذير غياب الرؤية.');}}
  };
  const handleIntent=async(command:NavigationIntent)=>{
    const engine=navigation.current;
    switch(command.type){
      case 'ACKNOWLEDGE_DISCLAIMER':acknowledge();announce('شكرًا. يمكنك اختيار الوجهة وبدء التوجيه.');break;
      case 'START_NAVIGATION':await begin();break;
      case 'CONFIRM_LOCATION':{const words=command.query.toLocaleLowerCase();const matches=graphRef.current?.nodes.filter(n=>nodeLabel(n,placesRef.current,floorsRef.current).toLocaleLowerCase().includes(words))??[];if(matches.length===1)anchorNode(matches[0]);else announce(matches.length?'الموقع غير محدد بما يكفي. اذكر اسمًا أدق.':'لم أجد هذا الموقع في الخريطة.');break;}
      case 'CONFIRM_ARRIVAL':{if(engine?.considerArrival(null,false,null,true)){sync(engine);emitInstruction(true);void stopCamera();motion.current?.stop();motion.current=null;}else announce('لا أستطيع تأكيد الوصول بعد؛ أحتاج موقعًا موثوقًا وقربًا من الوجهة.');break;}
      case 'NAVIGATE_TO':{setQuery(command.query);try{const found=(await navApi.search(command.query,graphRef.current?.building.id??sessionStorage.getItem('basira-current-building'),true)).results[0];if(found){await choose(found);announce(`وجدت ${found.item.name}. ثبت موقعك ثم قل ابدأ التوجيه أو اضغط البدء.`);}else announce('لم أجد الوجهة المطلوبة.');}catch{const local=placesRef.current.find(p=>[p.name,p.roomNumber??'',...p.aliases].some(v=>v.toLocaleLowerCase().includes(command.query.toLocaleLowerCase())));if(local)await choose({kind:'place',item:local,priority:0});else announce('البحث غير متاح الآن.');}break;}
      case 'WHERE_AM_I':{const loc=localization.current.fusion.current(Date.now());if(loc.state!=='TRACKING'||loc.confidence<.55)announce('موقعي الحالي غير مؤكد بما يكفي.');else{const nearby=graphRef.current?.nodes.filter(n=>n.floorId===loc.floorId&&n.placeId).sort((a,b)=>Math.hypot(a.x-loc.x!,a.y-loc.y!)-Math.hypot(b.x-loc.x!,b.y-loc.y!))[0];const name=placesRef.current.find(p=>p.id===nearby?.placeId)?.name??'موضع معروف';announce(`أنت في ${floorsRef.current.find(f=>f.id===loc.floorId)?.name??'الطابق الحالي'}، بالقرب من ${name}.`);}break;}
      case 'WHAT_IS_AHEAD':announce(latestScene.current?.shortText??'الرؤية غير متاحة الآن؛ لا أستطيع وصف ما أمامك.');break;
      case 'NEAREST_PLACE':{const loc=localization.current.fusion.current(Date.now());if(!graphRef.current||loc.state!=='TRACKING'){announce('أحتاج موقعًا موثوقًا وخريطة للعثور على الأقرب.');break;}const planner=engine?.planner??new RoutePlanner(graphRef.current.building,graphRef.current.nodes,graphRef.current.edges);const origin=trustedOrigin(planner.nodes,loc);const found=origin?planner.nearestPlace(origin.id,placesRef.current,kindOf(command.query),engine?.constraints.active()??[]):null;announce(found?`أقرب ${command.query} قابل للوصول: ${found.place.name}، على المسار المحسوب تقريبًا ${Math.round(found.route.totalDistance)} مترًا.`:'لم أجد مكانًا من هذا النوع يمكن الوصول إليه بالخريطة الحالية.');break;}
      case 'REPEAT_INSTRUCTION':emitInstruction(true);break;
      case 'PAUSE_NAVIGATION':engine?.pause();sync(engine);haptic.current.pulse('STOP');announce('توقف التوجيه مؤقتًا.');break;
      case 'RESUME_NAVIGATION':engine?.resume();sync(engine);emitInstruction(true);break;
      case 'CANCEL_NAVIGATION':engine?.cancel();sync(engine);motion.current?.stop();motion.current=null;void stopCamera();announce('أُلغي التنقل.');break;
      case 'REROUTE':if(engine?.reroute('USER_REQUEST')){sync(engine);announce('سأعيد حساب المسار.','RELOCALIZATION');emitInstruction(true);}else announce('لا أستطيع إيجاد مسار موثوق حاليًا.');break;
      case 'SAVE_PLACE':{const loc=localization.current.fusion.current(Date.now());if(loc.state!=='TRACKING'||loc.confidence<.65||loc.x===null||loc.y===null){announce('أحتاج موقعًا موثوقًا قبل الحفظ.');break;}try{await navigationRequest('/saved-places',json('POST',{name:command.name,category:'OTHER',buildingId:loc.buildingId,floorId:loc.floorId,localX:loc.x,localY:loc.y,localizationConfidence:loc.confidence}));announce(`حُفظ المكان باسم ${command.name}.`);}catch{announce('تعذر حفظ المكان. تحقق من تسجيل الدخول.');}break;}
      default:announce('لم أفهم الأمر. يمكنك قول: أين أنا، ماذا أمامي، أو خذيني إلى مكان.');
    }
  };
  handlerRef.current=handleIntent;
  const toggleMic=()=>{if(listener.current?.listening){listener.current.stop();setMicOn(false);setMicStatus('التحكم الصوتي متوقف');return;}const next=new VoiceCommandListener(language,text=>void handlerRef.current(intent.current.parse(text)),status=>{setMicStatus(status);if(status.startsWith('تعذر')||status.startsWith('توقف'))setMicOn(false);});listener.current=next;setMicOn(next.start());};
  const acknowledge=()=>{localStorage.setItem(disclaimerKey,'1');setDisclaimer(false);};
  useEffect(()=>{const saved=sessionStorage.getItem('basira-navigation-destination');if(!saved){const current=sessionStorage.getItem('basira-current-building');if(current)void loadBuilding(current).catch(()=>{});return;}try{const reference=JSON.parse(saved) as {kind:'place'|'saved';id:string};if(reference.kind==='saved')authorizedSavedPlace(reference.id).then(item=>{if(item)void choose({kind:'saved',item,priority:0});}).catch(()=>{});else navigationRequest<{place:Place}>(`/places/${reference.id}`).then(data=>void choose({kind:'place',item:data.place,priority:0})).catch(()=>{});}catch{/* stale selection */}},[]);
  useEffect(()=>{const timer=window.setInterval(()=>{const loc=localization.current.fusion.current(Date.now());if(loc.state!=='UNANCHORED')updateLocation(loc);const buildingId=graphRef.current?.building.id;if(buildingId&&navigator.onLine&&navigation.current?.session.state==='NAVIGATING')navApi.graph(buildingId).then(data=>{sessionStorage.setItem(`basira-b4-graph-${buildingId}`,JSON.stringify(data));graphRef.current=data;setGraph(data);if(navigation.current?.updateEdges(data.edges)){sync(navigation.current);announce('تغير إغلاق أحد الممرات. سأعيد حساب المسار.','RELOCALIZATION','closure');emitInstruction(true);}}).catch(()=>{});},30_000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{const changed=()=>setOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};},[]);
  useEffect(()=>()=>{listener.current?.stop();motion.current?.stop();voice.current.close();generation.current++;if(qrTimer.current!==null)window.clearInterval(qrTimer.current);camera.current.stop(video.current??undefined);void pipeline.current?.stop();navigation.current?.cancel();},[]);
  useEffect(()=>{const onHide=()=>{if(document.hidden){motion.current?.stop();motion.current=null;listener.current?.stop();setMicOn(false);void stopCamera();navigation.current?.pause();sync(navigation.current);}};document.addEventListener('visibilitychange',onHide);return()=>document.removeEventListener('visibilitychange',onHide);},[]);

  const selectedFloor=floors.find(f=>f.id===estimate?.floorId)?.name??'غير معروف';
  const progress=session?.progress?.fraction;
  return <Layout><div className="container max-w-4xl space-y-6 py-8 text-stone-100" dir="rtl">
    <Link href="/navigation" className="text-amber-300 underline">العودة إلى الأماكن</Link>
    <header><h1 className="text-3xl font-black">التنقل مع بصيرة</h1><p className="mt-2 text-stone-300">توجيه داخل المبنى باستخدام خريطة بصيرة وتحديد الموقع والرؤية عند توفرها.</p></header>
    {!online&&<p role="status" className="rounded-xl border border-amber-300/50 p-3 text-amber-100">انقطع الاتصال. تستمر الخريطة والنماذج المحملة في هذه الجلسة، لكن البحث الشبكي وتحديث إغلاقات الممرات قد لا يعملان.</p>}
    {disclaimer&&<section className={`${panel} border-amber-300`} role="dialog" aria-label="تنبيه الاستخدام الأول"><p>بصيرة مساعد تنقل تقني. الرؤية الحالية قد تفوّت عوائق أو مخاطر، ولا تضمن سلامة الحركة. استخدم وسيلة التنقل المعتادة وانتبه إلى محيطك.</p><button className={`${primary} mt-3`} onClick={acknowledge}>فهمت، متابعة</button><p className="mt-2 text-sm">يمكنك أيضًا قول «فهمت» بعد تشغيل الأوامر الصوتية.</p></section>}
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الوجهة</h2><form onSubmit={search} className="flex gap-2"><label className="sr-only" htmlFor="guide-search">ابحث عن وجهة</label><input id="guide-search" className={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="قاعة 121، مصعد، قاعتي…"/><button className={primary} disabled={busy}>بحث</button></form>
      {results.length>0&&<ul className="mt-3 space-y-2">{results.map(result=><li key={`${result.kind}-${result.item.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200/20 p-3"><span>{result.item.name}</span><button className={secondary} onClick={()=>void choose(result)}>اختيار</button></li>)}</ul>}
      <p className="mt-3 font-bold text-amber-200">{destination?`الوجهة: ${destination.name}`:'لم تُحدد وجهة بعد.'}</p>
    </section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">موقع البداية وإعادة التحديد</h2><p>الموقع: {estimate?.state==='TRACKING'?`${selectedFloor}، ثقة ${Math.round(estimate.confidence*100)}٪`:'غير مؤكد. استخدم علامة معروفة أو QR.'}</p>
      <label className="mt-3 block">ثبت موقعك عند عقدة معروفة<select className={input} value="" onChange={e=>{const node=graph?.nodes.find(n=>n.id===e.target.value);if(node)anchorNode(node);}}><option value="">اختر الموقع المؤكد</option>{graph?.nodes.map(n=><option key={n.id} value={n.id}>{nodeLabel(n,places,floors)}</option>)}</select></label>
      <p className="mt-2 text-sm text-stone-300">التأكيد اليدوي يعني أنك تقف عند الموقع المختار فعلًا. يمكن للكاميرا أيضًا قراءة QR ولوحات الأماكن المعروفة.</p>
      {session?.state==='RELOCALIZING'&&<p role="alert" className="mt-2 text-amber-200">أحتاج أولًا إلى تحديد موقعك بشكل أفضل. توقف وثبت موقعًا معروفًا.</p>}
    </section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">التوجيه</h2><p>الحالة: <strong>{session?.state??'لم تبدأ جلسة'}</strong></p><p className="mt-2 text-2xl font-bold text-amber-200">{session?.instruction?.text??'اختر وجهة وموقع بداية.'}</p>
      <p className="mt-2">الرؤية: {cameraStatus}</p><p>السلامة المرصودة: {session?.safety??'غير معروفة'} {safetyText}</p>{scene&&<p className="mt-2 text-sm">آخر وصف مختصر: {scene.shortText}</p>}
      {progress!==null&&progress!==undefined&&<p>التقدم التقريبي: {Math.round(progress*100)}٪{session?.progress?.distanceRemaining!==null?`، نحو ${Math.round(session?.progress?.distanceRemaining??0)} مترًا` : ''}</p>}
      {session?.state==='FAILED'&&<p role="alert" className="mt-2 text-red-200">{session.failureReason==='incomplete_map'?'الخريطة الداخلية لهذا الجزء غير مكتملة.':'لا أستطيع إيجاد مسار موثوق إلى هذه الوجهة حاليًا.'}</p>}
      {session?.instruction?.kind==='FLOOR_TRANSITION'&&<div className="mt-3 flex gap-2"><button className={secondary} onClick={()=>{updateLocation(localization.current.transition('ENTER_ELEVATOR',Date.now()));announce('بعد الوصول إلى الطابق المطلوب، أكد موقعك عند عقدة معروفة.','RELOCALIZATION');}}>بدأ الانتقال بين الطوابق</button></div>}
      <div className="mt-4 flex flex-wrap gap-2"><button className={primary} disabled={!destination||!graph||disclaimer||busy||session?.state==='NAVIGATING'} onClick={()=>void begin()}>ابدأ التوجيه</button><button className={secondary} disabled={session?.state!=='NAVIGATING'} onClick={()=>void handleIntent({type:'PAUSE_NAVIGATION'})}>إيقاف مؤقت</button><button className={secondary} disabled={session?.state!=='PAUSED'} onClick={()=>void handleIntent({type:'RESUME_NAVIGATION'})}>متابعة</button><button className={secondary} disabled={!session||session.state==='CANCELLED'} onClick={()=>void handleIntent({type:'CANCEL_NAVIGATION'})}>إلغاء</button><button className={secondary} disabled={!session?.route} onClick={()=>void handleIntent({type:'REROUTE'})}>غيّر المسار</button><button className={secondary} disabled={session?.state!=='NAVIGATING'} onClick={()=>void handleIntent({type:'CONFIRM_ARRIVAL'})}>تأكيد الوصول</button></div>
      <button className="mt-3 text-amber-200 underline" onClick={()=>setShowOptions(!showOptions)}>خيارات المسار والإرشاد</button>
      {showOptions&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><label>نوع المسار<select className={input} value={routeType} onChange={e=>setRouteType(e.target.value as RouteType)}><option value="RECOMMENDED">الموصى به لبصيرة</option><option value="SHORTEST">الأقصر</option><option value="ACCESSIBLE">المتاح دون درج</option></select></label><label>لغة الصوت<select className={input} value={language} onChange={e=>setLanguage(e.target.value as GuidanceLanguage)}><option value="ar">العربية</option><option value="en">English</option><option value="zh-CN">中文</option></select></label><label>وصف الاتجاه<select className={input} value={style} onChange={e=>setStyle(e.target.value as DirectionStyle)}><option value="LEFT_RIGHT">يمين ويسار</option><option value="CLOCK">اتجاه الساعة</option></select></label><label className="flex items-center gap-3"><input type="checkbox" checked={screenReader} onChange={e=>{setScreenReader(e.target.checked);voice.current.setScreenReaderMode(e.target.checked);}}/>استخدم قارئ الشاشة بدل صوت الملاحة</label></div>}
    </section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الأوامر والبيئة</h2><div className="flex flex-wrap gap-2"><button className={primary} onClick={toggleMic}>{micOn?'إيقاف الاستماع':'تشغيل الأوامر الصوتية'}</button><button className={secondary} onClick={()=>void handleIntent({type:'WHERE_AM_I'})}>أين أنا؟</button><button className={secondary} onClick={()=>void handleIntent({type:'WHAT_IS_AHEAD'})}>ماذا أمامي؟</button><button className={secondary} onClick={()=>void handleIntent({type:'REPEAT_INSTRUCTION'})}>أعد التعليمات</button><button className={secondary} onClick={()=>void (cameraOn?stopCamera():startCamera())}>{cameraOn?'إيقاف الرؤية':'تشغيل الرؤية وQR'}</button></div><p className="mt-3 text-sm">{micStatus} · {motionStatus}</p><p className="mt-2 text-sm text-stone-300">قد يحتاج تعرف الكلام في المتصفح إلى الإنترنت. تعمل أزرار التحكم عند عدم توفره. اطلب إذن الميكروفون فقط عند تشغيل الاستماع.</p>
      {!speechAvailable&&<p role="status" className="mt-2 text-amber-200">النطق الصوتي غير متاح في هذا المتصفح؛ استخدم قارئ الشاشة والأزرار.</p>}
      <button className="mt-3 text-amber-200 underline" onClick={()=>setShowPreview(!showPreview)}>{showPreview?'إخفاء المعاينة':'إظهار معاينة الكاميرا الاختيارية'}</button><video ref={video} muted playsInline aria-label="معاينة الكاميرا الاختيارية" className={`mt-3 max-h-64 w-full rounded-xl bg-black object-contain ${showPreview?'':'sr-only'}`}/><canvas ref={canvas} hidden/>
    </section>
    <p role={safetyText?'alert':'status'} aria-live={safetyText?'assertive':'polite'} className="min-h-7 text-amber-200">{screenReader||!speechAvailable||safetyText?notice:''}</p>
  </div></Layout>;
}
