import type { BoundingBox, MetricDepthMap, RelativeDepthMap, SegmentationGrid, VisionDetection, VisionObjectType, WalkableAreaProvider, WalkableAreaResult } from '@shared/vision';
import { classifyDirection, classifyVertical } from './safety';

export const SEG = { OTHER:0, FLOOR:1, ROAD:2, SIDEWALK:3, PATH:4, STAIRS:5, DOOR:6, COLUMN:7, WALL:8, BARRIER:9, SIGN:10, SOLID:11 } as const;
export function semanticCode(label: string): number {
  switch(label.toLowerCase().trim()) {
    case 'floor': return SEG.FLOOR;
    case 'road': return SEG.ROAD;
    case 'sidewalk': return SEG.SIDEWALK;
    case 'path': case 'dirt track': return SEG.PATH;
    case 'stairs': case 'stairway': case 'step': return SEG.STAIRS;
    case 'door': case 'screen door': return SEG.DOOR;
    case 'column': case 'pole': return SEG.COLUMN;
    case 'wall': return SEG.WALL;
    case 'fence': case 'railing': case 'bannister': return SEG.BARRIER;
    case 'signboard': case 'bulletin board': return SEG.SIGN;
    case 'box': case 'cabinet': case 'sofa': case 'desk': case 'rock': case 'counter': case 'wardrobe': case 'plant': return SEG.SOLID;
    default: return SEG.OTHER;
  }
}
export const isGround=(code:number)=>code===SEG.FLOOR||code===SEG.ROAD||code===SEG.SIDEWALK||code===SEG.PATH;

interface Region { code:number; count:number; x0:number; y0:number; x1:number; y1:number }
/** Four-connected components keep adjacent doors or obstacles from becoming one huge box. */
export function semanticRegions(grid:SegmentationGrid):Region[] {
  const {width:w,height:h,labels}=grid,seen=new Uint8Array(labels.length),regions:Region[]=[];
  for(let start=0;start<labels.length;start++) {
    const code=labels[start];
    if(seen[start]||code===SEG.OTHER||isGround(code)){continue;}
    const queue=[start]; seen[start]=1;
    const region:Region={code,count:0,x0:w,y0:h,x1:0,y1:0};
    for(let head=0;head<queue.length;head++) {
      const index=queue[head],x=index%w,y=Math.floor(index/w);
      region.count++;region.x0=Math.min(region.x0,x);region.y0=Math.min(region.y0,y);
      region.x1=Math.max(region.x1,x);region.y1=Math.max(region.y1,y);
      for(const next of [x>0?index-1:-1,x<w-1?index+1:-1,y>0?index-w:-1,y<h-1?index+w:-1]) {
        if(next>=0&&!seen[next]&&labels[next]===code){seen[next]=1;queue.push(next);}
      }
    }
    if(region.count>=Math.max(5,Math.round(w*h*0.003)))regions.push(region);
  }
  return regions;
}
const regionType:Record<number,VisionObjectType>={
  [SEG.STAIRS]:'STAIRS_UNCERTAIN',[SEG.DOOR]:'DOOR',[SEG.COLUMN]:'COLUMN',[SEG.WALL]:'WALL',
  [SEG.BARRIER]:'BARRIER',[SEG.SIGN]:'SIGN',[SEG.SOLID]:'UNKNOWN_OBSTACLE',
};
export function detectionsFromSegmentation(grid:SegmentationGrid):VisionDetection[] {
  return semanticRegions(grid).flatMap((region,index)=>{
    if(region.code===SEG.WALL&&region.y1<grid.height*0.55)return [];
    const boundingBox:BoundingBox={x:region.x0/grid.width,y:region.y0/grid.height,width:(region.x1-region.x0+1)/grid.width,height:(region.y1-region.y0+1)/grid.height};
    const type=regionType[region.code];if(!type)return [];
    // Semantic masks have no calibrated score. This is a conservative region-quality estimate.
    const quality=Math.min(0.72,0.5+region.count/(grid.width*grid.height));
    return [{id:`seg-${grid.timestamp}-${index}`,type,confidence:quality,boundingBox,
      horizontalDirection:classifyDirection(boundingBox),verticalPosition:classifyVertical(boundingBox),
      approximateDistance:null,timestamp:grid.timestamp,source:'SEGMENTATION' as const,
      trackId:`SEG:${type}:${Math.round((boundingBox.x+boundingBox.width/2)*5)}`}];
  });
}
const intersectsPath=(d:VisionDetection)=>d.boundingBox.x<0.67&&d.boundingBox.x+d.boundingBox.width>0.33&&d.boundingBox.y+d.boundingBox.height>0.55;
export class SemanticWalkableAreaProvider implements WalkableAreaProvider {
  analyze(grid:SegmentationGrid,detections:VisionDetection[]):WalkableAreaResult {
    const counts=[0,0,0],total=[0,0,0];
    for(let y=Math.floor(grid.height*0.55);y<Math.floor(grid.height*0.9);y++)for(let x=0;x<grid.width;x++){
      const sector=Math.min(2,Math.floor(x*3/grid.width));total[sector]++;
      if(isGround(grid.labels[y*grid.width+x]))counts[sector]++;
    }
    const free=counts.map((n,i)=>total[i]?n/total[i]:0);
    const blocked=detections.some(d=>intersectsPath(d)&&d.type!=='SIGN'&&d.type!=='DOOR');
    const center=free[1];
    const pathAhead=blocked||center<0.25&&counts[1]>0?'BLOCKED':center>=0.7&&!blocked?'CLEAR':'UNKNOWN';
    return {pathAhead,freeSpaceLeft:free[0],freeSpaceCenter:center,freeSpaceRight:free[2],
      confidence:Math.min(0.7,Math.max(...free)),source:'SEMANTIC_SEGMENTATION'};
  }
}

/** Possible floor termination only; a single RGB frame cannot establish a true pit or drop. */
export class DropOffHazardDetector {
  detect(grid:SegmentationGrid,depth:MetricDepthMap|RelativeDepthMap|null):VisionDetection|null {
    if(!depth||grid.width<4||grid.height<4)return null;
    const w=grid.width,h=grid.height;
    const coverage=(from:number,to:number)=>{
      let ground=0,total=0;
      for(let y=Math.floor(h*from);y<Math.floor(h*to);y++)for(let x=Math.floor(w*.38);x<Math.floor(w*.62);x++){
        total++;if(isGround(grid.labels[y*w+x]))ground++;
      }
      return total?ground/total:0;
    };
    if(coverage(.7,.85)<.6||coverage(.52,.64)>.2)return null;
    const sample=(fraction:number)=>{
      const x=Math.floor(depth.width*.5),y=Math.floor(depth.height*fraction);
      return depth.values[Math.min(depth.values.length-1,y*depth.width+x)];
    };
    const near=sample(.76),far=sample(.57);
    if(!Number.isFinite(near)||!Number.isFinite(far)||Math.abs(far-near)<(depth.source==='MONOCULAR_ESTIMATE'?.35:1.5))return null;
    const boundingBox:BoundingBox={x:.36,y:.5,width:.28,height:.37};
    return {id:`drop-${grid.timestamp}`,type:'DROP_OFF_UNCERTAIN',confidence:Math.min(.68,depth.confidence),boundingBox,
      horizontalDirection:'FRONT',verticalPosition:'BOTTOM',approximateDistance:null,
      timestamp:grid.timestamp,source:'DEPTH_FUSION',trackId:'DROP:FRONT'};
  }
}
