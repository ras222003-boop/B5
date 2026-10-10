/** Centrally controlled high sensitivity features. All fail closed when unavailable. */
export interface SafetyFlags {
  dropOffDetection:boolean;
  stairDirection:boolean;
  metricDepth:boolean;
  nativeArLocalization:boolean;
  experimentalObstacleClasses:boolean;
}
// Metric depth remains inactive unless a validated native depth bridge is present.
// Enable it by default so a supported phone can honor the selected metre range;
// BASIRA_METRIC_DEPTH=false remains an immediate server-side kill switch.
export const SAFE_DEFAULT_FLAGS:SafetyFlags={dropOffDetection:false,stairDirection:false,metricDepth:true,nativeArLocalization:false,experimentalObstacleClasses:false};
