import { describe, expect, it } from 'vitest';
import type { WalkableAreaResult } from '@shared/vision';
import { walkableAreaForLight } from './pipeline';

const clear: WalkableAreaResult = {
  pathAhead: 'CLEAR', freeSpaceLeft: 1, freeSpaceCenter: 1, freeSpaceRight: 1,
  confidence: .9, source: 'SEMANTIC_SEGMENTATION',
};

describe('vision pipeline frame-quality gate', () => {
  it('withholds a clear-space mask unless the sampled camera frame is known to have enough light', () => {
    expect(walkableAreaForLight('UNKNOWN', clear)).toBeNull();
    expect(walkableAreaForLight('LOW_LIGHT', clear)).toBeNull();
    expect(walkableAreaForLight('NOT_LOW_LIGHT', clear)).toEqual(clear);
  });
});
