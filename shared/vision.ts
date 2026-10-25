/** Data contracts shared by B2 and future native/on-device vision adapters. */
export const VISION_OBJECT_TYPES = [
  'PERSON', 'CHAIR', 'TABLE', 'DOOR', 'WALL', 'COLUMN', 'STAIRS_UP',
  'STAIRS_DOWN', 'STAIRS_UNCERTAIN', 'ELEVATOR', 'VEHICLE', 'CAR', 'BUS', 'TRUCK', 'MOTORCYCLE', 'BICYCLE',
  'CART', 'BOX', 'BARRIER', 'SIGN', 'CORRIDOR', 'ENTRANCE', 'EXIT',
  'UNKNOWN_OBSTACLE', 'DROP_OFF', 'DROP_OFF_UNCERTAIN',
  'SOFA', 'BED', 'BACKPACK', 'HANDBAG', 'SUITCASE', 'BOTTLE', 'DOG', 'CAT',
] as const;
export type VisionObjectType = typeof VISION_OBJECT_TYPES[number];
export type HorizontalDirection = 'LEFT' | 'FRONT_LEFT' | 'FRONT' | 'FRONT_RIGHT' | 'RIGHT';
export type VerticalPosition = 'TOP' | 'MIDDLE' | 'BOTTOM';
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFORMATION';
export type DistanceBand = 'VERY_CLOSE' | 'CLOSE' | 'MEDIUM' | 'FAR' | 'UNKNOWN';
export type VisionMode = 'EXPLORATION' | 'NAVIGATION';
export interface BoundingBox { x: number; y: number; width: number; height: number }
/** Association quality, not a claim about world motion or identity beyond this camera session. */
export interface ObjectTracking {
  state: 'TENTATIVE' | 'TRACKED' | 'AMBIGUOUS' | 'REACQUIRED';
  observations: number;
  firstSeenAt: number;
  lastSeenAt: number;
  gapMs: number;
}
export interface DepthReading {
  distanceMeters: number;
  confidence: number;
  source: 'ARKIT_DEPTH' | 'LIDAR' | 'ARCORE_DEPTH' | 'DEPTH_SENSOR' | 'MONOCULAR_ESTIMATE';
}
export interface VisionDetection {
  id: string;
  type: VisionObjectType;
  confidence: number;
  boundingBox: BoundingBox;
  horizontalDirection: HorizontalDirection;
  verticalPosition: VerticalPosition;
  approximateDistance: DepthReading | null;
  timestamp: number;
  source: 'OBJECT_DETECTOR' | 'SEGMENTATION' | 'DEPTH_FUSION' | 'OCR_SIGN' | 'NATIVE' | 'CLOUD';
  /** Native/custom providers can establish a stable ID across frames. */
  trackId?: string;
  tracking?: ObjectTracking;
  /** A model score is not calibrated probability; region heuristics are not class scores. */
  confidenceKind?: 'MODEL_SCORE' | 'REGION_HEURISTIC' | 'UNSPECIFIED';
  evidence?: readonly string[];
  /** A supported detector label, separate from the navigation type mapping. */
  cocoClass?:string;
  color?:ObjectColorObservation;
  /** Display-only research detections must never enter guidance or fall alerts. */
  experimental?:{modelId:string;modelSha256:string;classId:number;navigationEligible:false;referenceLabel:false};
}
export type ObjectColorName='red'|'blue'|'green'|'yellow'|'orange'|'purple'|'pink'|'black'|'white'|'gray'|'brown'|'multicolor';
export interface ObjectColorObservation {
  name:ObjectColorName|null;status:'ESTIMATED'|'MASK_SUPPORTED'|'UNCLEAR';
  reason:'BOX_ESTIMATE'|'ALIGNED_INSTANCE_MASK'|'LOW_LIGHT'|'CLIPPED_OR_REFLECTIVE'|'BACKGROUND_AMBIGUOUS'|'MIXED_OR_OCCLUDED'|'TOO_SMALL'|'WARMING_UP'|'CHANGING';
  supportFraction:number;samples:number;timestamp:number;stableFrames:number;calibrated:false;
}
export interface ObstacleDetection extends VisionDetection {
  riskLevel: RiskLevel;
  distanceBand: DistanceBand;
  reason: 'TYPE' | 'PROXIMITY' | 'UNCERTAIN';
}
export interface OCRDetection {
  text: string;
  confidence: number;
  boundingBox: BoundingBox | null;
  timestamp: number;
  language: 'ar' | 'en' | 'zh-CN' | 'unknown';
}
export interface PlaceCandidate {
  id: string;
  detectedText: string;
  suggestedType: 'CLASSROOM' | 'OFFICE' | 'ELEVATOR' | 'EXIT' | 'ENTRANCE' | 'PHARMACY' | 'CLINIC' | 'OTHER';
  confidence: number;
  buildingId: string | null;
  floorId: string | null;
  capturedAt: number;
  source: 'VISION';
  reviewStatus: 'PENDING';
  lookupStatus: 'NOT_FOUND' | 'UNAVAILABLE';
  doorDirection?: HorizontalDirection;
}
export interface RecognizedPlace { placeId: string; name: string; buildingId: string; floorId: string; confidence: number; doorDirection?: HorizontalDirection }
export interface SceneDescription {
  shortText: string;
  detailedText: string;
  riskLevel: RiskLevel | null;
  objects: VisionDetection[];
  recognizedPlace: RecognizedPlace | null;
  walkableArea?: WalkableAreaResult;
  /** Raw semantic surface observation. It is shown to the user but never treated as a clearance decision in low light. */
  surfaceAnalysis?: WalkableAreaResult;
  /** A negative camera quality gate; NOT_LOW_LIGHT is not a safety clearance. */
  cameraLight?: 'LOW_LIGHT' | 'NOT_LOW_LIGHT' | 'UNKNOWN';
  capturedAt: number;
}

export type PathAhead = 'CLEAR' | 'BLOCKED' | 'UNKNOWN';
export type GroundSurface = 'FLOOR' | 'ROAD' | 'SIDEWALK' | 'PATH' | 'UNKNOWN';
export interface WalkableAreaResult {
  pathAhead: PathAhead;
  freeSpaceLeft: number;
  freeSpaceCenter: number;
  freeSpaceRight: number;
  confidence: number;
  source: 'SEMANTIC_SEGMENTATION';
  surface?: GroundSurface;
  surfaceCoverage?: number;
}
/** SegFormer labels sampled to a small grid. A mask has no calibrated per-pixel confidence. */
export interface SegmentationGrid { width: number; height: number; labels: Uint8Array; timestamp: number }
/** Relative monocular values have no metre scale and cannot be used as metric distance. */
export interface RelativeDepthMap { width: number; height: number; values: Float32Array; confidence: number; source: 'MONOCULAR_ESTIMATE'; timestamp: number }
/** Camera-space metric pixels; alignmentVerified is set only by a trusted RGB+depth adapter. */
export interface MetricDepthMap { width: number; height: number; values: Float32Array; confidence: number; source: 'ARKIT_DEPTH' | 'LIDAR' | 'ARCORE_DEPTH' | 'DEPTH_SENSOR'; timestamp: number; alignmentVerified?: boolean }
/** Unverified monocular metres are for the opt-in object-distance display only. */
export interface EstimatedMetricDepthMap { width: number; height: number; values: Float32Array; source: 'MONOCULAR_METRIC'; timestamp: number }

/** Frame input is ephemeral; providers must never retain or upload it implicitly. */
export interface VisionProvider { readonly usagePolicy?:'EXPERIMENTAL_DISPLAY_ONLY'; detect(frame: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas, timestamp: number): Promise<VisionDetection[]>; close(): Promise<void> }
export interface SceneSegmentationProvider { segment(frame: Blob, timestamp: number): Promise<SegmentationGrid>; close(): Promise<void> }
export interface RelativeDepthProvider { estimate(frame: Blob, timestamp: number): Promise<RelativeDepthMap>; close(): Promise<void> }
export interface MetricDepthProvider { capture(timestamp: number): Promise<MetricDepthMap | null>; close(): Promise<void> }
export interface EstimatedMetricDepthProvider { estimate(frame: HTMLCanvasElement, timestamp: number): Promise<EstimatedMetricDepthMap>; close(): Promise<void> }
export interface WalkableAreaProvider { analyze(grid: SegmentationGrid, detections: VisionDetection[]): WalkableAreaResult }
export interface OCRProvider { recognize(frame: { blob: Blob; width: number; height: number }, timestamp: number): Promise<OCRDetection[]>; close(): Promise<void> }
export interface DepthProvider { read(detection: VisionDetection): Promise<DepthReading | null>; close(): Promise<void> }
export interface ObstacleProvider { classify(detection: VisionDetection): ObstacleDetection }
export interface HapticFeedbackProvider { critical(): void }
