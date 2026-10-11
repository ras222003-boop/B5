/**
 * Basira experimental WebAR feature registry.
 *
 * This module intentionally does NOT import, activate or fetch any XR SDK.
 * Feature availability does not imply measurement accuracy or walking safety.
 * Restricted binary capabilities must not be enabled commercially without
 * a separate license review and explicit deployment approval.
 */
export type BasiraArFeatureId =
  | 'image-targets'
  | 'face-effects'
  | 'sky-effects'
  | 'world-tracking'
  | 'world-effects'
  | 'absolute-scale';

export type BasiraArLicense = 'MIT' | 'XR_ENGINE_BINARY_RESTRICTED';

export interface BasiraArFeatureDefinition {
  id: BasiraArFeatureId;
  license: BasiraArLicense;
  description: string;
  /** Whether this capability can provide meter values on its own. */
  providesObjectDistanceMeters: false;
}

export const BASIRA_AR_FEATURES: ReadonlyArray<Readonly<BasiraArFeatureDefinition>> = [
  { id: 'image-targets', license: 'MIT', description: 'Recognize registered visual landmarks', providesObjectDistanceMeters: false },
  { id: 'face-effects', license: 'MIT', description: 'Opt-in visual face effects, not identification', providesObjectDistanceMeters: false },
  { id: 'sky-effects', license: 'MIT', description: 'Sky segmentation and visual effects', providesObjectDistanceMeters: false },
  { id: 'world-tracking', license: 'XR_ENGINE_BINARY_RESTRICTED', description: 'Relative camera pose via SLAM', providesObjectDistanceMeters: false },
  { id: 'world-effects', license: 'XR_ENGINE_BINARY_RESTRICTED', description: 'World-anchored visual AR content', providesObjectDistanceMeters: false },
  { id: 'absolute-scale', license: 'XR_ENGINE_BINARY_RESTRICTED', description: 'World-coordinate scale estimate, not per-object depth', providesObjectDistanceMeters: false },
];

export type BasiraArAccessStatus =
  | 'disabled'
  | 'license-review'
  | 'unsupported'
  | 'permission-required'
  | 'sdk-unavailable'
  | 'experimental';

export interface BasiraArAccessContext {
  /** Build or deployment-specific opt-in, NEVER on by default. */
  enabled: boolean;
  /** Review of XR Engine Binary license for the actual commercial offering. */
  binaryLicenseApproved: boolean;
  /** A secure camera-capable environment is mandatory. */
  secureContext: boolean;
  cameraSupported: boolean;
  /** Explicit user action/permission, not inferred from site visit. */
  userConsented: boolean;
  /** A functional engine runtime must actually be loaded before allowing a demo. */
  runtimeReady: boolean;
}

export const DEFAULT_BASIRA_AR_ACCESS: Readonly<BasiraArAccessContext> = Object.freeze({
  enabled: false,
  binaryLicenseApproved: false,
  secureContext: false,
  cameraSupported: false,
  userConsented: false,
  runtimeReady: false,
});

export function getBasiraArFeature(id: BasiraArFeatureId): Readonly<BasiraArFeatureDefinition> {
  const definition = BASIRA_AR_FEATURES.find(feature => feature.id === id);
  if (!definition) throw new Error('Unknown Basira AR feature');
  return definition;
}

export function evaluateBasiraArAccess(
  id: BasiraArFeatureId,
  context: BasiraArAccessContext = DEFAULT_BASIRA_AR_ACCESS,
): BasiraArAccessStatus {
  const feature = getBasiraArFeature(id);
  if (!context.enabled) return 'disabled';
  if (feature.license === 'XR_ENGINE_BINARY_RESTRICTED' && !context.binaryLicenseApproved) return 'license-review';
  if (!context.secureContext || !context.cameraSupported) return 'unsupported';
  if (!context.userConsented) return 'permission-required';
  if (!context.runtimeReady) return 'sdk-unavailable';
  return 'experimental';
}
