import { describe, expect, it, vi } from 'vitest';
import { VISION_OBJECT_TYPES, type VisionDetection } from '@shared/vision';
import { visionMessages } from '@/i18n/locales/vision';
import { ObjectSpeechTracker } from './objectSpeech';
import type { VisualApproachObservation } from './visualApproach';
const detection = (at: number, changes: Partial<VisionDetection> = {}): VisionDetection => ({ id: `d-${at}`, trackId: 'chair-1', type: 'CHAIR', confidence: .9,
  boundingBox: { x: .4, y: .3, width: .2, height: .4 }, horizontalDirection: 'FRONT', verticalPosition: 'MIDDLE', approximateDistance: null,
  timestamp: at, source: 'OBJECT_DETECTOR', tracking: { state: 'TRACKED', observations: 4, firstSeenAt: 0, lastSeenAt: at, gapMs: 200 }, ...changes });
const approach = (at: number): VisualApproachObservation => ({ trackId: 'chair-1', type: 'CHAIR', state: 'POSSIBLE_APPROACH', capturedAt: at, frameId: `f-${at}`,
  reasons: [], evidence: ['TRACKING', 'BOX_EXPANSION', 'COMPENSATED_OPTICAL_FLOW'], experimental: true });
describe('automatic object speech without metres', () => {
  it('announces a tracked object with camera-relative direction and no distance', () => {
    const tracker = new ObjectSpeechTracker(visionMessages.ar), announce = vi.fn(() => true);
    expect(tracker.observe([detection(1000)], 1000, announce)).toBe('كرسي أمام الكاميرا.');
    expect(tracker.observe([detection(6000)], 6000, announce)).toBeNull(); expect(announce).toHaveBeenCalledTimes(1);
  });
  it('prioritizes center, groups two objects and paces direction changes', () => {
    const tracker = new ObjectSpeechTracker(visionMessages.ar, 1000), announce = vi.fn(() => true);
    const person = detection(1000, { type: 'PERSON', trackId: 'person-1', horizontalDirection: 'LEFT' });
    expect(tracker.observe([person, detection(1000)], 1000, announce)).toBe('كرسي أمام الكاميرا، شخص إلى يسار الكاميرا.');
    expect(tracker.observe([detection(2000, { horizontalDirection: 'RIGHT' })], 2000, announce)).toBeNull();
    expect(tracker.observe([detection(11000, { horizontalDirection: 'RIGHT' })], 11000, announce)).toBe('كرسي إلى يمين الكاميرا.');
  });
  it('cannot produce an approach warning from box growth alone', () => {
    const tracker = new ObjectSpeechTracker(visionMessages.ar, 1000), announce = vi.fn(() => true);
    tracker.observe([detection(1000)], 1000, announce);
    expect(tracker.observe([detection(3000, { boundingBox: { x: .1, y: .1, width: .8, height: .8 } })], 3000, announce)).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });
  it('requires current corroborated evidence and preserves experimental wording', () => {
    const tracker = new ObjectSpeechTracker(visionMessages.ar, 1000), announce = vi.fn(() => true);
    tracker.observe([detection(1000)], 1000, announce);
    expect(tracker.observe([detection(2000)], 2000, announce, [approach(1000)])).toBeNull();
    const text = tracker.observe([detection(3000)], 3000, announce, [approach(3000)]);
    expect(text).toContain('تجريبي'); expect(text).toContain('قد تكون تقترب'); expect(text).not.toMatch(/متر|اصطدام/);
    expect(tracker.observe([detection(5000)], 5000, announce, [approach(5000)])).toBeNull();
  });
  it('does not speak stale, repeated, ambiguous, missing or nonfinite detections', () => {
    const tracker = new ObjectSpeechTracker(visionMessages.ar, 0), announce = vi.fn(() => true);
    expect(tracker.observe([detection(1000)], 3000, announce)).toBeNull();
    expect(tracker.observe([detection(4000, { confidence: NaN })], 4000, announce)).toBeNull();
    expect(tracker.observe([detection(4000, { trackId: undefined })], 4000, announce)).toBeNull();
    tracker.observe([detection(5000)], 5000, announce);
    expect(tracker.observe([detection(5000)], 5100, announce, [approach(5000)])).toBeNull();
    expect(tracker.observe([], 5300, announce, [approach(5000)])).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });
  it('retries a rejected announcement on a fresh frame', () => {
    const tracker = new ObjectSpeechTracker(visionMessages.ar), announce = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    expect(tracker.observe([detection(1000)], 1000, announce)).toBeNull();
    expect(tracker.observe([detection(1200)], 1200, announce)).toContain('كرسي');
  });
  it('has names for every shared object type in every language', () => {
    for (const copy of Object.values(visionMessages)) for (const type of VISION_OBJECT_TYPES) expect(copy.object[type]).toBeTruthy();
  });
  it('keeps experimental approach speech independent of ordinary descriptions',()=>{
    const tracker=new ObjectSpeechTracker(visionMessages.ar),ordinary=vi.fn(()=>true),alert=vi.fn(()=>true);
    expect(tracker.observe([detection(1000)],1000,ordinary,[],false,alert)).toBeNull();
    expect(tracker.observe([detection(1200)],1200,ordinary,[approach(1200)],false,alert)).toContain('تجريبي');
    expect(ordinary).not.toHaveBeenCalled();expect(alert).toHaveBeenCalledOnce();
  });
});
