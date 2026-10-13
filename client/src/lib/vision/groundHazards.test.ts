import {describe,expect,it} from 'vitest';
import type {SegmentationGrid,VisionDetection} from '@shared/vision';
import {GroundHazardEngine,grayscalePixels,type GroundHazardFrame} from './groundHazards';
import {SEG} from './segmentation';

const frame=(capturedAt=0,changes:Partial<GroundHazardFrame>={}):GroundHazardFrame=>({
  frameId:`frame-${capturedAt}`,capturedAt,width:64,height:64,...changes,
});
const edge=(row=44)=>{
  const gray=new Uint8Array(64*64).fill(70);
  gray.fill(190,row*64);return gray;
};
const grid=(timestamp=0,code:number=SEG.FLOOR):SegmentationGrid=>({
  timestamp,width:16,height:16,labels:new Uint8Array(256).fill(code),
});
const lowerObject=(timestamp=0):VisionDetection=>({
  id:'bag',type:'BACKPACK',confidence:.8,source:'OBJECT_DETECTOR',timestamp,
  boundingBox:{x:.3,y:.6,width:.25,height:.3},horizontalDirection:'FRONT',verticalPosition:'BOTTOM',approximateDistance:null,
});
const repeat=(engine:GroundHazardEngine,changes:Partial<GroundHazardFrame>={},start=0)=>
  [start,start+300,start+600].map(at=>engine.observe(frame(at,changes),at));

describe('experimental ground visual evidence',()=>{
  it('extracts luminance without preserving RGB pixels and rejects incomplete pixels',()=>{
    const source=new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255]);
    expect([...grayscalePixels(source)]).toEqual([76,150,29]);
    expect(()=>grayscalePixels(new Uint8ClampedArray(3))).toThrow('invalid_rgba');
  });
  it('withholds a single or two-frame lower image line and then describes uncertainty without a mask',()=>{
    const snapshots=repeat(new GroundHazardEngine(),{gray:edge()});
    expect(snapshots[0].observations).toEqual([]);
    expect(snapshots[1].observations).toEqual([]);
    expect(snapshots[2].observations).toHaveLength(1);
    expect(snapshots[2].observations[0]).toMatchObject({
      kind:'POSSIBLE_GROUND_BOUNDARY',confidence:null,evidenceStrength:'TEMPORALLY_STABLE',firstSeenAt:0,lastSeenAt:600,
      uncertainty:expect.arrayContaining(['NOT_PROOF_OF_DROP_OR_STEP','SHADOW_TEXTURE_OR_REFLECTION_POSSIBLE','GROUND_SURFACE_UNVERIFIED']),
    });
    expect(snapshots[2].observations[0].labelAr).toContain('لا يمكن تأكيد أنها حافة أرضية');
  });
  it('keeps a matching semantic ground cue explicitly uncalibrated',()=>{
    const engine=new GroundHazardEngine();
    const snapshots=[0,300,600].map(at=>engine.observe(frame(at,{gray:edge(),segmentation:grid(at)}),at));
    const boundary=snapshots[2].observations[0];
    expect(boundary.evidence).toContainEqual({source:'SEMANTIC_MASK',capturedAt:600,detail:'GROUND_LABEL_BELOW_BOUNDARY'});
    expect(boundary.uncertainty).toContain('SEMANTIC_GROUND_UNCALIBRATED');
    expect(boundary.confidence).toBeNull();
  });
  it('does not turn a mask from another capture into corroborating evidence',()=>{
    const snapshots=repeat(new GroundHazardEngine(),{gray:edge(),segmentation:grid(999)});
    expect(snapshots[2].observations[0].evidence.some(e=>e.source==='SEMANTIC_MASK')).toBe(false);
    expect(snapshots[2].observations[0].uncertainty).toContain('GROUND_SURFACE_UNVERIFIED');
  });
  it('does not label stair direction, height or step count from a semantic mask',()=>{
    const stairs=grid(0,SEG.OTHER);
    for(let y=7;y<13;y++)for(let x=5;x<10;x++)stairs.labels[y*16+x]=SEG.STAIRS;
    const result=new GroundHazardEngine().observe(frame(0,{segmentation:stairs}),0);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({kind:'VISIBLE_STAIRS',confidence:null,
      uncertainty:['UNCALIBRATED_SEMANTIC_LABEL','STAIR_DIRECTION_UNKNOWN','STEP_COUNT_AND_HEIGHT_UNKNOWN']});
  });
  it('describes a lower object without claiming ground contact or distance',()=>{
    const result=new GroundHazardEngine().observe(frame(0,{detections:[lowerObject()]}),0);
    expect(result.observations[0]).toMatchObject({kind:'LOWER_IMAGE_OBJECT',confidence:null,
      uncertainty:['GROUND_CONTACT_UNKNOWN','HEIGHT_AND_DISTANCE_UNKNOWN']});
  });
  it('rejects stale, weak, malformed and upper-image objects',()=>{
    const detection=lowerObject();
    const bad=[{...detection,timestamp:1},{...detection,confidence:.5},{...detection,confidence:1.1},
      {...detection,confidence:NaN},{...detection,source:'SEGMENTATION' as const},
      {...detection,boundingBox:{x:.3,y:.1,width:.2,height:.2}},
      {...detection,boundingBox:{x:.3,y:.6,width:NaN,height:.2}}];
    expect(new GroundHazardEngine().observe(frame(0,{detections:bad}),0).observations).toEqual([]);
  });
  it('rejects low light even when an apparent boundary is persistent',()=>{
    const engine=new GroundHazardEngine();repeat(engine,{gray:edge()});
    expect(engine.observe(frame(900,{gray:edge(),lowLight:true}),900)).toMatchObject({status:'LOW_LIGHT',observations:[]});
    expect(engine.observe(frame(1200,{gray:edge()}),1200).observations).toEqual([]);
  });
  it('rejects future, over-age and duplicate captures rather than extending persistence',()=>{
    expect(new GroundHazardEngine().observe(frame(10),9).status).toBe('INVALID');
    expect(new GroundHazardEngine().observe(frame(0),1251).status).toBe('STALE');
    const engine=new GroundHazardEngine();
    engine.observe(frame(0,{gray:edge()}),0);
    expect(engine.observe(frame(300,{frameId:'frame-0',gray:edge()}),300).status).toBe('STALE');
    expect(engine.observe(frame(600,{gray:edge()}),600).observations).toEqual([]);
  });
  it('rejects nonmonotonic captures and malformed image input',()=>{
    const engine=new GroundHazardEngine();engine.observe(frame(100),100);
    expect(engine.observe(frame(99),100).status).toBe('STALE');
    for(const changes of [{width:0},{height:Infinity},{width:4096,height:4096},{gray:new Uint8Array(3)},{frameId:''}])
      expect(new GroundHazardEngine().observe(frame(0,changes),0).status).toBe('INVALID');
  });
  it('requires elapsed time as well as three unique captures',()=>{
    const engine=new GroundHazardEngine();
    for(const at of [0,1,2])expect(engine.observe(frame(at,{gray:edge()}),at).observations).toEqual([]);
  });
  it('does not carry temporal evidence across a missing boundary, a long gap or reset',()=>{
    const engine=new GroundHazardEngine();repeat(engine,{gray:edge()});
    engine.observe(frame(900,{gray:new Uint8Array(4096)}),900);
    expect(engine.observe(frame(1200,{gray:edge()}),1200).observations).toEqual([]);
    expect(engine.observe(frame(2600,{gray:edge()}),2600).observations).toEqual([]);
    engine.reset();
    expect(engine.observe(frame(0,{gray:edge()}),0).observations).toEqual([]);
  });
  it('withholds upper-image edges and densely repeated horizontal texture',()=>{
    const textured=new Uint8Array(4096);
    for(let y=0;y<64;y++)textured.fill(y%2?220:30,y*64,(y+1)*64);
    for(const gray of [edge(20),new Uint8Array(4096),textured])
      expect(repeat(new GroundHazardEngine(),{gray})[2].observations).toEqual([]);
  });
  it('does not use a malformed semantic mask or an unsupported label',()=>{
    for(const segmentation of [{...grid(),labels:new Uint8Array(1)},grid(0,255)])
      expect(new GroundHazardEngine().observe(frame(0,{segmentation}),0).observations).toEqual([]);
  });
});
