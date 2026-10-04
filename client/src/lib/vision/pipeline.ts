import type { DepthProvider, DepthReading, MetricDepthMap, MetricDepthProvider, OCRDetection, OCRProvider, PlaceCandidate, RecognizedPlace, RelativeDepthMap, RelativeDepthProvider, SceneDescription, SceneSegmentationProvider, SegmentationGrid, VisionDetection, VisionMode, VisionProvider } from '@shared/vision';
import type { VisionConfig } from './config';
import type { Place } from '@shared/navigation';
import { captureFrame } from './camera';
import { BasiraSafetyEngine, classifyDirection, classifyVertical } from './safety';
import { isNavigationText, normalizePlaceText, signTypeForText, VisualPlaceRecognitionService } from './placeRecognition';
import { SceneUnderstandingService, VisionAnnouncementService, type VisionCopy } from './scene';
import { VisionFusionEngine } from './fusion';
import { hazardRank } from '@/lib/guidance/safety';

interface Callbacks {
  scene:(description:SceneDescription)=>void;
  alert:(text:string,risk:SceneDescription['riskLevel'])=>void;
  candidate:(candidate:PlaceCandidate)=>void;
  recognized:(place:RecognizedPlace)=>void;
  OCRFailure:()=>void;
  segmentationFailure:()=>void;
  depthFailure:()=>void;
  fatal:(error:unknown)=>void;
}
export interface VisionPipelineOptions {
  video:HTMLVideoElement; vision:VisionProvider; ocr:OCRProvider; depth:DepthProvider;
  segmentation?:SceneSegmentationProvider;relativeDepth?:RelativeDepthProvider;metricDepth?:MetricDepthProvider;
  segmentationIntervalMs?:number;depthIntervalMs?:number;
  config:VisionConfig; copy:VisionCopy; mode:VisionMode;
  buildingId:string|null; floorId:string|null;
  localPlaces?:Place[];
  announcement:VisionAnnouncementService; callbacks:Callbacks;
}

/** Camera -> detector -> scene/safety; sparse OCR runs separately so it cannot block safety frames. */
export class VisionPipeline {
  private running=false;
  private timer:number|null=null;
  private generation=0;
  private ocrBusy=false;
  private ocrEnabled=true;
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
  private latestObjects:VisionDetection[]=[];
  private readonly safety:BasiraSafetyEngine;
  private readonly fusion:VisionFusionEngine;
  private readonly scene:SceneUnderstandingService;
  private readonly place:VisualPlaceRecognitionService;
  private frames=0;
  private inferenceMs=0;
  private detections=0;
  constructor(private readonly options:VisionPipelineOptions) {
    this.safety=new BasiraSafetyEngine(options.config);
    this.fusion=new VisionFusionEngine(this.safety);
    this.scene=new SceneUnderstandingService(options.copy);
    this.place=new VisualPlaceRecognitionService(options.buildingId,options.floorId,options.localPlaces);
  }
  get snapshot(){return this.latest;}
  get active(){return this.running;}
  async start(){
    if(this.running)return;
    this.running=true;
    this.generation++;
    console.info('Basira vision session started',{mode:this.options.mode});
    this.watchBattery();
    this.schedule(0);
  }
  private schedule(ms:number){ if(this.running)this.timer=window.setTimeout(()=>void this.tick(),ms); }
  private async tick(){
    this.timer=null;
    if(!this.running)return;
    const generation=this.generation;
    const started=performance.now();
    try {
      if(this.options.video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA){this.schedule(250);return;}
      const detections=await this.options.vision.detect(this.options.video,started);
      if(!this.running||generation!==this.generation)return;
      const enriched=await Promise.all(detections.map(async detection=>({ ...detection,approximateDistance:await this.readDepth(detection,started) })));
      if(!this.running||generation!==this.generation)return;
      this.latestObjects=enriched;
      this.publish(started);
      this.frames++;
      this.inferenceMs+=performance.now()-started;
      this.detections+=detections.length;
      if(this.ocrEnabled&&!this.ocrBusy&&started-this.lastOCR>=this.options.config.OCRRefreshRate){
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
    const metricDepth=this.metricDepth&&now-this.metricDepth.timestamp<2_000?this.metricDepth:null;
    const frame=this.fusion.fuse({objects:this.latestObjects,segmentation,relativeDepth,metricDepth,signs});
    const events=this.options.mode==='NAVIGATION'
      ? [...frame.events].sort((a,b)=>hazardRank(b)-hazardRank(a)).filter(event=>hazardRank(event)>=3)
      : frame.events;
    this.latest=this.scene.summarize(events,this.recognizedPlace,Date.now(),frame.walkableArea);
    this.options.callbacks.scene(this.latest);
    const alert=this.options.announcement.announce(this.options.mode==='NAVIGATION'?events:frame.events,Date.now());
    if(alert)this.options.callbacks.alert(alert.text,alert.event.riskLevel);
  }
  private async processGeometry(generation:number,timestamp:number){
    this.geometryBusy=true;
    try{
      const frame=await captureFrame(this.options.video,this.options.config);
      if(!frame||!this.running||generation!==this.generation)return;
      const grid=await this.options.segmentation!.segment(frame.blob,timestamp);
      if(!this.running||generation!==this.generation)return;
      this.segmentation=grid;
      if(this.options.metricDepth){
        try{this.metricDepth=await this.options.metricDepth.capture(timestamp);}catch{this.metricDepth=null;this.options.callbacks.depthFailure();}
      }
      if(!this.metricDepth&&this.options.relativeDepth&&this.relativeDepthEnabled&&timestamp-this.lastDepth>=(this.options.depthIntervalMs??8000)){
        this.lastDepth=timestamp;
        try{this.relativeDepth=await this.options.relativeDepth.estimate(frame.blob,timestamp);}
        catch{this.relativeDepthEnabled=false;this.relativeDepth=null;this.options.callbacks.depthFailure();}
      }
      if(this.running&&generation===this.generation)this.publish(performance.now());
    }catch{
      if(this.running&&generation===this.generation){this.geometryEnabled=false;this.segmentation=null;this.metricDepth=null;this.relativeDepth=null;this.options.callbacks.segmentationFailure();}
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
  private async processOCR(generation:number,timestamp:number){
    this.ocrBusy=true;
    try {
      const frame=await captureFrame(this.options.video,this.options.config);
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
    if(this.timer!==null){window.clearTimeout(this.timer);this.timer=null;}
    this.batteryCleanup?.();this.batteryCleanup=null;
    this.options.announcement.reset();
    await Promise.allSettled([this.options.vision.close(),this.options.ocr.close(),this.options.depth.close(),
      this.options.segmentation?.close(),this.options.relativeDepth?.close(),this.options.metricDepth?.close()]);
    console.info('Basira vision session stopped',{frames:this.frames,detections:this.detections,averageInferenceMs:this.frames?Math.round(this.inferenceMs/this.frames):0});
    this.latest=null;this.signDetections=[];this.recognizedPlace=null;this.seenCandidates.clear();
    this.depthCache.clear();
    this.segmentation=null;this.relativeDepth=null;this.metricDepth=null;this.latestObjects=[];
  }
}
