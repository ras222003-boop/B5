import type {BoundingBox,VisionDetection} from '@shared/vision';
import type {AutoMeterSnapshot} from './autoMeter';
import type {LiveDetectionFrame} from './pipeline';

export interface DisplayRect {x:number;y:number;width:number;height:number}

/** Video object-fit and SVG preserveAspectRatio must use the same geometry. */
export function mapBoxToPreview(box:BoundingBox,frame:{width:number;height:number},view:{width:number;height:number},fit:'contain'|'cover'='contain'):DisplayRect|null {
  if(![box.x,box.y,box.width,box.height,frame.width,frame.height,view.width,view.height].every(Number.isFinite)||
    box.width<=0||box.height<=0||frame.width<=0||frame.height<=0||view.width<=0||view.height<=0)return null;
  const scale=fit==='contain'?Math.min(view.width/frame.width,view.height/frame.height):Math.max(view.width/frame.width,view.height/frame.height);
  const drawnWidth=frame.width*scale,drawnHeight=frame.height*scale;
  return {x:(view.width-drawnWidth)/2+box.x*drawnWidth,y:(view.height-drawnHeight)/2+box.y*drawnHeight,
    width:box.width*drawnWidth,height:box.height*drawnHeight};
}

export function overlayMeters(detection:VisionDetection,frame:LiveDetectionFrame,snapshot:AutoMeterSnapshot|null,now:number):number|null {
  if(!snapshot||snapshot.frameId!==frame.frameId||snapshot.capturedAt!==frame.capturedAt||
    now-snapshot.capturedAt>2000||now<snapshot.capturedAt)return null;
  return snapshot.measurements.find(item=>item.id===detection.id&&item.frameId===frame.frameId)?.distanceMeters??null;
}
