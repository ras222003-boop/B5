/**
 * Test-only registered landmark. Incoming XR event data must never be used to
 * construct routes, HTML, or destinations without an explicit trusted mapping.
 */
export const BASIRA_IMAGE_TARGET_NAME = 'basira-lab-entrance' as const;

export type BasiraLandmark = Readonly<{
  id: typeof BASIRA_IMAGE_TARGET_NAME;
  title: string;
  description: string;
  isVerifiedBuildingLocation: false;
}>;

export const BASIRA_LAB_LANDMARK: BasiraLandmark = Object.freeze({
  id: BASIRA_IMAGE_TARGET_NAME,
  title: 'مدخل مختبر بصيرة — علامة تدريبية',
  description: 'اكتُشفت علامة اختبار بصيرة. لا يعني ذلك تحديد موقعك داخل مبنى حقيقي.',
  isVerifiedBuildingLocation: false,
});

export type LandmarkDetection = Readonly<{
  name: typeof BASIRA_IMAGE_TARGET_NAME;
  observedAt: number;
  state: 'found' | 'lost';
}>;

/** Reject unknown/untrusted names and malformed events. No geolocation inference. */
export function parseLandmarkEvent(
  incoming: unknown,
  state: 'found' | 'lost',
  observedAt: number,
): LandmarkDetection | null {
  if (!incoming || typeof incoming !== 'object') return null;
  const obj = incoming as { detail?: unknown };
  const details = obj.detail;
  if (!details || typeof details !== 'object') return null;
  if ((details as { name?: unknown }).name !== BASIRA_IMAGE_TARGET_NAME) return null;
  if (!Number.isFinite(observedAt) || observedAt < 0) return null;
  return { name: BASIRA_IMAGE_TARGET_NAME, observedAt, state };
}
