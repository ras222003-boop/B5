import { describe, it, expect } from "vitest";
import { pointPromptsForBox,nativeBoxPrompts } from "./objectMasks";
import type { VisionDetection } from "@shared/vision";
describe("installed SlimSAM prompt contract", () => {
  it('transforms native boxes into resized coordinates without padding or a width/height swap',()=>{
    const d={boundingBox:{x:.25,y:.2,width:.5,height:.3}} as VisionDetection;
    expect(nativeBoxPrompts({width:400,height:200},[d],[512,1024])).toEqual([[256,102.4,768,256]]);
    expect(()=>nativeBoxPrompts({width:400,height:200},[{...d,boundingBox:{x:-1,y:0,width:1,height:1}}],[512,1024])).toThrow('box_contract');
    expect(()=>nativeBoxPrompts({width:400,height:200},[d],[0,1024])).toThrow('resize_contract');
  });
  it("uses supported foreground/background point labels, never unsupported native-box labels", () => {
    const d = {
        boundingBox: { x: 0.2, y: 0.3, width: 0.4, height: 0.4 },
      } as VisionDetection,
      p = pointPromptsForBox({ width: 320, height: 240 }, d);
    expect(p.labels).toEqual([1, 0, 0, 0, 0]);
    expect(p.points[0]).toEqual([128, 120]);
    expect(
      p.points.every(([x, y]) => x >= 0 && x < 320 && y >= 0 && y < 240)
    ).toBe(true);
  });
  it("keeps border prompts inside the image", () => {
    const p = pointPromptsForBox({ width: 80, height: 60 }, {
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    } as VisionDetection);
    expect(p.points[1]).toEqual([0, 0]);
    expect(p.points[4]).toEqual([79, 59]);
  });
});
