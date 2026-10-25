import type { HorizontalDirection, VisionDetection, VisionObjectType } from '@shared/vision';
import type { VisionCopy } from './scene';
import { validNormalizedBox } from './objectTracking';
import type { VisualApproachObservation } from './visualApproach';
import {objectLabel,COCO_LABELS} from './cocoLabels';
import {colorDescription} from './objectColors';

const speechKey = 'basira-vision-object-speech-v1';
export function getObjectSpeechEnabled() { try { return localStorage.getItem(speechKey) !== 'false'; } catch { return true; } }
export function saveObjectSpeechEnabled(value: boolean) { try { localStorage.setItem(speechKey, String(value)); } catch { /* Storage is optional. */ } return value; }

interface SpokenTrack { detection: VisionDetection; announcedDirection: HorizontalDirection | null; announcedAt: number; approachAt: number;announcedColor?:string }
const excluded = new Set<VisionObjectType>(['STAIRS_UP', 'STAIRS_DOWN', 'STAIRS_UNCERTAIN', 'DROP_OFF', 'DROP_OFF_UNCERTAIN', 'UNKNOWN_OBSTACLE']);
const central = (direction: HorizontalDirection) => direction === 'FRONT' ? 2 : direction === 'FRONT_LEFT' || direction === 'FRONT_RIGHT' ? 1 : 0;

/** Speech consumes the shared tracker identity. Box growth alone never creates an approach cue. */
export class ObjectSpeechTracker {
  private tracks = new Map<string, SpokenTrack>();
  private lastSpeech = -Infinity;
  constructor(private readonly copy: VisionCopy, private readonly minimumGapMs = 4500,
    private readonly approachPhrase = copy.approachPossible,private readonly minimumScore=.65) {}
  reset() { this.tracks.clear(); this.lastSpeech = -Infinity; }
  observe(detections: readonly VisionDetection[], now: number, announce: (text: string) => boolean,
    approaches: readonly VisualApproachObservation[] = [],ordinaryEnabled=true,
    announceApproach:(text:string)=>boolean=announce,colorEnabled=false): string | null {
    if (!Number.isFinite(now)) return null;
    const current = new Map<string, SpokenTrack>();
    for (const detection of detections) {
      if (!detection.trackId || detection.tracking?.state !== 'TRACKED' || detection.tracking.observations < 2 ||
        !Number.isFinite(detection.confidence) || detection.confidence < this.minimumScore || detection.confidence > 1 ||
        (excluded.has(detection.type)&&!(detection.type==='UNKNOWN_OBSTACLE'&&detection.cocoClass)) || detection.experimental || detection.source === 'SEGMENTATION' || !validNormalizedBox(detection.boundingBox) ||
        !Number.isFinite(detection.timestamp) || now - detection.timestamp > 800 || detection.timestamp > now + 5) continue;
      const previous = this.tracks.get(detection.trackId);
      // Repeated snapshots are not new observations and cannot trigger delayed speech.
      if (previous && detection.timestamp <= previous.detection.timestamp) continue;
      current.set(detection.trackId, previous && previous.detection.type === detection.type
        ? { ...previous, detection }
        : { detection, announcedDirection: null, announcedAt: -Infinity, approachAt: -Infinity });
    }
    // Retain pacing state for briefly repeated snapshots, but only current observations can speak.
    for (const [id, track] of Array.from(this.tracks)) if (now - track.detection.timestamp > 1200 ||
      !detections.some(d => d.trackId === id)) this.tracks.delete(id);
    for (const [id, track] of Array.from(current)) this.tracks.set(id, track);
    if (now - this.lastSpeech < this.minimumGapMs) return null;

    const approaching = Array.from(current.values()).map(track => ({ track, approach: approaches.find(a =>
      a.trackId === track.detection.trackId && a.type === track.detection.type && a.capturedAt === track.detection.timestamp &&
      a.experimental === true && a.reasons.length === 0 && a.evidence.includes('COMPENSATED_OPTICAL_FLOW') &&
      a.evidence.includes('BOX_EXPANSION') && a.evidence.includes('TRACKING') &&
      (a.state === 'POSSIBLE_APPROACH' || a.state === 'STRONG_APPROACH')) }))
      .filter(item => item.approach && !excluded.has(item.track.detection.type) && now - item.track.approachAt >= 20000)
      .sort((a, b) => Number(b.approach!.state === 'STRONG_APPROACH') - Number(a.approach!.state === 'STRONG_APPROACH'))[0];
    if (approaching) {
      const { track, approach } = approaching, name = this.copy.object[track.detection.type], direction = this.copy.direction[track.detection.horizontalDirection];
      const text = approach!.state === 'STRONG_APPROACH' ? this.copy.approachStrong(name, direction) : this.approachPhrase(name, direction);
      if (!announceApproach(text)) return null;
      track.approachAt = now; this.lastSpeech = now;
      return text;
    }
    if(!ordinaryEnabled&&!colorEnabled)return null;
    const signature=(track:SpokenTrack)=>colorEnabled&&track.detection.color?(track.detection.cocoClass==='person'?'person-clothing-unspecified':track.detection.color.name??(track.detection.color.reason==='LOW_LIGHT'?'low-light':'unclear')):'';
    const candidates = Array.from(current.values()).filter(track => {
      const firstStableColour=colorEnabled&&Boolean(track.detection.color?.name)&&['',undefined,'unclear'].includes(track.announcedColor);
      return ((ordinaryEnabled&&track.announcedDirection !== track.detection.horizontalDirection)||(colorEnabled&&signature(track)&&track.announcedColor!==signature(track)&&!['WARMING_UP','CHANGING'].includes(track.detection.color?.reason??''))) && now-track.announcedAt >= (firstStableColour?this.minimumGapMs:9000);
    })
      .sort((a, b) => central(b.detection.horizontalDirection) - central(a.detection.horizontalDirection) ||
        b.detection.boundingBox.width * b.detection.boundingBox.height - a.detection.boundingBox.width * a.detection.boundingBox.height).slice(0, 2);
    if (!candidates.length) return null;
    const text = `${candidates.map(track => {
      const d=track.detection,name=objectLabel(d,this.copy),color=colorEnabled&&d.cocoClass!=='person'&&!['WARMING_UP','CHANGING'].includes(d.color?.reason??'')?colorDescription(d).replace(' (تقدير من الصورة)',''):'';
      if(!ordinaryEnabled&&d.cocoClass==='person')return 'ألوان الملابس غير محددة دون فصل موثوق للملابس عن بقية الشخص';
      if(colorEnabled&&d.color?.reason==='LOW_LIGHT')return 'اللون غير واضح بسبب ضعف الإضاءة';
      const direction=colorEnabled&&this.copy.object.PERSON==='شخص'?(['LEFT','FRONT_LEFT'].includes(d.horizontalDirection)?'في يسار الصورة':['RIGHT','FRONT_RIGHT'].includes(d.horizontalDirection)?'في يمين الصورة':'في وسط الصورة'):this.copy.direction[d.horizontalDirection];
      return ordinaryEnabled?`${name}${color?`، ${d.color?.name?(COCO_LABELS[d.cocoClass??'']?.feminine?'تبدو ':'يبدو '):''}${color}`:''} ${direction}`:`لون ${name}: ${d.color?.name?colorDescription({...d,cocoClass:undefined}).replace(' (تقدير من الصورة)',''):color||'غير واضح'}`;
    }).join('، ')}.`;
    if (!announce(text)) return null;
    for (const track of candidates) { if(ordinaryEnabled)track.announcedDirection = track.detection.horizontalDirection;track.announcedColor=signature(track);track.announcedAt = now; }
    this.lastSpeech = now;
    return text;
  }
}
