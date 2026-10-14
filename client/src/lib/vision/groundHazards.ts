import type {BoundingBox, SegmentationGrid, VisionDetection} from '@shared/vision';
import {isGround, isValidSegmentationGrid, SEG, semanticRegions} from './segmentation';

export type GroundHazardKind = 'VISIBLE_STAIRS' | 'POSSIBLE_GROUND_BOUNDARY' | 'LOWER_IMAGE_OBJECT';
export interface GroundEvidence {
  source: 'SEMANTIC_MASK' | 'IMAGE_GRADIENT' | 'OBJECT_DETECTOR' | 'TEMPORAL_PERSISTENCE';
  capturedAt: number;
  detail: string;
}
export interface GroundHazardObservation {
  id: string;
  kind: GroundHazardKind;
  boundingBox: BoundingBox;
  firstSeenAt: number;
  lastSeenAt: number;
  /** No calibrated probability is available for these visual cues. */
  confidence: null;
  evidenceStrength: 'SINGLE_FRAME' | 'TEMPORALLY_STABLE';
  evidence: GroundEvidence[];
  uncertainty: string[];
  labelAr: string;
}
export interface GroundHazardFrame {
  frameId: string;
  /** All timestamps use the same monotonic performance.now() clock. */
  capturedAt: number;
  width: number;
  height: number;
  gray?: Uint8Array | Uint8ClampedArray;
  segmentation?: SegmentationGrid | null;
  detections?: readonly VisionDetection[];
  lowLight?: boolean;
}
export interface GroundHazardSnapshot {
  frameId: string;
  capturedAt: number;
  status: 'CURRENT' | 'STALE' | 'INVALID' | 'LOW_LIGHT';
  observations: GroundHazardObservation[];
}
type Candidate = Omit<GroundHazardObservation, 'id' | 'firstSeenAt' | 'lastSeenAt' | 'confidence' | 'evidenceStrength'>;
type Track = {id: string; candidate: Candidate; firstAt: number; lastAt: number; seen: number};
export const GROUND_MAX_AGE_MS = 1250;
const validBox = (b: BoundingBox) => [b.x,b.y,b.width,b.height].every(Number.isFinite) &&
  b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x+b.width <= 1.001 && b.y+b.height <= 1.001;
const centerDistance = (a: BoundingBox,b: BoundingBox) => Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2);

/** Downsample at capture time, before this call. This function never stores RGB pixels. */
export function grayscalePixels(rgba: Uint8ClampedArray): Uint8Array {
  if (rgba.length % 4 !== 0) throw new Error('invalid_rgba');
  const gray = new Uint8Array(rgba.length/4);
  for (let i=0;i<gray.length;i++) gray[i]=Math.round(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2]);
  return gray;
}

/**
 * Experimental visual observations, never a fall/step-height or safe-path detector.
 * A repeated visual line can still be a shadow, seam, texture or reflection.
 * No metric depth, step direction, on-floor relationship or collision risk is inferred.
 */
export class GroundHazardEngine {
  private tracks: Track[]=[];
  private nextId=1;
  private lastFrameId='';
  private lastCapturedAt=Number.NEGATIVE_INFINITY;
  reset() { this.tracks=[];this.nextId=1;this.lastFrameId='';this.lastCapturedAt=Number.NEGATIVE_INFINITY; }
  observe(frame: GroundHazardFrame, now=performance.now()): GroundHazardSnapshot {
    const result = (status: GroundHazardSnapshot['status'], observations: GroundHazardObservation[]=[]): GroundHazardSnapshot =>
      ({frameId:frame.frameId,capturedAt:frame.capturedAt,status,observations});
    if (!frame.frameId || !Number.isFinite(now) || !Number.isFinite(frame.capturedAt) || now<frame.capturedAt ||
        !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width<8 || frame.height<8 ||
        frame.width*frame.height>1_048_576 ||
        (frame.gray && (!(frame.gray instanceof Uint8Array || frame.gray instanceof Uint8ClampedArray) || frame.gray.length!==frame.width*frame.height))) {
      this.tracks=[];return result('INVALID');
    }
    if (now-frame.capturedAt>GROUND_MAX_AGE_MS || frame.frameId===this.lastFrameId || frame.capturedAt<=this.lastCapturedAt) {
      this.tracks=[];return result('STALE');
    }
    this.lastFrameId=frame.frameId;this.lastCapturedAt=frame.capturedAt;
    if (frame.lowLight) { this.tracks=[];return result('LOW_LIGHT'); }
    const grid = frame.segmentation && isValidSegmentationGrid(frame.segmentation) &&
      frame.segmentation.timestamp===frame.capturedAt ? frame.segmentation : null;
    const candidates: Candidate[]=[];
    if (grid) for (const region of semanticRegions(grid)) {
      if (region.code!==SEG.STAIRS) continue;
      candidates.push({kind:'VISIBLE_STAIRS',
        boundingBox:{x:region.x0/grid.width,y:region.y0/grid.height,width:(region.x1-region.x0+1)/grid.width,height:(region.y1-region.y0+1)/grid.height},
        evidence:[{source:'SEMANTIC_MASK',capturedAt:frame.capturedAt,detail:'STAIRS_REGION'}],
        uncertainty:['UNCALIBRATED_SEMANTIC_LABEL','STAIR_DIRECTION_UNKNOWN','STEP_COUNT_AND_HEIGHT_UNKNOWN'],
        labelAr:'تظهر منطقة درج محتملة، لكن لا يمكن تحديد اتجاهها بصورة موثوقة.'});
    }
    if (frame.gray) candidates.push(...this.edges(frame,grid));
    for (const detection of frame.detections??[]) {
      const box=detection.boundingBox;
      if (detection.source!=='OBJECT_DETECTOR' || !Number.isFinite(detection.confidence) || detection.confidence<.65 || detection.confidence>1 ||
          !Number.isFinite(detection.timestamp) || detection.timestamp!==frame.capturedAt || !validBox(box) || box.y+box.height/2<.67) continue;
      candidates.push({kind:'LOWER_IMAGE_OBJECT',boundingBox:{...box},
        evidence:[{source:'OBJECT_DETECTOR',capturedAt:detection.timestamp,detail:`VISIBLE_OBJECT:${detection.type}`}],
        uncertainty:['GROUND_CONTACT_UNKNOWN','HEIGHT_AND_DISTANCE_UNKNOWN'],
        labelAr:'يوجد جسم ظاهر في الجزء السفلي من الصورة؛ لا يمكن تأكيد ملامسته للأرض.'});
    }
    const previous=this.tracks.filter(track=>frame.capturedAt-track.lastAt<=GROUND_MAX_AGE_MS);
    const used=new Set<Track>();
    this.tracks=candidates.slice(0,12).map(candidate=>{
      const choices=previous.filter(track=>!used.has(track)&&track.candidate.kind===candidate.kind&&
        centerDistance(track.candidate.boundingBox,candidate.boundingBox)<.08)
        .sort((a,b)=>centerDistance(a.candidate.boundingBox,candidate.boundingBox)-centerDistance(b.candidate.boundingBox,candidate.boundingBox));
      // Ambiguous association cannot increase persistence or inherit an identity.
      const prior=choices.length===1?choices[0]:undefined;
      if (prior) { used.add(prior);return {...prior,candidate,lastAt:frame.capturedAt,seen:prior.seen+1}; }
      return {id:`ground-${this.nextId++}`,candidate,firstAt:frame.capturedAt,lastAt:frame.capturedAt,seen:1};
    });
    const observations=this.tracks.flatMap((track): GroundHazardObservation[]=>{
      const stable=track.seen>=3 && track.lastAt-track.firstAt>=500;
      // Require coherent observations on three distinct captures before exposing
      // even a possible boundary; semantic floor evidence is itself uncalibrated.
      if (track.candidate.kind==='POSSIBLE_GROUND_BOUNDARY' && !stable) return [];
      return [{...track.candidate,id:track.id,firstSeenAt:track.firstAt,lastSeenAt:track.lastAt,confidence:null,
        evidenceStrength:stable?'TEMPORALLY_STABLE':'SINGLE_FRAME',
        evidence:[...track.candidate.evidence,...(stable?[{source:'TEMPORAL_PERSISTENCE' as const,capturedAt:track.lastAt,detail:`${track.seen}_UNIQUE_FRAMES`}]:[])]}];
    });
    return result('CURRENT',observations);
  }
  private edges(frame: GroundHazardFrame, grid: SegmentationGrid|null): Candidate[] {
    const {width:w,height:h,gray}=frame;
    if (!gray) return [];
    const rows: {y:number;x0:number;x1:number;support:number;ground:number}[]=[];
    const x0=Math.floor(w*.1),x1=Math.ceil(w*.9),step=Math.max(1,Math.round(h/160));
    for (let y=Math.max(step,Math.floor(h*.52));y<Math.min(h-step,Math.floor(h*.94));y++) {
      let count=0,first=w,last=0,ground=0;
      for (let x=x0;x<x1;x++) {
        // Vertical luminance gradient finds a horizontal visual boundary.
        if (Math.abs(gray[(y+step)*w+x]-gray[(y-step)*w+x])<32) continue;
        count++;first=Math.min(first,x);last=x;
        if (grid) {
          const gx=Math.min(grid.width-1,Math.floor(x*grid.width/w));
          const gy=Math.min(grid.height-1,Math.floor((y+step)*grid.height/h));
          if (isGround(grid.labels[gy*grid.width+gx])) ground++;
        }
      }
      if (count/(x1-x0)>=.55) rows.push({y,x0:first,x1:last,support:count/(x1-x0),ground:count?ground/count:0});
    }
    // Merge neighboring gradient rows. Dense repeated texture is withheld.
    const groups: typeof rows=[];
    for (const row of rows) {
      const previous=groups[groups.length-1];
      if (previous&&row.y-previous.y<=step*3) { if(row.support>previous.support)groups[groups.length-1]=row; }
      else groups.push(row);
    }
    if (groups.length>4) return [];
    return groups.map(row=>({kind:'POSSIBLE_GROUND_BOUNDARY',
      boundingBox:{x:row.x0/w,y:(row.y-step)/h,width:(row.x1-row.x0+1)/w,height:Math.min(1-(row.y-step)/h,step*2/h)},
      evidence:[{source:'IMAGE_GRADIENT',capturedAt:frame.capturedAt,detail:'HORIZONTAL_VISUAL_BOUNDARY'},
        ...(grid&&row.ground>=.6?[{source:'SEMANTIC_MASK' as const,capturedAt:grid.timestamp,detail:'GROUND_LABEL_BELOW_BOUNDARY'}]:[])],
      uncertainty:['NOT_PROOF_OF_DROP_OR_STEP','SHADOW_TEXTURE_OR_REFLECTION_POSSIBLE',
        ...(grid&&row.ground>=.6?['SEMANTIC_GROUND_UNCALIBRATED']:['GROUND_SURFACE_UNVERIFIED'])],
      labelAr:grid&&row.ground>=.6?'تظهر حافة أرضية محتملة أمام الكاميرا؛ قد تكون ظلًا أو نمطًا سطحيًا.':'تظهر حافة بصرية متكررة في الجزء السفلي من الصورة؛ لا يمكن تأكيد أنها حافة أرضية.'}));
  }
}
