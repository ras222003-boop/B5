import { describe, expect, it } from 'vitest';
import type { VisionDetection } from '@shared/vision';
import { ObjectTracker } from './objectTracking';
const item = (x: number, at: number, type: VisionDetection['type'] = 'CHAIR'): VisionDetection => ({
  id: `${at}-${x}`, type, confidence: .9, boundingBox: { x, y: .3, width: .12, height: .3 },
  horizontalDirection: 'FRONT', verticalPosition: 'MIDDLE', approximateDistance: null, timestamp: at, source: 'OBJECT_DETECTOR',
});
const frame = (at: number) => ({ frameId: `frame-${at}`, capturedAt: at, now: at });
describe('conservative object identity', () => {
  it('retains identities across motion and detection reordering', () => {
    const t = new ObjectTracker();
    const a = t.update([item(.1, 1000), item(.65, 1000)], frame(1000)).detections;
    const b = t.update([item(.63, 1200), item(.12, 1200)], frame(1200)).detections;
    expect(b[0].trackId).toBe(a[1].trackId); expect(b[1].trackId).toBe(a[0].trackId);
    expect(b[0].tracking.state).toBe('TRACKED');
  });
  it('does not reuse identity across classes or through ambiguous overlap', () => {
    const t = new ObjectTracker();
    const a = t.update([item(.35, 1000), item(.49, 1000)], frame(1000)).detections;
    const b = t.update([item(.41, 1200), item(.42, 1200)], frame(1200)).detections;
    expect(b.every(d => d.tracking.state === 'AMBIGUOUS')).toBe(true);
    expect(b.every(d => !a.some(old => old.trackId === d.trackId))).toBe(true);
    const c = t.update([item(.41, 1400, 'PERSON')], frame(1400)).detections[0];
    expect(c.tracking.state).toBe('TENTATIVE');
  });
  it('marks reappearance as reacquired and resets its evidence count', () => {
    const t = new ObjectTracker();
    const a = t.update([item(.4, 1000)], frame(1000)).detections[0];
    t.update([], frame(1200));
    const b = t.update([item(.4, 1400)], frame(1400)).detections[0];
    expect(b.trackId).toBe(a.trackId); expect(b.tracking.state).toBe('REACQUIRED'); expect(b.tracking.observations).toBe(1);
  });
  it('rejects stale, repeated, future, malformed and low-confidence observations', () => {
    const t = new ObjectTracker();
    t.update([item(.4, 1000)], frame(1000));
    expect(t.update([item(.4, 1000)], frame(1000)).reason).toBe('REPEATED_FRAME');
    expect(t.update([], { ...frame(1100), now: 3000 }).reason).toBe('STALE_FRAME');
    expect(t.update([], { ...frame(4000), now: 3000 }).reason).toBe('INVALID_FRAME');
    expect(t.update([{ ...item(-.1, 4000) }, { ...item(.4, 4000), confidence: NaN }, item(.4, 2000)], frame(4000)).detections).toEqual([]);
  });
  it('does not revive an identity after reset', () => {
    const t = new ObjectTracker(), first = t.update([item(.4, 1000)], frame(1000)).detections[0];
    t.reset(); expect(t.update([item(.4, 2000)], frame(2000)).detections[0].trackId).not.toBe(first.trackId);
  });
  it('does not carry a colour identity from a cup to a different COCO class',()=>{
    const t=new ObjectTracker();
    const cup=t.update([{...item(.4,1000,'UNKNOWN_OBSTACLE'),cocoClass:'cup'}],frame(1000)).detections[0];
    const fork=t.update([{...item(.4,1200,'UNKNOWN_OBSTACLE'),cocoClass:'fork'}],frame(1200)).detections[0];
    expect(fork.trackId).not.toBe(cup.trackId);expect(fork.tracking.state).toBe('TENTATIVE');
  });
});
