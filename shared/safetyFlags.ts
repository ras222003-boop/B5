/** Centrally controlled high sensitivity features. All fail closed when unavailable. */
export interface SafetyFlags {
  dropOffDetection:boolean;
  stairDirection:boolean;
  metricDepth:boolean;
  nativeArLocalization:boolean;
  experimentalObstacleClasses:boolean;
}
export const SAFE_DEFAULT_FLAGS:SafetyFlags={dropOffDetection:false,stairDirection:false,metricDepth:false,nativeArLocalization:false,experimentalObstacleClasses:false};
