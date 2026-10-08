/** Data contracts shared by B2 and future native/on-device vision adapters. */
export const VISION_OBJECT_TYPES = [
  'PERSON', 'CHAIR', 'TABLE', 'DOOR', 'WALL', 'COLUMN', 'STAIRS_UP',
  'STAIRS_DOWN', 'STAIRS_UNCERTAIN', 'ELEVATOR', 'VEHICLE', 'BICYCLE',
  'CART', 'BOX', 'BARRIER', 'SIGN', 'CORRIDOR', 'ENTRANCE', 'EXIT',
  'UNKNOWN_OBSTACLE', 'DROP_OFF', 'DROP_OFF_UNCERTAIN',
] as const;
export type VisionObjectType = typeof VISION_OBJECT_TYPES[number];
export type HorizontalDirection = 'LEFT' | 'FRONT_LEFT' | 'FRONT' | 'FRONT_RIGHT' | 'RIGHT';
export type VerticalPosition = 'TOP' | 'MIDDLE' | 'BOTTOM';
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFORMATION';
export type DistanceBand = 'VERY_CLOSE' | 'CLOSE' | 'MEDIUM' | 'FAR' | 'UNKNOWN';
export type VisionMode = 'EXPLORATION' | 'NAVIGATION';
export interface BoundingBox { x: number; y: number; width: number; height: number }
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
  /** A negative camera quality gate; NOT_LOW_LIGHT is not a safety clearance. */
  cameraLight?: 'LOW_LIGHT' | 'NOT_LOW_LIGHT' | 'UNKNOWN';
  capturedAt: number;
}

export type PathAhead = 'CLEAR' | 'BLOCKED' | 'UNKNOWN';
export interface WalkableAreaResult {
  pathAhead: PathAhead;
  freeSpaceLeft: number;
  freeSpaceCenter: number;
  freeSpaceRight: number;
  confidence: number;
  source: 'SEMANTIC_SEGMENTATION';
}
/** SegFormer labels sampled to a small grid. A mask has no calibrated per-pixel confidence. */
export interface SegmentationGrid { width: number; height: number; labels: Uint8Array; timestamp: number }
/** Relative monocular values have no metre scale and cannot be used as metric distance. */
export interface RelativeDepthMap { width: number; height: number; values: Float32Array; confidence: number; source: 'MONOCULAR_ESTIMATE'; timestamp: number }
export interface MetricDepthMap { width: number; height: number; values: Float32Array; confidence: number; source: 'ARKIT_DEPTH' | 'LIDAR' | 'ARCORE_DEPTH' | 'DEPTH_SENSOR'; timestamp: number }

/** Frame input is ephemeral; providers must never retain or upload it implicitly. */
export interface VisionProvider { detect(frame: HTMLVideoElement | HTMLCanvasElement, timestamp: number): Promise<VisionDetection[]>; close(): Promise<void> }
export interface SceneSegmentationProvider { segment(frame: Blob, timestamp: number): Promise<SegmentationGrid>; close(): Promise<void> }
export interface RelativeDepthProvider { estimate(frame: Blob, timestamp: number): Promise<RelativeDepthMap>; close(): Promise<void> }
export interface MetricDepthProvider { capture(timestamp: number): Promise<MetricDepthMap | null>; close(): Promise<void> }
export interface WalkableAreaProvider { analyze(grid: SegmentationGrid, detections: VisionDetection[]): WalkableAreaResult }
export interface OCRProvider { recognize(frame: { blob: Blob; width: number; height: number }, timestamp: number): Promise<OCRDetection[]>; close(): Promise<void> }
export interface DepthProvider { read(detection: VisionDetection): Promise<DepthReading | null>; close(): Promise<void> }
export interface ObstacleProvider { classify(detection: VisionDetection): ObstacleDetection }
export interface HapticFeedbackProvider { critical(): void }
