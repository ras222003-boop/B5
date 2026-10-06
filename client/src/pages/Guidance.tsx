import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n, useMessages } from '@/i18n';
import { visionMessages } from '@/i18n/locales/vision';
import { navApi, navigationRequest, json, type BuildingGraph, type SearchResult } from '@/lib/navigationApi';
import { cachePublicMap, readPublicMap } from '@/lib/navigationCache';
import { sharedMapApi, SharedMapSyncService } from '@/lib/sharedMap';
import { loadSafetyFlags } from '@/lib/safetyFlags';
import type { IssueDuration, IssueType } from '@shared/sharedMap';
import { BasiraLocalizationEngine } from '@/lib/localization/engine';
import { PedestrianMotionProvider, decodeQrFrame, parseQrAnchor } from '@/lib/localization/providers';
import { BasiraNavigationEngine } from '@/lib/guidance/engine';
import { authorizedSavedPlace } from '@/lib/guidance/destination';
import { RoutePlanner, resolveDestination, trustedOrigin } from '@/lib/guidance/route';
import { assessFamiliarRoute, routeSaveBody } from '@/lib/guidance/journey';
import NavigationRouteMap from '@/components/navigation/NavigationRouteMap';
import OutdoorApproach from '@/components/navigation/OutdoorApproach';
import { zoneAnnouncement, zoneAt } from '@/lib/guidance/zones';
import { VoiceCommandListener, VoiceNavigationService, HapticNavigationService, NavigationIntentService } from '@/lib/guidance/voice';
import { guidancePhrases } from '@/lib/guidance/systemPhrases';
import { NavigationInstructionGenerator, type DirectionStyle, type GuidanceLanguage } from '@/lib/guidance/instructions';
import { getSpeechPreferences, saveSpeechPreferences, speechEngine } from '@/lib/speechEngine';
import type { ArabicStyle } from '@shared/speech';
import { DEFAULT_VISION_CONFIG } from '@/lib/vision/config';
import { CameraService } from '@/lib/vision/camera';
import { MediaPipeVisionProvider, TesseractOCRProvider, UnavailableDepthProvider } from '@/lib/vision/providers';
import { SegFormerSceneProvider, MonocularRelativeDepthProvider, NativeMetricDepthProvider } from '@/lib/vision/modelProviders';
import { detectVisionCapabilities } from '@/lib/vision/capabilities';
import { VisionPipeline } from '@/lib/vision/pipeline';
import { VisionAnnouncementService } from '@/lib/vision/scene';
import type { Floor, MapNode, Place, SavedPlace, SavedRoute } from '@shared/navigation';
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
  const [language,setLanguage]=useState<GuidanceLanguage>(()=>getSpeechPreferences().language),[style,setStyle]=useState<DirectionStyle>('LEFT_RIGHT'),[screenReader,setScreenReader]=useState(()=>getSpeechPreferences().screenReaderMode),[arabicStyle,setArabicStyle]=useState<ArabicStyle>(()=>getSpeechPreferences().arabicStyle);
  const [query,setQuery]=useState(''),[results,setResults]=useState<SearchResult[]>([]),[selected,setSelected]=useState<SearchResult|null>(null),[destination,setDestination]=useState<NavigationDestination|null>(null);
  const [graph,setGraph]=useState<BuildingGraph|null>(null),[floors,setFloors]=useState<Floor[]>([]),[places,setPlaces]=useState<Place[]>([]),[estimate,setEstimate]=useState<LocalizationEstimate|null>(null);
  const [notice,setNotice]=useState(''),[safetyText,setSafetyText]=useState(''),[scene,setScene]=useState<SceneDescription|null>(null),[cameraStatus,setCameraStatus]=useState('الكاميرا متوقفة'),[micStatus,setMicStatus]=useState('التحكم الصوتي متوقف'),[motionStatus,setMotionStatus]=useState('حساسات الحركة متوقفة');
  const [busy,setBusy]=useState(false),[cameraOn,setCameraOn]=useState(false),[micOn,setMicOn]=useState(false),[showPreview,setShowPreview]=useState(false),[routeType,setRouteType]=useState<RouteType>('RECOMMENDED'),[showOptions,setShowOptions]=useState(false);
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'?true:navigator.onLine);
  const [outdoorTarget,setOutdoorTarget]=useState<{name:string;latitude:number;longitude:number;kind:'BUILDING'|'SAVED'}|null>(null);
  const [savedRoutes,setSavedRoutes]=useState<SavedRoute[]>([]),[preferredRoute,setPreferredRoute]=useState<SavedRoute|null>(null),[familiarPreference,setFamiliarPreference]=useState(()=>localStorage.getItem('basira-prefer-familiar')!=='false');
  const [saveRouteName,setSaveRouteName]=useState(''),[savePlaceName,setSavePlaceName]=useState(''),[mapFloorId,setMapFloorId]=useState<string|null>(null),[hapticsOn,setHapticsOn]=useState(()=>localStorage.getItem('basira-haptics')!=='false');
  const [issueType,setIssueType]=useState<IssueType>('ROAD_CLOSED'),[issueDuration,setIssueDuration]=useState<IssueDuration>('TEMPORARY'),[issueDescription,setIssueDescription]=useState(''),[issueConsent,setIssueConsent]=useState(false);
  const [disclaimer,setDisclaimer]=useState(()=>typeof window!=='undefined'&&!localStorage.getItem(disclaimerKey));
  const speechAvailable=typeof window!=='undefined'&&'speechSynthesis'in window&&typeof SpeechSynthesisUtterance!=='undefined';
  const {session,sync}=useSession();
  const localization=useRef(new BasiraLocalizationEngine()),navigation=useRef<BasiraNavigationEngine|null>(null),voice=useRef(new VoiceNavigationService(platformLanguage)),haptic=useRef(new HapticNavigationService()),intent=useRef(new NavigationIntentService());
  const motion=useRef<PedestrianMotionProvider|null>(null),listener=useRef<VoiceCommandListener|null>(null),camera=useRef(new CameraService(DEFAULT_VISION_CONFIG)),pipeline=useRef<VisionPipeline|null>(null),video=useRef<HTMLVideoElement|null>(null),canvas=useRef<HTMLCanvasElement|null>(null),qrTimer=useRef<number|null>(null),generation=useRef(0);
  const graphRef=useRef<BuildingGraph|null>(null),placesRef=useRef<Place[]>([]),floorsRef=useRef<Floor[]>([]),latestScene=useRef<SceneDescription|null>(null),lastInstruction=useRef(''),preparedRoute=useRef('');
  const mapVersionRef=useRef(1),deferredMapRef=useRef<{graph:BuildingGraph;version:number}|null>(null);
  const mapSync=useRef(new SharedMapSyncService());
  const hazardActive=useRef(false);
  const lastZoneRef=useRef<string|null>(null);
  const startNodeRef=useRef<MapNode|null>(null),breadcrumb=useRef<string[]>([]),arrivalReported=useRef<string|null>(null),fineGuidance=useRef(false);
  const spoken=guidancePhrases(language,arabicStyle);
  const languageRef=useRef(language),styleRef=useRef(style),selectedRef=useRef<SearchResult|null>(null);
  const handlerRef=useRef<(command:NavigationIntent)=>Promise<void>>(async()=>{});
  useEffect(()=>{languageRef.current=language;styleRef.current=style;voice.current.setLanguage(language);navigation.current?.configure(language,style,arabicStyle);sync(navigation.current);lastInstruction.current='';voice.current.invalidateRoute();},[language,style,arabicStyle]);
  useEffect(()=>{voice.current.setScreenReaderMode(screenReader);},[screenReader]);
  useEffect(()=>{haptic.current.setEnabled(hapticsOn);localStorage.setItem('basira-haptics',String(hapticsOn));},[hapticsOn]);
  useEffect(()=>{navApi.savedRoutes().then(data=>setSavedRoutes(data.savedRoutes)).catch(()=>{});},[]);
  useEffect(()=>{const changed=()=>{const p=getSpeechPreferences();setLanguage(p.language);setArabicStyle(p.arabicStyle);setScreenReader(p.screenReaderMode);};window.addEventListener('basira-speech-preferences',changed);return()=>window.removeEventListener('basira-speech-preferences',changed);},[]);
  useEffect(()=>{selectedRef.current=selected;},[selected]);

  const announce=(text:string,priority:'CRITICAL_SAFETY'|'HIGH_SAFETY'|'RELOCALIZATION'|'TURN'|'ARRIVAL'|'INFORMATION'='INFORMATION',key=text,force=false)=>{setNotice(text);return voice.current.announce(text,priority,key,force);};
  const emitInstruction=(force=false)=>{const engine=navigation.current,instruction=engine?.session.instruction;if(!instruction||!['NAVIGATING','ARRIVED'].includes(engine?.session.state??'')||hazardActive.current&&instruction.kind!=='ARRIVAL')return;if(!force&&lastInstruction.current===instruction.id)return;const route=engine?.session.route;if(route&&preparedRoute.current!==route.id){voice.current.invalidateRoute();preparedRoute.current=route.id;}lastInstruction.current=instruction.id;announce(instruction.text,instruction.kind==='ARRIVAL'?'ARRIVAL':'TURN',instruction.id,force);if(route&&engine?.session.progress){const nextIndex=engine.session.progress.edgeIndex+1;if(nextIndex<route.orderedEdges.length){const next=new NavigationInstructionGenerator(floorsRef.current,language,style,arabicStyle).forEdge(route,nextIndex,engine.session.location?.confidence??0);voice.current.prefetch(next.id,next.text);}}haptic.current.pulse(instruction.kind==='TURN_LEFT'?'LEFT':instruction.kind==='TURN_RIGHT'?'RIGHT':instruction.kind==='ARRIVAL'?'ARRIVAL':'CONTINUE');};
  const updateLocation=(value:LocalizationEstimate)=>{
    setEstimate(value);if(value.floorId)setMapFloorId(value.floorId);const engine=navigation.current;if(!engine)return;
    const result=engine.updateLocation(value,Date.now());sync(engine);
    if(result==='PROGRESS'&&engine.session.route&&engine.session.progress){
      const edge=engine.session.route.orderedEdges[engine.session.progress.edgeIndex];
      if(edge&&breadcrumb.current.at(-1)!==edge.id)breadcrumb.current.push(edge.id);
      const near=engine.session.progress.distanceRemaining!==null&&engine.session.progress.distanceRemaining<=20;
      if(near&&!fineGuidance.current&&value.confidence>=.65){fineGuidance.current=true;announce('أنت في الجزء الأخير من الطريق. تحقق من الباب أو رقم الغرفة قبل تأكيد الوصول.','INFORMATION','fine-guidance');}
    }
    const zone=zoneAt(graphRef.current?.zones,value),zoneId=zone?.id??null;
    if(zoneId!==lastZoneRef.current){lastZoneRef.current=zoneId;if(zone&&engine.session.state==='NAVIGATING')announce(zoneAnnouncement(zone,languageRef.current),'INFORMATION',`zone:${zone.id}`);}
    if(result==='LOST'){voice.current.close();announce(spoken.lost,'RELOCALIZATION','location-lost');haptic.current.pulse('RELOCALIZE');}
    if(result==='RECOVERED'){announce(spoken.recovered,'RELOCALIZATION','location-recovered');emitInstruction(true);}
    if(result==='OFF_ROUTE'){announce(spoken.offRoute,'RELOCALIZATION','off-route');emitInstruction(true);}
    if(result==='PROGRESS')emitInstruction();
  };
  const anchorNode=(node:MapNode,source:'MANUAL'|'QR'|'NFC'='MANUAL')=>{
    setOutdoorTarget(null);
    if(deferredMapRef.current){const pending=deferredMapRef.current;deferredMapRef.current=null;graphRef.current=pending.graph;setGraph(pending.graph);mapVersionRef.current=pending.version;navigation.current?.updateEdges(pending.graph.edges);announce('تحدّثت الخريطة عند نقطة تثبيت معروفة. سأعيد التحقق من المسار.','RELOCALIZATION','map-safe-point');}
    const location=localization.current.anchor({buildingId:node.buildingId,floorId:node.floorId,x:node.x,y:node.y,headingDegrees:null,confidence:source==='MANUAL'?.82:.95,uncertaintyRadius:source==='MANUAL'?2.5:1.5,source,timestamp:Date.now(),nodeId:node.id,placeId:node.placeId});
    updateLocation(location);announce(`تم تثبيت الموقع عند ${nodeLabel(node,placesRef.current,floorsRef.current)}.`,'RELOCALIZATION','anchor');
  };
  const loadBuilding=async(buildingId:string)=>{
    let knownVersion=Number(sessionStorage.getItem(`basira-b5-version-${buildingId}`)??1),cachedGraph=false;
    try{knownVersion=(await sharedMapApi.version(buildingId)).version;}catch{/* keep cached version */}
    let data:BuildingGraph;
    try{data=await navApi.graph(buildingId);cachePublicMap(`graph:${buildingId}`,data);}
    catch{const cached=readPublicMap<BuildingGraph>(`graph:${buildingId}`);if(!cached)throw new Error('map_unavailable');data=cached;cachedGraph=true;setNotice('تعمل الخريطة العامة المحملة سابقًا دون اتصال؛ معلومات المخاطر والإغلاق قديمة أو غير معروفة.');}
    const [floorResult,placeResult]=await Promise.allSettled([navApi.floors(buildingId),navApi.places(buildingId)]);
    const floorList=floorResult.status==='fulfilled'?floorResult.value.floors:readPublicMap<Floor[]>(`floors:${buildingId}`)??[];
    const placeList=placeResult.status==='fulfilled'?placeResult.value.places:readPublicMap<Place[]>(`places:${buildingId}`)??[];
    if(floorResult.status==='fulfilled')cachePublicMap(`floors:${buildingId}`,floorList);
    if(placeResult.status==='fulfilled')cachePublicMap(`places:${buildingId}`,placeList);
    setGraph(data);graphRef.current=data;lastZoneRef.current=null;setFloors(floorList);floorsRef.current=floorList;setPlaces(placeList);placesRef.current=placeList;
    setMapFloorId(previous=>previous&&floorList.some(floor=>floor.id===previous)?previous:floorList[0]?.id??null);
    mapVersionRef.current=cachedGraph?Number(sessionStorage.getItem(`basira-b5-version-${buildingId}`)??1):knownVersion;
    sessionStorage.setItem(`basira-b5-version-${buildingId}`,String(mapVersionRef.current));
    return data;
  };
  const resetForDestination=()=>{navigation.current?.cancel();navigation.current=null;sync(null);voice.current.invalidateRoute();motion.current?.stop();motion.current=null;void stopCamera();
    startNodeRef.current=null;breadcrumb.current=[];arrivalReported.current=null;fineGuidance.current=false;setGraph(null);graphRef.current=null;setDestination(null);setSelected(null);selectedRef.current=null;setOutdoorTarget(null);sessionStorage.removeItem('basira-navigation-destination');};
  const choose=async(result:SearchResult)=>{
    resetForDestination();
    const item=result.item;if(!item.buildingId){if(item.latitude!=null&&item.longitude!=null){setOutdoorTarget({name:item.name,latitude:item.latitude,longitude:item.longitude,kind:'SAVED'});setDestination(null);setSelected(result);announce('يمكن متابعة موقعك واتجاه المكان العام عبر GPS. لا توجد بيانات طريق مشي لهذه الوجهة.');}else announce('هذه الوجهة لا تحتوي على موقع صالح للملاحة.');return;}
    setBusy(true);
    try{
      if(result.kind==='saved'&&!await authorizedSavedPlace(item.id))throw new Error('private_place_unavailable');
      const data=await loadBuilding(item.buildingId);
      setOutdoorTarget(data.building.latitude!=null&&data.building.longitude!=null?{name:data.building.name,latitude:data.building.latitude,longitude:data.building.longitude,kind:'BUILDING'}:null);
      const value=resolveDestination(item,result.kind,data.nodes);
      if(!value){if(item.latitude!=null&&item.longitude!=null){setOutdoorTarget({name:item.name,latitude:item.latitude,longitude:item.longitude,kind:'SAVED'});setDestination(null);setSelected(result);announce('لا توجد عقدة داخلية موثوقة لهذه النقطة. سأعرض موقعها التقريبي عبر GPS فقط.');}else announce('الخريطة الداخلية لهذا الجزء غير مكتملة، أو لا توجد عقدة موثوقة للوجهة.');return;}
      if(result.kind==='place'&&!placesRef.current.some(place=>place.id===item.id)){placesRef.current=[...placesRef.current,item as Place];setPlaces(placesRef.current);}
      setSelected(result);setPreferredRoute(null);setDestination(value);sessionStorage.setItem('basira-navigation-destination',JSON.stringify({kind:result.kind,id:item.id}));
      announce(`اختيرت الوجهة: ${item.name}. ثبت موقع البداية ثم ابدأ التوجيه.`);
    }catch{announce('تعذر تحميل الوجهة أو التحقق من صلاحية المكان الشخصي.');}finally{setBusy(false);}
  };
  const chooseSavedRoute=async(saved:SavedRoute)=>{
    resetForDestination();
    setBusy(true);
    try{const data=await loadBuilding(saved.buildingId);const node=data.nodes.find(item=>item.id===saved.destinationNodeId);if(!node)throw new Error('stale_route');
      setOutdoorTarget(data.building.latitude!=null&&data.building.longitude!=null?{name:data.building.name,latitude:data.building.latitude,longitude:data.building.longitude,kind:'BUILDING'}:null);
      setSelected(null);setPreferredRoute(saved);setDestination({kind:'saved',id:saved.id,name:saved.name,buildingId:saved.buildingId,floorId:node.floorId,nodeId:node.id,placeId:node.placeId});
      announce(`اختير المسار المألوف ${saved.name}. سأتأكد من الخريطة والمخاطر الحالية عند البدء.`);
    }catch{announce('تعذر فتح المسار المحفوظ أو تغيرت خريطته.');}finally{setBusy(false);}
  };
  const search=async(event?:FormEvent)=>{event?.preventDefault();if(!query.trim())return;setBusy(true);try{setResults((await navApi.search(query,graphRef.current?.building.id??sessionStorage.getItem('basira-current-building'),true)).results);setNotice('');}catch{const local=placesRef.current.filter(p=>[p.name,p.roomNumber??'',...p.aliases].some(v=>v.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(item=>({kind:'place' as const,item,priority:0}));setResults(local);announce(local.length?'تعذر البحث الشبكي؛ تظهر الأماكن العامة المحملة لهذه الجلسة.':'تعذر البحث الآن. تحقق من الاتصال أو الخريطة المحملة.');}finally{setBusy(false);}};
  const begin=async()=>{
    if(disclaimer){announce('اقرأ تنبيه الاستخدام الأول ثم قل فهمت أو اضغط متابعة.');return;}
    if(!destination||!graphRef.current){announce('اختر وجهة وخريطة أولًا.');return;}
    const location=localization.current.fusion.current(Date.now());setEstimate(location);
    lastZoneRef.current=null;
    const planner=new RoutePlanner(graphRef.current.building,graphRef.current.nodes,[...graphRef.current.edges]);
    const origin=trustedOrigin(planner.nodes,location);
    const familiar=origin&&(familiarPreference||preferredRoute)?((preferredRoute?[preferredRoute]:savedRoutes).map(saved=>({saved,assessment:assessFamiliarRoute(saved,graphRef.current!.building,planner.nodes,planner.edges,origin.id,destination.nodeId,[],Date.now())})).filter(value=>value.assessment.eligible).sort((a,b)=>b.saved.successfulArrivalCount-a.saved.successfulArrivalCount||new Date(b.saved.lastSuccessfulAt).getTime()-new Date(a.saved.lastSuccessfulAt).getTime())[0]??null):null;
    if(familiar){planner.preferFamiliarEdges(familiar.assessment.edgeIds);setPreferredRoute(familiar.saved);}
    else if(preferredRoute)announce('المسار المعتاد غير متاح أو تغيرت بياناته. سأبحث عن بديل.','RELOCALIZATION','familiar-unavailable');
    const engine=new BasiraNavigationEngine(planner,floorsRef.current,languageRef.current,styleRef.current,arabicStyle);
    navigation.current=engine;const place=selectedRef.current?.kind==='place'?selectedRef.current.item as Place:null;
    if(!engine.prepare(destination,location,routeType,place)){sync(engine);announce(engine.session.failureReason==='incomplete_map'?'الخريطة الداخلية لهذا الجزء غير مكتملة.':engine.session.failureReason==='no_route'?'لا أستطيع إيجاد مسار موثوق إلى هذه الوجهة حاليًا.':'أحتاج أولًا إلى تحديد موقعك بشكل أفضل.','RELOCALIZATION');return;}
    startNodeRef.current=engine.session.route?.origin??null;breadcrumb.current=[];fineGuidance.current=false;arrivalReported.current=null;
    engine.start();sync(engine);emitInstruction(true);
    if(!motion.current){const provider=new PedestrianMotionProvider(sample=>{if(sample.stepDetected)updateLocation(localization.current.step(sample.timestamp));},(degrees,source,absolute)=>{const heading=localization.current.heading.observe(degrees,source,Date.now(),absolute);const current=localization.current.fusion.current(Date.now());if(heading.confidence>=.3&&current.state==='TRACKING'&&navigation.current)navigation.current.session.location={...current,headingDegrees:heading.degrees};});
      try{if(await provider.start()){motion.current=provider;setMotionStatus('حساسات الحركة تعمل.');}else setMotionStatus('حساسات الحركة غير متاحة؛ استخدم علامات QR أو تأكيد المواقع.');}catch{setMotionStatus('لم يُسمح بحساسات الحركة؛ يمكنك استخدام العلامات المعروفة.');}}
    void startCamera();
  };
  useEffect(()=>{const route=session?.route;if(session?.state!=='ARRIVED'||!route||arrivalReported.current===route.id)return;
    arrivalReported.current=route.id;setSaveRouteName(`${route.origin.nodeType==='ENTRANCE'?'من المدخل':'من نقطة البداية'} إلى ${route.destination.name}`);
    if(preferredRoute&&preferredRoute.destinationNodeId===route.destination.nodeId&&preferredRoute.routeData.edgeIds.join('|')===route.orderedEdges.map(edge=>edge.id).join('|')){
      const duration=Math.max(1,Math.round((Date.now()-session.startedAt)/1000));
      void navApi.routeSuccess(preferredRoute.id,duration).then(({savedRoute})=>setSavedRoutes(previous=>previous.map(item=>item.id===savedRoute.id?savedRoute:item))).catch(()=>{});
    }
  },[session?.state,session?.route?.id]);
  const saveJourney=async(event:FormEvent)=>{event.preventDefault();const route=navigation.current?.session.route;if(navigation.current?.session.state!=='ARRIVED'||!route||!saveRouteName.trim())return;
    setBusy(true);try{const duration=Math.max(1,Math.round((Date.now()-navigation.current.session.startedAt)/1000));const {savedRoute}=await navApi.saveRoute(routeSaveBody(route,saveRouteName,duration));setSavedRoutes(previous=>[savedRoute,...previous]);setSaveRouteName('');announce('حُفظ المسار في ذاكرة رحلاتك الخاصة. ستُراجع الخريطة والمخاطر في كل استخدام جديد.');}
    catch{announce('تعذر حفظ المسار. تحقق من الاتصال أو من حالة الخريطة الحالية.');}finally{setBusy(false);}
  };
  const saveCurrentPlace=async(event:FormEvent)=>{event.preventDefault();const loc=localization.current.fusion.current(Date.now());if(loc.state!=='TRACKING'||loc.confidence<.65||loc.x===null||loc.y===null||!loc.buildingId||!loc.floorId){announce('ثبّت موقعًا موثوقًا أولًا قبل حفظ المكان.');return;}
    try{await navigationRequest('/saved-places',json('POST',{name:savePlaceName.trim(),category:'OTHER',buildingId:loc.buildingId,floorId:loc.floorId,localX:loc.x,localY:loc.y,localizationConfidence:loc.confidence}));setSavePlaceName('');announce('حُفظ المكان في أماكني الخاصة.');}catch{announce('تعذر حفظ المكان. تحقق من تسجيل الدخول.');}
  };
  const returnToStart=()=>{const start=startNodeRef.current,current=localization.current.fusion.current(Date.now()),graph=graphRef.current,old=navigation.current;
    if(!start||!graph||!old||!trustedOrigin(graph.nodes,current)){announce('أحتاج إلى موقع موثوق ونقطة بداية محفوظة في الجلسة للعودة.','RELOCALIZATION');return;}
    const planner=new RoutePlanner(graph.building,graph.nodes,[...graph.edges]);const constraints=old.constraints.active();
    const available=new Set(breadcrumb.current.filter(id=>graph.edges.some(edge=>edge.id===id&&!edge.temporarilyClosed&&edge.riskLevel==='LOW')&&!constraints.some(item=>item.edgeId===id)));
    planner.preferFamiliarEdges(available);const engine=new BasiraNavigationEngine(planner,floorsRef.current,languageRef.current,styleRef.current,arabicStyle);
    for(const constraint of constraints)engine.constraints.add(constraint.edgeId,constraint.kind,constraint.createdAt,constraint.expiresAt-constraint.createdAt);
    const target={kind:'place' as const,id:start.id,name:'نقطة البداية',buildingId:start.buildingId,floorId:start.floorId,nodeId:start.id,placeId:start.placeId};
    if(!engine.prepare(target,current,'RECOMMENDED')){announce('تعذر حساب طريق العودة من الموقع الحالي. أعد تحديد موقعك أو اطلب المساعدة.','RELOCALIZATION');return;}
    engine.start();navigation.current=engine;setDestination(target);setPreferredRoute(null);sync(engine);announce('حُسب طريق العودة إلى نقطة البداية وفق حالة الخريطة الحالية.','RELOCALIZATION','return-start');emitInstruction(true);
  };
  const stopCamera=async()=>{generation.current++;if(qrTimer.current!==null){window.clearInterval(qrTimer.current);qrTimer.current=null;}const active=pipeline.current;pipeline.current=null;camera.current.stop(video.current??undefined);setCameraOn(false);setCameraStatus('الكاميرا متوقفة');latestScene.current=null;setScene(null);hazardActive.current=false;if(navigation.current)navigation.current.session.safety='ROUTE_UNCERTAIN';if(active)await active.stop();};
  const emergencyStop=()=>{navigation.current?.cancel();sync(navigation.current);listener.current?.stop();listener.current=null;setMicOn(false);setMicStatus('التحكم الصوتي متوقف');motion.current?.stop();motion.current=null;setMotionStatus('حساسات الحركة متوقفة');voice.current.close();if(typeof navigator!=='undefined'&&'vibrate'in navigator)navigator.vibrate(0);void stopCamera();setSafetyText('');setNotice('أُوقفت الجلسة والكاميرا والميكروفون والاهتزاز.');};
  const startCamera=async()=>{
    if(!video.current||cameraOn)return;const run=++generation.current;setCameraStatus('جارٍ تشغيل الكاميرا ونماذج الرؤية');
    try{
      const safetyFlags=await loadSafetyFlags();
      await camera.current.start(video.current);if(run!==generation.current)return;setCameraOn(true);
      qrTimer.current=window.setInterval(()=>{if(!video.current||!canvas.current||!graphRef.current)return;const code=decodeQrFrame(video.current,canvas.current);const node=code?parseQrAnchor(code,graphRef.current.nodes):null;if(node)anchorNode(node,'QR');},2000);
      const provider=await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
      if(run!==generation.current){await provider.close();return;}
      const capabilities=detectVisionCapabilities();let segmentation:SegFormerSceneProvider|undefined,relativeDepth:MonocularRelativeDepthProvider|undefined,metricDepth:NativeMetricDepthProvider|undefined;
      try{segmentation=await SegFormerSceneProvider.open();}catch{setCameraStatus('كشف الأجسام يعمل، وتقسيم المشهد غير متاح.');}
      if(safetyFlags.metricDepth&&window.BasiraNativeDepth&&capabilities.nativeDepth)metricDepth=new NativeMetricDepthProvider(window.BasiraNativeDepth);
      else if(capabilities.performanceTier==='HIGH'&&segmentation)try{relativeDepth=await MonocularRelativeDepthProvider.open();}catch{/* relative depth is optional */}
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close(),relativeDepth?.close()]);return;}
      const vision=new VisionPipeline({video:video.current!,vision:provider,ocr:new TesseractOCRProvider(),depth:new UnavailableDepthProvider(),segmentation,relativeDepth,metricDepth,segmentationIntervalMs:capabilities.segmentationIntervalMs,depthIntervalMs:capabilities.depthIntervalMs,
        config:DEFAULT_VISION_CONFIG,copy:visionCopy,mode:'NAVIGATION',buildingId:graphRef.current?.building.id??null,floorId:null,localPlaces:placesRef.current,safetyFlags,
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
      case 'WHERE_AM_I':{const loc=localization.current.fusion.current(Date.now());if(loc.state!=='TRACKING'||loc.confidence<.55)announce(spoken.whereUncertain);else{const nearby=graphRef.current?.nodes.filter(n=>n.floorId===loc.floorId&&n.placeId).sort((a,b)=>Math.hypot(a.x-loc.x!,a.y-loc.y!)-Math.hypot(b.x-loc.x!,b.y-loc.y!))[0];const name=placesRef.current.find(p=>p.id===nearby?.placeId)?.name??(language==='en'?'a known place':language==='zh-CN'?'已知地点':'موضع معروف');const floor=floorsRef.current.find(f=>f.id===loc.floorId)?.name??(language==='en'?'the current floor':language==='zh-CN'?'当前楼层':'الطابق الحالي');const zone=zoneAt(graphRef.current?.zones,loc);const zoneText=zone?(language==='en'?` You are in ${zone.name}.`:language==='zh-CN'?` 您位于${zone.name}。`:` أنت في منطقة ${zone.name}.`):'';announce(`${spoken.whereKnown(floor,name)}${zoneText}`);}break;}
      case 'WHAT_IS_AHEAD':announce(latestScene.current?.shortText??spoken.visionUnavailable);break;
      case 'NEAREST_PLACE':{const loc=localization.current.fusion.current(Date.now());if(!graphRef.current||loc.state!=='TRACKING'){announce('أحتاج موقعًا موثوقًا وخريطة للعثور على الأقرب.');break;}const planner=engine?.planner??new RoutePlanner(graphRef.current.building,graphRef.current.nodes,graphRef.current.edges);const origin=trustedOrigin(planner.nodes,loc);const found=origin?planner.nearestPlace(origin.id,placesRef.current,kindOf(command.query),engine?.constraints.active()??[]):null;announce(found?`أقرب ${command.query} قابل للوصول: ${found.place.name}، على المسار المحسوب تقريبًا ${Math.round(found.route.totalDistance)} مترًا.`:'لم أجد مكانًا من هذا النوع يمكن الوصول إليه بالخريطة الحالية.');break;}
      case 'REPEAT_INSTRUCTION':emitInstruction(true);break;
      case 'PAUSE_NAVIGATION':engine?.pause();sync(engine);haptic.current.pulse('STOP');announce('توقف التوجيه مؤقتًا.');break;
      case 'RESUME_NAVIGATION':engine?.resume();sync(engine);emitInstruction(true);break;
      case 'CANCEL_NAVIGATION':engine?.cancel();sync(engine);motion.current?.stop();motion.current=null;void stopCamera();announce(spoken.cancelled);break;
      case 'REROUTE':if(engine?.reroute('USER_REQUEST')){sync(engine);announce(spoken.rerouting,'RELOCALIZATION');emitInstruction(true);}else announce('لا أستطيع إيجاد مسار موثوق حاليًا.');break;
      case 'SAVE_PLACE':{const loc=localization.current.fusion.current(Date.now());if(loc.state!=='TRACKING'||loc.confidence<.65||loc.x===null||loc.y===null){announce('أحتاج موقعًا موثوقًا قبل الحفظ.');break;}try{await navigationRequest('/saved-places',json('POST',{name:command.name,category:'OTHER',buildingId:loc.buildingId,floorId:loc.floorId,localX:loc.x,localY:loc.y,localizationConfidence:loc.confidence}));announce(`حُفظ المكان باسم ${command.name}.`);}catch{announce('تعذر حفظ المكان. تحقق من تسجيل الدخول.');}break;}
      default:announce('لم أفهم الأمر. يمكنك قول: أين أنا، ماذا أمامي، أو خذيني إلى مكان.');
    }
  };
  handlerRef.current=handleIntent;
  const toggleMic=()=>{if(listener.current?.listening){listener.current.stop();setMicOn(false);setMicStatus('التحكم الصوتي متوقف');return;}const next=new VoiceCommandListener(language,text=>void handlerRef.current(intent.current.parse(text)),status=>{setMicStatus(status);if(status.startsWith('تعذر')||status.startsWith('توقف'))setMicOn(false);});listener.current=next;setMicOn(next.start());};
  const acknowledge=()=>{localStorage.setItem(disclaimerKey,'1');setDisclaimer(false);};
  useEffect(()=>{const saved=sessionStorage.getItem('basira-navigation-destination');if(!saved){const current=sessionStorage.getItem('basira-current-building');if(current)void loadBuilding(current).catch(()=>{});return;}try{const reference=JSON.parse(saved) as {kind:'place'|'saved';id:string};if(reference.kind==='saved')authorizedSavedPlace(reference.id).then(item=>{if(item)void choose({kind:'saved',item,priority:0});}).catch(()=>{});else navigationRequest<{place:Place}>(`/places/${reference.id}`).then(data=>void choose({kind:'place',item:data.place,priority:0})).catch(()=>{});}catch{/* stale selection */}},[]);
  useEffect(()=>{const timer=window.setInterval(()=>{const loc=localization.current.fusion.current(Date.now());if(loc.state!=='UNANCHORED')updateLocation(loc);const buildingId=graphRef.current?.building.id;if(!buildingId||!navigator.onLine)return;
    if(deferredMapRef.current&&navigation.current?.session.state!=='NAVIGATING'){const pending=deferredMapRef.current;deferredMapRef.current=null;graphRef.current=pending.graph;setGraph(pending.graph);mapVersionRef.current=pending.version;navigation.current?.updateEdges(pending.graph.edges);}
    mapSync.current.latest(buildingId,deferredMapRef.current?.version??mapVersionRef.current,navigation.current?.session.state==='NAVIGATING').then(state=>{if(!state)return;const fresh=state.graph;cachePublicMap(`graph:${buildingId}`,fresh);sessionStorage.setItem(`basira-b5-version-${buildingId}`,String(state.version));
      if(state.policy==='DEFER'){deferredMapRef.current={graph:fresh,version:state.version};announce('توفرت نسخة أحدث من الخريطة، وستُطبّق عند نقطة تثبيت معروفة أو بعد انتهاء التوجيه.','INFORMATION','map-update-deferred');return;}
      graphRef.current=fresh;setGraph(fresh);mapVersionRef.current=state.version;if(navigation.current?.updateEdges(fresh.edges)){sync(navigation.current);announce(state.policy==='URGENT'?'ورد تحديث لإغلاق ممر؛ أعدت حساب الطريق.':'تحدّثت الخريطة وأُعيد حساب الطريق.','RELOCALIZATION','map-update');emitInstruction(true);}
    }).catch(()=>{});
  },30_000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{const changed=()=>setOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};},[]);
  useEffect(()=>()=>{listener.current?.stop();motion.current?.stop();voice.current.close();if('vibrate'in navigator)navigator.vibrate(0);generation.current++;if(qrTimer.current!==null)window.clearInterval(qrTimer.current);camera.current.stop(video.current??undefined);void pipeline.current?.stop();navigation.current?.cancel();},[]);
  useEffect(()=>{const onHide=()=>{if(document.hidden){motion.current?.stop();motion.current=null;listener.current?.stop();setMicOn(false);void stopCamera();navigation.current?.pause();sync(navigation.current);}};document.addEventListener('visibilitychange',onHide);return()=>document.removeEventListener('visibilitychange',onHide);},[]);

  const selectedFloor=floors.find(f=>f.id===estimate?.floorId)?.name??'غير معروف';
  const positionQuality=estimate?.state!=='TRACKING'||Date.now()-(estimate?.timestamp??0)>20000?'LOST':estimate.confidence>=.8&&(estimate.uncertaintyRadius??99)<=3?'HIGH':estimate.confidence>=.55?'MEDIUM':'LOW';
  const reportMapIssue=async(event:FormEvent)=>{event.preventDefault();const buildingId=graphRef.current?.building.id;if(!buildingId||!issueConsent||issueDescription.trim().length<8){announce('اختر المبنى واكتب وصفًا واضحًا ووافق على إرسال البلاغ.');return;}try{const result=await sharedMapApi.report({buildingId,floorId:estimate?.floorId??null,type:issueType,duration:issueDuration,description:issueDescription.trim(),targetPlaceId:null,targetEdgeId:null,idempotencyKey:crypto.randomUUID(),consent:true});announce('queued'in result?'حُفظ البلاغ وسيرسل عند عودة الاتصال.':'وصل البلاغ إلى مراجعة الخريطة، ولم يغيّر المسار الرسمي تلقائيًا.');setIssueDescription('');setIssueConsent(false);}catch{announce('تعذر إرسال البلاغ. تحقق من تسجيل الدخول.');}};
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
    {outdoorTarget&&<OutdoorApproach target={outdoorTarget} announce={announce}/>}
    <section className={panel}><h2 className="mb-3 text-xl font-bold">ذاكرة الرحلات</h2><label className="flex items-center gap-3"><input type="checkbox" checked={familiarPreference} onChange={e=>{setFamiliarPreference(e.target.checked);localStorage.setItem('basira-prefer-familiar',String(e.target.checked));}}/>أفضل المسارات المألوفة حين تسمح الخريطة الحالية</label>
      {savedRoutes.length?<ul className="mt-3 space-y-2">{savedRoutes.map(saved=><li key={saved.id} className="rounded-xl border border-amber-200/20 p-3"><strong>{saved.name}</strong><p className="text-sm text-stone-300">{saved.familiarity==='HIGH_CONFIDENCE'?'مألوف جدًا':saved.familiarity==='FAMILIAR'?'مألوف':'تعلم حديثًا'} · وصول مُبلّغ عنه {saved.successfulArrivalCount} · آخر استخدام {new Date(saved.lastSuccessfulAt).toLocaleDateString('ar-SA')}</p><div className="mt-2 flex gap-2"><button className={secondary} onClick={()=>void chooseSavedRoute(saved)}>استخدم المسار</button><button className={secondary} onClick={()=>void navApi.deleteRoute(saved.id).then(()=>{setSavedRoutes(previous=>previous.filter(item=>item.id!==saved.id));if(preferredRoute?.id===saved.id)setPreferredRoute(null);}).catch(()=>announce('تعذر حذف المسار.'))}>حذف</button></div></li>)}</ul>:<p className="mt-2 text-sm text-stone-300">لا توجد رحلات محفوظة. يمكنك حفظ المسار بعد تأكيد الوصول.</p>}
      <p className="mt-3 text-sm text-stone-300">تبقى رحلاتك خاصة. <Link href="/navigation/shared-map" className="text-amber-200 underline">اقترح معلومة عامة منفصلة للخريطة</Link> إذا رغبت؛ تخضع للمراجعة ولا تُنشر الرحلة الشخصية.</p>
    </section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">موقع البداية وإعادة التحديد</h2><p>الموقع: {positionQuality==='LOST'?'مفقود':`${selectedFloor}، ${positionQuality==='HIGH'?'ثقة مرتفعة':positionQuality==='MEDIUM'?'ثقة متوسطة':'ثقة منخفضة'}`}</p>
      {estimate?.state==='TRACKING'&&<p>نطاق عدم اليقين التقريبي: {estimate.uncertaintyRadius===null?'غير معروف':`${Math.round(estimate.uncertaintyRadius)} متر`} · المصادر: {estimate.sources.join('، ')||'غير معروفة'} · آخر تثبيت قوي: {estimate.lastStrongAnchorAt?`قبل ${Math.max(0,Math.round((Date.now()-estimate.lastStrongAnchorAt)/1000))} ثانية`:'غير متاح'}</p>}
      <label className="mt-3 block">ثبت موقعك عند عقدة معروفة<select className={input} value="" onChange={e=>{const node=graph?.nodes.find(n=>n.id===e.target.value);if(node)anchorNode(node);}}><option value="">اختر الموقع المؤكد</option>{graph?.nodes.map(n=><option key={n.id} value={n.id}>{nodeLabel(n,places,floors)}</option>)}</select></label>
      <p className="mt-2 text-sm text-stone-300">التأكيد اليدوي يعني أنك تقف عند الموقع المختار فعلًا. يمكن للكاميرا أيضًا قراءة QR ولوحات الأماكن المعروفة.</p>
      {(session?.state==='RELOCALIZING'||session?.state==='LOST')&&<p role="alert" className="mt-2 text-amber-200">أحتاج أولًا إلى تحديد موقعك بشكل أفضل. توقف في مكان مناسب وثبت موقعًا معروفًا أو امسح QR. أوقفت التعليمات الاتجاهية الدقيقة.</p>}
      <form onSubmit={saveCurrentPlace} className="mt-4 flex flex-wrap gap-2"><label className="grow">اسم هذا المكان<input className={input} required maxLength={255} value={savePlaceName} onChange={e=>setSavePlaceName(e.target.value)}/></label><button className={secondary} disabled={!savePlaceName.trim()}>احفظ هذا المكان</button></form>
    </section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">التوجيه</h2><p>الحالة: <strong>{session?.state??'لم تبدأ جلسة'}</strong></p><p className="mt-2 text-2xl font-bold text-amber-200">{session?.instruction?.text??'اختر وجهة وموقع بداية.'}</p>
      {session?.route&&<p className="mt-2 text-sm text-stone-300">جودة بيانات المسار: {positionQuality==='LOST'||positionQuality==='LOW'?'بحاجة إلى إعادة تحديد':session.route.confidence>=.8&&positionQuality==='HIGH'?'أفضل تحققًا':'متوسطة الثقة'}. هذا وصف للبيانات، وليس ضمانًا لسلامة الطريق.</p>}
      <p className="mt-2">الرؤية: {cameraStatus}</p><p>السلامة المرصودة: {session?.safety??'غير معروفة'} {safetyText}</p>{scene&&<p className="mt-2 text-sm">آخر وصف مختصر: {scene.shortText}</p>}
      {progress!==null&&progress!==undefined&&<p>التقدم التقريبي: {Math.round(progress*100)}٪{session?.progress?.distanceRemaining!==null?`، نحو ${Math.round(session?.progress?.distanceRemaining??0)} مترًا` : ''}</p>}
      {session?.state==='FAILED'&&<p role="alert" className="mt-2 text-red-200">{session.failureReason==='incomplete_map'?'الخريطة الداخلية لهذا الجزء غير مكتملة.':'لا أستطيع إيجاد مسار موثوق إلى هذه الوجهة حاليًا.'}</p>}
      {session?.instruction?.kind==='FLOOR_TRANSITION'&&<div className="mt-3 flex gap-2"><button className={secondary} onClick={()=>{updateLocation(localization.current.transition('ENTER_ELEVATOR',Date.now()));announce('بعد الوصول إلى الطابق المطلوب، أكد موقعك عند عقدة معروفة.','RELOCALIZATION');}}>بدأ الانتقال بين الطوابق</button></div>}
      <div className="mt-4 flex flex-wrap gap-2"><button className={primary} disabled={!destination||!graph||disclaimer||busy||session?.state==='NAVIGATING'} onClick={()=>void begin()}>ابدأ التوجيه</button><button className={secondary} disabled={session?.state!=='NAVIGATING'} onClick={()=>void handleIntent({type:'PAUSE_NAVIGATION'})}>إيقاف مؤقت</button><button className={secondary} disabled={session?.state!=='PAUSED'} onClick={()=>void handleIntent({type:'RESUME_NAVIGATION'})}>متابعة</button><button className={secondary} disabled={!session||session.state==='CANCELLED'} onClick={()=>void handleIntent({type:'CANCEL_NAVIGATION'})}>إلغاء</button><button className={secondary} disabled={!session?.route} onClick={()=>void handleIntent({type:'REROUTE'})}>غيّر المسار</button><button className={secondary} disabled={!startNodeRef.current||!session||!['NAVIGATING','PAUSED','ARRIVED'].includes(session.state)} onClick={returnToStart}>العودة إلى نقطة البداية</button><button className={secondary} disabled={session?.state!=='NAVIGATING'} onClick={()=>void handleIntent({type:'CONFIRM_ARRIVAL'})}>تأكيد الوصول</button><button className={primary} onClick={emergencyStop} aria-label="إيقاف فوري للتوجيه والكاميرا والميكروفون والاهتزاز">إيقاف فوري</button></div>
      {session?.state==='ARRIVED'&&<form onSubmit={saveJourney} className="mt-4 flex flex-wrap gap-2 rounded-xl border border-amber-300/40 p-3"><label className="grow">وصلت إلى وجهتك. هل تريد حفظ هذا المسار؟<input className={input} required maxLength={255} value={saveRouteName} onChange={e=>setSaveRouteName(e.target.value)} placeholder="اسم المسار"/></label><button className={primary} disabled={busy||!saveRouteName.trim()}>حفظ المسار</button></form>}
      <button className="mt-3 text-amber-200 underline" onClick={()=>setShowOptions(!showOptions)}>خيارات المسار والإرشاد</button>
      {showOptions&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><label>نوع المسار<select className={input} value={routeType} onChange={e=>setRouteType(e.target.value as RouteType)}><option value="RECOMMENDED">الموصى به لبصيرة</option><option value="SHORTEST">الأقصر</option><option value="ACCESSIBLE">المتاح دون درج</option></select></label><label>لغة الصوت<select className={input} value={language} onChange={e=>{const next=e.target.value as GuidanceLanguage;setLanguage(next);saveSpeechPreferences({...getSpeechPreferences(),language:next});}}><option value="ar">العربية</option><option value="en">English</option><option value="zh-CN">中文</option></select></label>{language==='ar'&&<label>نمط العربية<select className={input} value={arabicStyle} onChange={e=>{const next=e.target.value as ArabicStyle;setArabicStyle(next);saveSpeechPreferences({...getSpeechPreferences(),arabicStyle:next});}}><option value="MSA">العربية الفصحى</option><option value="SAUDI">العربية السعودية</option></select></label>}<label>وصف الاتجاه<select className={input} value={style} onChange={e=>setStyle(e.target.value as DirectionStyle)}><option value="LEFT_RIGHT">يمين ويسار</option><option value="CLOCK">اتجاه الساعة</option></select></label><label className="flex items-center gap-3"><input type="checkbox" checked={screenReader} onChange={e=>{setScreenReader(e.target.checked);saveSpeechPreferences({...getSpeechPreferences(),screenReaderMode:e.target.checked});if(e.target.checked)speechEngine.stop();}}/>استخدم قارئ الشاشة بدل صوت الملاحة</label><label className="flex items-center gap-3"><input type="checkbox" checked={hapticsOn} onChange={e=>setHapticsOn(e.target.checked)}/>تفعيل الاهتزاز</label><Link href="/settings/voice" className="text-amber-200 underline">اختيار الصوت والسرعة ومعاينة الصوت</Link></div>}
    </section>
    {graph&&<section className={panel}><h2 className="mb-3 text-xl font-bold">خارطة المسار</h2><label>الطابق المعروض<select className={input} value={mapFloorId??''} onChange={e=>setMapFloorId(e.target.value)}>{floors.map(floor=><option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label><div className="mt-3"><NavigationRouteMap nodes={graph.nodes} edges={graph.edges} places={places} route={session?.route??null} progress={session?.progress??null} estimate={estimate} floorId={mapFloorId} floorName={floors.find(floor=>floor.id===mapFloorId)?.name??'الطابق'}/></div></section>}
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الأوامر والبيئة</h2><div className="flex flex-wrap gap-2"><button className={primary} onClick={toggleMic}>{micOn?'إيقاف الاستماع':'تشغيل الأوامر الصوتية'}</button><button className={secondary} onClick={()=>void handleIntent({type:'WHERE_AM_I'})}>أين أنا؟</button><button className={secondary} onClick={()=>void handleIntent({type:'WHAT_IS_AHEAD'})}>ماذا أمامي؟</button><button className={secondary} onClick={()=>void handleIntent({type:'REPEAT_INSTRUCTION'})}>أعد التعليمات</button><button className={secondary} onClick={()=>void (cameraOn?stopCamera():startCamera())}>{cameraOn?'إيقاف الرؤية':'تشغيل الرؤية وQR'}</button></div><p className="mt-3 text-sm">{micStatus} · {motionStatus}</p><p className="mt-2 text-sm text-stone-300">قد يحتاج تعرف الكلام في المتصفح إلى الإنترنت. تعمل أزرار التحكم عند عدم توفره. اطلب إذن الميكروفون فقط عند تشغيل الاستماع.</p>
      {!online&&<p role="status" className="mt-2 text-amber-200">الصوت المحلي قيد الاستخدام دون اتصال.</p>}
      {!speechAvailable&&<p role="status" className="mt-2 text-amber-200">النطق المحلي غير متاح في هذا المتصفح؛ استخدم قارئ الشاشة والأزرار.</p>}
      <button className="mt-3 text-amber-200 underline" onClick={()=>setShowPreview(!showPreview)}>{showPreview?'إخفاء المعاينة':'إظهار معاينة الكاميرا الاختيارية'}</button><video ref={video} muted playsInline aria-label="معاينة الكاميرا الاختيارية" className={`mt-3 max-h-64 w-full rounded-xl bg-black object-contain ${showPreview?'':'sr-only'}`}/><canvas ref={canvas} hidden/>
    </section>
    <section className={panel}><h2 className="mb-3 text-xl font-bold">الإبلاغ عن مشكلة في الخريطة</h2><p className="mb-2 text-sm text-stone-300">بلاغك يذهب للمراجعة. العائق المؤقت مثل كرسي أو ازدحام لا يُسجّل كجدار أو إغلاق دائم.</p><form onSubmit={reportMapIssue} className="grid gap-3 sm:grid-cols-2"><label>نوع المشكلة<select className={input} value={issueType} onChange={e=>setIssueType(e.target.value as IssueType)}><option value="ROAD_CLOSED">طريق مغلق</option><option value="PLACE_MOVED">مكان انتقل</option><option value="WRONG_ACCESSIBILITY">مسار غير مناسب للكفيف</option><option value="UNMARKED_STAIRS">درج غير مسجل</option><option value="OTHER">أخرى</option></select></label><label>مدة المشكلة<select className={input} value={issueDuration} onChange={e=>setIssueDuration(e.target.value as IssueDuration)}><option value="TEMPORARY">مؤقتة</option><option value="PERSISTENT">مستمرة</option><option value="UNKNOWN">غير معروف</option></select></label><label className="sm:col-span-2">الوصف<textarea className={input} minLength={8} maxLength={500} required value={issueDescription} onChange={e=>setIssueDescription(e.target.value)}/></label><label className="flex gap-2 sm:col-span-2"><input type="checkbox" checked={issueConsent} onChange={e=>setIssueConsent(e.target.checked)}/>أوافق على مشاركة وصف المشكلة والطابق التقريبي دون سجل المسار أو صور الكاميرا</label><button className={secondary} disabled={!issueConsent}>إرسال البلاغ</button></form></section>
    <p role={safetyText?'alert':'status'} aria-live={safetyText?'assertive':'polite'} className="min-h-7 text-amber-200">{notice}</p>
  </div></Layout>;
}
