/** Centrally controlled high sensitivity features. All fail closed when unavailable. */
export interface SafetyFlags {
  dropOffDetection:boolean;
  stairDirection:boolean;
  metricDepth:boolean;
  nativeArLocalization:boolean;
  experimentalObstacleClasses:boolean;
}
// Only the validated native depth bridge may use this existing navigation flag.
// The camera-only Auto Meter is isolated from navigation and never uses it.
// BASIRA_METRIC_DEPTH=false remains the server-side kill switch.
export const SAFE_DEFAULT_FLAGS:SafetyFlags={dropOffDetection:false,stairDirection:false,metricDepth:true,nativeArLocalization:false,experimentalObstacleClasses:false};
