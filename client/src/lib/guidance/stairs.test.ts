import { describe, expect, it } from 'vitest';
import type { SceneDescription, VisionDetection } from '@shared/vision';
import { StairAssistantEngine, observedStairEvidence, type StairEvidence } from './stairs';

const at = 1_000;
const evidence = (changes: Partial<StairEvidence> = {}): StairEvidence =>
  ({ direction: 'UP', confidence: 0.9, source: 'NATIVE', timestamp: at, ...changes });
const scene = (object: Partial<VisionDetection>, capturedAt = at): SceneDescription => ({
  shortText: '', detailedText: '', riskLevel: null, recognizedPlace: null, capturedAt,
  objects: [{ id: 'stair', type: 'STAIRS_UNCERTAIN', confidence: 0.7,
    boundingBox: { x: 0.2, y: 0.3, width: 0.6, height: 0.6 }, horizontalDirection: 'FRONT',
    verticalPosition: 'BOTTOM', approximateDistance: null, timestamp: capturedAt, source: 'SEGMENTATION', ...object }],
});

describe('Basira Stair Assistant simulated evidence', () => {
  it('treats a three-step-up fixture as an approach, with no claimed step confirmation', () => {
    const stair = new StairAssistantEngine('HAPTIC_ONLY');
    expect(stair.approach(evidence({ visibleSteps: 3, stepCountConfidence: 0.95 }), at).phase).toBe('APPROACH');
    expect(stair.countDescription(evidence({ visibleSteps: 3, stepCountConfidence: 0.95 }))).toContain('نحو 3');
    expect(stair.confirmStart(at + 100).phase).toBe('ASCENDING');
    const cue = stair.motionStep(at + 500);
    expect(cue.estimatedStepCue).toBe(false);
    expect(cue.detectedStep).toBe(false);
    expect(stair.motionStep(at + 600).estimatedStepCue).toBe(false);
  });

  it('keeps a ten-step-up fixture approximate and never invents a count from a partial or occluded view', () => {
    const stair = new StairAssistantEngine();
    expect(stair.countDescription(evidence({ visibleSteps: 10, stepCountConfidence: 0.92 }))).toContain('نحو 10');
    expect(stair.countDescription(evidence({ visibleSteps: 10, stepCountConfidence: 0.4 }))).toBeNull();
    expect(stair.countDescription(evidence({ visibleSteps: null, stepCountConfidence: 0.95 }))).toBeNull();
    expect(stair.countDescription(evidence({ visibleSteps: 12, stepCountConfidence: 0.95 }))).toBeNull();
  });

  it('requires explicit start confirmation for a descending fixture and never treats motion as a detected stair', () => {
    const stair = new StairAssistantEngine('SOUND_HAPTIC');
    stair.approach(evidence({ direction: 'DOWN' }), at);
    expect(stair.phase).toBe('APPROACH');
    expect(stair.confirmStart(at + 200).phase).toBe('DESCENDING');
    expect(stair.motionStep(at + 700)).toMatchObject({ estimatedStepCue: false, detectedStep: false });
  });

  it('requires flat surface plus landing evidence and supports a second flight', () => {
    const stair = new StairAssistantEngine();
    stair.approach(evidence(), at); stair.confirmStart(at + 100);
    expect(stair.observeLanding(evidence({ landingConfidence: 0.9, flatSurfaceConfidence: 0.6 }), at + 500).phase).toBe('ASCENDING');
    expect(stair.observeLanding(evidence({ timestamp: at + 500, landingConfidence: 0.9, flatSurfaceConfidence: 0.9 }), at + 500).phase).toBe('LANDING');
    expect(stair.continueFlight().phase).toBe('ASCENDING');
    expect(stair.observeEnd(evidence({ timestamp: at + 900, flatSurfaceConfidence: 0.9, motionTransitionConfidence: 0.85 }), at + 900).phase).toBe('VERIFY_END');
    expect(stair.confirmEnd().phase).toBe('IDLE');
  });

  it('does not infer stair direction from the web segmentation fixture, dim view, or stale view', () => {
    expect(observedStairEvidence(scene({ type: 'STAIRS_UP', confidence: 0.9, source: 'SEGMENTATION' }), at)?.direction).toBe('UNKNOWN');
    expect(observedStairEvidence(scene({ type: 'STAIRS_DOWN', confidence: 0.45, source: 'NATIVE' }), at)?.direction).toBe('UNKNOWN');
    expect(observedStairEvidence(scene({ type: 'STAIRS_UP', confidence: 0.95, source: 'NATIVE' }), at + 4000)).toBeNull();
    const stair = new StairAssistantEngine();
    stair.approach(evidence({ direction: 'UNKNOWN', confidence: 0.6 }), at);
    expect(stair.confirmStart(at + 100).phase).toBe('APPROACH');
  });

  it('does not call a stair at the side of the camera field a stair ahead', () => {
    expect(observedStairEvidence(scene({ horizontalDirection: 'LEFT', source: 'NATIVE', confidence: .95 }), at)).toBeNull();
    expect(observedStairEvidence(scene({ horizontalDirection: 'FRONT_RIGHT', source: 'NATIVE', confidence: .95 }), at)).not.toBeNull();
  });

  it('halts on conflicting map and vision directions until the user verifies the stair',()=>{
    const stair=new StairAssistantEngine();
    stair.approach(evidence({direction:'UP',source:'MAP'}),at);
    expect(stair.approach(evidence({direction:'DOWN',source:'NATIVE',timestamp:at+100}),at+100).message).toContain('تعارضت');
    expect(stair.confirmStart(at+200).phase).toBe('APPROACH');
    stair.chooseDirection('DOWN',at+300);
    expect(stair.confirmStart(at+350).phase).toBe('DESCENDING');
  });

  it('does not announce stair end from map evidence or a single uncertain flat reading', () => {
    const stair = new StairAssistantEngine();
    stair.approach(evidence(), at); stair.confirmStart(at + 100);
    expect(stair.observeEnd(evidence({ source: 'MAP', flatSurfaceConfidence: 1, motionTransitionConfidence: 1 }), at + 200).phase).toBe('ASCENDING');
    expect(stair.observeEnd(evidence({ flatSurfaceConfidence: 0.9, motionTransitionConfidence: 0.2 }), at + 200).phase).toBe('ASCENDING');
    expect(stair.confirmEnd().message).toContain('بتأكيدك');
  });
});
