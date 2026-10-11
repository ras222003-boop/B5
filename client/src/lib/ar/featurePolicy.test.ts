import { describe, expect, it } from 'vitest';
import {
  BASIRA_AR_FEATURES,
  DEFAULT_BASIRA_AR_ACCESS,
  evaluateBasiraArAccess,
  type BasiraArAccessContext,
  type BasiraArFeatureId,
} from './featurePolicy';

const ready: BasiraArAccessContext = {
  enabled: true,
  binaryLicenseApproved: true,
  secureContext: true,
  cameraSupported: true,
  userConsented: true,
  runtimeReady: true,
};

describe('Basira WebAR additive feature policy', () => {
  it('keeps every WebAR feature off by default', () => {
    for (const feature of BASIRA_AR_FEATURES) {
      expect(evaluateBasiraArAccess(feature.id)).toBe('disabled');
    }
    expect(DEFAULT_BASIRA_AR_ACCESS.binaryLicenseApproved).toBe(false);
  });

  it('cannot label world tracking or absolute scale approved before the license check', () => {
    for (const feature of ['world-tracking', 'world-effects', 'absolute-scale'] as BasiraArFeatureId[]) {
      expect(evaluateBasiraArAccess(feature, { ...ready, binaryLicenseApproved: false })).toBe('license-review');
    }
  });

  it('allows MIT candidates to reach experimental state only when every prerequisite is satisfied', () => {
    expect(evaluateBasiraArAccess('image-targets', { ...ready, binaryLicenseApproved: false })).toBe('experimental');
    expect(evaluateBasiraArAccess('face-effects', { ...ready, userConsented: false })).toBe('permission-required');
    expect(evaluateBasiraArAccess('sky-effects', { ...ready, secureContext: false })).toBe('unsupported');
    expect(evaluateBasiraArAccess('image-targets', { ...ready, cameraSupported: false })).toBe('unsupported');
    expect(evaluateBasiraArAccess('image-targets', { ...ready, runtimeReady: false })).toBe('sdk-unavailable');
  });

  it('never represents visual tracking as verified object distance in metres', () => {
    for (const feature of BASIRA_AR_FEATURES) {
      expect(feature.providesObjectDistanceMeters).toBe(false);
    }
  });
});
