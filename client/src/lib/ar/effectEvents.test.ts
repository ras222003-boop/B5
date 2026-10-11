import { describe, expect, it } from 'vitest';
import { effectHint, parseBasiraEffectEvent } from './effectEvents';

describe('8th Wall face and sky events', () => {
  it('maps a real face pipeline event without retaining biometrics', () => {
    expect(parseBasiraEffectEvent('face','reality.facefound',{faceId:17,mesh:[100,200]},100))
      .toEqual({kind:'face',state:'found',observedAt:100});
  });
  it('refuses unknown events, other semantic layers and invalid timestamps', () => {
    expect(parseBasiraEffectEvent('face','reality.imagefound',{},10)).toBeNull();
    expect(parseBasiraEffectEvent('sky','reality.layerfound',{name:'road'},10)).toBeNull();
    expect(parseBasiraEffectEvent('sky','reality.layerfound',{name:'sky'},10)?.state).toBe('found');
    expect(parseBasiraEffectEvent('sky','reality.layerfound',{},NaN)).toBeNull();
  });
  it('does not claim segmentation detects collision risks', () => {
    expect(effectHint('sky','found','ar')).toContain('ليس كشفًا للعوائق');
  });
});
