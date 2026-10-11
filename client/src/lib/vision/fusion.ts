import type { MetricDepthMap, ObstacleDetection, RelativeDepthMap, SegmentationGrid, VisionDetection, WalkableAreaResult } from '@shared/vision';
import { BasiraSafetyEngine } from './safety';
import { detectionsFromSegmentation, DropOffHazardDetector, SemanticWalkableAreaProvider } from './segmentation';

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
  if (map.alignmentVerified !== true || map.confidence < .75 || d.source !== 'OBJECT_DETECTOR' ||
      d.confidence < .75 || Math.abs(d.timestamp-map.timestamp) > 100 ||
      !Number.isFinite(d.timestamp) || !Number.isFinite(map.timestamp) ||
      !['ARKIT_DEPTH','LIDAR','ARCORE_DEPTH','DEPTH_SENSOR'].includes(map.source) ||
      !Number.isInteger(map.width) || !Number.isInteger(map.height) ||
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
  fuse(input:FusionInput):FusionFrame {
    const semantic=input.segmentation?detectionsFromSegmentation(input.segmentation):[];
    const objects=[...input.objects];
    for(const item of semantic){
      const duplicate=objects.some(existing=>existing.type===item.type&&overlap(existing,item)>.35);
      if(!duplicate)objects.push(item);
    }
    const alignedDepth=input.segmentation&&input.metricDepth?.timestamp===input.segmentation.timestamp?input.metricDepth:
      input.segmentation&&input.relativeDepth?.timestamp===input.segmentation.timestamp?input.relativeDepth:null;
    const hazard=input.segmentation?this.dropOff.detect(input.segmentation,alignedDepth):null;
    if(hazard)objects.unshift(hazard);
    const walkableArea=input.segmentation?this.walkable.analyze(input.segmentation,objects):null;
    const detections=[...objects,...input.signs];
    const enriched=detections.map(d=>({...d,approximateDistance:input.metricDepth?metricDepthForDetection(d,input.metricDepth):d.approximateDistance}));
    return {detections:enriched,events:this.safety.classifyAll(enriched),walkableArea,surfaceAnalysis:walkableArea};
  }
}
