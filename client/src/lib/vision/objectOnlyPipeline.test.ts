import { afterEach, describe, it, expect, vi } from "vitest";
import { ObjectOnlyPipeline } from "./objectOnlyPipeline";
import { VisionPipeline, type VisionPipelineOptions } from "./pipeline";
import { DEFAULT_VISION_CONFIG } from "./config";
import { visionMessages } from "@/i18n/locales/vision";
import type { VisionDetection } from "@shared/vision";
import { SparseOpticalFlow } from './opticalFlow';
import { DEFAULT_APPROACH_PREFERENCES } from './approachPreferences';
import { PerceptionTelemetry } from './perception';
import { AdaptiveHapticAlerts } from './adaptiveHaptics';
import type {AtomicNativeFrame} from './nativeFramePair';
const candidate = (at: number): VisionDetection => ({
  id: "cup-" + at,
  cocoClass: "cup",
  type: "UNKNOWN_OBSTACLE",
  confidence: 0.6,
  boundingBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
  horizontalDirection: "LEFT",
  verticalPosition: "MIDDLE",
  approximateDistance: null,
  timestamp: at,
  source: "OBJECT_DETECTOR",
});
function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("document", {
    createElement: () => {
      const c = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray(c.width * c.height * 4).fill(200),
          }),
        }),
      };
      return c;
    },
  });
  const video = {
    paused: false,
    ended: false,
    readyState: 2,
    currentTime: 1,
    videoWidth: 64,
    videoHeight: 48,
  };
  const callbacks = {
    scene: vi.fn(),
    alert: vi.fn(),
    objectSpeech: vi.fn(() => true),
    candidate: vi.fn(),
    recognized: vi.fn(),
    OCRFailure: vi.fn(),
    segmentationFailure: vi.fn(),
    depthFailure: vi.fn(),
    fatal: vi.fn(),
    perception: vi.fn(),
    detectionFrame: vi.fn(),
    approachRisk: vi.fn(),
    analysisState: vi.fn(),
  };
  const options = {
    video,
    vision: {
      usagePolicy: "EXPERIMENTAL_OBJECTS_ONLY",
      detect: vi.fn(async (_frame, at) => {
        video.currentTime += 0.5;
        return [candidate(at)];
      }),
      close: vi.fn(async () => {}),
    },
    config: { ...DEFAULT_VISION_CONFIG, detectionThreshold: 0.5 },
    copy: visionMessages.ar,
    mode: "EXPLORATION",
    buildingId: null,
    floorId: null,
    autoMeterEnabled: true,
    experimentalApproachEnabled: true,
    announcement: { announce: vi.fn() },
    depth: { read: vi.fn(), close: vi.fn() },
    ocr: { recognize: vi.fn(), close: vi.fn() },
    callbacks,
  } as unknown as VisionPipelineOptions;
  return { options, callbacks, video };
}
function expandingV3(options: VisionPipelineOptions, video: ReturnType<typeof setup>['video']) {
  let frame = 0;
  vi.mocked(options.vision.detect).mockImplementation(async (_image, at) => {
    video.currentTime += .25;
    const size = .22 * 1.12 ** frame++;
    return [{...candidate(at),id:'chair',cocoClass:'chair',type:'CHAIR',confidence:.96,
      horizontalDirection:'FRONT',boundingBox:{x:(1-size)/2,y:(1-size)/2,width:size,height:size},
      // A V3 response is never accepted as metric evidence, even when forged.
      approximateDistance:{distanceMeters:.2,confidence:1,source:'LIDAR'}}];
  });
  let previous: {frameId:string;capturedAt:number} | null = null;
  return vi.spyOn(SparseOpticalFlow.prototype,'update').mockImplementation((image,detections) => {
    const old = previous;
    previous = {frameId:image.frameId,capturedAt:image.capturedAt};
    return old ? detections.filter(d => d.trackId).map(d => ({
      source:'SPARSE_OPTICAL_FLOW' as const,trackId:d.trackId!,frameId:image.frameId,
      previousFrameId:old.frameId,capturedAt:image.capturedAt,previousCapturedAt:old.capturedAt,
      pointCount:16,outwardFraction:.95,backgroundPointCount:24,backgroundInlierRatio:.9,
      expansionPerSecond:.5,globalScaleChange:0,globalRotationDegrees:0,
      compensated:true,quality:'VALID' as const,
    })) : [];
  });
}
function nativeSetup(){
  const session=setup();
  const makeCanvas=()=>{
    const canvas={width:0,height:0,getContext:()=>({
      save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),drawImage:vi.fn(),
      getImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4).fill(200)}),
    })};return canvas;
  };
  vi.stubGlobal('document',{hidden:false,createElement:makeCanvas});
  vi.stubGlobal('Image',class{naturalWidth=640;naturalHeight=480;src='';decode=async()=>{};});
  const frame=():AtomicNativeFrame=>{
    const nativeTimestampMs=100_000+performance.now();
    return {
      frameId:`arkit-${nativeTimestampMs/1000}`,nativeTimestampMs,bridgeAgeMs:0,source:'ARKIT_DEPTH',
      cameraWidth:1920,cameraHeight:1440,imageBase64:'A'.repeat(256),capturedWithNativeSession:true,
      // If the experimental route ever tries to consume depth, fail the test.
      get values():number[]{throw Error('V3_must_not_read_depth');},
      depthEnabled:true,alignedToCameraFrame:true,rawDepthFresh:true,depthWidth:64,depthHeight:48,validCoverage:1,
    };
  };
  const bridge={start:vi.fn(async()=>{}),setMeterEnabled:vi.fn(async()=>{}),
    stop:vi.fn(async()=>{}),nextFrame:vi.fn(async()=>frame() as AtomicNativeFrame|null)};
  session.options.nativeFrames=bridge;
  session.options.nativeCanvas=makeCanvas() as unknown as HTMLCanvasElement;
  // There is no second WebKit camera. Native RGB must work without a playing video.
  Object.assign(session.video,{paused:true,readyState:0,videoWidth:0,videoHeight:0});
  return {...session,bridge,frame};
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("experimental objects never enter navigation", () => {
  it('requires a preview canvas for the native RGB transport',()=>{
    const {options}=nativeSetup();
    expect(()=>new ObjectOnlyPipeline({...options,nativeCanvas:undefined})).toThrow('object_only_native_canvas_required');
  });
  it.each(['audioEnabled','hapticsEnabled'] as const)(
    'runs V3 objects and relative approach on native RGB when %s is enabled, without reading depth',async preference=>{
      const {options,callbacks,video,bridge}=nativeSetup();
      options.experimentalApproachEnabled=false;
      options.approachPreferences={...DEFAULT_APPROACH_PREFERENCES,[preference]:true};
      expandingV3(options,video);
      const session=new ObjectOnlyPipeline(options);await session.start();await vi.advanceTimersByTimeAsync(2000);
      expect(bridge.start).toHaveBeenCalledOnce();
      expect(bridge.setMeterEnabled.mock.calls.every(([enabled])=>enabled===false)).toBe(true);
      expect(callbacks.fatal).not.toHaveBeenCalled();
      expect(callbacks.approachRisk.mock.calls.some(([signal])=>signal.level==='CAUTION'||signal.level==='HIGH')).toBe(true);
      expect(callbacks.detectionFrame.mock.calls.some(([frame])=>frame?.width===480&&frame.height===640&&frame.detections.length)).toBe(true);
      expect(callbacks.detectionFrame.mock.calls.filter(([frame])=>frame).every(([frame])=>frame.detections.every(d=>d.approximateDistance===null))).toBe(true);
      expect(options.depth.read).not.toHaveBeenCalled();expect(options.ocr.recognize).not.toHaveBeenCalled();
      expect(callbacks.alert).not.toHaveBeenCalled();expect(callbacks.scene).not.toHaveBeenCalled();
      expect(options.announcement.announce).not.toHaveBeenCalled();
      expect(await session.setAutoMeterEnabled(true)).toBe(false);
      await session.stop();expect(bridge.stop).toHaveBeenCalledOnce();expect(options.vision.close).toHaveBeenCalledOnce();
    }
  );
  it.each(['frame-unavailable','frame-stale','frame-repeated','document-hidden'] as const)(
    'withdraws native V3 audio/haptics cues when RGB becomes unusable: %s',async loss=>{
      const {options,callbacks,video,bridge,frame}=nativeSetup();
      options.approachPreferences={...DEFAULT_APPROACH_PREFERENCES,hapticsEnabled:true};
      const platform={capabilities:vi.fn(async()=>({supported:true,intensityControl:true,source:'NATIVE' as const})),
        pulse:vi.fn(async()=>true),test:vi.fn(async()=>true),stop:vi.fn()};
      const haptics=new AdaptiveHapticAlerts(options.approachPreferences,platform,()=>performance.now());
      await haptics.refreshCapabilities();callbacks.approachRisk.mockImplementation(signal=>haptics.update(signal));
      expandingV3(options,video);
      const session=new ObjectOnlyPipeline(options);await session.start();await vi.advanceTimersByTimeAsync(2000);
      expect(platform.pulse).toHaveBeenCalled();const stopsBefore=platform.stop.mock.calls.length;
      if(loss==='frame-unavailable')bridge.nextFrame.mockResolvedValue(null);
      else if(loss==='frame-stale')bridge.nextFrame.mockImplementation(async()=>({...frame(),bridgeAgeMs:501}));
      else if(loss==='frame-repeated'){const repeated=await bridge.nextFrame();bridge.nextFrame.mockResolvedValue(repeated);}
      else (document as unknown as {hidden:boolean}).hidden=true;
      await vi.advanceTimersByTimeAsync(loss==='frame-repeated'?600:300);
      expect(callbacks.approachRisk).toHaveBeenLastCalledWith(expect.objectContaining({level:'UNAVAILABLE'}));
      expect(callbacks.perception).toHaveBeenLastCalledWith(null);
      expect(platform.stop.mock.calls.length).toBeGreaterThan(stopsBefore);
      const pulses=platform.pulse.mock.calls.length;await vi.advanceTimersByTimeAsync(1000);
      expect(platform.pulse).toHaveBeenCalledTimes(pulses);
      await session.stop();
    }
  );
  it('does not publish a native inference that completes after camera suspension',async()=>{
    const {options,callbacks}=nativeSetup();let finish!:()=>void;
    vi.mocked(options.vision.detect).mockImplementation((_image,at)=>new Promise(resolve=>{finish=()=>resolve([candidate(at)]);}));
    const session=new ObjectOnlyPipeline(options);await session.start();await vi.advanceTimersByTimeAsync(1);
    (document as unknown as {hidden:boolean}).hidden=true;finish();await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.objectSpeech).not.toHaveBeenCalled();expect(callbacks.detectionFrame.mock.calls.every(([frame])=>frame===null)).toBe(true);
    expect(callbacks.analysisState).toHaveBeenLastCalledWith('PAUSED');await session.stop();
  });
  it('does not restart analysis when native camera permission completes after stop',async()=>{
    const {options,bridge}=nativeSetup();let finish!:()=>void;
    bridge.start.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const session=new ObjectOnlyPipeline(options);const starting=session.start();await session.stop();
    finish();await starting;await vi.advanceTimersByTimeAsync(1500);
    expect(session.active).toBe(false);expect(bridge.nextFrame).not.toHaveBeenCalled();expect(options.vision.detect).not.toHaveBeenCalled();
    expect(bridge.stop).toHaveBeenCalledOnce();expect(options.vision.close).toHaveBeenCalledOnce();
  });
  it('does not publish or speak a late inference after stop',async()=>{
    const {options,callbacks}=setup();let complete!:(detections:VisionDetection[])=>void;
    vi.mocked(options.vision.detect).mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    const session=new ObjectOnlyPipeline(options);await session.start();await vi.advanceTimersByTimeAsync(1);
    await session.stop();complete([candidate(0)]);await vi.advanceTimersByTimeAsync(2000);
    expect(session.active).toBe(false);expect(callbacks.objectSpeech).not.toHaveBeenCalled();
    expect(callbacks.perception.mock.calls.every(([p])=>p===null)).toBe(true);expect(options.vision.close).toHaveBeenCalledOnce();
  });
  it('continues detection, tracking and ordinary speech when colour pixels cannot be read',async()=>{
    const {options,callbacks}=setup();
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:()=>{},getImageData:()=>{throw Error('pixel-read-unavailable');}})})});
    const session=new ObjectOnlyPipeline(options);await session.start();await vi.advanceTimersByTimeAsync(1600);
    expect(session.active).toBe(true);expect(callbacks.fatal).not.toHaveBeenCalled();expect(options.vision.detect).toHaveBeenCalled();expect(callbacks.objectSpeech).toHaveBeenCalledOnce();expect(callbacks.objectSpeech.mock.calls[0][0]).toContain('كوب');expect(callbacks.alert).not.toHaveBeenCalled();
    await session.stop();expect(options.vision.close).toHaveBeenCalledOnce();
  });
  it("rejects research providers in the original pipeline, and rejects navigation/stairs in the object session", () => {
    const { options } = setup();
    expect(() => new VisionPipeline(options)).toThrow("Research providers");
    expect(
      () => new ObjectOnlyPipeline({ ...options, mode: "NAVIGATION" })
    ).toThrow("object_only_policy");
    expect(
      () =>
        new ObjectOnlyPipeline({
          ...options,
          vision: {
            ...options.vision,
            usagePolicy: "EXPERIMENTAL_DISPLAY_ONLY",
          },
        })
    ).toThrow("object_only_policy");
  });
  it("tracks and speaks objects at the validated research threshold while all safety/depth/OCR routes stay unused", async () => {
    const { options, callbacks } = setup(),
      session = new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(1600);
    expect(
      callbacks.perception.mock.calls.some(
        ([p]) => p?.observations[0]?.detection.tracking?.state === "TRACKED"
      )
    ).toBe(true);
    expect(callbacks.objectSpeech).toHaveBeenCalledTimes(1);
    expect(callbacks.objectSpeech.mock.calls[0][0]).toContain("كوب");
    expect(options.announcement.announce).not.toHaveBeenCalled();
    expect(callbacks.alert).not.toHaveBeenCalled();
    expect(options.depth.read).not.toHaveBeenCalled();
    expect(options.ocr.recognize).not.toHaveBeenCalled();
    expect(await session.setAutoMeterEnabled(true)).toBe(false);
    expect(await session.requestMeterNow()).toEqual({
      snapshot: null,
      diagnostic: "OFF",
    });
    await session.stop();
    expect(options.vision.close).toHaveBeenCalledOnce();
    expect(callbacks.perception).toHaveBeenLastCalledWith(null);
  });
  it("rejects a stair detection even if a provider also supplies a COCO name", async () => {
    const { options, callbacks } = setup();
    vi.mocked(options.vision.detect).mockImplementation(async (_f, at) => [
      { ...candidate(at), type: "STAIRS_UP" },
    ]);
    const session = new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.fatal).toHaveBeenCalledOnce();
    expect(callbacks.objectSpeech).not.toHaveBeenCalled();
    expect(callbacks.alert).not.toHaveBeenCalled();
  });
  it.each(['audioEnabled','hapticsEnabled'] as const)(
    'runs experimental relative approach when %s alone is enabled', async preference => {
      const {options,callbacks,video}=setup();
      options.experimentalApproachEnabled=false;
      options.approachPreferences={...DEFAULT_APPROACH_PREFERENCES,[preference]:true};
      expandingV3(options,video);
      const session=new ObjectOnlyPipeline(options);
      await session.start();
      await vi.advanceTimersByTimeAsync(2000);
      expect(callbacks.approachRisk.mock.calls.some(([signal])=>signal.level==='CAUTION'||signal.level==='HIGH')).toBe(true);
      expect(callbacks.approachRisk.mock.calls.some(([signal])=>typeof signal.text==='string')).toBe(true);
      const snapshots=callbacks.perception.mock.calls.map(([snapshot])=>snapshot).filter(Boolean);
      expect(snapshots.some(snapshot=>snapshot.approach.some(item=>item.state==='POSSIBLE_APPROACH'||item.state==='STRONG_APPROACH'))).toBe(true);
      expect(snapshots.every(snapshot=>snapshot.observations.every(item=>item.detection.approximateDistance===null))).toBe(true);
      expect(callbacks.alert).not.toHaveBeenCalled();
      expect(options.announcement.announce).not.toHaveBeenCalled();
      expect(options.depth.read).not.toHaveBeenCalled();
      await session.stop();
    }
  );
  it('keeps the trusted metric setting unavailable for V3 and strips provider distances',async()=>{
    const {options,callbacks,video}=setup();
    options.experimentalApproachEnabled=false;
    options.approachPreferences={...DEFAULT_APPROACH_PREFERENCES,audioEnabled:true,mode:'TRUSTED_METRIC'};
    const flow=expandingV3(options,video);
    const session=new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(1200);
    expect(flow).not.toHaveBeenCalled();
    expect(callbacks.approachRisk.mock.calls.length).toBeGreaterThan(0);
    expect(callbacks.approachRisk.mock.calls.every(([signal])=>signal.level==='UNAVAILABLE'&&!signal.text)).toBe(true);
    const frame=callbacks.detectionFrame.mock.calls.find(([value])=>value?.detections.length)?.[0];
    expect(frame.detections[0].approximateDistance).toBeNull();
    expect(callbacks.perception.mock.calls.filter(([value])=>value).every(([value])=>value.approach.length===0)).toBe(true);
    await session.stop();
  });
  it.each(['no-objects','paused','track-ended','track-removed'] as const)(
    'cancels approach cues when camera or tracking is lost: %s',async loss=>{
      const {options,callbacks,video}=setup();
      options.approachPreferences={...DEFAULT_APPROACH_PREFERENCES,hapticsEnabled:true};
      const platform={
        capabilities:vi.fn(async()=>({supported:true,intensityControl:true,source:'NATIVE' as const})),
        pulse:vi.fn(async()=>true),test:vi.fn(async()=>true),stop:vi.fn(),
      };
      const haptics=new AdaptiveHapticAlerts(options.approachPreferences,platform,()=>performance.now());
      await haptics.refreshCapabilities();
      callbacks.approachRisk.mockImplementation(signal=>haptics.update(signal));
      const track={readyState:'live',getSettings:()=>({})};
      let tracks=[track];
      (video as unknown as {srcObject:MediaStream}).srcObject={getVideoTracks:()=>tracks} as unknown as MediaStream;
      expandingV3(options,video);
      const session=new ObjectOnlyPipeline(options);
      await session.start();
      await vi.advanceTimersByTimeAsync(2000);
      expect(callbacks.approachRisk.mock.calls.some(([signal])=>signal.level==='CAUTION'||signal.level==='HIGH')).toBe(true);
      expect(platform.pulse).toHaveBeenCalled();
      const stopsBefore=platform.stop.mock.calls.length;
      if(loss==='no-objects')vi.mocked(options.vision.detect).mockImplementation(async()=>{video.currentTime+=.25;return [];});
      else if(loss==='paused')video.paused=true;
      else if(loss==='track-ended')track.readyState='ended';
      else tracks=[];
      await vi.advanceTimersByTimeAsync(300);
      expect(callbacks.approachRisk).toHaveBeenLastCalledWith(expect.objectContaining({level:'UNAVAILABLE'}));
      expect(platform.stop.mock.calls.length).toBeGreaterThan(stopsBefore);
      const pulsesAfterLoss=platform.pulse.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(platform.pulse).toHaveBeenCalledTimes(pulsesAfterLoss);
      if(loss!=='no-objects')expect(callbacks.perception).toHaveBeenLastCalledWith(null);
      else expect(callbacks.perception.mock.lastCall?.[0]?.approach).toEqual([]);
      await session.stop();
    }
  );
  it('withdraws V3 approach when measured tracking rate is limited',async()=>{
    const {options,callbacks,video}=setup();
    expandingV3(options,video);
    const session=new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(callbacks.approachRisk.mock.calls.some(([signal])=>signal.level==='CAUTION'||signal.level==='HIGH')).toBe(true);
    vi.spyOn(PerceptionTelemetry.prototype,'record').mockReturnValue({
      inferenceMs:700,p95InferenceMs:700,effectiveFps:1.2,processedFrames:20,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(callbacks.approachRisk).toHaveBeenLastCalledWith(expect.objectContaining({level:'UNAVAILABLE'}));
    expect(callbacks.perception.mock.lastCall?.[0]).toMatchObject({tracking:'LIMITED',approach:[]});
    await session.stop();
  });
  it('rejects a late V3 inference when the camera pauses during detection',async()=>{
    const {options,callbacks,video}=setup();
    let finish!:()=>void;
    vi.mocked(options.vision.detect).mockImplementation((_image,at)=>new Promise(resolve=>{
      finish=()=>resolve([candidate(at)]);
    }));
    const session=new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(1);
    video.paused=true;
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.analysisState).toHaveBeenLastCalledWith('PAUSED');
    expect(callbacks.approachRisk).toHaveBeenLastCalledWith(expect.objectContaining({level:'UNAVAILABLE'}));
    expect(callbacks.detectionFrame.mock.calls.every(([frame])=>frame===null)).toBe(true);
    await session.stop();
  });
  it('keeps ordinary V3 observations running if optical flow fails',async()=>{
    const {options,callbacks}=setup();
    vi.spyOn(SparseOpticalFlow.prototype,'update').mockImplementation(()=>{throw Error('flow_failed');});
    const session=new ObjectOnlyPipeline(options);
    await session.start();
    await vi.advanceTimersByTimeAsync(1100);
    expect(callbacks.fatal).not.toHaveBeenCalled();
    expect(callbacks.detectionFrame.mock.calls.some(([frame])=>frame?.detections.length)).toBe(true);
    expect(callbacks.approachRisk.mock.calls.every(([signal])=>signal.level==='UNAVAILABLE')).toBe(true);
    await session.stop();
  });
});
