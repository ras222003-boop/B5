import { describe, expect, it } from 'vitest';
import { ocrRefreshInterval } from './pipeline';

describe('contextual room-sign reading', () => {
  it('keeps OCR sparse until the final approach and bounds the faster interval', () => {
    expect(ocrRefreshInterval('NAVIGATION', false, 8000)).toBe(8000);
    expect(ocrRefreshInterval('EXPLORATION', true, 8000)).toBe(8000);
    expect(ocrRefreshInterval('NAVIGATION', true, 8000)).toBe(2500);
    expect(ocrRefreshInterval('NAVIGATION', true, 1000)).toBe(1500);
  });
});
