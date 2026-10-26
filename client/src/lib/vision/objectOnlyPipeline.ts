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

/** Existing Basira camera UI, object-only inference. No fusion, depth, OCR, hazards or navigation calls. */
export class ObjectOnlyPipeline {
  private running = false;
  private generation = 0;
  private timer: number | null = null;
  private lastVideoTime = -1;
  private readonly tracker: ObjectTracker;
  private readonly colors = new ObjectColorTracker();
  private readonly speech: ObjectSpeechTracker;
  private readonly telemetry = new PerceptionTelemetry();
  private objectSpeechEnabled: boolean;
  private colorSpeechEnabled: boolean;
  private _snapshot: PerceptionSnapshot | null = null;
  constructor(private readonly options: VisionPipelineOptions) {
    if (
      options.mode !== "EXPLORATION" ||
      options.nativeFrames ||
      options.vision.usagePolicy !== "EXPERIMENTAL_OBJECTS_ONLY"
    )
      throw new Error("object_only_policy_required");
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
  setExperimentalApproachEnabled(_value: boolean) {
    /* This session has no approach or safety path. */
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
    this.generation++;
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
    this._snapshot = null;
    this.options.callbacks.perception?.(null);
    this.options.callbacks.detectionFrame?.(null);
  }
  private async tick() {
    if (!this.running) return;
    const run = this.generation,
      started = performance.now(),
      video = this.options.video;
    if (video.paused || video.ended || video.readyState < 2) {
      this.clear();
      this.options.callbacks.analysisState?.("PAUSED");
      this.schedule(200);
      return;
    }
    if (video.currentTime === this.lastVideoTime) {
      if (
        this._snapshot &&
        !freshTimestamp(this._snapshot.capturedAt, started)
      ) {
        this.clear();
        this.options.callbacks.analysisState?.("STALE");
      }
      this.schedule(100);
      return;
    }
    this.lastVideoTime = video.currentTime;
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    try {
      canvas
        .getContext("2d",{willReadFrequently:true})!
        .drawImage(video, 0, 0, canvas.width, canvas.height);
      const at = performance.now(),
        frameId = `objects-${at}`,
        wallTime = Date.now(),
        pixels = sampleColorFrame(canvas, at, frameId),
        light = pixels ? assessFrameLight(pixels.data) : "UNKNOWN";
      if(pixels&&this.options.callbacks.objectSourceSignature)this.options.callbacks.objectSourceSignature(sourcePixelSignature(pixels));
      const raw = await this.options.vision.detect(canvas, at);
      if (!this.running || run !== this.generation) return;
      if (
        video.paused ||
        video.ended ||
        !freshTimestamp(at, performance.now())
      ) {
        this.clear();
        this.options.callbacks.analysisState?.("STALE");
        this.schedule(100);
        return;
      }
      // Unsupported/research stair outputs cannot be renamed into ordinary COCO objects.
      if (
        raw.some(
          d =>
            d.experimental ||
            !d.cocoClass ||
            !COCO_LABELS[d.cocoClass] ||
            d.type.startsWith("STAIRS") ||
            d.type.startsWith("DROP_OFF")
        )
      )
        throw new Error("object_only_detection_contract");
      const tracked = this.tracker.update(raw, {
        frameId,
        capturedAt: at,
        now: performance.now(),
      });
      if (tracked.rejectedFrame) {
        this.clear();
        this.schedule(100);
        return;
      }
      const detections = tracked.detections.map(d => ({
        ...d,
        color: pixels
          ? this.colors.update(
              d,
              analyzeObjectColor(pixels, d, tracked.detections)
            )
          : undefined,
      }));
      const timings = this.telemetry.record(at, performance.now());
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
        approach: [],
        performance: timings,
        tracking:
          timings.processedFrames < 3
            ? "WARMING_UP"
            : timings.effectiveFps < 1.5 || light === "LOW_LIGHT"
              ? "LIMITED"
              : "TRACKING",
      };
      this.options.callbacks.quality?.(light);
      this.options.callbacks.perception?.(this._snapshot);
      this.options.callbacks.detectionFrame?.({
        frameId,
        capturedAt: wallTime,
        width: canvas.width,
        height: canvas.height,
        detections,
      });
      this.options.callbacks.analysisState?.(
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
      this.schedule(Math.max(0, 500 - (performance.now() - started)));
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
    await this.options.vision.close();
  }
}
