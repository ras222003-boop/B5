import { afterEach, describe, expect, it } from 'vitest';
import { getBasiraArCameraOwner, releaseBasiraArCamera, reserveBasiraArCamera } from './cameraOwnership';

afterEach(() => {
  for (const id of ['basira-image-target-lab', 'basira-effect-face', 'basira-effect-sky']) releaseBasiraArCamera(id);
});

describe('Basira AR camera reservation', () => {
  it('prevents two AR labs acquiring the same camera simultaneously', () => {
    expect(reserveBasiraArCamera('basira-image-target-lab')).toBe(true);
    expect(reserveBasiraArCamera('basira-effect-face')).toBe(false);
    expect(getBasiraArCameraOwner()).toBe('basira-image-target-lab');
  });
  it('ignores releases from a different owner and allows an appropriate owner to stop', () => {
    expect(reserveBasiraArCamera('basira-effect-sky')).toBe(true);
    releaseBasiraArCamera('basira-effect-face');
    expect(getBasiraArCameraOwner()).toBe('basira-effect-sky');
    releaseBasiraArCamera('basira-effect-sky');
    expect(getBasiraArCameraOwner()).toBeNull();
  });
  it('rejects an empty owner', () => {
    expect(reserveBasiraArCamera(' ')).toBe(false);
  });
});
