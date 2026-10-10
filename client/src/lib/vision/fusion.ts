import type { MetricDepthMap, ObstacleDetection, RelativeDepthMap, SegmentationGrid, VisionDetection, WalkableAreaResult } from '@shared/vision';
import { BasiraSafetyEngine } from './safety';
import { detectionsFromSegmentation, DropOffHazardDetector, SemanticWalkableAreaProvider } from './segmentation';

const overlap=(a:VisionDetection,b:VisionDetection)=>{
  const x=Math.max(0,Math.min(a.boundingBox.x+a.boundingBox.width,b.boundingBox.x+b.boundingBox.width)-Math.max(a.boundingBox.x,b.boundingBox.x));
  const y=Math.max(0,Math.min(a.boundingBox.y+a.boundingBox.height,b.boundingBox.y+b.boundingBox.height)-Math.max(a.boundingBox.y,b.boundingBox.y));
  const intersection=x*y;
  return intersection/(a.boundingBox.width*a.boundingBox.height+b.boundingBox.width*b.boundingBox.height-intersection||1);
};
export function metricDepthForDetection(d:VisionDetection,map:MetricDepthMap):VisionDetection['approximateDistance'] {
  if(map.confidence<.7||Math.abs(d.timestamp-map.timestamp)>250)return null;
  const cx=d.boundingBox.x+d.boundingBox.width/2,cy=d.boundingBox.y+d.boundingBox.height/2;
  const samples:number[]=[];
  for(const dx of [-.08,0,.08])for(const dy of [-.08,0,.08]){
    const x=Math.max(0,Math.min(map.width-1,Math.floor((cx+dx*d.boundingBox.width)*map.width)));
    const y=Math.max(0,Math.min(map.height-1,Math.floor((cy+dy*d.boundingBox.height)*map.height)));
    const value=map.values[y*map.width+x];if(Number.isFinite(value)&&value>0)samples.push(value);
  }
  if(samples.length<5)return null;
  samples.sort((a,b)=>a-b);
  return {distanceMeters:samples[Math.floor(samples.length/2)],confidence:map.confidence,source:map.source};
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
