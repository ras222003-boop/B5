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
import { MonocularRelativeDepthProvider, NativeMetricDepthProvider, SegFormerSceneProvider } from '@/lib/vision/modelProviders';
import { detectVisionCapabilities, type VisionCapabilities } from '@/lib/vision/capabilities';
import { VisionPipeline } from '@/lib/vision/pipeline';
import { BrowserHapticFeedbackProvider, VisionAnnouncementService } from '@/lib/vision/scene';
import type { PlaceCandidate, RecognizedPlace, RiskLevel, SceneDescription } from '@shared/vision';

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
  const [cameraPermission,setCameraPermission]=useState<PermissionState>('not_requested');
  const [online,setOnline]=useState(typeof navigator==='undefined'?true:navigator.onLine);
  const [spokenSummary,setSpokenSummary]=useState('');
  useEffect(()=>{permissionService.status('camera').then(setCameraPermission).catch(()=>{});const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);

  const stop=useCallback(async()=>{
    generation.current++;
    const pipeline=pipelineRef.current;pipelineRef.current=null;
    cameraRef.current.stop(videoRef.current??undefined);
    stopSpeaking();
    setState('STOPPED');setScene(null);setCandidates([]);setRecognized(null);
    if(pipeline)await pipeline.stop();
  },[stopSpeaking]);
  useEffect(()=>()=>{
    generation.current++;
    cameraRef.current.stop(videoRef.current??undefined);
    void pipelineRef.current?.stop();pipelineRef.current=null;
  },[]);
  useEffect(()=>{const onHidden=()=>{if(document.hidden)void stop();};document.addEventListener('visibilitychange',onHidden);return()=>document.removeEventListener('visibilitychange',onHidden);},[stop]);

  const start=async()=>{
    if(state!=='STOPPED'||!videoRef.current)return;
    const run=++generation.current;
    setError('');setOCRWarning('');setModelWarning('');setDepthWarning('');setLastAlert('');setRisk(null);setSpokenSummary('');setState('STARTING');
    try {
      const detected=detectVisionCapabilities();setCapabilities(detected);
      await cameraRef.current.start(videoRef.current);
      if(run!==generation.current){cameraRef.current.stop(videoRef.current);return;}
      setCameraPermission('allowed');
      const provider=await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
      if(run!==generation.current){await provider.close();cameraRef.current.stop(videoRef.current);return;}
      let segmentation:SegFormerSceneProvider|undefined;
      try{segmentation=await SegFormerSceneProvider.open();}
      catch{setModelWarning(t.segmentationFailure);}
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close()]);cameraRef.current.stop(videoRef.current);return;}
      let metricDepth:NativeMetricDepthProvider|undefined;
      let relativeDepth:MonocularRelativeDepthProvider|undefined;
      if(detected.nativeDepth&&window.BasiraNativeDepth)metricDepth=new NativeMetricDepthProvider(window.BasiraNativeDepth);
      else if(detected.performanceTier==='HIGH'&&segmentation){
        try{relativeDepth=await MonocularRelativeDepthProvider.open();}
        catch{setDepthWarning(t.depthFailure);}
      }
      if(run!==generation.current){await Promise.allSettled([provider.close(),segmentation?.close(),relativeDepth?.close()]);cameraRef.current.stop(videoRef.current);return;}
      const currentBuildingId=sessionStorage.getItem('basira-current-building');
      const announcement=new VisionAnnouncementService(t,text=>speak(text,0.9,lang),new BrowserHapticFeedbackProvider(),DEFAULT_VISION_CONFIG.alertCooldownMs);
      const pipeline=new VisionPipeline({video:videoRef.current,vision:provider,ocr:new TesseractOCRProvider(),depth:new UnavailableDepthProvider(),
        segmentation,relativeDepth,metricDepth,segmentationIntervalMs:detected.segmentationIntervalMs,depthIntervalMs:detected.depthIntervalMs,
        config:DEFAULT_VISION_CONFIG,copy:t,mode:'EXPLORATION',buildingId:currentBuildingId,floorId:null,announcement,
        callbacks:{
          scene:description=>{if(run===generation.current){setScene(description);setState('ANALYZING');}},
          alert:(text,level)=>{if(run===generation.current){setLastAlert(text);setRisk(level);}},
          candidate:candidate=>{if(run===generation.current)setCandidates(previous=>[candidate,...previous].slice(0,10));},
          recognized:place=>{if(run===generation.current)setRecognized(place);},
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
  const cameraState=state==='STOPPED'?t.stopped:state==='STARTING'?t.starting:state==='WORKING'?t.working:t.analyzing;
  return <Layout><div className="container max-w-4xl space-y-6 py-10 text-stone-100">
    <Link href="/navigation" className="text-amber-300 underline">{nav.title}</Link>
    <header><h1 className="text-3xl font-black">{t.title}</h1><p className="mt-3 text-lg text-stone-300">{t.description}</p></header>
    <p className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-amber-100">{t.advisory}</p>
    <div className="flex flex-wrap gap-3">{state==='STOPPED'?<button type="button" className={button} onClick={start}>{t.start}</button>:<button type="button" className={button} onClick={()=>void stop()}>{t.stop}</button>}</div>
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
    <div className="flex flex-wrap gap-3"><button className={secondary} type="button" disabled={state==='STOPPED'||state==='STARTING'} onClick={()=>report(false)}>{t.whatAhead}</button><button className={secondary} type="button" disabled={state==='STOPPED'||state==='STARTING'} onClick={()=>report(true)}>{t.describe}</button></div>
    <p aria-live="polite" role="status" className="min-h-6">{spokenSummary}</p>
    {recognized&&<p role="status" className="rounded-xl border border-emerald-300/40 p-4 text-emerald-100">{t.placeRecognized(recognized.name)}</p>}
    {candidates.length>0&&<div role="status" aria-live="polite" className="space-y-2">{candidates.slice(0,2).map(candidate=><p key={candidate.id}>{candidate.lookupStatus==='UNAVAILABLE'?t.candidateOffline(candidate.detectedText):t.candidate(candidate.detectedText)}</p>)}</div>}
    <video ref={videoRef} muted playsInline aria-hidden="true" aria-label={t.preview} className="aspect-video w-full max-w-md rounded-xl bg-stone-950 object-cover" />
  </div></Layout>;
}
