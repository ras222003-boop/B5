import type { DepthProvider, DepthReading, EstimatedMetricDepthProvider, MetricDepthMap, MetricDepthProvider, OCRDetection, OCRProvider, PlaceCandidate, RecognizedPlace, RelativeDepthMap, RelativeDepthProvider, SceneDescription, SceneSegmentationProvider, SegmentationGrid, VisionDetection, VisionMode, VisionProvider, WalkableAreaResult } from '@shared/vision';
import type { VisionConfig } from './config';
import type { Place } from '@shared/navigation';
import { captureFrame,detectionFrame as smallDetectionFrame } from './camera';
import { BasiraSafetyEngine, classifyDirection, classifyVertical } from './safety';
import { isNavigationText, normalizePlaceText, signTypeForText, VisualPlaceRecognitionService } from './placeRecognition';
import { SceneUnderstandingService, VisionAnnouncementService, type VisionCopy } from './scene';
import { VisionFusionEngine } from './fusion';
import { hazardRank } from '@/lib/guidance/safety';
import { assessFrameLight,sampleFrameLight, type FrameLightStatus } from './frameQuality';
import { SAFE_DEFAULT_FLAGS, type SafetyFlags } from '@shared/safetyFlags';
import { metricDiagnostic, type MetricDiagnostic } from './metricEngine';
import { checkAtomicFrame, checkAtomicRgbFrame, rotateNativeDepthClockwise } from './nativeFramePair';
import { measureAutoMeterObjects, measureEstimatedObjects, type AutoMeterSnapshot } from './autoMeter';
import {meterErrorCode,type MeterDiagnostic} from './meterDiagnostics';
import {ObjectSpeechTracker} from './objectSpeech';
import {ObjectTracker} from './objectTracking';
import {VisualApproachEstimator} from './visualApproach';
import {SparseOpticalFlow} from './opticalFlow';
import {GroundHazardEngine,grayscalePixels,type GroundHazardSnapshot} from './groundHazards';
import {freshTimestamp,observationFor,PerceptionTelemetry,type PerceptionSnapshot} from './perception';

interface Callbacks {
  perception?:(snapshot:PerceptionSnapshot|null)=>void;
  analysisState?:(state:'WAITING'|'LIVE'|'STALE'|'PAUSED'|'SLOW')=>void;
  scene:(description:SceneDescription)=>void;
  detectionFrame?:(frame:LiveDetectionFrame)=>void;
  alert:(text:string,risk:SceneDescription['riskLevel'])=>void;
  objectSpeech?:(text:string)=>boolean;
  approachSpeech?:(text:string)=>boolean;
  candidate:(candidate:PlaceCandidate)=>void;
  recognized:(place:RecognizedPlace,capturedAt:number)=>void;
  OCRFailure:()=>void;
  segmentationFailure:()=>void;
  depthFailure:()=>void;
  metricStatus?:(diagnostic:MetricDiagnostic)=>void;
  autoMeterSnapshot?:(snapshot:AutoMeterSnapshot|null)=>void;
  /** The JPEG is captured from the exact detector/metric input, never from a later live frame. */
  pinnedMetricFrame?:(result:PinnedMetricFrame|null)=>void;
  autoMeterRejected?:()=>void;
  estimatedMetricStatus?:(status:'UNAVAILABLE'|'WAITING'|'LIVE'|'LOW_LIGHT')=>void;
  metricModelFailure?:()=>void;
  meterDiagnostic?:(diagnostic:MeterDiagnostic)=>void;
  metricTiming?:(phase:'LOAD'|'INFERENCE',milliseconds:number)=>void;
  fatal:(error:unknown)=>void;
  quality?:(light:FrameLightStatus)=>void;
}
export interface LiveDetectionFrame {
  frameId:string;
  capturedAt:number;
  width:number;
  height:number;
  detections:VisionDetection[];
}
export interface PinnedMetricFrame {
  frame:LiveDetectionFrame;
  imageDataUrl:string;
}
export interface MeterAttempt {
  snapshot:AutoMeterSnapshot|null;
  diagnostic:MeterDiagnostic;
}
export interface VisionPipelineOptions {
  video:HTMLVideoElement; vision:VisionProvider; ocr:OCRProvider; depth:DepthProvider;
  /** Native RGB is the sole detector input when present; its optional depth is paired atomically. */
  nativeFrames?:NonNullable<Window['BasiraNativeFrames']>;
  nativeCanvas?:HTMLCanvasElement;
  autoMeterEnabled?:boolean;
  objectSpeechEnabled?:boolean;
  experimentalApproachEnabled?:boolean;
  approachPhrase?:(name:string,direction:string)=>string;
  estimatedMetricModel?:(signal?:AbortSignal)=>Promise<EstimatedMetricDepthProvider>;
  segmentation?:SceneSegmentationProvider;relativeDepth?:RelativeDepthProvider;metricDepth?:MetricDepthProvider;
  segmentationIntervalMs?:number;depthIntervalMs?:number;
  config:VisionConfig; copy:VisionCopy; mode:VisionMode;
  buildingId:string|null; floorId:string|null;
  localPlaces?:Place[];
  safetyFlags?:SafetyFlags;
  announcement:VisionAnnouncementService; callbacks:Callbacks;
}

/** Faster sign reading is reserved for the final approach to a known destination. */
export function ocrRefreshInterval(mode: VisionMode, findingDestination: boolean, normalMs: number): number {
  return mode === 'NAVIGATION' && findingDestination ? Math.max(1500, Math.min(2500, normalMs)) : normalMs;
}

/** Unknown frame quality is not evidence that the camera can verify free space. */
export function walkableAreaForLight(light: FrameLightStatus, area: WalkableAreaResult | null): WalkableAreaResult | null {
  return light === 'NOT_LOW_LIGHT' ? area : null;
}

/** Camera -> detector -> scene/safety; sparse OCR runs separately so it cannot block safety frames. */
export class VisionPipeline {
  private readonly tracker=new ObjectTracker();
  private readonly flow=new SparseOpticalFlow();
  private readonly approach=new VisualApproachEstimator();
  private readonly ground=new GroundHazardEngine();
  private readonly semanticGroundEngine=new GroundHazardEngine();
  private semanticGround:GroundHazardSnapshot|null=null;
  private readonly telemetry=new PerceptionTelemetry();
  private perception:PerceptionSnapshot|null=null;
  private approachEnabled=false;
  private lastVideoTime=-1;
  private lastCapturedAt=0;
  private lastCaptureWallTime=0;
  private analysisState='WAITING';
  private slowFrames=0;
  private running=false;
  private timer:number|null=null;
  private generation=0;
  private observationGeneration=0;
  private ocrBusy=false;
  private ocrEnabled=true;
  private findingDestination=false;
  private lastOCR=Number.NEGATIVE_INFINITY;
  private lowBattery=false;
  private batteryCleanup:(()=>void)|null=null;
  private recognizedPlace:RecognizedPlace|null=null;
  private recognizedPlaceCapturedAt=Number.NEGATIVE_INFINITY;
  private signDetections:VisionDetection[]=[];
  private latest:SceneDescription|null=null;
  private seenCandidates=new Set<string>();
  private depthCache=new Map<string,{reading:DepthReading|null;at:number}>();
  private segmentation:SegmentationGrid|null=null;
  private relativeDepth:RelativeDepthMap|null=null;
  private metricDepth:MetricDepthMap|null=null;
  private geometryBusy=false;
  private geometryEnabled=true;
  private relativeDepthEnabled=true;
  private lastGeometry=Number.NEGATIVE_INFINITY;
  private lastDepth=Number.NEGATIVE_INFINITY;
  private lastMetric=Number.NEGATIVE_INFINITY;
  private autoMeterEnabled:boolean;
  private objectSpeechEnabled:boolean;
  private readonly objectSpeech:ObjectSpeechTracker;
  private autoMeterGeneration=0;
  private lastNativeFrameId='';
  private estimatedModel:EstimatedMetricDepthProvider|null=null;
  private modelOpening:Promise<void>|null=null;
  private modelOpenAbort:AbortController|null=null;
  private modelBusy=false;
  private forceMeterCapture=false;
  private pendingMeterRequests:{requestedAt:number;resolve:(result:MeterAttempt)=>void;timer:number}[]=[];
  private currentMeterDiagnostic:MeterDiagnostic='OFF';
  private lastModel=Number.NEGATIVE_INFINITY;
  private latestObjects:VisionDetection[]=[];
  private lastLightCheck=Number.NEGATIVE_INFINITY;
  private cameraLight:FrameLightStatus='UNKNOWN';
  private readonly safety:BasiraSafetyEngine;
  private readonly fusion:VisionFusionEngine;
  private readonly scene:SceneUnderstandingService;
  private readonly place:VisualPlaceRecognitionService;
  private frames=0;
  private inferenceMs=0;
  private detections=0;
  constructor(private readonly options:VisionPipelineOptions) {
    if(options.vision.usagePolicy==='EXPERIMENTAL_DISPLAY_ONLY')throw new Error('Research providers cannot enter guidance/safety pipeline');
    this.approachEnabled=options.experimentalApproachEnabled===true;
    this.autoMeterEnabled=options.autoMeterEnabled===true;
    this.objectSpeechEnabled=options.objectSpeechEnabled!==false;
    this.objectSpeech=new ObjectSpeechTracker(options.copy,4500,options.approachPhrase);
    this.safety=new BasiraSafetyEngine(options.config);
    this.fusion=new VisionFusionEngine(this.safety);
    this.scene=new SceneUnderstandingService(options.copy);
    this.place=new VisualPlaceRecognitionService(options.buildingId,options.floorId,options.localPlaces);
  }
  get snapshot(){return this.latest;}
  get active(){return this.running;}
  setExperimentalApproachEnabled(enabled:boolean){this.approachEnabled=enabled;this.approach.reset();this.flow.reset();}
  private reportAnalysis(state:'WAITING'|'LIVE'|'STALE'|'PAUSED'|'SLOW'){
    if(state!==this.analysisState){this.analysisState=state;this.options.callbacks.analysisState?.(state);}
  }
  private invalidate(state:'WAITING'|'STALE'|'PAUSED'){
    this.observationGeneration++;
    this.latestObjects=[];this.latest=null;this.perception=null;
    this.segmentation=null;this.relativeDepth=null;this.metricDepth=null;this.signDetections=[];
    this.recognizedPlace=null;this.recognizedPlaceCapturedAt=Number.NEGATIVE_INFINITY;this.depthCache.clear();
    this.tracker.reset();this.flow.reset();this.approach.reset();this.ground.reset();this.semanticGroundEngine.reset();this.semanticGround=null;this.objectSpeech.reset();
    this.options.callbacks.perception?.(null);this.reportAnalysis(state);
  }
  private cameraUnavailable(){
    // Native RGB arrives through the bridge, not the (usually paused) video element.
    if(this.options.nativeFrames)return false;
    const video=this.options.video;
    const track=(video.srcObject as MediaStream|null)?.getVideoTracks?.()[0];
    return Boolean(video.paused||video.ended||track?.readyState==='ended');
  }
  private acceptsObservation(generation:number,observationGeneration:number,capturedAt:number){
    return this.running&&generation===this.generation&&observationGeneration===this.observationGeneration&&
      !this.cameraUnavailable()&&freshTimestamp(capturedAt,performance.now());
  }
  setFindingDestination(active:boolean){this.findingDestination=active;}
  setAlertDistanceMeters(value:number){this.safety.setAlertDistanceMeters(value);}
  setObjectSpeechEnabled(enabled:boolean){this.objectSpeechEnabled=enabled;this.objectSpeech.reset();}
  setSegmentation(provider:SceneSegmentationProvider){
    if(!this.running){void provider.close();return;}
    this.options.segmentation=provider;this.geometryEnabled=true;this.lastGeometry=Number.NEGATIVE_INFINITY;
  }
  /** A button press is satisfied only by a frame captured after the press. */
  requestMeterNow():Promise<MeterAttempt>{
    if(!this.running||!this.autoMeterEnabled)return Promise.resolve({snapshot:null,diagnostic:'OFF'});
    if(!this.options.nativeFrames&&!this.options.estimatedMetricModel)return Promise.resolve({snapshot:null,diagnostic:'MODEL_INIT'});
    return new Promise(resolve=>{
      const requestedAt=performance.now();
      const timer=window.setTimeout(()=>{
        this.pendingMeterRequests=this.pendingMeterRequests.filter(item=>item.timer!==timer);
        const diagnostic=!this.options.nativeFrames&&!this.estimatedModel&&
          (this.modelOpening||this.currentMeterDiagnostic==='MODEL_LOADING')?'MODEL_TIMEOUT':'FRAME_TIMEOUT';
        this.reportMeterDiagnostic(diagnostic);
        resolve({snapshot:null,diagnostic});
        this.forceMeterCapture=this.pendingMeterRequests.length>0;
      },15_000);
      this.pendingMeterRequests.push({requestedAt,resolve,timer});
      this.forceMeterCapture=true;
      if(!this.options.nativeFrames&&!this.estimatedModel&&!this.modelOpening)void this.startMetricModel();
    });
  }
  private reportMeterDiagnostic(diagnostic:MeterDiagnostic){
    this.currentMeterDiagnostic=diagnostic;
    this.options.callbacks.meterDiagnostic?.(diagnostic);
  }
  private finishMeterAttempt(capturedAt:number,result:MeterAttempt){
    const ready=this.pendingMeterRequests.filter(item=>capturedAt>=item.requestedAt);
    this.pendingMeterRequests=this.pendingMeterRequests.filter(item=>capturedAt<item.requestedAt);
    for(const item of ready){window.clearTimeout(item.timer);item.resolve(result);}
    this.forceMeterCapture=this.pendingMeterRequests.length>0;
  }
  private cancelMeterRequests(diagnostic:MeterDiagnostic){
    for(const item of this.pendingMeterRequests){window.clearTimeout(item.timer);item.resolve({snapshot:null,diagnostic});}
    this.pendingMeterRequests=[];this.forceMeterCapture=false;
  }
  async setAutoMeterEnabled(enabled:boolean):Promise<boolean>{
    this.autoMeterEnabled=enabled;
    this.autoMeterGeneration++;
    if(!enabled)this.modelOpenAbort?.abort();
    if(!enabled)this.cancelMeterRequests('OFF');
    this.metricDepth=null;
    this.options.callbacks.autoMeterSnapshot?.(null);
    this.options.callbacks.pinnedMetricFrame?.(null);
    this.reportMeterDiagnostic(enabled?(this.options.nativeFrames?'WAITING_CAMERA':'MODEL_LOADING'):'OFF');
    this.options.callbacks.metricStatus?.({status:enabled&&this.options.nativeFrames?'WAITING':'UNAVAILABLE',source:null});
    if(!this.options.nativeFrames){
      this.options.callbacks.estimatedMetricStatus?.(enabled&&this.options.estimatedMetricModel?'WAITING':'UNAVAILABLE');
      if(enabled&&this.running)void this.startMetricModel();
      if(!enabled&&this.estimatedModel){const model=this.estimatedModel;this.estimatedModel=null;void model.close();}
    }
    if(this.running&&this.options.nativeFrames){
      try{await this.options.nativeFrames.setMeterEnabled(enabled);}
      catch{
        this.autoMeterEnabled=false;this.autoMeterGeneration++;
        this.cancelMeterRequests('OFF');
        this.options.callbacks.autoMeterRejected?.();
        this.options.callbacks.metricStatus?.({status:'UNAVAILABLE',source:null});
        return false;
      }
    }
    return true;
  }
  async start(){
    if(this.running)return;
    this.running=true;
    this.generation++;
    if(this.options.nativeFrames){
      try{await this.options.nativeFrames.start();}
      catch(error){await this.stop();throw error;}
      if(this.autoMeterEnabled)await this.setAutoMeterEnabled(true);
    }
    console.info('Basira vision session started',{mode:this.options.mode});
    this.watchBattery();
    this.schedule(0);
    if(this.autoMeterEnabled&&!this.options.nativeFrames)void this.startMetricModel();
  }
  private schedule(ms:number){ if(this.running)this.timer=window.setTimeout(()=>void this.tick(),ms); }
  private async startMetricModel(){
    if(this.modelOpening){
      // A new opt-in may arrive while a previous, now stale load is finishing.
      await this.modelOpening;
      if(this.running&&this.autoMeterEnabled&&!this.estimatedModel)void this.startMetricModel();
      return;
    }
    if(this.estimatedModel||!this.options.estimatedMetricModel||!this.running||!this.autoMeterEnabled)return;
    const token=this.autoMeterGeneration;
    const controller=new AbortController();this.modelOpenAbort=controller;
    const openedAt=performance.now();
    this.reportMeterDiagnostic('MODEL_LOADING');
    const opening=this.options.estimatedMetricModel(controller.signal).then(async model=>{
      if(!this.running||!this.autoMeterEnabled||token!==this.autoMeterGeneration){await model.close();return;}
      this.estimatedModel=model;
      this.options.callbacks.metricTiming?.('LOAD',Math.round(performance.now()-openedAt));
      this.options.callbacks.estimatedMetricStatus?.('WAITING');
      this.reportMeterDiagnostic('WAITING_CAMERA');
      this.forceMeterCapture=this.pendingMeterRequests.length>0;
    }).catch(error=>{
      if(this.running&&this.autoMeterEnabled&&token===this.autoMeterGeneration){
        this.options.callbacks.estimatedMetricStatus?.('UNAVAILABLE');
        const diagnostic=meterErrorCode(error,'MODEL_INIT');
        this.reportMeterDiagnostic(diagnostic);
        this.cancelMeterRequests(diagnostic);
        this.options.callbacks.metricModelFailure?.();
      }
    });
    this.modelOpening=opening;
    await opening;
    if(this.modelOpening===opening)this.modelOpening=null;
    if(this.modelOpenAbort===controller)this.modelOpenAbort=null;
  }
  private async processEstimatedMetric(frame:HTMLCanvasElement,detections:VisionDetection[],timestamp:number,capturedAt:number,generation:number,meterGeneration:number){
    this.modelBusy=true;
    const inferenceStarted=performance.now();
    try{
      const map=await this.estimatedModel!.estimate(frame,timestamp);
      if(!this.running||generation!==this.generation||meterGeneration!==this.autoMeterGeneration||!this.autoMeterEnabled)return;
      if(performance.now()-timestamp>6000){
        this.options.callbacks.autoMeterSnapshot?.(null);
        this.options.callbacks.pinnedMetricFrame?.(null);
        this.options.callbacks.estimatedMetricStatus?.('UNAVAILABLE');
        this.reportMeterDiagnostic('FRAME_STALE');
        this.finishMeterAttempt(timestamp,{snapshot:null,diagnostic:'FRAME_STALE'});
        return;
      }
      const snapshot=measureEstimatedObjects(detections,map,`web-${timestamp}`,capturedAt);
      const detectionFrame={frameId:snapshot.frameId,capturedAt,width:frame.width,height:frame.height,detections};
      this.options.callbacks.detectionFrame?.(detectionFrame);
      this.options.callbacks.autoMeterSnapshot?.(snapshot);
      if(snapshot.measurements.some(item=>item.distanceMeters!==null)){
        try{this.options.callbacks.pinnedMetricFrame?.({frame:detectionFrame,imageDataUrl:frame.toDataURL('image/jpeg',.75)});}
        catch{this.options.callbacks.pinnedMetricFrame?.(null);}
      }else this.options.callbacks.pinnedMetricFrame?.(null);
      const diagnostic=snapshot.measurements.some(item=>item.distanceMeters!==null)?'READY_OBJECT'
        :snapshot.centerSurface?.distanceMeters!=null?'READY_CENTER'
        :snapshot.measurements[0]?.rejectionReason??'NO_OBJECT_DETECTED';
      this.reportMeterDiagnostic(diagnostic);
      this.finishMeterAttempt(timestamp,{snapshot,diagnostic});
      this.options.callbacks.estimatedMetricStatus?.('LIVE');
    }catch(error){
      if(this.running&&generation===this.generation&&meterGeneration===this.autoMeterGeneration){
        const model=this.estimatedModel;this.estimatedModel=null;
        this.options.callbacks.autoMeterSnapshot?.(null);
        this.options.callbacks.pinnedMetricFrame?.(null);
        this.options.callbacks.estimatedMetricStatus?.('UNAVAILABLE');
        const diagnostic=meterErrorCode(error,'INFERENCE_FAILED');
        this.reportMeterDiagnostic(diagnostic);
        this.cancelMeterRequests(diagnostic);
        this.options.callbacks.metricModelFailure?.();
        if(model)void model.close();
      }
    }finally{
      this.options.callbacks.metricTiming?.('INFERENCE',Math.round(performance.now()-inferenceStarted));
      frame.width=frame.height=0;this.modelBusy=false;
    }
  }
  private async tick(){
    this.timer=null;
    if(!this.running)return;
    const generation=this.generation;
    const started=performance.now();
    try {
      let detectionFrame:HTMLVideoElement|HTMLCanvasElement=this.options.video;
      let detectorTimestamp=started;
      let nativeFrameId='';
      let nativeMap:MetricDepthMap|null=null;
      let metricFrame:HTMLCanvasElement|null=null;
      let metricCapturedAt=0;
      let frameCapturedAt=Date.now();
      const meterGeneration=this.autoMeterGeneration;
      if(this.options.nativeFrames&&this.options.nativeCanvas){
        const sample=await this.options.nativeFrames.nextFrame();
        if(!this.running||generation!==this.generation)return;
        if(checkAtomicRgbFrame(sample)||!sample||sample.frameId===this.lastNativeFrameId){
          if(performance.now()-this.lastCapturedAt>1250)this.invalidate('STALE');
          this.options.callbacks.metricStatus?.({status:this.autoMeterEnabled?'WAITING':'UNAVAILABLE',source:null});
          this.schedule(500);return;
        }
        this.lastNativeFrameId=sample.frameId;
        const image=new Image();
        image.src='data:image/jpeg;base64,'+sample.imageBase64;
        await image.decode();
        if(!this.running||generation!==this.generation)return;
        const canvas=this.options.nativeCanvas;
        const context=canvas.getContext('2d');
        if(!context)throw new Error('native_canvas_unavailable');
        canvas.width=480;canvas.height=640;
        context.clearRect(0,0,480,640);
        context.save();context.translate(480,0);context.rotate(Math.PI/2);
        context.drawImage(image,0,0,640,480);context.restore();
        detectorTimestamp=performance.now();
        frameCapturedAt=Date.now();
        detectionFrame=canvas;
        nativeFrameId=sample.frameId;
        if(this.autoMeterEnabled&&meterGeneration===this.autoMeterGeneration&&checkAtomicFrame(sample)===null){
          nativeMap=rotateNativeDepthClockwise(sample,detectorTimestamp);
        }
        this.options.callbacks.metricStatus?.(nativeMap?{status:'LIVE',source:nativeMap.source}:{status:this.autoMeterEnabled?'WAITING':'UNAVAILABLE',source:null});
      }else {
        const video=this.options.video;
        if(this.cameraUnavailable()){
          this.invalidate('PAUSED');this.schedule(250);return;
        }
        if(video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA||video.currentTime===this.lastVideoTime){
          if(started-this.lastCapturedAt>1250)this.invalidate('STALE');
          this.schedule(100);return;
        }
        this.lastVideoTime=video.currentTime;
      }
      if(!this.options.nativeFrames&&started-this.lastLightCheck>=3000){
        this.lastLightCheck=started;
        const previous=this.cameraLight;
        this.cameraLight=sampleFrameLight(this.options.video);
        if(previous!==this.cameraLight)this.options.callbacks.quality?.(this.cameraLight);
      }
      if(!this.options.nativeFrames&&this.autoMeterEnabled&&(this.estimatedModel||this.modelOpening)&&this.cameraLight!=='NOT_LOW_LIGHT'){
        if(this.cameraLight==='LOW_LIGHT'){
          this.options.callbacks.autoMeterSnapshot?.(null);
          this.options.callbacks.pinnedMetricFrame?.(null);
        }
        this.options.callbacks.estimatedMetricStatus?.(this.cameraLight==='LOW_LIGHT'?'LOW_LIGHT':'UNAVAILABLE');
        const diagnostic=this.cameraLight==='LOW_LIGHT'?'LOW_LIGHT':
          this.modelOpening&&!this.estimatedModel?'MODEL_LOADING':'WAITING_CAMERA';
        this.reportMeterDiagnostic(diagnostic);
        if(this.cameraLight==='LOW_LIGHT')this.finishMeterAttempt(started,{snapshot:null,diagnostic});
      }
      if(!this.options.nativeFrames&&this.autoMeterEnabled&&this.estimatedModel&&!this.modelBusy&&
        this.cameraLight==='NOT_LOW_LIGHT'&&(this.forceMeterCapture||started-this.lastModel>=1500)){
        const video=this.options.video;
        metricFrame=document.createElement('canvas');
        const scale=Math.min(1,this.options.config.inputResolution.width/video.videoWidth,
          this.options.config.inputResolution.height/video.videoHeight);
        metricFrame.width=Math.max(1,Math.round(video.videoWidth*scale));
        metricFrame.height=Math.max(1,Math.round(video.videoHeight*scale));
        const context=metricFrame.getContext('2d');
        if(context){
          context.drawImage(video,0,0,metricFrame.width,metricFrame.height);
          metricCapturedAt=Date.now();
          frameCapturedAt=metricCapturedAt;
          detectionFrame=metricFrame;detectorTimestamp=started;this.lastModel=started;
          this.options.callbacks.estimatedMetricStatus?.('WAITING');
          this.reportMeterDiagnostic('FRAME_PROCESSING');
        }
        else metricFrame=null;
      }
      if(!this.options.nativeFrames&&detectionFrame instanceof HTMLVideoElement)
        detectionFrame=smallDetectionFrame(detectionFrame,this.options.config);
      // Copy motion/ground pixels from the detector input BEFORE asynchronous inference.
      const grayCanvas=document.createElement('canvas');grayCanvas.width=96;grayCanvas.height=72;
      const grayContext=grayCanvas.getContext('2d',{willReadFrequently:true});
      let gray:Uint8Array|undefined;
      if(grayContext){
        grayContext.drawImage(detectionFrame,0,0,96,72);
        const rgba=grayContext.getImageData(0,0,96,72).data;gray=grayscalePixels(rgba);
        const light=assessFrameLight(rgba);
        if(light!==this.cameraLight){this.cameraLight=light;this.options.callbacks.quality?.(light);}
      }
      grayCanvas.width=grayCanvas.height=0;
      const rawDetections=await this.options.vision.detect(detectionFrame,detectorTimestamp);
      if(rawDetections.some(item=>item.experimental))throw new Error('Research detections cannot enter guidance/safety pipeline');
      if(!this.running||generation!==this.generation)return;
      if(this.cameraUnavailable()){
        if(metricFrame)metricFrame.width=metricFrame.height=0;
        this.invalidate('PAUSED');this.schedule(250);return;
      }
      const frameId=this.options.nativeFrames?nativeFrameId:`web-${detectorTimestamp}`;
      const tracked=this.tracker.update(rawDetections,{frameId,capturedAt:detectorTimestamp,now:performance.now()});
      if(tracked.rejectedFrame){if(metricFrame)metricFrame.width=metricFrame.height=0;this.invalidate('STALE');this.schedule(100);return;}
      const detections=tracked.detections;
      this.lastCapturedAt=detectorTimestamp;this.lastCaptureWallTime=frameCapturedAt;
      const width=detectionFrame instanceof HTMLVideoElement?detectionFrame.videoWidth:detectionFrame.width;
      const height=detectionFrame instanceof HTMLVideoElement?detectionFrame.videoHeight:detectionFrame.height;
      this.options.callbacks.detectionFrame?.({frameId,capturedAt:frameCapturedAt,width,height,detections});
      if(metricFrame)void this.processEstimatedMetric(metricFrame,detections,detectorTimestamp,metricCapturedAt,generation,meterGeneration);
      // Depth must be captured independently of semantic segmentation. A
      // segmentation model failure cannot disable a trusted metric sensor.
      if(!this.options.nativeFrames&&this.options.metricDepth && started-this.lastMetric>=500) {
        this.lastMetric=started;
        try { this.metricDepth=await this.options.metricDepth.capture(started); }
        catch { this.metricDepth=null; this.options.callbacks.depthFailure(); }
        if(!this.running||generation!==this.generation)return;
      }
      if(!this.options.nativeFrames)this.options.callbacks.metricStatus?.(metricDiagnostic(this.metricDepth,started,Boolean(this.options.metricDepth)));
      if(this.options.nativeFrames&&meterGeneration===this.autoMeterGeneration&&this.autoMeterEnabled){
        const snapshot=measureAutoMeterObjects(detections,nativeMap,nativeFrameId,frameCapturedAt,nativeMap?.source);
        this.options.callbacks.autoMeterSnapshot?.(snapshot);
        if(snapshot.measurements.some(item=>item.distanceMeters!==null)&&this.options.nativeCanvas){
          try{this.options.callbacks.pinnedMetricFrame?.({frame:{frameId,capturedAt:frameCapturedAt,width,height,detections},imageDataUrl:this.options.nativeCanvas.toDataURL('image/jpeg',.75)});}
          catch{this.options.callbacks.pinnedMetricFrame?.(null);}
        }else this.options.callbacks.pinnedMetricFrame?.(null);
        const diagnostic=snapshot.measurements.some(item=>item.distanceMeters!==null)
          ?'READY_OBJECT':snapshot.measurements[0]?.rejectionReason??'NO_OBJECT_DETECTED';
        this.reportMeterDiagnostic(diagnostic);
        this.finishMeterAttempt(started,{snapshot,diagnostic});
      }
      const enriched=await Promise.all(detections.map(async detection=>({ ...detection,approximateDistance:await this.readDepth(detection,started) })));
      if(!this.running||generation!==this.generation)return;
      if(this.cameraUnavailable()){
        this.invalidate('PAUSED');this.schedule(250);return;
      }
      const completedAt=performance.now();
      if(!freshTimestamp(detectorTimestamp,completedAt)){this.invalidate('STALE');this.schedule(100);return;}
      this.latestObjects=enriched;
      const motionUsable=this.approachEnabled&&this.cameraLight==='NOT_LOW_LIGHT';
      if(!motionUsable){this.flow.reset();this.approach.reset();}
      const motion=motionUsable&&gray?this.flow.update({frameId,capturedAt:detectorTimestamp,width:96,height:72,pixels:gray},detections):[];
      const settings=(this.options.video.srcObject as MediaStream|null)?.getVideoTracks?.()[0]?.getSettings?.() as (MediaTrackSettings&{zoom?:number})|undefined;
      const approach=motionUsable?this.approach.update(enriched,{frameId,capturedAt:detectorTimestamp,now:performance.now(),motion,zoom:settings?.zoom}):[];
      const ground=this.ground.observe({frameId,capturedAt:detectorTimestamp,width:96,height:72,gray,
        detections:enriched,lowLight:this.cameraLight==='LOW_LIGHT',segmentation:this.segmentation},completedAt);
      if(this.semanticGround?.status==='CURRENT'&&freshTimestamp(this.semanticGround.capturedAt,completedAt)&&Math.abs(this.semanticGround.capturedAt-detectorTimestamp)<=250)
        ground.observations.push(...this.semanticGround.observations);
      const finishedAt=performance.now();
      if(!freshTimestamp(detectorTimestamp,finishedAt)){this.invalidate('STALE');this.schedule(100);return;}
      const timings=this.telemetry.record(detectorTimestamp,finishedAt);
      this.slowFrames=timings.inferenceMs>600?Math.min(10,this.slowFrames+1):Math.max(0,this.slowFrames-1);
      this.perception={frameId,capturedAt:detectorTimestamp,completedAt:finishedAt,observations:enriched.map(d=>{
        const observation=observationFor(d);return this.cameraLight==='LOW_LIGHT'?{...observation,validity:'UNCERTAIN' as const,uncertainty:[...observation.uncertainty,'LOW_LIGHT']}:observation;
      }),ground,approach,performance:timings,
        tracking:timings.processedFrames<3?'WARMING_UP':timings.effectiveFps<1.5||this.cameraLight==='LOW_LIGHT'?'LIMITED':'TRACKING'};
      this.options.callbacks.perception?.(this.perception);
      this.reportAnalysis(this.perception.tracking==='LIMITED'?'SLOW':'LIVE');
      this.publish(finishedAt,true);
      this.frames++;
      this.inferenceMs+=performance.now()-started;
      this.detections+=detections.length;
      if(this.ocrEnabled&&!this.ocrBusy&&started-this.lastOCR>=ocrRefreshInterval(this.options.mode,this.findingDestination,this.options.config.OCRRefreshRate)){
        this.lastOCR=started;
        void this.processOCR(generation,started);
      }
      if(this.options.segmentation&&this.geometryEnabled&&!this.geometryBusy&&started-this.lastGeometry>=(this.options.segmentationIntervalMs??3000)){
        this.lastGeometry=started;void this.processGeometry(generation,started);
      }
      const targetRate=this.approachEnabled?Math.max(4,this.options.config.frameAnalysisRate):this.options.config.frameAnalysisRate;
      this.schedule(Math.max(0,1000/(targetRate/(this.lowBattery||this.slowFrames>=3?2:1))-(performance.now()-started)));
    } catch(error) {
      if(!this.running||generation!==this.generation)return;
      console.error('Basira vision provider failed',{name:error instanceof Error?error.name:'unknown'});
      this.options.callbacks.fatal(error);
      await this.stop();
    }
  }
  private publish(now:number,fromDetection=false){
    if(this.cameraUnavailable()||(!fromDetection&&!freshTimestamp(this.lastCapturedAt,now)))return;
    const objects=this.latestObjects.filter(object=>freshTimestamp(object.timestamp,now));
    const signs=this.signDetections.filter(sign=>freshTimestamp(sign.timestamp,now));
    const segmentation=this.segmentation&&freshTimestamp(this.segmentation.timestamp,now)?this.segmentation:null;
    const relativeDepth=this.relativeDepth&&now-this.relativeDepth.timestamp<2_000?this.relativeDepth:null;
    const metricDepth=!this.options.nativeFrames&&this.metricDepth&&this.metricDepth.alignmentVerified===true&&Math.abs(now-this.metricDepth.timestamp)<=500?this.metricDepth:null;
    const frame=this.fusion.fuse({objects,segmentation,relativeDepth,metricDepth,signs},now);
    const flags=this.options.safetyFlags??SAFE_DEFAULT_FLAGS;
    const allowed=frame.events.filter(event=>
      (flags.dropOffDetection||!event.type.startsWith('DROP_OFF'))&&
      (flags.stairDirection||!['STAIRS_UP','STAIRS_DOWN'].includes(event.type))&&
      (flags.experimentalObstacleClasses||!['UNKNOWN_OBSTACLE'].includes(event.type)));
    const events=this.options.mode==='NAVIGATION'
      ? [...allowed].sort((a,b)=>hazardRank(b)-hazardRank(a)).filter(event=>hazardRank(event)>=3)
      : allowed;
    const recognized=freshTimestamp(this.recognizedPlaceCapturedAt,now)?this.recognizedPlace:null;
    this.latest=this.scene.summarize(events,recognized,this.lastCaptureWallTime||Date.now()-(now-(objects[0]?.timestamp??now)),walkableAreaForLight(this.cameraLight,frame.walkableArea),frame.surfaceAnalysis);
    this.latest.cameraLight=this.cameraLight;
    this.options.callbacks.scene(this.latest);
    // Safety announcements keep priority. Ordinary object speech uses detector
    // frames and remains available when metric and segmentation engines fail.
    const safetyOnlyEvents=events.map(event=>this.safety.classify({...event,approximateDistance:null}))
      .filter(event=>event.riskLevel==='HIGH'||event.riskLevel==='CRITICAL');
    const alert=this.options.announcement.announce(safetyOnlyEvents,Date.now());
    if(alert)this.options.callbacks.alert(alert.text,alert.event.riskLevel);
    if(fromDetection&&this.cameraLight!=='LOW_LIGHT'&&(this.objectSpeechEnabled||this.approachEnabled)&&!alert&&this.options.callbacks.objectSpeech)
      this.objectSpeech.observe(objects,now,this.options.callbacks.objectSpeech,this.approachEnabled?this.perception?.approach:undefined,this.objectSpeechEnabled,this.options.callbacks.approachSpeech);
  }
  private async processGeometry(generation:number,timestamp:number){
    this.geometryBusy=true;
    const observationGeneration=this.observationGeneration;
    try{
      timestamp=performance.now();
      const frame=await this.captureCurrentFrame();
      if(!frame||!this.acceptsObservation(generation,observationGeneration,timestamp))return;
      const grid=await this.options.segmentation!.segment(frame.blob,timestamp);
      if(!this.acceptsObservation(generation,observationGeneration,timestamp)||grid.timestamp!==timestamp)return;
      this.segmentation=grid;
      this.semanticGround=this.semanticGroundEngine.observe({frameId:`seg-${timestamp}`,capturedAt:timestamp,width:grid.width,height:grid.height,segmentation:grid,lowLight:this.cameraLight==='LOW_LIGHT'},performance.now());
      // Late semantics keep their source time; never refresh the detector capture time.
      if(this.perception&&freshTimestamp(this.perception.capturedAt,performance.now())&&this.semanticGround.status==='CURRENT'&&Math.abs(this.perception.capturedAt-timestamp)<=250){
        this.perception={...this.perception,ground:{...this.perception.ground,observations:[...this.perception.ground.observations.filter(item=>item.kind!=='VISIBLE_STAIRS'),...this.semanticGround.observations]}};
        this.options.callbacks.perception?.(this.perception);
      }
      if(this.options.relativeDepth&&this.relativeDepthEnabled&&timestamp-this.lastDepth>=(this.options.depthIntervalMs??8000)){
        this.lastDepth=timestamp;
        try{
          const depth=await this.options.relativeDepth.estimate(frame.blob,timestamp);
          if(!this.acceptsObservation(generation,observationGeneration,timestamp))return;
          this.relativeDepth=depth;
        }
        catch{if(this.acceptsObservation(generation,observationGeneration,timestamp)){this.relativeDepthEnabled=false;this.relativeDepth=null;this.options.callbacks.depthFailure();}}
      }
      if(this.acceptsObservation(generation,observationGeneration,timestamp))this.publish(performance.now());
    }catch{
      if(this.acceptsObservation(generation,observationGeneration,timestamp)){this.geometryEnabled=false;this.segmentation=null;this.relativeDepth=null;this.options.callbacks.segmentationFailure();}
    }finally{this.geometryBusy=false;}
  }
  private async readDepth(detection:VisionDetection,now:number):Promise<DepthReading|null>{
    const key=detection.trackId??detection.id,previous=this.depthCache.get(key);
    if(previous&&now-previous.at<this.options.config.depthRefreshRate)return previous.reading;
    const reading=await this.options.depth.read(detection);
    this.depthCache.set(key,{reading,at:now});
    if(this.depthCache.size>100)this.depthCache.forEach((item,id)=>{if(now-item.at>this.options.config.depthRefreshRate*3)this.depthCache.delete(id);});
    return reading;
  }
  private async captureCurrentFrame():Promise<{blob:Blob;width:number;height:number}|null>{
    const native=this.options.nativeCanvas;
    if(!this.options.nativeFrames||!native)return captureFrame(this.options.video,this.options.config);
    if(!native.width||!native.height)return null;
    // Copy synchronously so the next native RGB frame cannot change this OCR/segmentation sample.
    const copy=document.createElement('canvas');copy.width=native.width;copy.height=native.height;
    const context=copy.getContext('2d');if(!context)return null;
    context.drawImage(native,0,0);
    const blob=await new Promise<Blob|null>(resolve=>copy.toBlob(resolve,'image/png'));
    const width=copy.width,height=copy.height;
    copy.width=copy.height=0;
    return blob?{blob,width,height}:null;
  }
  private async processOCR(generation:number,timestamp:number){
    this.ocrBusy=true;
    const observationGeneration=this.observationGeneration;
    try {
      timestamp=performance.now();
      const frame=await this.captureCurrentFrame();
      if(!frame||!this.acceptsObservation(generation,observationGeneration,timestamp))return;
      const readings=await this.options.ocr.recognize(frame,timestamp);
      if(!this.acceptsObservation(generation,observationGeneration,timestamp))return;
      for(const reading of readings.filter(item=>item.timestamp===timestamp&&isNavigationText(item.text)).slice(0,3)) {
        this.addSign(reading);
        const result=await this.place.recognize(reading);
        if(!this.acceptsObservation(generation,observationGeneration,timestamp))return;
        const door=this.closestDoor(reading);
        if(result.place){this.recognizedPlaceCapturedAt=timestamp;this.recognizedPlace={...result.place,doorDirection:door?.horizontalDirection};this.options.callbacks.recognized(this.recognizedPlace,timestamp);}
        if(result.candidate){
          if(door)result.candidate.doorDirection=door.horizontalDirection;
          const key=normalizePlaceText(result.candidate.detectedText);
          if(!this.seenCandidates.has(key)) {this.seenCandidates.add(key);this.options.callbacks.candidate(result.candidate);}
        }
      }
    } catch {
      if(this.acceptsObservation(generation,observationGeneration,timestamp)){this.ocrEnabled=false;this.options.callbacks.OCRFailure();}
    } finally {this.ocrBusy=false;}
  }
  private closestDoor(reading:OCRDetection):VisionDetection|null {
    if(!reading.boundingBox)return null;
    const cx=reading.boundingBox.x+reading.boundingBox.width/2;
    const doors=this.latest?.objects.filter(item=>item.type==='DOOR'&&freshTimestamp(item.timestamp,performance.now())&&Math.abs(item.timestamp-reading.timestamp)<=250&&Math.abs(item.boundingBox.x+item.boundingBox.width/2-cx)<.18&&
      reading.boundingBox!.y<item.boundingBox.y+item.boundingBox.height*.5)??[];
    return doors.sort((a,b)=>Math.abs(a.boundingBox.x+a.boundingBox.width/2-cx)-Math.abs(b.boundingBox.x+b.boundingBox.width/2-cx))[0]??null;
  }
  private addSign(reading:OCRDetection){
    if(!reading.boundingBox)return;
    const boundingBox=reading.boundingBox;
    const sign:VisionDetection={
      id:`ocr-${reading.timestamp}-${reading.text.slice(0,8)}`,type:signTypeForText(reading.text),confidence:reading.confidence,boundingBox,
      horizontalDirection:classifyDirection(boundingBox),verticalPosition:classifyVertical(boundingBox),
      approximateDistance:null,timestamp:reading.timestamp,source:'OCR_SIGN',trackId:`SIGN:${normalizePlaceText(reading.text)}`,
    };
    this.signDetections=[sign,...this.signDetections.filter(previous=>previous.trackId!==sign.trackId&&reading.timestamp-previous.timestamp<12_000)].slice(0,3);
  }
  private async watchBattery(){
    const nav=navigator as Navigator & {getBattery?:()=>Promise<{level:number;charging:boolean;addEventListener:(event:string,callback:()=>void)=>void;removeEventListener:(event:string,callback:()=>void)=>void}>};
    if(!nav.getBattery)return;
    try{const battery=await nav.getBattery();if(!this.running)return;
      const update=()=>{this.lowBattery=!battery.charging&&battery.level<=0.2;};
      battery.addEventListener('levelchange',update);battery.addEventListener('chargingchange',update);update();
      this.batteryCleanup=()=>{battery.removeEventListener('levelchange',update);battery.removeEventListener('chargingchange',update);};
    }catch{/* Battery API is optional. */}
  }
  async stop(){
    if(!this.running)return;
    this.running=false;this.generation++;
    this.autoMeterEnabled=false;this.autoMeterGeneration++;
    this.modelOpenAbort?.abort();
    this.cancelMeterRequests('OFF');
    const model=this.estimatedModel;this.estimatedModel=null;
    this.options.callbacks.estimatedMetricStatus?.('UNAVAILABLE');
    this.reportMeterDiagnostic('OFF');
    this.options.callbacks.autoMeterSnapshot?.(null);
    this.options.callbacks.pinnedMetricFrame?.(null);
    this.options.callbacks.metricStatus?.({status:'UNAVAILABLE',source:null});
    if(this.timer!==null){window.clearTimeout(this.timer);this.timer=null;}
    this.batteryCleanup?.();this.batteryCleanup=null;
    this.options.announcement.reset();
    this.objectSpeech.reset();
    this.invalidate('WAITING');this.lastVideoTime=-1;
    if(this.options.nativeFrames){
      await this.options.nativeFrames.setMeterEnabled(false).catch(()=>{});
      await this.options.nativeFrames.stop().catch(()=>{});
    }
    await Promise.allSettled([this.options.vision.close(),this.options.ocr.close(),this.options.depth.close(),
      this.options.segmentation?.close(),this.options.relativeDepth?.close(),this.options.metricDepth?.close(),model?.close(),this.modelOpening]);
    console.info('Basira vision session stopped',{frames:this.frames,detections:this.detections,averageInferenceMs:this.frames?Math.round(this.inferenceMs/this.frames):0});
    this.latest=null;this.signDetections=[];this.recognizedPlace=null;this.seenCandidates.clear();
    this.depthCache.clear();
    this.segmentation=null;this.relativeDepth=null;this.metricDepth=null;this.latestObjects=[];
  }
}
