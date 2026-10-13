import type { MetricDepthMap, ObstacleDetection, RelativeDepthMap, SegmentationGrid, VisionDetection, WalkableAreaResult } from '@shared/vision';
import { BasiraSafetyEngine } from './safety';
import { detectionsFromSegmentation, DropOffHazardDetector, isValidSegmentationGrid, SemanticWalkableAreaProvider } from './segmentation';

export const FUSION_MAX_AGE_MS = 1250;
export const FUSION_MAX_SKEW_MS = 250;
const isFresh = (timestamp:number,now:number) => Number.isFinite(timestamp)&&Number.isFinite(now)&&
  timestamp<=now&&now-timestamp<=FUSION_MAX_AGE_MS;
const validDetection = (d:VisionDetection) => Number.isFinite(d.confidence)&&d.confidence>=0&&d.confidence<=1&&
  [d.boundingBox.x,d.boundingBox.y,d.boundingBox.width,d.boundingBox.height].every(Number.isFinite)&&
  d.boundingBox.x>=0&&d.boundingBox.y>=0&&d.boundingBox.width>0&&d.boundingBox.height>0&&
  d.boundingBox.x+d.boundingBox.width<=1.001&&d.boundingBox.y+d.boundingBox.height<=1.001;

const overlap=(a:VisionDetection,b:VisionDetection)=>{
  const x=Math.max(0,Math.min(a.boundingBox.x+a.boundingBox.width,b.boundingBox.x+b.boundingBox.width)-Math.max(a.boundingBox.x,b.boundingBox.x));
  const y=Math.max(0,Math.min(a.boundingBox.y+a.boundingBox.height,b.boundingBox.y+b.boundingBox.height)-Math.max(a.boundingBox.y,b.boundingBox.y));
  const intersection=x*y;
  return intersection/(a.boundingBox.width*a.boundingBox.height+b.boundingBox.width*b.boundingBox.height-intersection||1);
};
/**
 * Conservative association of a detected object with a SAME-VIDEO-FRAME
 * metric depth surface. Detection rectangles are not object masks: reject
 * mixed or hollow areas instead of assuming background is the object.
 *
 * The resulting reading is EXPERIMENTAL and never validates stair/drop-off
 * safety. Absolute Scale (world-pose displacement) cannot feed this path.
 */
export function metricDepthForDetection(d: VisionDetection, map: MetricDepthMap): VisionDetection['approximateDistance'] {
  if (map.alignmentVerified !== true || !Number.isFinite(map.confidence) || map.confidence < .75 || map.confidence > 1 || d.source !== 'OBJECT_DETECTOR' ||
      !Number.isFinite(d.confidence) || d.confidence < .75 || d.confidence > 1 || Math.abs(d.timestamp-map.timestamp) > 100 ||
      !Number.isFinite(d.timestamp) || !Number.isFinite(map.timestamp) ||
      !['ARKIT_DEPTH','LIDAR','ARCORE_DEPTH','DEPTH_SENSOR'].includes(map.source) ||
      !Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width<=0 || map.height<=0 || map.width*map.height>1_048_576 ||
      map.values.length !== map.width*map.height) return null;
  const box=d.boundingBox;
  if (![box.x,box.y,box.width,box.height].every(Number.isFinite) ||
      box.x<0 || box.y<0 || box.width<=0 || box.height<=0 ||
      box.x+box.width>1 || box.y+box.height>1 ||
      box.width*map.width<7 || box.height*map.height<7) return null;
  const samples:number[]=[];
  let center:number|null=null;
  for (let y=0;y<5;y++)for(let x=0;x<5;x++){
    const px=Math.max(0,Math.min(map.width-1,Math.floor((box.x+(.26+x*.12)*box.width)*map.width)));
    const py=Math.max(0,Math.min(map.height-1,Math.floor((box.y+(.26+y*.12)*box.height)*map.height)));
    const value=map.values[py*map.width+px];
    if(Number.isFinite(value)&&value>=.2&&value<=10) {
      samples.push(value);
      if(x===2&&y===2)center=value;
    }
  }
  if (samples.length<20||center===null)return null;
  samples.sort((a,b)=>a-b);
  const mid=samples[Math.floor(samples.length/2)];
  const spread=samples[Math.ceil((samples.length-1)*.9)]-samples[Math.floor((samples.length-1)*.1)];
  const allowed=Math.max(.15,mid*.12);
  if(spread>allowed||Math.abs(center-mid)>allowed)return null;
  return {distanceMeters:Math.round(mid*100)/100,
    confidence:Math.min(map.confidence,d.confidence,samples.length/25),source:map.source};
}
export interface FusionInput {
  objects:VisionDetection[];segmentation:SegmentationGrid|null;
  relativeDepth:RelativeDepthMap|null;metricDepth:MetricDepthMap|null;
  signs:VisionDetection[];
}
export interface FusionFrame { detections:VisionDetection[];events:ObstacleDetection[];walkableArea:WalkableAreaResult|null;surfaceAnalysis:WalkableAreaResult|null }
/** One frame result with duplicate classes removed, hazard evidence ranked before ordinary objects. */
export class VisionFusionEngine {
  private readonly walkable=new SemanticWalkableAreaProvider();
  private readonly dropOff=new DropOffHazardDetector();
  constructor(private readonly safety:BasiraSafetyEngine) {}
  /** All source timestamps and now use the same monotonic clock. */
  fuse(input:FusionInput,now=performance.now()):FusionFrame {
    const freshObjects=input.objects.filter(d=>validDetection(d)&&isFresh(d.timestamp,now));
    const freshSigns=input.signs.filter(d=>validDetection(d)&&isFresh(d.timestamp,now));
    const freshGrid=input.segmentation&&isValidSegmentationGrid(input.segmentation)&&isFresh(input.segmentation.timestamp,now)?input.segmentation:null;
    const newest=Math.max(...freshObjects.map(d=>d.timestamp),...freshSigns.map(d=>d.timestamp),freshGrid?.timestamp??Number.NEGATIVE_INFINITY);
    const sameScene=(timestamp:number)=>newest-timestamp<=FUSION_MAX_SKEW_MS;
    const segmentation=freshGrid&&sameScene(freshGrid.timestamp)?freshGrid:null;
    const metricDepth=input.metricDepth&&isFresh(input.metricDepth.timestamp,now)&&sameScene(input.metricDepth.timestamp)&&
      input.metricDepth.timestamp<=newest?input.metricDepth:null;
    const relativeDepth=input.relativeDepth&&isFresh(input.relativeDepth.timestamp,now)&&sameScene(input.relativeDepth.timestamp)&&
      input.relativeDepth.timestamp<=newest?input.relativeDepth:null;
    const semantic=segmentation?detectionsFromSegmentation(segmentation):[];
    const objects=freshObjects.filter(d=>sameScene(d.timestamp));
    for(const item of semantic){
      const duplicate=objects.some(existing=>existing.type===item.type&&overlap(existing,item)>.35);
      if(!duplicate)objects.push(item);
    }
    const alignedDepth=segmentation&&metricDepth?.timestamp===segmentation.timestamp?metricDepth:
      segmentation&&relativeDepth?.timestamp===segmentation.timestamp?relativeDepth:null;
    const hazard=segmentation?this.dropOff.detect(segmentation,alignedDepth):null;
    if(hazard)objects.unshift(hazard);
    const walkableArea=segmentation?this.walkable.analyze(segmentation,objects):null;
    const detections=[...objects,...freshSigns.filter(d=>sameScene(d.timestamp))];
    // A rejected supplied depth map cannot leave an earlier metric association in place.
    const enriched=detections.map(d=>({...d,approximateDistance:metricDepth?metricDepthForDetection(d,metricDepth):input.metricDepth?null:d.approximateDistance}));
    return {detections:enriched,events:this.safety.classifyAll(enriched),walkableArea,surfaceAnalysis:walkableArea};
  }
}
