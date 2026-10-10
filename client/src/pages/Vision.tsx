import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n, useMessages } from '@/i18n';
import { visionMessages } from '@/i18n/locales/vision';
import { navigationMessages } from '@/i18n/locales/navigation';
import { useTextToSpeech } from '@/hooks/useSpeech';
import { permissionService, type PermissionState } from '@/lib/permissionService';
import { DEFAULT_VISION_CONFIG, VISION_ALERT_DISTANCE_OPTIONS, getVisionAlertDistance, saveVisionAlertDistance, visionConfigForAlertDistance } from '@/lib/vision/config';
import { CameraService, CameraServiceError } from '@/lib/vision/camera';
import { MediaPipeVisionProvider, TesseractOCRProvider, UnavailableDepthProvider } from '@/lib/vision/providers';
import { MonocularRelativeDepthProvider, NativeMetricDepthProvider, SegFormerSceneProvider } from '@/lib/vision/modelProviders';
import { detectVisionCapabilities, type VisionCapabilities } from '@/lib/vision/capabilities';
import { VisionPipeline } from '@/lib/vision/pipeline';
import { BrowserHapticFeedbackProvider, VisionAnnouncementService } from '@/lib/vision/scene';
import type { PlaceCandidate, RecognizedPlace, RiskLevel, SceneDescription } from '@shared/vision';
import type { MapNode, Place } from '@shared/navigation';
import type { LocalizationEstimate } from '@shared/localization';
import { BasiraLocalizationEngine } from '@/lib/localization/engine';
import { navApi, navigationRequest, json } from '@/lib/navigationApi';
import { emptyProposal, observedEvidence, sharedMapApi } from '@/lib/sharedMap';
import { loadSafetyFlags } from '@/lib/safetyFlags';

const button='inline-flex min-h-14 items-center justify-center rounded-xl bg-amber-300 px-6 py-3 text-lg font-bold text-stone-950 hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';
const secondary='inline-flex min-h-14 items-center justify-center rounded-xl border border-amber-300/50 px-6 py-3 text-lg font-bold text-amber-100 hover:bg-amber-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';

export default function Vision() {
  const t=useMessages(visionMessages),nav=useMessages(navigationMessages);
  const {lang}=useI18n();
  const {speak,stop:stopSpeaking}=useTextToSpeech();
  const videoRef=useRef<HTMLVideoElement|null>(null);
  const cameraRef=useRef<CameraService>(new CameraService(DEFAULT_VISION_CONFIG));
  const pipelineRef=useRef<VisionPipeline|null>(null);
  const generation=useRef(0);
  const localizationRef=useRef(new BasiraLocalizationEngine());
  const graphNodesRef=useRef<MapNode[]>([]);
  const [locationEstimate,setLocationEstimate]=useState<LocalizationEstimate|null>(null);
  const [savedName,setSavedName]=useState('');
  const [saveNotice,setSaveNotice]=useState('');
  const [state,setState]=useState<'STOPPED'|'STARTING'|'WORKING'|'ANALYZING'>('STOPPED');
  const [error,setError]=useState('');
  const [OCRWarning,setOCRWarning]=useState('');
  const [modelWarning,setModelWarning]=useState('');
  const [depthWarning,setDepthWarning]=useState('');
  const [capabilities,setCapabilities]=useState<VisionCapabilities|null>(null);
  const [lastAlert,setLastAlert]=useState('');
  const [risk,setRisk]=useState<RiskLevel|null>(null);
  const [scene,setScene]=useState<SceneDescription|null>(null);
  const [recognized,setRecognized]=useState<RecognizedPlace|null>(null);
  const [candidates,setCandidates]=useState<PlaceCandidate[]>([]);
  const [shareCandidate,setShareCandidate]=useState(false),[shareNotice,setShareNotice]=useState('');
  const [cameraPermission,setCameraPermission]=useState<PermissionState>('not_requested');
  const [online,setOnline]=useState(typeof navigator==='undefined'?true:navigator.onLine);
  const [spokenSummary,setSpokenSummary]=useState('');
  const [alertDistanceMeters,setAlertDistanceMeters]=useState(()=>getVisionAlertDistance());
  useEffect(()=>{permissionService.status('camera').then(setCameraPermission).catch(()=>{});const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{if(!locationEstimate)return;const timer=window.setInterval(()=>setLocationEstimate(localizationRef.current.fusion.current(Date.now())),5000);return()=>window.clearInterval(timer);},[Boolean(locationEstimate)]);

  const stop=useCallback(async()=>{
    generation.current++;
    const pipeline=pipelineRef.current;pipelineRef.current=null;
    cameraRef.current.stop(videoRef.current??undefined);
    stopSpeaking();
    setState('STOPPED');setScene(null);setCandidates([]);setRecognized(null);
    localizationRef.current=new BasiraLocalizationEngine();setLocationEstimate(null);graphNodesRef.current=[];
    if(pipeline)await pipeline.stop();
  },[stopSpeaking]);
  useEffect(()=>()=>{
    generation.current++;
    cameraRef.current.stop(videoRef.current??undefined);
    void pipelineRef.current?.stop();pipelineRef.current=null;
    stopSpeaking();
  },[]);
  useEffect(()=>{const onHidden=()=>{if(document.hidden)void stop();};document.addEventListener('visibilitychange',onHidden);return()=>document.removeEventListener('visibilitychange',onHidden);},[stop]);

  const start=async()=>{
    if(state!=='STOPPED'||!videoRef.current)return;
    const run=++generation.current;
    setError('');setOCRWarning('');setModelWarning('');setDepthWarning('');setLastAlert('');setRisk(null);setSpokenSummary('');setState('STARTING');
    try {
      const safetyFlags=await loadSafetyFlags();
      const detected=detectVisionCapabilities();setCapabilities(detected);
      const visionConfig=visionConfigForAlertDistance(alertDistanceMeters);
      await cameraRef.current.start(videoRef.current);
      if(run!==generation.current){cameraRef.current.stop(videoRef.current);return;}
      setCameraPermission('allowed');
      const provider=await MediaPipeVisionProvider.open(visionConfig);
      if(run!==generation.current){await provider.close();cameraRef.current.stop(videoRef.current);return;}
      let segmentation:SegFormerSceneProvider|undefined;
      try{segmentation=await SegFormerSceneProvider.open();}
      catch{setModelWarning(t.segmentationFailure);}
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close()]);cameraRef.current.stop(videoRef.current);return;}
      let metricDepth:NativeMetricDepthProvider|undefined;
      let relativeDepth:MonocularRelativeDepthProvider|undefined;
      if(safetyFlags.metricDepth&&detected.nativeDepth&&window.BasiraNativeDepth)metricDepth=new NativeMetricDepthProvider(window.BasiraNativeDepth);
      else if(detected.performanceTier==='HIGH'&&segmentation){
        try{relativeDepth=await MonocularRelativeDepthProvider.open();}
        catch{setDepthWarning(t.depthFailure);}
      }
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close(),relativeDepth?.close()]);cameraRef.current.stop(videoRef.current);return;}
      const currentBuildingId=sessionStorage.getItem('basira-current-building');
      graphNodesRef.current=currentBuildingId?(await navApi.graph(currentBuildingId).then(result=>result.nodes).catch(()=>[])):[];
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close(),relativeDepth?.close()]);cameraRef.current.stop(videoRef.current);return;}
      const announcement=new VisionAnnouncementService(t,text=>speak(text,0.9,lang),new BrowserHapticFeedbackProvider(),visionConfig.alertCooldownMs);
      const pipeline=new VisionPipeline({video:videoRef.current,vision:provider,ocr:new TesseractOCRProvider(),depth:new UnavailableDepthProvider(),
        segmentation,relativeDepth,metricDepth,segmentationIntervalMs:detected.segmentationIntervalMs,depthIntervalMs:detected.depthIntervalMs,
        config:visionConfig,copy:t,mode:'EXPLORATION',buildingId:currentBuildingId,floorId:null,announcement,safetyFlags,
        callbacks:{
          scene:description=>{if(run===generation.current){setScene(description);setState('ANALYZING');}},
          alert:(text,level)=>{if(run===generation.current){setLastAlert(text);setRisk(level);}},
          candidate:candidate=>{if(run===generation.current)setCandidates(previous=>[candidate,...previous].slice(0,10));},
          recognized:place=>{if(run===generation.current){setRecognized(place);void navigationRequest<{place:Place}>(`/places/${place.placeId}`).then(result=>{
            if(run!==generation.current)return;
            const anchor=localizationRef.current.visualAnchor(result.place,graphNodesRef.current,place.confidence,Date.now());
            if(anchor)setLocationEstimate(localizationRef.current.fusion.current(Date.now()));
          }).catch(()=>{});}},
          OCRFailure:()=>{if(run===generation.current)setOCRWarning(t.ocrFailure);},
          segmentationFailure:()=>{if(run===generation.current)setModelWarning(t.segmentationFailure);},
          depthFailure:()=>{if(run===generation.current)setDepthWarning(t.depthFailure);},
          fatal:()=>{if(run===generation.current){setError(t.providerFailure);void stop();}},
        },
      });
      pipelineRef.current=pipeline;
      await pipeline.start();
      if(run===generation.current)setState('WORKING');
    } catch(caught) {
      cameraRef.current.stop(videoRef.current??undefined);
      if(run!==generation.current)return;
      const key=caught instanceof CameraServiceError?caught.code:'MODEL';
      console.warn('Basira vision startup failed',{code:key});
      setError(key==='NO_CAMERA'?t.noCamera:key==='DENIED'?t.denied:key==='DEVICE_SETTINGS'?t.settings:key==='UNAVAILABLE'?t.unavailable:key==='IN_USE'?t.inUse:key==='MODEL'?t.modelFailure:t.cameraFailure);
      setState('STOPPED');
      permissionService.status('camera').then(setCameraPermission).catch(()=>{});
    }
  };
  const report=(detail:boolean)=>{
    const value=scene?(detail?scene.detailedText:scene.shortText):t.noDetections;
    setSpokenSummary(value);speak(value,0.9,lang);
  };
  const savePersonal=async()=>{
    const estimate=localizationRef.current.fusion.current(Date.now());
    if(!savedName.trim()||estimate.state!=='TRACKING'||estimate.x===null||estimate.y===null||!estimate.floorId)return;
    try{await navigationRequest('/saved-places',json('POST',{name:savedName.trim(),category:'OTHER',buildingId:estimate.buildingId,floorId:estimate.floorId,localX:estimate.x,localY:estimate.y,localizationConfidence:estimate.confidence}));setSaveNotice('حُفظ المكان في أماكنك الخاصة.');setSavedName('');}
    catch{setSaveNotice('تعذر حفظ المكان. سجّل الدخول ثم حاول مجددًا.');}
  };
  const contributeCandidate=async(candidate:PlaceCandidate)=>{
    const estimate=localizationRef.current.fusion.current(Date.now());
    if(!shareCandidate||estimate.state!=='TRACKING'||estimate.confidence<.55||estimate.x===null||estimate.y===null||!estimate.floorId||!estimate.buildingId||candidate.buildingId!==estimate.buildingId){setShareNotice('ثبّت موقعك داخل المبنى ووافق على المشاركة قبل الإرسال.');return;}
    const proposal=emptyProposal(estimate.floorId);proposal.name=candidate.detectedText;proposal.placeType=candidate.suggestedType;proposal.x=estimate.x;proposal.y=estimate.y;
    try{const result=await sharedMapApi.submit({buildingId:estimate.buildingId,type:'PLACE',source:'OCR',proposal,evidence:observedEvidence(estimate.floorId,estimate.x,estimate.y,estimate.confidence,candidate.confidence),idempotencyKey:crypto.randomUUID(),consent:true});setShareNotice('queued'in result?'حُفظت المساهمة المصرح بها حتى عودة الاتصال.':'أُرسلت قراءة اللوحة والموقع فقط للمراجعة، دون صورة أو سجل حركة.');setShareCandidate(false);}catch{setShareNotice('تعذر إرسال المساهمة. تحقق من الدخول وبيانات الموقع.');}
  };
  const cameraState=state==='STOPPED'?t.stopped:state==='STARTING'?t.starting:state==='WORKING'?t.working:t.analyzing;
  return <Layout><div className="container max-w-4xl space-y-4 py-6 text-stone-100">
    <Link href="/navigation" className="text-amber-300 underline">{nav.title}</Link>
    <header><h1 className="text-3xl font-black">{t.title}</h1><p className="mt-3 text-lg text-stone-300">{t.description}</p></header>
    <p className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-amber-100">{t.advisory}</p>
    <div className="flex flex-wrap gap-3">{state==='STOPPED'?<button type="button" className={button} onClick={start}>{t.start}</button>:<button type="button" className={button} onClick={()=>void stop()}>{t.stop}</button>}</div>
    <section className="rounded-2xl border border-amber-200/20 bg-stone-900 p-5"><label className="block font-bold">{t.alertDistanceLabel}<select className="mt-2 min-h-14 w-full rounded-xl border border-amber-200/40 bg-stone-950 px-4 text-white" value={alertDistanceMeters} onChange={event=>{const value=saveVisionAlertDistance(Number(event.target.value));setAlertDistanceMeters(value);pipelineRef.current?.setAlertDistanceMeters(value);}}>{VISION_ALERT_DISTANCE_OPTIONS.map(value=><option key={value} value={value}>{value} {lang==='en'?'metres':lang==='zh-CN'?'米':'متر'}</option>)}</select></label><p className="mt-2 text-sm text-stone-300">{t.alertDistanceNote}</p></section>
    <div className="flex flex-wrap gap-3"><button className={secondary} type="button" disabled={state==='STOPPED'||state==='STARTING'} onClick={()=>report(false)}>{t.whatAhead}</button><button className={secondary} type="button" disabled={state==='STOPPED'||state==='STARTING'} onClick={()=>report(true)}>{t.describe}</button></div>
    <p aria-live="polite" role="status" className="min-h-6">{spokenSummary}</p>
    <section aria-label={t.status} className="rounded-2xl border border-amber-200/20 bg-stone-900 p-5">
      <p role="status" aria-live="polite">{t.status}: <strong>{cameraState}</strong></p>
      <p className="mt-2">{nav.permissionCamera}: {({not_requested:nav.notRequested,allowed:nav.allowed,denied:nav.denied,device_settings:nav.deviceSettings,unavailable:nav.unavailable} as const)[cameraPermission]}</p>
      <p className="mt-2">{t.risk}: <strong>{risk?t.riskLabels[risk]:'—'}</strong></p>
      <p className="mt-2">{t.lastAlert}: <span role="alert" aria-live={risk==='CRITICAL'||risk==='HIGH'?'assertive':'polite'}>{lastAlert||'—'}</span></p>
    </section>
    {error&&<p role="alert" className="rounded-xl border border-red-400/50 p-4 text-red-200">{error}</p>}
    {OCRWarning&&<p role="status" aria-live="polite" className="text-amber-200">{OCRWarning}</p>}
    {modelWarning&&<p role="status" aria-live="polite" className="text-amber-200">{modelWarning}</p>}
    {depthWarning&&<p role="status" aria-live="polite" className="text-amber-200">{depthWarning}</p>}
    {!online&&<p role="status" className="rounded-xl border border-amber-300/40 p-4 text-amber-100">{t.offline}</p>}
    <p className="text-sm text-stone-300">{capabilities?.nativeDepth?t.nativeDepthAvailable:t.depthUnavailable}</p>
    {scene?.walkableArea&&<p role="status" className="text-amber-100">{scene.walkableArea.pathAhead==='BLOCKED'?t.pathBlocked:scene.walkableArea.pathAhead==='CLEAR'?t.pathClearObserved:t.pathUnknown}</p>}
    {recognized&&<p role="status" className="rounded-xl border border-emerald-300/40 p-4 text-emerald-100">{t.placeRecognized(recognized.name)}</p>}
    {locationEstimate?.state==='TRACKING'&&<section className="space-y-3 rounded-xl border border-amber-300/40 p-4"><p>موقعك الحالي: بالقرب من {recognized?.name??'مكان معروف'} · الثقة {Math.round(locationEstimate.confidence*100)}٪. التقدير مرتبط بلوحة معروفة وليس قياسًا ميدانيًا للدقة.</p><div className="flex flex-wrap gap-2"><input className="min-h-12 rounded-xl border border-amber-200/40 bg-stone-950 px-3" value={savedName} onChange={e=>setSavedName(e.target.value)} placeholder="اسم مكانك الخاص" aria-label="اسم مكانك الخاص"/><button className={secondary} disabled={!savedName.trim()} onClick={savePersonal}>احفظ هذا المكان</button></div><p role="status" aria-live="polite">{saveNotice}</p></section>}
    {locationEstimate?.state==='LOCALIZATION_LOST'&&<p role="alert" className="rounded-xl border border-amber-300/40 p-4">تعذر تحديد موقعك بدقة داخل المبنى. وجّه الكاميرا نحو لوحة مكان معروف لإعادة التثبيت.</p>}
    {candidates.length>0&&<section className="space-y-3 rounded-xl border border-amber-200/30 p-4"><h2 className="font-bold">معلومات جديدة محتملة للخريطة</h2><label className="flex gap-2"><input type="checkbox" checked={shareCandidate} onChange={e=>setShareCandidate(e.target.checked)}/>أوافق على مشاركة نص اللوحة وموقع تقريبي فقط، دون صورة، للمراجعة العامة</label>{candidates.slice(0,2).map(candidate=><p key={candidate.id}>{candidate.lookupStatus==='UNAVAILABLE'?t.candidateOffline(candidate.detectedText):t.candidate(candidate.detectedText)} <button className={secondary} disabled={!shareCandidate||locationEstimate?.state!=='TRACKING'} onClick={()=>void contributeCandidate(candidate)}>أرسل كمساهمة</button></p>)}<p role="status" aria-live="polite">{shareNotice}</p></section>}
    <video ref={videoRef} muted playsInline aria-hidden="true" aria-label={t.preview} className="aspect-video w-full max-w-md rounded-xl bg-stone-950 object-cover" />
  </div></Layout>;
}
