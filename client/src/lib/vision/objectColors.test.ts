import { describe, it, expect, vi } from "vitest";
import type { VisionDetection } from "@shared/vision";
import {
  analyzeObjectColor,
  hsvLabel,
  ObjectColorTracker,
  colorDescription,
  type ColorPixels,
  sampleColorFrame,
} from "./objectColors";
import { COCO_LABELS } from "./cocoLabels";
const detection = {
  id: "one",
  type: "CHAIR",
  cocoClass: "chair",
  confidence: 0.9,
  boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  source: "OBJECT_DETECTOR",
  timestamp: 1,
  trackId: "stable-1",
  tracking: { state: "TRACKED", observations: 3 },
} as VisionDetection;
function pixels(fg: number[], background = [30, 180, 70]): ColorPixels {
  const width = 100,
    height = 100,
    data = new Uint8ClampedArray(40000);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = x >= 20 && x < 80 && y >= 20 && y < 80 ? fg : background;
      data.set([...p, 255], (y * width + x) * 4);
    }
  return { width, height, data, timestamp: 1, frameId: "frame-1" };
}
describe("conservative per-object pixel colour", () => {
  it('uses measured Lab contrast rather than rejecting every same-name background',()=>{
    const out=analyzeObjectColor(pixels([30,30,30],[65,65,65]),detection);
    expect(out.name).toBe('black');expect(out.quality?.backgroundSeparation).toBeGreaterThan(12);expect(out.calibrated).toBe(false);
  });
  it('does not reject a well-exposed small object just because most of the scene is dark',()=>{
    const p=pixels([0,0,0],[0,0,0]);for(let y=45;y<55;y++)for(let x=45;x<55;x++)p.data.set([205,25,25,255],(y*100+x)*4);
    expect(analyzeObjectColor(p,{...detection,boundingBox:{x:.45,y:.45,width:.1,height:.1}}).name).toBe('red');
  });
  it('does not describe neutral shading/window modes as a proven multicoloured material',()=>{
    const p=pixels([25,25,25]);for(let y=20;y<80;y++)for(let x=50;x<80;x++)p.data.set([140,140,140,255],(y*100+x)*4);
    expect(analyzeObjectColor(p,detection).name).toBeNull();
  });
  it('separates dark saturated blue from neutral black, and keeps colour quality independent of detector score',()=>{
    const frame=pixels([6,12,45]);const a=analyzeObjectColor(frame,detection),b=analyzeObjectColor(frame,{...detection,confidence:.1});
    expect(a.name).toBe('blue');expect(a.quality).toEqual(b.quality);expect(a.quality?.score).toBeLessThanOrEqual(1);
  });
  it('reports missing boundary context as a limited estimate, never an instance mask',()=>{
    const out=analyzeObjectColor(pixels([200,20,20],[200,20,20]),{...detection,boundingBox:{x:0,y:0,width:1,height:1}});
    expect(out.name).toBe('red');expect(out.reason).toBe('BOX_ESTIMATE');expect(out.quality?.score).toBeLessThanOrEqual(.5);expect(out.quality?.contextSamples).toBe(0);
  });
  it('recovers after one ambiguous frame without carrying a colour through that frame or identity swaps',()=>{
    const tracker=new ObjectColorTracker(),c=analyzeObjectColor(pixels([200,20,20]),detection);
    for(const at of [1,200,400])tracker.update(detection,{...c,timestamp:at});
    expect(tracker.update(detection,{...c,name:null,status:'UNCLEAR',reason:'BACKGROUND_AMBIGUOUS',timestamp:600}).name).toBeNull();
    expect(tracker.update(detection,{...c,timestamp:800}).name).toBe('red');
    expect(tracker.update({...detection,cocoClass:'car'},{...c,timestamp:1000}).name).toBeNull();
    expect(tracker.update(detection,{...c,timestamp:1000}).name).toBeNull();
  });
  it('does not let a canvas pixel-read failure stop the detector/camera caller',()=>{
    const canvas={width:1,height:1,getContext:()=>({drawImage:()=>{},getImageData:()=>{throw Error('tainted-or-unavailable-pixels');}})};
    vi.stubGlobal('document',{createElement:()=>canvas});
    try{expect(sampleColorFrame({width:100,height:100} as HTMLCanvasElement,1,'f')).toBeNull();expect(canvas.width).toBe(0);}finally{vi.unstubAllGlobals();}
  });
  it('describes a conservative shade and both major colours, rather than averaging them into a new colour',()=>{
    const p=pixels([20,40,160]);
    const result=analyzeObjectColor(p,detection);
    expect(result.name).toBe('blue');expect(result.shade).toBe('DARK');
    for(let y=20;y<80;y++)for(let x=20;x<50;x++)p.data.set([200,20,20,255],(y*100+x)*4);
    const mixed=analyzeObjectColor(p,detection);
    expect(mixed.name).toBe('multicolor');expect(new Set(mixed.components)).toEqual(new Set(['red','blue']));
    const description=colorDescription({...detection,cocoClass:'chair',color:mixed});expect(description).toContain('أحمر');expect(description).toContain('أزرق');
  });
  it('keeps a stable colour while requiring evidence for a changed shade',()=>{
    const tracker=new ObjectColorTracker(),d={...detection,trackId:'t',tracking:{state:'TRACKED' as const,observations:5,firstSeenAt:0,lastSeenAt:10,gapMs:1}};
    const c=analyzeObjectColor(pixels([20,40,160]),d);c.timestamp=1;
    tracker.update(d,c);tracker.update(d,{...c,timestamp:200});expect(tracker.update(d,{...c,timestamp:400}).name).toBe('blue');
    const changed=tracker.update(d,{...c,timestamp:600,shade:'LIGHT'});expect(changed.name).toBe('blue');expect(changed.shade).toBeUndefined();
    expect(tracker.update(d,{...c,timestamp:800,shade:'LIGHT'}).name).toBe('blue');
    expect(tracker.update(d,{...c,timestamp:1000,shade:'LIGHT'}).shade).toBe('LIGHT');
  });
  it("covers all 80 actual COCO labels without manufacturing unsupported categories", () => {
    expect(Object.keys(COCO_LABELS)).toHaveLength(80);
    expect(COCO_LABELS.cup.ar).toBe("كوب");
    expect(COCO_LABELS.stairs).toBeUndefined();
  });
  it("distinguishes the eleven basic colours from foreground pixels", () => {
    for (const [name, rgb] of Object.entries({
      red: [200, 20, 20],
      blue: [20, 40, 200],
      green: [20, 160, 40],
      yellow: [225, 225, 20],
      orange: [225, 110, 20],
      purple: [120, 20, 170],
      pink: [235, 130, 180],
      black: [25, 25, 25],
      white: [235, 235, 235],
      gray: [130, 130, 130],
      brown: [100, 60, 20],
    })) {
      expect(hsvLabel(...(rgb as [number, number, number]))).toBe(name);
      const result = analyzeObjectColor(
        pixels(rgb, name === "green" ? [200, 30, 30] : [30, 180, 70]),
        detection
      );
      expect(result.name).toBe(name);
      expect(result.status).toBe("ESTIMATED");
      expect(result.calibrated).toBe(false);
    }
  });
  it("abstains on low light, clipping, same-colour backgrounds and tiny targets", () => {
    expect(
      analyzeObjectColor(pixels([10, 10, 10], [15, 15, 15]), detection).reason
    ).toBe("LOW_LIGHT");
    expect(
      analyzeObjectColor(pixels([255, 255, 255]), detection).name
    ).toBeNull();
    expect(
      analyzeObjectColor(pixels([200, 20, 20], [200, 20, 20]), detection).reason
    ).toBe("BACKGROUND_AMBIGUOUS");
    expect(
      analyzeObjectColor(pixels([200, 20, 20]), {
        ...detection,
        boundingBox: { x: 0.1, y: 0.1, width: 0.02, height: 0.02 },
      }).reason
    ).toBe("TOO_SMALL");
  });
  it("treats neutral black under moderate illumination as black without erasing saturated dark blue", () => {
    for (const pixel of [
      [25, 25, 25],
      [45, 50, 58],
      [55, 56, 60],
    ])
      expect(hsvLabel(...(pixel as [number, number, number]))).toBe("black");
    expect(hsvLabel(20, 40, 120)).toBe("blue");
  });
  it("rejects occlusion, and only accepts a mask associated with the exact instance/frame", () => {
    const frame = pixels([210, 30, 30]);
    expect(
      analyzeObjectColor(frame, detection, [{ ...detection, id: "occluder" }])
        .name
    ).toBeNull();
    const mask = {
      objectId: "stable-1",
      frameId: "frame-1",
      width: 100,
      height: 100,
      data: new Uint8Array(10000).fill(1),
      source: "INSTANCE_SEGMENTATION" as const,
      alignmentVerified: true as const,
    };
    expect(
      analyzeObjectColor(frame, detection, [], { ...mask, frameId: "old" }).name
    ).toBeNull();
    // Mask selects only the known foreground, never the test background.
    mask.data.fill(0);
    for (let y = 20; y < 80; y++)
      for (let x = 20; x < 80; x++) mask.data[y * 100 + x] = 1;
    expect(analyzeObjectColor(frame, detection, [], mask).status).toBe(
      "MASK_SUPPORTED"
    );
  });
  it("reports multicolour for two strong foreground regions, but not specular glare", () => {
    const frame = pixels([210, 20, 20]);
    for (let y = 20; y < 80; y++)
      for (let x = 50; x < 80; x++)
        frame.data.set([20, 30, 210, 255], (y * 100 + x) * 4);
    expect(analyzeObjectColor(frame, detection).name).toBe("multicolor");
    for (let y = 20; y < 80; y++)
      for (let x = 50; x < 80; x++)
        frame.data.set([255, 255, 255, 255], (y * 100 + x) * 4);
    expect(analyzeObjectColor(frame, detection).reason).toBe(
      "CLIPPED_OR_REFLECTIVE"
    );
  });
  it("requires three new valid tracked frames and drops an invalid or genuinely changing colour", () => {
    const tracker = new ObjectColorTracker(),
      red = analyzeObjectColor(pixels([200, 20, 20]), detection);
    expect(tracker.update(detection, red).name).toBeNull();
    expect(
      tracker.update(detection, { ...red, timestamp: 200 }).name
    ).toBeNull();
    expect(tracker.update(detection, { ...red, timestamp: 400 }).name).toBe(
      "red"
    );
    const blue = { ...red, name: "blue" as const, timestamp: 600 };
    expect(tracker.update(detection, blue).reason).toBe("CHANGING");
    expect(
      tracker.update(detection, { ...blue, timestamp: 800 }).name
    ).toBeNull();
    expect(tracker.update(detection, { ...blue, timestamp: 1000 }).name).toBe(
      "blue"
    );
    expect(
      tracker.update(detection, {
        ...blue,
        name: null,
        status: "UNCLEAR",
        reason: "LOW_LIGHT",
        timestamp: 1200,
      }).name
    ).toBeNull();
    expect(
      tracker.update(
        {
          ...detection,
          tracking: { ...detection.tracking!, state: "AMBIGUOUS" },
        },
        { ...red, timestamp: 1400 }
      ).name
    ).toBeNull();
  });
  it("uses feminine Arabic colours and names uncertainty explicitly", () => {
    expect(
      colorDescription({
        ...detection,
        cocoClass: "handbag",
        color: { name: "red", status: "ESTIMATED" } as never,
      })
    ).toContain("حمراء");
    expect(
      colorDescription({
        ...detection,
        color: { name: null, reason: "LOW_LIGHT" } as never,
      })
    ).toContain("ضعف الإضاءة");
  });
});
