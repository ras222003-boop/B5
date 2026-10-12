import type { DepthProvider, DepthReading, EstimatedMetricDepthProvider, MetricDepthMap, MetricDepthProvider, OCRDetection, OCRProvider, PlaceCandidate, RecognizedPlace, RelativeDepthMap, RelativeDepthProvider, SceneDescription, SceneSegmentationProvider, SegmentationGrid, VisionDetection, VisionMode, VisionProvider, WalkableAreaResult } from '@shared/vision';
import type { VisionConfig } from './config';
import type { Place } from '@shared/navigation';
import { captureFrame } from './camera';
import { BasiraSafetyEngine, classifyDirection, classifyVertical } from './safety';
import { isNavigationText, normalizePlaceText, signTypeForText, VisualPlaceRecognitionService } from './placeRecognition';
import { SceneUnderstandingService, VisionAnnouncementService, type VisionCopy } from './scene';
import { VisionFusionEngine } from './fusion';
import { hazardRank } from '@/lib/guidance/safety';
import { sampleFrameLight, type FrameLightStatus } from './frameQuality';
import { SAFE_DEFAULT_FLAGS, type SafetyFlags } from '@shared/safetyFlags';
import { metricDiagnostic, type MetricDiagnostic } from './metricEngine';
import { checkAtomicFrame, checkAtomicRgbFrame, rotateNativeDepthClockwise } from './nativeFramePair';
import { measureAutoMeterObjects, measureEstimatedObjects, type AutoMeterSnapshot } from './autoMeter';
import {meterErrorCode,type MeterDiagnostic} from './meterDiagnostics';

interface Callbacks {
  scene:(description:SceneDescription)=>void;
  detectionFrame?:(frame:LiveDetectionFrame)=>void;
  alert:(text:string,risk:SceneDescription['riskLevel'])=>void;
  candidate:(candidate:PlaceCandidate)=>void;
  recognized:(place:RecognizedPlace)=>void;
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
  estimatedMetricModel?:()=>Promise<EstimatedMetricDepthProvider>;
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
  private running=false;
  private timer:number|null=null;
  private generation=0;
  private ocrBusy=false;
  private ocrEnabled=true;
  private findingDestination=false;
  private lastOCR=Number.NEGATIVE_INFINITY;
  private lowBattery=false;
  private batteryCleanup:(()=>void)|null=null;
  private recognizedPlace:RecognizedPlace|null=null;
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
  private autoMeterGeneration=0;
  private lastNativeFrameId='';
  private estimatedModel:EstimatedMetricDepthProvider|null=null;
  private modelOpening:Promise<void>|null=null;
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
    this.autoMeterEnabled=options.autoMeterEnabled===true;
    this.safety=new BasiraSafetyEngine(options.config);
    this.fusion=new VisionFusionEngine(this.safety);
    this.scene=new SceneUnderstandingService(options.copy);
    this.place=new VisualPlaceRecognitionService(options.buildingId,options.floorId,options.localPlaces);
  }
  get snapshot(){return this.latest;}
  get active(){return this.running;}
  setFindingDestination(active:boolean){this.findingDestination=active;}
  setAlertDistanceMeters(value:number){this.safety.setAlertDistanceMeters(value);}
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
    }else if(this.autoMeterEnabled)void this.startMetricModel();
    console.info('Basira vision session started',{mode:this.options.mode});
    this.watchBattery();
    this.schedule(0);
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
    const openedAt=performance.now();
    this.reportMeterDiagnostic('MODEL_LOADING');
    const opening=this.options.estimatedMetricModel().then(async model=>{
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
  }
  private async processEstimatedMetric(frame:HTMLCanvasElement,detections:VisionDetection[],timestamp:number,capturedAt:number,generation:number,meterGeneration:number){
    this.modelBusy=true;
    const inferenceStarted=performance.now();
    try{
      const map=await this.estimatedModel!.estimate(frame,timestamp);
      if(!this.running||generation!==this.generation||meterGeneration!==this.autoMeterGeneration||!this.autoMeterEnabled)return;
      if(performance.now()-timestamp>6000){
        this.options.callbacks.autoMeterSnapshot?.(null);
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
          this.options.callbacks.autoMeterSnapshot?.(null);
          this.options.callbacks.pinnedMetricFrame?.(null);
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
      }else if(this.options.video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA){this.schedule(250);return;}
      if(!this.options.nativeFrames&&started-this.lastLightCheck>=3000){
        this.lastLightCheck=started;
        const previous=this.cameraLight;
        this.cameraLight=sampleFrameLight(this.options.video);
        if(previous!==this.cameraLight)this.options.callbacks.quality?.(this.cameraLight);
      }
      if(!this.options.nativeFrames&&this.autoMeterEnabled&&(this.estimatedModel||this.modelOpening)&&this.cameraLight!=='NOT_LOW_LIGHT'){
        this.options.callbacks.autoMeterSnapshot?.(null);
        this.options.callbacks.estimatedMetricStatus?.(this.cameraLight==='LOW_LIGHT'?'LOW_LIGHT':'UNAVAILABLE');
        const diagnostic=this.cameraLight==='LOW_LIGHT'?'LOW_LIGHT':'WAITING_CAMERA';
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
          this.options.callbacks.autoMeterSnapshot?.(null);
          this.options.callbacks.pinnedMetricFrame?.(null);
          this.options.callbacks.estimatedMetricStatus?.('WAITING');
          this.reportMeterDiagnostic('FRAME_PROCESSING');
        }
        else metricFrame=null;
      }
      const detections=await this.options.vision.detect(detectionFrame,detectorTimestamp);
      if(!this.running||generation!==this.generation)return;
      const frameId=this.options.nativeFrames?nativeFrameId:`web-${detectorTimestamp}`;
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
      this.latestObjects=enriched;
      this.publish(started);
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
      this.schedule(Math.max(0,1000/(this.options.config.frameAnalysisRate/(this.lowBattery?2:1))-(performance.now()-started)));
    } catch(error) {
      if(!this.running||generation!==this.generation)return;
      console.error('Basira vision provider failed',{name:error instanceof Error?error.name:'unknown'});
      this.options.callbacks.fatal(error);
      await this.stop();
    }
  }
  private publish(now:number){
    const signs=this.signDetections.filter(sign=>now-sign.timestamp<12_000);
    const segmentation=this.segmentation&&now-this.segmentation.timestamp<10_000?this.segmentation:null;
    const relativeDepth=this.relativeDepth&&now-this.relativeDepth.timestamp<2_000?this.relativeDepth:null;
    const metricDepth=!this.options.nativeFrames&&this.metricDepth&&this.metricDepth.alignmentVerified===true&&Math.abs(now-this.metricDepth.timestamp)<=500?this.metricDepth:null;
    const frame=this.fusion.fuse({objects:this.latestObjects,segmentation,relativeDepth,metricDepth,signs});
    const flags=this.options.safetyFlags??SAFE_DEFAULT_FLAGS;
    const allowed=frame.events.filter(event=>
      (flags.dropOffDetection||!event.type.startsWith('DROP_OFF'))&&
      (flags.stairDirection||!['STAIRS_UP','STAIRS_DOWN'].includes(event.type))&&
      (flags.experimentalObstacleClasses||!['UNKNOWN_OBSTACLE'].includes(event.type)));
    const events=this.options.mode==='NAVIGATION'
      ? [...allowed].sort((a,b)=>hazardRank(b)-hazardRank(a)).filter(event=>hazardRank(event)>=3)
      : allowed;
    this.latest=this.scene.summarize(events,this.recognizedPlace,Date.now(),walkableAreaForLight(this.cameraLight,frame.walkableArea),frame.surfaceAnalysis);
    this.latest.cameraLight=this.cameraLight;
    this.options.callbacks.scene(this.latest);
    // Medium-information objects remain available for an on-demand scene summary.
    // Automatic audio is reserved for safety hazards and named objects within the configured metric range.
    // Experimental object-to-depth association is NOT a certified obstacle
    // alarm. Keep spoken measurements in on-demand descriptions only.
    const safetyOnlyEvents=events.map(event=>this.safety.classify({...event,approximateDistance:null}))
      .filter(event=>event.riskLevel==='HIGH'||event.riskLevel==='CRITICAL');
    const alert=this.options.announcement.announce(safetyOnlyEvents,Date.now());
    if(alert)this.options.callbacks.alert(alert.text,alert.event.riskLevel);
  }
  private async processGeometry(generation:number,timestamp:number){
    this.geometryBusy=true;
    try{
      const frame=await this.captureCurrentFrame();
      if(!frame||!this.running||generation!==this.generation)return;
      const grid=await this.options.segmentation!.segment(frame.blob,timestamp);
      if(!this.running||generation!==this.generation)return;
      this.segmentation=grid;
      if(this.options.relativeDepth&&this.relativeDepthEnabled&&timestamp-this.lastDepth>=(this.options.depthIntervalMs??8000)){
        this.lastDepth=timestamp;
        try{this.relativeDepth=await this.options.relativeDepth.estimate(frame.blob,timestamp);}
        catch{this.relativeDepthEnabled=false;this.relativeDepth=null;this.options.callbacks.depthFailure();}
      }
      if(this.running&&generation===this.generation)this.publish(performance.now());
    }catch{
      if(this.running&&generation===this.generation){this.geometryEnabled=false;this.segmentation=null;this.relativeDepth=null;this.options.callbacks.segmentationFailure();}
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
    try {
      const frame=await this.captureCurrentFrame();
      if(!frame||!this.running||generation!==this.generation)return;
      const readings=await this.options.ocr.recognize(frame,timestamp);
      if(!this.running||generation!==this.generation)return;
      for(const reading of readings.filter(item=>isNavigationText(item.text)).slice(0,3)) {
        this.addSign(reading);
        const result=await this.place.recognize(reading);
        if(!this.running||generation!==this.generation)return;
        const door=this.closestDoor(reading);
        if(result.place){this.recognizedPlace={...result.place,doorDirection:door?.horizontalDirection};this.options.callbacks.recognized(this.recognizedPlace);}
        if(result.candidate){
          if(door)result.candidate.doorDirection=door.horizontalDirection;
          const key=normalizePlaceText(result.candidate.detectedText);
          if(!this.seenCandidates.has(key)) {this.seenCandidates.add(key);this.options.callbacks.candidate(result.candidate);}
        }
      }
    } catch {
      if(this.running&&generation===this.generation){this.ocrEnabled=false;this.options.callbacks.OCRFailure();}
    } finally {this.ocrBusy=false;}
  }
  private closestDoor(reading:OCRDetection):VisionDetection|null {
    if(!reading.boundingBox)return null;
    const cx=reading.boundingBox.x+reading.boundingBox.width/2;
    const doors=this.latest?.objects.filter(item=>item.type==='DOOR'&&Math.abs(item.boundingBox.x+item.boundingBox.width/2-cx)<.18&&
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
