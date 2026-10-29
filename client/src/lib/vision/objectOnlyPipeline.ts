import type { VisionPipelineOptions } from "./pipeline";
import type { SceneSegmentationProvider } from "@shared/vision";
import { ObjectTracker } from "./objectTracking";
import { ObjectSpeechTracker } from "./objectSpeech";
import {
  ObjectColorTracker,
  sampleColorFrame,
  analyzeObjectColor,
} from "./objectColors";
import {
  freshTimestamp,
  observationFor,
  PerceptionTelemetry,
  PERCEPTION_TTL_MS,
  type PerceptionSnapshot,
} from "./perception";
import { assessFrameLight } from "./frameQuality";
import { COCO_LABELS } from "./cocoLabels";
import {sourcePixelSignature} from './objectTrial';
import { grayscalePixels } from './groundHazards';
import { SparseOpticalFlow } from './opticalFlow';
import { VisualApproachEstimator } from './visualApproach';
import { SmartApproachRiskEngine } from './approachRisk';
import { captureNativeRgb } from './nativeRgbCapture';
import {
  DEFAULT_APPROACH_PREFERENCES,
  type ApproachPreferences,
} from './approachPreferences';

/** Existing Basira camera UI, object-only inference and optional experimental image-motion cues. No fusion, depth, OCR, hazards or navigation calls. */
export class ObjectOnlyPipeline {
  private running = false;
  private generation = 0;
  private timer: number | null = null;
  private lastVideoTime = -1;
  private lastNativeFrameId = '';
  private analysisState: 'WAITING'|'LIVE'|'STALE'|'PAUSED'|'SLOW' = 'WAITING';
  private readonly tracker: ObjectTracker;
  private readonly colors = new ObjectColorTracker();
  private readonly speech: ObjectSpeechTracker;
  private readonly telemetry = new PerceptionTelemetry();
  private readonly flow = new SparseOpticalFlow();
  private readonly approach = new VisualApproachEstimator();
  private readonly approachRisk = new SmartApproachRiskEngine();
  private manualApproachEnabled: boolean;
  private approachPreferences: ApproachPreferences;
  private objectSpeechEnabled: boolean;
  private colorSpeechEnabled: boolean;
  private _snapshot: PerceptionSnapshot | null = null;
  constructor(private readonly options: VisionPipelineOptions) {
    if (
      options.mode !== "EXPLORATION" ||
      options.vision.usagePolicy !== "EXPERIMENTAL_OBJECTS_ONLY"
    )
      throw new Error("object_only_policy_required");
    if(options.nativeFrames&&!options.nativeCanvas)throw new Error('object_only_native_canvas_required');
    this.tracker = new ObjectTracker(
      PERCEPTION_TTL_MS,
      1800,
      options.config.detectionThreshold
    );
    this.speech = new ObjectSpeechTracker(
      options.copy,
      4500,
      undefined,
      options.config.detectionThreshold,
      PERCEPTION_TTL_MS
    );
    this.objectSpeechEnabled = options.objectSpeechEnabled !== false;
    this.colorSpeechEnabled = options.colorSpeechEnabled === true;
    this.manualApproachEnabled = options.experimentalApproachEnabled === true;
    this.approachPreferences = options.approachPreferences ?? DEFAULT_APPROACH_PREFERENCES;
  }
  get snapshot() {
    return null;
  }
  get active() {
    return this.running;
  }
  setObjectSpeechEnabled(value: boolean) {
    this.objectSpeechEnabled = value;
    this.speech.reset();
  }
  setColorSpeechEnabled(value: boolean) {
    this.colorSpeechEnabled = value;
    this.speech.reset();
  }
  private get relativeApproachEnabled() {
    return (
      this.manualApproachEnabled ||
      this.approachPreferences.audioEnabled ||
      this.approachPreferences.hapticsEnabled
    ) && this.approachPreferences.mode === 'RELATIVE';
  }
  private resetApproach() {
    this.flow.reset();
    this.approach.reset();
    this.approachRisk.reset();
    if (this._snapshot?.approach.length) {
      this._snapshot = { ...this._snapshot, approach: [] };
      this.options.callbacks.perception?.(this._snapshot);
    }
    this.options.callbacks.approachRisk?.({level:'UNAVAILABLE',capturedAt:performance.now()});
  }
  setExperimentalApproachEnabled(value: boolean) {
    this.manualApproachEnabled = value;
    this.resetApproach();
  }
  setApproachPreferences(preferences: ApproachPreferences) {
    this.approachPreferences = preferences;
    this.resetApproach();
  }
  async setAutoMeterEnabled(_value: boolean) {
    return false;
  }
  async requestMeterNow() {
    return { snapshot: null, diagnostic: "OFF" as const };
  }
  setSegmentation(provider: SceneSegmentationProvider) {
    void provider.close();
  }
  async start() {
    if (this.running) return;
    this.running = true;
    const run=++this.generation;
    if(this.options.nativeFrames){
      try{
        await this.options.nativeFrames.start();
        if(!this.running||run!==this.generation)return;
        // V3 may consume the native RGB camera, never native metres or fusion.
        await this.options.nativeFrames.setMeterEnabled(false);
        if(!this.running||run!==this.generation)return;
      }catch(error){
        this.running=false;
        await this.options.nativeFrames.stop().catch(()=>{});
        throw error;
      }
    }
    this.schedule(0);
  }
  private schedule(ms: number) {
    if (this.running)
      this.timer = window.setTimeout(() => void this.tick(), ms);
  }
  private clear() {
    this.tracker.reset();
    this.colors.reset();
    this.speech.reset();
    this.resetApproach();
    this._snapshot = null;
    this.options.callbacks.perception?.(null);
    this.options.callbacks.detectionFrame?.(null);
  }
  private cameraUnavailable() {
    if(this.options.nativeFrames)return document.hidden===true;
    const video = this.options.video;
    const tracks = (video.srcObject as MediaStream | null)?.getVideoTracks?.();
    return video.paused || video.ended || video.readyState < 2 ||
      Boolean(tracks && (!tracks.length || tracks[0].readyState === 'ended'));
  }
  private reportAnalysis(state:'WAITING'|'LIVE'|'STALE'|'PAUSED'|'SLOW') {
    if (state !== this.analysisState) {
      this.analysisState = state;
      this.options.callbacks.analysisState?.(state);
    }
  }
  private async tick() {
    if (!this.running) return;
    const run = this.generation,
      started = performance.now(),
      video = this.options.video;
    if (this.cameraUnavailable()) {
      this.clear();
      this.reportAnalysis('PAUSED');
      this.schedule(200);
      return;
    }
    if (!this.options.nativeFrames && video.currentTime === this.lastVideoTime) {
      if (
        this._snapshot &&
        !freshTimestamp(this._snapshot.capturedAt, started)
      ) {
        this.clear();
        this.reportAnalysis('STALE');
      }
      this.schedule(100);
      return;
    }
    this.lastVideoTime = video.currentTime;
    const canvas = document.createElement("canvas");
    if(!this.options.nativeFrames){
      const scale=Math.min(1,640/video.videoWidth,480/video.videoHeight);
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
      canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    }
    try {
      let at=performance.now(),frameId=`objects-${at}`,wallTime=Date.now();
      if(this.options.nativeFrames){
        const captured=await captureNativeRgb(this.options.nativeFrames,canvas,this.lastNativeFrameId);
        if(!this.running||run!==this.generation)return;
        if(!captured){
          this.clear();this.reportAnalysis('STALE');this.schedule(100);return;
        }
        ({capturedAt:at,frameId,wallTime}=captured);
        this.lastNativeFrameId=frameId;
        const preview=this.options.nativeCanvas!;
        preview.width=canvas.width;preview.height=canvas.height;
        preview.getContext('2d')?.drawImage(canvas,0,0);
      }else{
        canvas.getContext('2d',{willReadFrequently:true})!.drawImage(video,0,0,canvas.width,canvas.height);
      }
      const pixels = sampleColorFrame(canvas, at, frameId),
        light = pixels ? assessFrameLight(pixels.data) : "UNKNOWN";
      const colourPixelSamplingMs=performance.now()-at;
      if(pixels&&this.options.callbacks.objectSourceSignature)this.options.callbacks.objectSourceSignature(sourcePixelSignature(pixels));
      let gray: Uint8Array | null = null;
      if (this.relativeApproachEnabled && light === 'NOT_LOW_LIGHT') {
        try {
          const grayCanvas = document.createElement('canvas');
          grayCanvas.width = 96;
          grayCanvas.height = 72;
          const context = grayCanvas.getContext('2d', {willReadFrequently:true});
          if (context) {
            context.drawImage(canvas, 0, 0, 96, 72);
            gray = grayscalePixels(context.getImageData(0, 0, 96, 72).data);
          }
          grayCanvas.width = grayCanvas.height = 0;
        } catch { gray = null; }
      }
      const raw = await this.options.vision.detect(canvas, at);
      if (!this.running || run !== this.generation) return;
      if (this.cameraUnavailable()) {
        this.clear();
        this.reportAnalysis('PAUSED');
        this.schedule(100);
        return;
      }
      if (!freshTimestamp(at, performance.now())) {
        this.clear();
        this.reportAnalysis('STALE');
        this.schedule(100);
        return;
      }
      // Unsupported/research stair outputs cannot be renamed into ordinary COCO objects.
      if (
        raw.some(
          d =>
            d.experimental ||
            d.source !== 'OBJECT_DETECTOR' ||
            !d.cocoClass ||
            !COCO_LABELS[d.cocoClass] ||
            d.type.startsWith("STAIRS") ||
            d.type.startsWith("DROP_OFF")
        )
      )
        throw new Error("object_only_detection_contract");
      // V3 has no aligned depth input. Even a provider-supplied distance cannot
      // become a measured metre or enter the ordinary scene/safety path.
      const tracked = this.tracker.update(raw.map(d => ({...d, approximateDistance:null})), {
        frameId,
        capturedAt: at,
        now: performance.now(),
      });
      if (tracked.rejectedFrame) {
        this.clear();
        this.reportAnalysis('STALE');
        this.schedule(100);
        return;
      }
      const colourStarted=performance.now();
      const detections = tracked.detections.map(d => ({
        ...d,
        color: pixels
          ? this.colors.update(
              d,
              analyzeObjectColor(pixels, d, tracked.detections)
            )
          : undefined,
      }));
      const colourAnalysisMs=performance.now()-colourStarted;
      const timings = {...this.telemetry.record(at, performance.now()),colourAnalysisMs,colourPixelSamplingMs};
      const tracking = timings.processedFrames < 3 ? 'WARMING_UP'
        : timings.effectiveFps < 1.5 || light === 'LOW_LIGHT' ? 'LIMITED' : 'TRACKING';
      const motionUsable = this.relativeApproachEnabled && tracking === 'TRACKING' &&
        light === 'NOT_LOW_LIGHT' && gray !== null;
      let approach: ReturnType<VisualApproachEstimator['update']> = [];
      let riskResult: ReturnType<SmartApproachRiskEngine['update']> | null = null;
      if (motionUsable) {
        try {
          const motion = this.flow.update({frameId,capturedAt:at,width:96,height:72,pixels:gray!},detections);
          const settings = (video.srcObject as MediaStream | null)?.getVideoTracks?.()[0]?.getSettings?.() as
            (MediaTrackSettings & {zoom?:number}) | undefined;
          approach = this.approach.update(detections,{frameId,capturedAt:at,now:performance.now(),motion,zoom:settings?.zoom});
          riskResult = this.approachRisk.update(detections,approach,{
            frameId,capturedAt:at,now:performance.now(),metricDepth:null,
            mode:'RELATIVE',sensitivity:this.approachPreferences.sensitivity,
          });
        } catch {
          // An optional image-motion failure must preserve ordinary V3 objects.
          this.flow.reset();this.approach.reset();this.approachRisk.reset();
          approach = [];
        }
      } else {
        this.flow.reset();this.approach.reset();this.approachRisk.reset();
      }
      const rank = {UNAVAILABLE:-1,NONE:0,ATTENTION:1,HIGH:2,URGENT:3};
      const top = riskResult?.risks.filter(item => rank[item.level] > 0)
        .sort((a,b) => rank[b.level]-rank[a.level] ||
          (a.approximateTtcSeconds??Infinity)-(b.approximateTtcSeconds??Infinity))[0];
      const level = top?.level === 'ATTENTION' ? 'CAUTION' : top?.level === 'URGENT' ? 'CRITICAL' :
        top?.level ?? (riskResult?.status === 'NO_APPROACH_EVIDENCE' ? 'NONE' : 'UNAVAILABLE');
      const alert = riskResult?.alert;
      const alertDetection = alert && detections.find(item => item.trackId === alert.trackId);
      const text = alert && top?.trackId === alert.trackId && alertDetection
        ? (alert.level === 'ATTENTION' ? this.options.copy.approachPossible : this.options.copy.approachStrong)(
            this.options.copy.object[alert.type],this.options.copy.direction[alertDetection.horizontalDirection])
        : undefined;
      this._snapshot = {
        frameId,
        capturedAt: at,
        completedAt: performance.now(),
        observations: detections.map(d =>
          observationFor(d, this.options.config.detectionThreshold)
        ),
        ground: {
          frameId,
          capturedAt: at,
          status: "CURRENT",
          observations: [],
        },
        approach,
        performance: timings,
        tracking,
      };
      this.options.callbacks.quality?.(light);
      this.options.callbacks.approachRisk?.({level,capturedAt:at,trackId:top?.trackId,text});
      this.options.callbacks.perception?.(this._snapshot);
      this.options.callbacks.detectionFrame?.({
        frameId,
        capturedAt: wallTime,
        width: canvas.width,
        height: canvas.height,
        detections,
      });
      this.reportAnalysis(
        this._snapshot.tracking === "LIMITED" ? "SLOW" : "LIVE"
      );
      if (this.options.callbacks.objectSpeech)
        this.speech.observe(
          detections,
          performance.now(),
          this.options.callbacks.objectSpeech,
          [],
          this.objectSpeechEnabled,
          () => false,
          this.colorSpeechEnabled
        );
      const interval = this.relativeApproachEnabled ? Math.min(250,1000/Math.max(4,this.options.config.frameAnalysisRate)) : 500;
      this.schedule(Math.max(0, interval - (performance.now() - started)));
    } catch (error) {
      if (this.running && run === this.generation) {
        this.options.callbacks.fatal(error);
        await this.stop();
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  async stop() {
    this.running = false;
    this.generation++;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.clear();
    if(this.options.nativeFrames){
      await this.options.nativeFrames.setMeterEnabled(false).catch(()=>{});
      await this.options.nativeFrames.stop().catch(()=>{});
    }
    await this.options.vision.close();
  }
}
