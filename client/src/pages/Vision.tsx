import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { useI18n, useMessages } from '@/i18n';
import { visionMessages } from '@/i18n/locales/vision';
import { navigationMessages } from '@/i18n/locales/navigation';
import { useTextToSpeech } from '@/hooks/useSpeech';
import { permissionService, type PermissionState } from '@/lib/permissionService';
import { DEFAULT_VISION_CONFIG } from '@/lib/vision/config';
import { CameraService, CameraServiceError } from '@/lib/vision/camera';
import { MediaPipeVisionProvider, TesseractOCRProvider, UnavailableDepthProvider } from '@/lib/vision/providers';
import { SegFormerSceneProvider } from '@/lib/vision/modelProviders';
import { MonocularMetricDepthProvider } from '@/lib/vision/metricModel';
import { detectVisionCapabilities, type VisionCapabilities } from '@/lib/vision/capabilities';
import { VisionPipeline } from '@/lib/vision/pipeline';
import type { MetricDiagnostic } from '@/lib/vision/metricEngine';
import { AutoMeterSpeechPacer, getAutoMeterEnabled, getAutoMeterSpeechEnabled, saveAutoMeterEnabled, saveAutoMeterSpeechEnabled, type AutoMeterSnapshot } from '@/lib/vision/autoMeter';
import {centerSurfaceLabel,meterDiagnosticText,type MeterDiagnostic} from '@/lib/vision/meterDiagnostics';
import { AUTO_METER_REFERENCE_METERS, autoMeterTrialsJsonl, createAutoMeterTrial, type AutoMeterReferenceMeters, type AutoMeterTrial } from '@/lib/vision/autoMeterTrials';
import { BrowserHapticFeedbackProvider, VisionAnnouncementService } from '@/lib/vision/scene';
import type { PlaceCandidate, RecognizedPlace, RiskLevel, SceneDescription, VisionObjectType } from '@shared/vision';
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
  const nativeCanvasRef=useRef<HTMLCanvasElement|null>(null);
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
  const [metricInfo,setMetricInfo]=useState<MetricDiagnostic>({status:'UNAVAILABLE',source:null});
  const [meterDiagnostic,setMeterDiagnostic]=useState<MeterDiagnostic>('OFF');
  const [autoMeterEnabled,setAutoMeterEnabled]=useState(()=>getAutoMeterEnabled());
  const autoMeterEnabledRef=useRef(autoMeterEnabled);
  const [autoMeterSpeechEnabled,setAutoMeterSpeechEnabled]=useState(()=>getAutoMeterSpeechEnabled());
  const autoMeterSpeechRef=useRef(autoMeterSpeechEnabled);
  const speechPacerRef=useRef(new AutoMeterSpeechPacer());
  const [meterSnapshot,setMeterSnapshot]=useState<AutoMeterSnapshot|null>(null);
  const trialSessionId=useRef(`auto-meter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [trialDevice,setTrialDevice]=useState('');
  const [trialOs,setTrialOs]=useState('');
  const [trialCondition,setTrialCondition]=useState('indoor');
  const [trialReference,setTrialReference]=useState<AutoMeterReferenceMeters>(1);
  const [trialSource,setTrialSource]=useState<'ARKIT_DEPTH'|'LIDAR'|'ARCORE_DEPTH'|'DEPTH_SENSOR'|'MONOCULAR_METRIC'>('ARKIT_DEPTH');
  const [trialObject,setTrialObject]=useState<VisionObjectType>('CHAIR');
  const [trialTrack,setTrialTrack]=useState('');
  const [trialRows,setTrialRows]=useState<AutoMeterTrial[]>([]);
  const [trialNotice,setTrialNotice]=useState('');
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
  useEffect(()=>{permissionService.status('camera').then(setCameraPermission).catch(()=>{});const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{if(!locationEstimate)return;const timer=window.setInterval(()=>setLocationEstimate(localizationRef.current.fusion.current(Date.now())),5000);return()=>window.clearInterval(timer);},[Boolean(locationEstimate)]);
  useEffect(()=>{
    if(!meterSnapshot)return;
    const expiresIn=Math.max(0,6000-(Date.now()-meterSnapshot.capturedAt));
    const timer=window.setTimeout(()=>{
      setMeterSnapshot(current=>current?.frameId===meterSnapshot.frameId&&current.capturedAt===meterSnapshot.capturedAt?null:current);
      setMeterDiagnostic(previous=>previous==='READY_OBJECT'||previous==='READY_CENTER'?'FRAME_STALE':previous);
    },expiresIn);
    return()=>window.clearTimeout(timer);
  },[meterSnapshot]);

  const stop=useCallback(async()=>{
    generation.current++;
    const pipeline=pipelineRef.current;pipelineRef.current=null;
    cameraRef.current.stop(videoRef.current??undefined);
    stopSpeaking();
    setState('STOPPED');setMetricInfo({status:'UNAVAILABLE',source:null});setMeterDiagnostic('OFF');setMeterSnapshot(null);speechPacerRef.current.reset();setScene(null);setCandidates([]);setRecognized(null);
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
    if(state!=='STOPPED'||!videoRef.current||!nativeCanvasRef.current)return;
    const run=++generation.current;
    setError('');setOCRWarning('');setModelWarning('');setDepthWarning('');setMetricInfo({status:'UNAVAILABLE',source:null});setMeterDiagnostic(autoMeterEnabledRef.current?'MODEL_LOADING':'OFF');setMeterSnapshot(null);setLastAlert('');setRisk(null);setSpokenSummary('');setState('STARTING');
    try {
      const safetyFlags=await loadSafetyFlags();
      const detected=detectVisionCapabilities();setCapabilities(detected);
      const visionConfig=DEFAULT_VISION_CONFIG;
      const nativeFrames=window.BasiraNativeFrames;
      if(!nativeFrames)await cameraRef.current.start(videoRef.current);
      if(run!==generation.current){cameraRef.current.stop(videoRef.current);return;}
      if(!nativeFrames)setCameraPermission('allowed');
      const provider=await MediaPipeVisionProvider.open(visionConfig);
      if(run!==generation.current){await provider.close();cameraRef.current.stop(videoRef.current);return;}
      let segmentation:SegFormerSceneProvider|undefined;
      try{segmentation=await SegFormerSceneProvider.open();}
      catch{setModelWarning(t.segmentationFailure);}
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close()]);cameraRef.current.stop(videoRef.current);return;}
      const currentBuildingId=sessionStorage.getItem('basira-current-building');
      graphNodesRef.current=currentBuildingId?(await navApi.graph(currentBuildingId).then(result=>result.nodes).catch(()=>[])):[];
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close()]);cameraRef.current.stop(videoRef.current);return;}
      const announcement=new VisionAnnouncementService(t,text=>speak(text,0.9,lang),new BrowserHapticFeedbackProvider(),visionConfig.alertCooldownMs);
      const pipeline=new VisionPipeline({video:videoRef.current,nativeCanvas:nativeCanvasRef.current,nativeFrames,
        autoMeterEnabled:autoMeterEnabledRef.current,vision:provider,ocr:new TesseractOCRProvider(),depth:new UnavailableDepthProvider(),
        estimatedMetricModel:nativeFrames?undefined:()=>MonocularMetricDepthProvider.open(),
        segmentation,segmentationIntervalMs:detected.segmentationIntervalMs,depthIntervalMs:detected.depthIntervalMs,
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
          metricStatus:status=>{if(run===generation.current){setMetricInfo(status);if(status.source)setTrialSource(status.source);}},
          meterDiagnostic:diagnostic=>{if(run===generation.current)setMeterDiagnostic(diagnostic);},
          autoMeterSnapshot:snapshot=>{if(run===generation.current){
            setMeterSnapshot(snapshot);
            if(snapshot&&autoMeterSpeechRef.current){
              const item=speechPacerRef.current.choose(snapshot);
              if(item?.distanceMeters!==null&&item?.distanceMeters!==undefined){
                const phrase=`${snapshot.nativeSource==='MONOCULAR_METRIC'?t.autoMeterAiSpeechPrefix:t.autoMeterNativeSpeechPrefix} ${t.autoMeterSpeech(t.object[item.type],t.direction[item.direction],item.distanceMeters)}`;
                speak(phrase,0.9,lang);
              }
            }
          }},
          autoMeterRejected:()=>{if(run===generation.current){
            autoMeterEnabledRef.current=false;
            setAutoMeterEnabled(saveAutoMeterEnabled(false));
            setMeterSnapshot(null);
          }},
          fatal:()=>{if(run===generation.current){setError(t.providerFailure);void stop();}},
        },
      });
      pipelineRef.current=pipeline;
      await pipeline.start();
      if(run===generation.current){setState('WORKING');if(nativeFrames)setCameraPermission('allowed');}
    } catch(caught) {
      cameraRef.current.stop(videoRef.current??undefined);
      await pipelineRef.current?.stop();pipelineRef.current=null;
      if(run!==generation.current)return;
      const key=caught instanceof CameraServiceError?caught.code:'MODEL';
      console.warn('Basira vision startup failed',{code:key});
      const nativePermission=caught instanceof Error&&caught.message.includes('camera_permission_required');
      setError(nativePermission?t.nativePermissionRetry:key==='NO_CAMERA'?t.noCamera:key==='DENIED'?t.denied:key==='DEVICE_SETTINGS'?t.settings:key==='UNAVAILABLE'?t.unavailable:key==='IN_USE'?t.inUse:key==='MODEL'?t.modelFailure:t.cameraFailure);
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
  const toggleAutoMeter=()=>{
    const enabled=!autoMeterEnabledRef.current;
    if(enabled)setDepthWarning('');
    autoMeterEnabledRef.current=enabled;
    setAutoMeterEnabled(saveAutoMeterEnabled(enabled));
    setMeterSnapshot(null);setMeterDiagnostic(enabled?(window.BasiraNativeFrames?'WAITING_CAMERA':'MODEL_LOADING'):'OFF');speechPacerRef.current.reset();
    void pipelineRef.current?.setAutoMeterEnabled(enabled);
  };
  const toggleAutoMeterSpeech=()=>{
    const enabled=!autoMeterSpeechRef.current;
    autoMeterSpeechRef.current=enabled;
    setAutoMeterSpeechEnabled(saveAutoMeterSpeechEnabled(enabled));
    speechPacerRef.current.reset();
  };
  const speakMetersNow=()=>{
    const current=meterSnapshot&&Date.now()-meterSnapshot.capturedAt<6000?meterSnapshot:null;
    const measured=current?.measurements.filter(item=>item.distanceMeters!==null).slice(0,3)??[];
    if(!measured.length){
      if(current?.nativeSource==='MONOCULAR_METRIC'&&current.centerSurface?.distanceMeters!=null){
        speak(`${t.autoMeterAiSpeechPrefix} ${centerSurfaceLabel(lang)}، ${current.centerSurface.distanceMeters.toFixed(2)} ${t.autoMeterMeters}.`,0.9,lang);
        return;
      }
      const reason=current?.measurements[0]?.rejectionReason??current?.centerSurface?.rejectionReason??
        (meterDiagnostic==='READY_OBJECT'||meterDiagnostic==='READY_CENTER'?'FRAME_STALE':meterDiagnostic);
      speak(meterDiagnosticText(reason??'WAITING_CAMERA',lang),0.9,lang);
      return;
    }
    const prefix=meterSnapshot?.nativeSource==='MONOCULAR_METRIC'?t.autoMeterAiSpeechPrefix:t.autoMeterNativeSpeechPrefix;
    speak(`${prefix} ${measured.map(item=>t.autoMeterSpeech(t.object[item.type],t.direction[item.direction],item.distanceMeters!)).join(' ')}`,0.9,lang);
  };
  const recordTrial=()=>{
    const measurement=trialTrack==='__missed__'?null:(meterSnapshot?.measurements.find(item=>item.trackId===trialTrack)??meterSnapshot?.measurements[0]??null);
    const row=createAutoMeterTrial({sessionId:trialSessionId.current,deviceModel:trialDevice,osVersion:trialOs,
      source:measurement?.source??(hasNativeFrames?trialSource:'MONOCULAR_METRIC'),
      snapshot:meterSnapshot,measurement,missedObjectType:trialObject,referenceMeters:trialReference,
      condition:trialCondition,now:Date.now()});
    if(!row){setTrialNotice(t.autoMeterTrialMissing);return;}
    if(trialRows.some(previous=>previous.frameId===row.frameId&&previous.objectType===row.objectType&&previous.referenceMeters===row.referenceMeters)){
      setTrialNotice(t.autoMeterTrialDuplicate);return;
    }
    setTrialRows(previous=>[...previous,row]);setTrialNotice(t.autoMeterTrialSaved);
  };
  const downloadTrials=()=>{
    if(!trialRows.length)return;
    const url=URL.createObjectURL(new Blob([autoMeterTrialsJsonl(trialRows)],{type:'application/x-ndjson;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`basira-auto-meter-${trialSessionId.current}.jsonl`;
    link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const cameraState=state==='STOPPED'?t.stopped:state==='STARTING'?t.starting:state==='WORKING'?t.working:t.analyzing;
  const hasNativeFrames=typeof window!=='undefined'&&Boolean(window.BasiraNativeFrames);
  const currentMeterSnapshot=meterSnapshot&&Date.now()-meterSnapshot.capturedAt<6000?meterSnapshot:null;
  return <Layout><div className="container max-w-4xl space-y-4 py-6 text-stone-100">
    <Link href="/navigation" className="text-amber-300 underline">{nav.title}</Link>
    <header><h1 className="text-3xl font-black">{t.title}</h1><p className="mt-3 text-lg text-stone-300">{t.description}</p></header>
    <p className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-amber-100">{t.advisory}</p>
    <div className="flex flex-wrap gap-3">{state==='STOPPED'?<button type="button" className={button} onClick={start}>{t.start}</button>:<button type="button" className={button} onClick={()=>void stop()}>{t.stop}</button>}</div>
    <section className="rounded-2xl border border-amber-200/30 bg-stone-900 p-5" aria-label={t.autoMeterTitle}>
      <h2 className="text-xl font-bold">{t.autoMeterTitle}</h2>
      <p className="mt-2 text-sm text-stone-300">{t.autoMeterRangeNote}</p>
      <button type="button" className={`${secondary} mt-4 w-full sm:w-auto`} aria-pressed={autoMeterEnabled} onClick={toggleAutoMeter}>
        {autoMeterEnabled?t.autoMeterStop:t.autoMeterStart}
      </button>
      <label className="mt-4 flex min-h-12 items-center gap-3"><input type="checkbox" className="size-5" checked={autoMeterSpeechEnabled} onChange={toggleAutoMeterSpeech}/>{t.autoMeterSpeechLabel}</label>
      <p role="status" aria-live={['FRAME_PROCESSING','READY_OBJECT','READY_CENTER'].includes(meterDiagnostic)?'off':'polite'} className="mt-2">{!autoMeterEnabled?t.autoMeterOffStatus:hasNativeFrames?(metricInfo.status==='LIVE'?t.autoMeterLive:metricInfo.status==='WAITING'?t.autoMeterWaiting:t.autoMeterUnavailable):meterDiagnosticText(meterDiagnostic,lang)}</p>
    </section>
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
    {autoMeterEnabled&&state!=='STOPPED'&&<section aria-label={t.autoMeterObjectsTitle}
      className="rounded-xl border border-amber-200/30 bg-stone-900 p-4">
      <h2 className="mb-2 font-bold">{t.autoMeterObjectsTitle}</h2>
      <button type="button" className={`${secondary} mb-3`} onClick={speakMetersNow}>{t.autoMeterSpeakNow}</button>
      {!currentMeterSnapshot?.measurements.length?<p>{t.autoMeterNoObjects}</p>:
        <ul className="space-y-3">{currentMeterSnapshot.measurements.slice(0,5).map(item=><li key={item.id} className="border-b border-amber-200/20 pb-2">
          <span className="font-semibold">{t.object[item.type]} {t.direction[item.direction]}</span>
          <span className="block">{item.distanceMeters===null?meterDiagnosticText(item.rejectionReason??'INVALID_MODEL_DEPTH',lang):`${item.distanceMeters.toFixed(2)} ${t.autoMeterMeters}`}</span>
          <span className="block text-sm text-stone-300">{t.autoMeterSource}: {item.source==='MONOCULAR_METRIC'?t.autoMeterAiSource:item.source??t.autoMeterNoSource} · {t.autoMeterReliability}: {item.reliability==='EXPERIMENTAL'?t.autoMeterExperimental:t.autoMeterUnavailableLabel}</span>
        </li>)}</ul>}
      {currentMeterSnapshot?.nativeSource==='MONOCULAR_METRIC'&&currentMeterSnapshot.centerSurface&&
        <p className="mt-3 border-t border-amber-200/20 pt-3">{centerSurfaceLabel(lang)}: <strong>{currentMeterSnapshot.centerSurface.distanceMeters!=null
          ?`${currentMeterSnapshot.centerSurface.distanceMeters.toFixed(2)} ${t.autoMeterMeters} — ${t.autoMeterExperimental}`
          :meterDiagnosticText(currentMeterSnapshot.centerSurface.rejectionReason??'INVALID_MODEL_DEPTH',lang)}</strong></p>}
    </section>}
    <details className="rounded-xl border border-amber-200/30 bg-stone-900 p-4">
      <summary className="cursor-pointer font-bold">{t.autoMeterValidationTitle}</summary>
      <p className="mt-2 text-sm text-stone-300">{t.autoMeterValidationNote}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>{t.autoMeterDeviceModel}<input className="mt-1 min-h-12 w-full rounded-lg bg-stone-950 px-3" value={trialDevice} onChange={event=>setTrialDevice(event.target.value)} /></label>
        <label>{t.autoMeterOsVersion}<input className="mt-1 min-h-12 w-full rounded-lg bg-stone-950 px-3" value={trialOs} onChange={event=>setTrialOs(event.target.value)} /></label>
        <label>{t.autoMeterReference}<select className="mt-1 min-h-12 w-full rounded-lg bg-stone-950 px-3" value={trialReference} onChange={event=>setTrialReference(Number(event.target.value) as AutoMeterReferenceMeters)}>{AUTO_METER_REFERENCE_METERS.map(value=><option key={value} value={value}>{value} {t.autoMeterMeters}</option>)}</select></label>
        <label>{t.autoMeterTrialSource}<select className="mt-1 min-h-12 w-full rounded-lg bg-stone-950 px-3" value={hasNativeFrames?trialSource:'MONOCULAR_METRIC'} onChange={event=>setTrialSource(event.target.value as typeof trialSource)}>{hasNativeFrames?<><option value="ARKIT_DEPTH">ARKit / LiDAR</option><option value="LIDAR">LiDAR</option><option value="ARCORE_DEPTH">ARCore Depth</option><option value="DEPTH_SENSOR">Depth sensor</option></>:<option value="MONOCULAR_METRIC">{t.autoMeterAiSource}</option>}</select></label>
        <label>{t.autoMeterCondition}<input className="mt-1 min-h-12 w-full rounded-lg bg-stone-950 px-3" value={trialCondition} onChange={event=>setTrialCondition(event.target.value)} /></label>
        <label>{t.autoMeterTrialObject}<select className="mt-1 min-h-12 w-full rounded-lg bg-stone-950 px-3" value={trialTrack} onChange={event=>setTrialTrack(event.target.value)}><option value="">{t.autoMeterFirstObject}</option>{meterSnapshot?.measurements.map(item=><option key={item.trackId} value={item.trackId}>{t.object[item.type]} {t.direction[item.direction]}</option>)}<option value="__missed__">{t.autoMeterMissedObject}</option></select></label>
        {trialTrack==='__missed__'&&<label>{t.autoMeterExpectedObject}<select className="mt-1 min-h-12 w-full rounded-lg bg-stone-950 px-3" value={trialObject} onChange={event=>setTrialObject(event.target.value as VisionObjectType)}>{(['CHAIR','PERSON','TABLE','BOX','DOOR','UNKNOWN_OBSTACLE'] as const).map(type=><option key={type} value={type}>{t.object[type]}</option>)}</select></label>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={secondary} disabled={state==='STOPPED'||!autoMeterEnabled} onClick={recordTrial}>{t.autoMeterRecordTrial}</button><button type="button" className={secondary} disabled={!trialRows.length} onClick={downloadTrials}>{t.autoMeterDownloadTrials} ({trialRows.length})</button></div>
      <p role="status" aria-live="polite" className="mt-2">{trialNotice}</p>
    </details>
    {import.meta.env.VITE_BASIRA_AR_LAB_ENABLED !== 'false' &&
      <a href="/navigation/ar-lab/world-scale-sandbox" className="inline-flex min-h-12 items-center rounded-lg border border-amber-300/60 px-4 py-3 text-amber-200 underline">
        {lang==='ar'?'جرّب تقدير حركة الهاتف بالأمتار داخل المتصفح (8th Wall — ليس بُعد الأجسام)':lang==='zh-CN'?'8th Wall 位移研究（非物体距离）':'8th Wall camera-displacement research (not object distance)'}
      </a>}
    {scene?.walkableArea&&<p role="status" className="text-amber-100">{scene.walkableArea.pathAhead==='BLOCKED'?t.pathBlocked:scene.walkableArea.pathAhead==='CLEAR'?t.pathClearObserved:t.pathUnknown}</p>}
    {scene?.surfaceAnalysis&&<p role="status" className="text-amber-100">{t.surfaceStatus(scene.surfaceAnalysis.surface??'UNKNOWN',scene.surfaceAnalysis.surfaceCoverage??0)}</p>}
    {scene?.objects.some(object=>object.type==='STAIRS_UNCERTAIN'||object.type==='STAIRS_UP'||object.type==='STAIRS_DOWN')&&<p role="alert" className="text-amber-100">{t.stairsObserved}</p>}
    {recognized&&<p role="status" className="rounded-xl border border-emerald-300/40 p-4 text-emerald-100">{t.placeRecognized(recognized.name)}</p>}
    {locationEstimate?.state==='TRACKING'&&<section className="space-y-3 rounded-xl border border-amber-300/40 p-4"><p>موقعك الحالي: بالقرب من {recognized?.name??'مكان معروف'} · الثقة {Math.round(locationEstimate.confidence*100)}٪. التقدير مرتبط بلوحة معروفة وليس قياسًا ميدانيًا للدقة.</p><div className="flex flex-wrap gap-2"><input className="min-h-12 rounded-xl border border-amber-200/40 bg-stone-950 px-3" value={savedName} onChange={e=>setSavedName(e.target.value)} placeholder="اسم مكانك الخاص" aria-label="اسم مكانك الخاص"/><button className={secondary} disabled={!savedName.trim()} onClick={savePersonal}>احفظ هذا المكان</button></div><p role="status" aria-live="polite">{saveNotice}</p></section>}
    {locationEstimate?.state==='LOCALIZATION_LOST'&&<p role="alert" className="rounded-xl border border-amber-300/40 p-4">تعذر تحديد موقعك بدقة داخل المبنى. وجّه الكاميرا نحو لوحة مكان معروف لإعادة التثبيت.</p>}
    {candidates.length>0&&<section className="space-y-3 rounded-xl border border-amber-200/30 p-4"><h2 className="font-bold">معلومات جديدة محتملة للخريطة</h2><label className="flex gap-2"><input type="checkbox" checked={shareCandidate} onChange={e=>setShareCandidate(e.target.checked)}/>أوافق على مشاركة نص اللوحة وموقع تقريبي فقط، دون صورة، للمراجعة العامة</label>{candidates.slice(0,2).map(candidate=><p key={candidate.id}>{candidate.lookupStatus==='UNAVAILABLE'?t.candidateOffline(candidate.detectedText):t.candidate(candidate.detectedText)} <button className={secondary} disabled={!shareCandidate||locationEstimate?.state!=='TRACKING'} onClick={()=>void contributeCandidate(candidate)}>أرسل كمساهمة</button></p>)}<p role="status" aria-live="polite">{shareNotice}</p></section>}
    <video ref={videoRef} muted playsInline aria-hidden="true" aria-label={t.preview} className={`aspect-video w-full max-w-md rounded-xl bg-stone-950 object-cover ${hasNativeFrames?'hidden':''}`} />
    <canvas ref={nativeCanvasRef} width={480} height={640} aria-hidden="true" className={`aspect-[3/4] w-full max-w-sm rounded-xl bg-stone-950 object-contain ${hasNativeFrames?'':'hidden'}`} />
  </div></Layout>;
}
