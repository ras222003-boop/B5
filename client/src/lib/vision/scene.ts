import type { HapticFeedbackProvider, ObstacleDetection, RecognizedPlace, SceneDescription, WalkableAreaResult } from '@shared/vision';
import { visionMessages } from '@/i18n/locales/vision';
import { AlertDeduplicator } from './safety';

export type VisionCopy = typeof visionMessages.ar;
const metricDistance=(event:ObstacleDetection)=>{
  const depth=event.approximateDistance;
  return depth&&depth.source!=='MONOCULAR_ESTIMATE'&&depth.confidence>=.7&&Number.isFinite(depth.distanceMeters)&&depth.distanceMeters>0?depth.distanceMeters:null;
};
const objectPhrase=(event:ObstacleDetection,copy:VisionCopy)=>{
  const distance=metricDistance(event);
  return `${copy.object[event.type]} ${copy.direction[event.horizontalDirection]}${distance===null?'':`، ${copy.distance(distance)}`}`;
};

export class SceneUnderstandingService {
  constructor(private readonly copy:VisionCopy) {}
  summarize(events:ObstacleDetection[],recognizedPlace:RecognizedPlace|null,capturedAt:number,walkableArea:WalkableAreaResult|null=null,surfaceAnalysis:WalkableAreaResult|null=walkableArea):SceneDescription {
    const top=events.slice(0,4);
    const phrases=top.map(event=>objectPhrase(event,this.copy));
    const pathText=walkableArea?.pathAhead==='BLOCKED'?this.copy.pathBlocked:walkableArea?.pathAhead==='UNKNOWN'?this.copy.pathUnknown:'';
    const surfaceText=surfaceAnalysis?.surface&&surfaceAnalysis.surface!=='UNKNOWN'?` ${this.copy.surface(surfaceAnalysis.surface)}.`:'';
    const shortText=phrases.length?`${this.copy.scenePrefix}: ${phrases.slice(0,2).join('، ')}.${pathText?` ${pathText}`:''}${surfaceText}`:`${pathText||this.copy.noDetections}${surfaceText}`;
    const detailedText=phrases.length?`${this.copy.sceneDetails}: ${phrases.join('، ')}.${recognizedPlace?` ${this.copy.placeRecognized(recognizedPlace.name)}.`:''}${pathText?` ${pathText}`:''}${surfaceText}`:`${pathText||this.copy.noDetections}${surfaceText}`;
    return {shortText,detailedText,riskLevel:events[0]?.riskLevel??null,objects:events,recognizedPlace,walkableArea:walkableArea??undefined,surfaceAnalysis:surfaceAnalysis??undefined,capturedAt};
  }
}

export class BrowserHapticFeedbackProvider implements HapticFeedbackProvider {
  critical() { if ('vibrate' in navigator) navigator.vibrate(200); }
}

/** Speaks only the highest-priority changed event; never queues every object. */
export class VisionAnnouncementService {
  private deduplicator:AlertDeduplicator;
  private hazardUntil=0;
  constructor(private readonly copy:VisionCopy,private readonly speak:(text:string)=>void,private readonly haptic:HapticFeedbackProvider,cooldownMs:number) {
    this.deduplicator=new AlertDeduplicator(cooldownMs);
  }
  announce(events:ObstacleDetection[],now:number):{text:string;event:ObstacleDetection}|null {
    const top=events[0];
    if(top?.riskLevel==='INFORMATION'&&now<this.hazardUntil)return null;
    if(!top||!this.deduplicator.shouldAnnounce(top,now)) return null;
    if(top.riskLevel==='HIGH'||top.riskLevel==='CRITICAL')this.hazardUntil=now+4000;
    const text=top.type==='DROP_OFF_UNCERTAIN'?this.copy.uncertainDropOff
      :top.type==='DROP_OFF'?this.copy.dropOff
      :top.type==='STAIRS_DOWN'&&top.riskLevel==='CRITICAL'?this.copy.stairsDown
      :top.type==='STAIRS_UNCERTAIN'||top.type==='STAIRS_DOWN'&&top.reason==='UNCERTAIN'
      ? this.copy.uncertainStairs
      : `${top.riskLevel==='CRITICAL'||top.riskLevel==='HIGH'?`${this.copy.alertPrefix}، `:''}${objectPhrase(top,this.copy)}.`;
    if(top.riskLevel==='CRITICAL')this.haptic.critical();
    this.speak(text);
    return {text,event:top};
  }
  reset(){this.deduplicator.reset();this.hazardUntil=0;}
}
