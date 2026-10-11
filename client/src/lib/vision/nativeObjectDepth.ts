import type { DepthReading, MetricDepthMap, VisionDetection } from '@shared/vision';

export type ObjectDepthRejection =
  | 'LOW_OBJECT_CONFIDENCE'
  | 'UNVERIFIED_DEPTH'
  | 'STALE_FRAME'
  | 'SMALL_OBJECT'
  | 'LOW_LOCAL_COVERAGE'
  | 'MIXED_SURFACES'
  | 'NO_CENTRAL_SURFACE';

export interface ObjectDepthEvidence {
  reading: DepthReading | null;
  reason: ObjectDepthRejection | null;
  valid: number;
  total: number;
  spreadMeters: number | null;
}
const rejected = (reason: ObjectDepthRejection, valid = 0, total = 25, spreadMeters: number | null = null): ObjectDepthEvidence =>
  ({reading:null,reason,valid,total,spreadMeters});

/**
 * Experimental, conservative camera-to-surface depth for a detected object.
 *
 * A bounding box is NOT an object segmentation mask. For chairs, glass or objects
 * with holes, background may still be visible in the box; this gate therefore
 * rejects mixed/unsupported readings, but never certifies object association.
 *
 * This method MUST NOT be used to enable walking or stair audio alerts.
 */
export function estimateNativeObjectDepth(d: VisionDetection, map: MetricDepthMap): ObjectDepthEvidence {
  if (d.confidence < .75) return rejected('LOW_OBJECT_CONFIDENCE');
  if (map.source !== 'ARKIT_DEPTH' || !Number.isFinite(map.confidence) ||
      map.confidence < .70 || map.values.length !== map.width * map.height) {
    return rejected('UNVERIFIED_DEPTH');
  }
  if (!Number.isFinite(d.timestamp) || !Number.isFinite(map.timestamp) ||
      Math.abs(d.timestamp - map.timestamp) > 100) return rejected('STALE_FRAME');

  const box=d.boundingBox;
  if (![box.x,box.y,box.width,box.height].every(Number.isFinite) ||
      box.x<0 || box.y<0 || box.width<=0 || box.height<=0 ||
      box.x+box.width>1 || box.y+box.height>1 ||
      box.width*map.width < 7 || box.height*map.height < 7) {
    return rejected('SMALL_OBJECT');
  }
  // An interior 5x5 grid avoids many edges, but not background seen through gaps.
  const cx=box.x+box.width/2, cy=box.y+box.height/2;
  const samples:number[]=[];
  let center:number|null=null;
  for(let iy=0;iy<5;iy++){
    for(let ix=0;ix<5;ix++){
      const rx=cx+(ix-2)*.12*box.width, ry=cy+(iy-2)*.12*box.height;
      const x=Math.min(map.width-1,Math.max(0,Math.floor(rx*map.width)));
      const y=Math.min(map.height-1,Math.max(0,Math.floor(ry*map.height)));
      const value=map.values[y*map.width+x];
      if(Number.isFinite(value)&&value>=.25&&value<=10){
        samples.push(value);
        if(ix===2&&iy===2)center=value;
      }
    }
  }
  if(samples.length<20)return rejected('LOW_LOCAL_COVERAGE',samples.length);
  samples.sort((a,b)=>a-b);
  const median=samples[Math.floor(samples.length/2)];
  const p10=samples[Math.floor((samples.length-1)*.1)];
  const p90=samples[Math.ceil((samples.length-1)*.9)];
  const spreadMeters=p90-p10;
  const tolerance=Math.max(.18,.12*median);
  if(spreadMeters>tolerance)return rejected('MIXED_SURFACES',samples.length,25,spreadMeters);
  if(center===null||Math.abs(center-median)>tolerance)return rejected('NO_CENTRAL_SURFACE',samples.length,25,spreadMeters);
  return {
    reading: {
      distanceMeters: Math.round(median*100)/100,
      confidence: Math.min(map.confidence,d.confidence,samples.length/25),
      source: 'ARKIT_DEPTH',
    },
    reason:null,valid:samples.length,total:25,spreadMeters,
  };
}
