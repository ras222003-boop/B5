import { describe, it, expect } from 'vitest';
import { BASIRA_LAB_LANDMARK, parseLandmarkEvent } from './imageTargetLandmarks';

describe('Basira 8th Wall image landmarks', () => {
  it('accepts only a registered image target name and type-safe event details', () => {
    expect(parseLandmarkEvent({detail:{name:'basira-lab-entrance'}},'found',17))
      .toEqual({name:'basira-lab-entrance', observedAt:17, state:'found'});
    expect(parseLandmarkEvent({detail:{name:'basira-lab-entrance'}},'lost',20)?.state).toBe('lost');
    expect(parseLandmarkEvent({detail:{name:'unknown-sign', route:'/safe-route'}},'found',17)).toBeNull();
    expect(parseLandmarkEvent({detail:'anything'},'found',17)).toBeNull();
    expect(parseLandmarkEvent(null,'found',17)).toBeNull();
    expect(parseLandmarkEvent({detail:{name:'basira-lab-entrance'}},'found',NaN)).toBeNull();
  });
  it('never claims the demo marker validates a real-world building location', () => {
    expect(BASIRA_LAB_LANDMARK.isVerifiedBuildingLocation).toBe(false);
    expect(BASIRA_LAB_LANDMARK.description).toContain('لا يعني');
  });
});
