/** B1 map data and later navigation provider boundaries. Coordinates are local metres. */
export const buildingTypes = ['University','School','Hospital','Airport','Mall','Government','Office','PublicBuilding','Other'] as const;
export const placeTypes = ['ROOM','CLASSROOM','OFFICE','LAB','RECEPTION','ELEVATOR','STAIRS','RESTROOM','ENTRANCE','EXIT','EMERGENCY_EXIT','CORRIDOR','INTERSECTION','WAITING_AREA','PHARMACY','CLINIC','SERVICE_POINT','PARKING','OTHER'] as const;
export const nodeTypes = ['POINT','ROOM','CORRIDOR','INTERSECTION','DOOR','STAIRS','ELEVATOR','ENTRANCE','EXIT'] as const;
export const savedCategories = ['STUDY','WORK','CAR','HOME','HEALTH','FAVORITE','OTHER'] as const;
export const verificationStatuses = ['DISCOVERED','COMMUNITY_VERIFIED','OFFICIAL'] as const;
export const accessibilityLevels = ['UNKNOWN','STANDARD','ACCESSIBLE'] as const;

export interface Building {
  id: string; name: string; alternativeNames: string[]; organizationName: string | null;
  buildingType: typeof buildingTypes[number]; description: string | null; address: string | null;
  latitude: number | null; longitude: number | null; numberOfFloors: number | null;
  status: 'ACTIVE' | 'INACTIVE'; mapStatus: 'UNMAPPED' | 'IN_PROGRESS' | 'MAPPED';
  verificationStatus: typeof verificationStatuses[number]; createdBy: string | null;
  createdAt: string; updatedAt: string;
}
export interface Floor {
  id: string; buildingId: string; floorNumber: number; name: string; description: string | null;
  floorPlanReference: string | null; localOrigin: { x: number; y: number } | null;
  createdAt: string; updatedAt: string;
}
export interface Place {
  id: string; buildingId: string; floorId: string; name: string; roomNumber: string | null;
  aliases: string[]; departmentName: string | null; description: string | null;
  placeType: typeof placeTypes[number]; localX: number | null; localY: number | null;
  latitude: number | null; longitude: number | null; entranceDirection: string | null;
  accessibilityInformation: string | null; verificationStatus: typeof verificationStatuses[number];
  confidenceScore: number | null; isPublic: boolean; createdBy: string | null;
  createdAt: string; updatedAt: string; floorName?: string; buildingName?: string;
}
export interface MapNode {
  id: string; buildingId: string; floorId: string; placeId: string | null; x: number; y: number;
  nodeType: typeof nodeTypes[number]; accessibilityLevel: typeof accessibilityLevels[number];
}
export interface MapEdge {
  id: string; buildingId: string; fromNodeId: string; toNodeId: string; distanceMeters: number;
  direction: string | null; pathType: 'CORRIDOR' | 'DOOR' | 'STAIRS' | 'RAMP' | 'ELEVATOR' | 'OTHER';
  accessibilityLevel: typeof accessibilityLevels[number]; hasStairs: boolean; hasRamp: boolean;
  wheelchairAccessible: boolean; visuallyImpairedFriendly: boolean; temporarilyClosed: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}
export interface SavedPlace {
  id: string; name: string; category: typeof savedCategories[number]; notes: string | null;
  latitude: number | null; longitude: number | null; buildingId: string | null;
  floorId: string | null; placeId: string | null; isFavorite: boolean;
  lastUsedAt: string | null; createdAt: string; updatedAt: string;
  buildingName?: string | null; floorName?: string | null;
}

/** B2 contracts are re-exported for existing B1 import paths. */
export type { VisionProvider, OCRProvider, DepthProvider, ObstacleProvider, HapticFeedbackProvider,
  SceneSegmentationProvider, RelativeDepthProvider, MetricDepthProvider, WalkableAreaProvider,
  VisionDetection, ObstacleDetection, SceneDescription, DepthReading, OCRDetection, PlaceCandidate, RiskLevel,
  SegmentationGrid, RelativeDepthMap, MetricDepthMap, WalkableAreaResult } from './vision';
export interface IndoorLocalizationProvider { locate(buildingId: string): Promise<{ floorId: string; x: number; y: number } | null> }
export interface NavigationProvider { prepareDestination(placeId: string): Promise<void> }
export interface AutoMapperProvider { importGraph(buildingId: string, nodes: MapNode[], edges: MapEdge[]): Promise<void> }
export interface VoiceNavigationProvider { announce(instruction: string): Promise<void> }
