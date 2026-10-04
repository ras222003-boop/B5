import type { HapticFeedbackProvider, ObstacleDetection, RecognizedPlace, SceneDescription } from '@shared/vision';
import { visionMessages } from '@/i18n/locales/vision';
import { AlertDeduplicator } from './safety';

export type VisionCopy = typeof visionMessages.ar;
const objectPhrase=(event:ObstacleDetection,copy:VisionCopy)=>`${copy.object[event.type]} ${copy.direction[event.horizontalDirection]}`;

export class SceneUnderstandingService {
  constructor(private readonly copy:VisionCopy) {}
  summarize(events:ObstacleDetection[],recognizedPlace:RecognizedPlace|null,capturedAt:number):SceneDescription {
    const top=events.slice(0,4);
    const phrases=top.map(event=>objectPhrase(event,this.copy));
    const shortText=phrases.length?`${this.copy.scenePrefix}: ${phrases.slice(0,2).join('، ')}.`:this.copy.noDetections;
    const detailedText=phrases.length?`${this.copy.sceneDetails}: ${phrases.join('، ')}.${recognizedPlace?` ${this.copy.placeRecognized(recognizedPlace.name)}.`:''}`:this.copy.noDetections;
    return {shortText,detailedText,riskLevel:events[0]?.riskLevel??null,objects:events,recognizedPlace,capturedAt};
  }
}

export class BrowserHapticFeedbackProvider implements HapticFeedbackProvider {
  critical() { if ('vibrate' in navigator) navigator.vibrate(200); }
}

/** Speaks only the highest-priority changed event; never queues every object. */
export class VisionAnnouncementService {
  private deduplicator:AlertDeduplicator;
  constructor(private readonly copy:VisionCopy,private readonly speak:(text:string)=>void,private readonly haptic:HapticFeedbackProvider,cooldownMs:number) {
    this.deduplicator=new AlertDeduplicator(cooldownMs);
  }
  announce(events:ObstacleDetection[],now:number):{text:string;event:ObstacleDetection}|null {
    const top=events[0];
    if(!top||!this.deduplicator.shouldAnnounce(top,now)) return null;
    const text=top.type==='STAIRS_UNCERTAIN'||top.type==='STAIRS_DOWN'&&top.reason==='UNCERTAIN'
      ? this.copy.uncertainStairs
      : `${top.riskLevel==='CRITICAL'||top.riskLevel==='HIGH'?`${this.copy.alertPrefix}، `:''}${objectPhrase(top,this.copy)}.`;
    if(top.riskLevel==='CRITICAL')this.haptic.critical();
    this.speak(text);
    return {text,event:top};
  }
  reset(){this.deduplicator.reset();}
}
