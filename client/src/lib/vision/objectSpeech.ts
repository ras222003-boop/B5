import type { HorizontalDirection, VisionDetection, VisionObjectType } from '@shared/vision';
import type { VisionCopy } from './scene';
import { validNormalizedBox } from './objectTracking';
import type { VisualApproachObservation } from './visualApproach';

const speechKey = 'basira-vision-object-speech-v1';
export function getObjectSpeechEnabled() { try { return localStorage.getItem(speechKey) !== 'false'; } catch { return true; } }
export function saveObjectSpeechEnabled(value: boolean) { try { localStorage.setItem(speechKey, String(value)); } catch { /* Storage is optional. */ } return value; }

interface SpokenTrack { detection: VisionDetection; announcedDirection: HorizontalDirection | null; announcedAt: number; approachAt: number }
const excluded = new Set<VisionObjectType>(['STAIRS_UP', 'STAIRS_DOWN', 'STAIRS_UNCERTAIN', 'DROP_OFF', 'DROP_OFF_UNCERTAIN', 'UNKNOWN_OBSTACLE']);
const central = (direction: HorizontalDirection) => direction === 'FRONT' ? 2 : direction === 'FRONT_LEFT' || direction === 'FRONT_RIGHT' ? 1 : 0;

/** Speech consumes the shared tracker identity. Box growth alone never creates an approach cue. */
export class ObjectSpeechTracker {
  private tracks = new Map<string, SpokenTrack>();
  private lastSpeech = -Infinity;
  constructor(private readonly copy: VisionCopy, private readonly minimumGapMs = 4500,
    private readonly approachPhrase = copy.approachPossible) {}
  reset() { this.tracks.clear(); this.lastSpeech = -Infinity; }
  observe(detections: readonly VisionDetection[], now: number, announce: (text: string) => boolean,
    approaches: readonly VisualApproachObservation[] = [],ordinaryEnabled=true,
    announceApproach:(text:string)=>boolean=announce): string | null {
    if (!Number.isFinite(now)) return null;
    const current = new Map<string, SpokenTrack>();
    for (const detection of detections) {
      if (!detection.trackId || detection.tracking?.state !== 'TRACKED' || detection.tracking.observations < 2 ||
        !Number.isFinite(detection.confidence) || detection.confidence < .65 || detection.confidence > 1 ||
        excluded.has(detection.type) || detection.source === 'SEGMENTATION' || !validNormalizedBox(detection.boundingBox) ||
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
      .filter(item => item.approach && now - item.track.approachAt >= 20000)
      .sort((a, b) => Number(b.approach!.state === 'STRONG_APPROACH') - Number(a.approach!.state === 'STRONG_APPROACH'))[0];
    if (approaching) {
      const { track, approach } = approaching, name = this.copy.object[track.detection.type], direction = this.copy.direction[track.detection.horizontalDirection];
      const text = approach!.state === 'STRONG_APPROACH' ? this.copy.approachStrong(name, direction) : this.approachPhrase(name, direction);
      if (!announceApproach(text)) return null;
      track.approachAt = now; this.lastSpeech = now;
      return text;
    }
    if(!ordinaryEnabled)return null;
    const candidates = Array.from(current.values()).filter(track => track.announcedDirection !== track.detection.horizontalDirection && now - track.announcedAt >= 9000)
      .sort((a, b) => central(b.detection.horizontalDirection) - central(a.detection.horizontalDirection) ||
        b.detection.boundingBox.width * b.detection.boundingBox.height - a.detection.boundingBox.width * a.detection.boundingBox.height).slice(0, 2);
    if (!candidates.length) return null;
    const text = `${candidates.map(track => `${this.copy.object[track.detection.type]} ${this.copy.direction[track.detection.horizontalDirection]}`).join('، ')}.`;
    if (!announce(text)) return null;
    for (const track of candidates) { track.announcedDirection = track.detection.horizontalDirection; track.announcedAt = now; }
    this.lastSpeech = now;
    return text;
  }
}
