export type LocalizationSource = 'QR'|'MANUAL'|'VISUAL_PLACE'|'VISION_WALKABLE'|'GPS_BUILDING'|'STEP_MOTION'|'COMPASS'|'GYROSCOPE'|'NATIVE_AR'|'BEACON'|'WIFI'|'NFC'|'BAROMETER';
export type LocalizationState = 'UNANCHORED'|'TRACKING'|'LOCALIZATION_LOST';
export interface LocalizationEstimate {
  buildingId:string|null;floorId:string|null;x:number|null;y:number|null;
  headingDegrees:number|null;confidence:number;uncertaintyRadius:number|null;
  sources:LocalizationSource[];timestamp:number;lastStrongAnchorAt:number|null;
  state:LocalizationState;
}
export interface PositionObservation {
  buildingId:string|null;floorId:string|null;x:number|null;y:number|null;
  headingDegrees:number|null;confidence:number;uncertaintyRadius:number|null;
  source:LocalizationSource;timestamp:number;nodeId?:string|null;placeId?:string|null;
}
export interface MotionSample {timestamp:number;accelerationMagnitude:number|null;rotationRate:number|null;headingDegrees:number|null;stepDetected:boolean;source:'DEVICE_MOTION'|'NATIVE_STEP' }
export interface HeadingEstimate {degrees:number|null;confidence:number;source:'COMPASS'|'GYROSCOPE'|'NATIVE_AR'|'NONE';timestamp:number}
export interface FloorEstimate {floorId:string|null;confidence:number;sources:LocalizationSource[];timestamp:number;transitionPending:boolean}
export interface VisualAnchor {placeId:string;nodeId:string|null;buildingId:string;floorId:string;x:number|null;y:number|null;confidence:number;timestamp:number}
export interface RelocalizationEvent {type:'LOCALIZATION_LOST'|'LOCALIZATION_RECOVERED'|'ANCHOR_APPLIED';estimate:LocalizationEstimate;source?:LocalizationSource;timestamp:number}
export type FloorTransitionType='ENTER_ELEVATOR'|'EXIT_ELEVATOR'|'STAIRS_TRANSITION'|'FLOOR_CONFIRMED';
export interface FloorTransitionEvent {type:FloorTransitionType;floorId:string|null;timestamp:number;source:LocalizationSource}
export interface MappingSession {
  id:string;buildingId:string;startedBy:string;startedAt:string;endedAt:string|null;
  status:'ACTIVE'|'COMPLETED'|'CANCELLED'|'REVIEW_REQUIRED';
  startAnchor:PositionObservation|null;confidence:number;deviceCapabilities:Record<string,boolean>;
}
export interface MappingTrackPoint {
  sessionId:string;timestamp:number;x:number;y:number;floorId:string|null;
  headingDegrees:number|null;confidence:number;sourceSummary:LocalizationSource[];
}
export const suggestionTypes=['NEW_NODE','NEW_EDGE','PLACE_ANCHOR','CORRIDOR','INTERSECTION','DOOR','ELEVATOR','STAIRS','ENTRANCE','EXIT','FLOOR_TRANSITION'] as const;
export type MapSuggestionType=typeof suggestionTypes[number];
export interface MapSuggestion {
  id:string;sessionId:string;buildingId:string;floorId:string|null;type:MapSuggestionType;
  status:'PENDING'|'ACCEPTED'|'REJECTED';confidence:number;
  x:number|null;y:number|null;name:string|null;placeId:string|null;
  suggestedPlaceType:'CLASSROOM'|'OFFICE'|'ELEVATOR'|'EXIT'|'ENTRANCE'|'PHARMACY'|'CLINIC'|'OTHER'|null;
  fromNodeId:string|null;toNodeId:string|null;source:LocalizationSource[];
  geometry:{from:{x:number;y:number};to:{x:number;y:number}}|null;
  dedupKey:string;createdAt:string;reviewedAt:string|null;reviewedBy:string|null;
}
export interface LocalizationConfig {
  defaultStepLengthMeters:number;minStepLengthMeters:number;maxStepLengthMeters:number;
  motionThreshold:number;stepRefractoryMs:number;driftPerStepMeters:number;
  confidenceHalfLifeMs:number;lostThreshold:number;maxAnchorAgeMs:number;
  suggestionMinDistanceMeters:number;dedupRadiusMeters:number;
}
export const DEFAULT_LOCALIZATION_CONFIG:LocalizationConfig={
  defaultStepLengthMeters:.65,minStepLengthMeters:.3,maxStepLengthMeters:1.2,
  motionThreshold:1.2,stepRefractoryMs:350,driftPerStepMeters:.18,
  confidenceHalfLifeMs:60_000,lostThreshold:.3,maxAnchorAgeMs:180_000,
  suggestionMinDistanceMeters:3,dedupRadiusMeters:2.5,
};
export interface BeaconLocalizationProvider {available():boolean;observe():Promise<PositionObservation|null>}
export interface WifiLocalizationProvider {available():boolean;observe():Promise<PositionObservation|null>}
export interface NfcAnchorProvider {available():boolean;scan():Promise<string|null>}
export interface BarometerLocalizationProvider {available():boolean;observeFloor():Promise<FloorEstimate|null>}
export interface NativeArLocalizationProvider {available():boolean;observe():Promise<PositionObservation|null>}
