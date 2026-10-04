import type { Place, MapNode, MapEdge } from './navigation';

export const contributionTypes=['PLACE','MAP_NODE','MAP_EDGE','CORRIDOR','INTERSECTION','DOOR','ELEVATOR','STAIRS','ENTRANCE','EXIT','FLOOR_TRANSITION','ACCESSIBILITY_INFO','ROUTE_OBSERVATION','PLACE_NAME_CHANGE','PLACE_MOVED','TEMPORARY_CLOSURE_REPORT'] as const;
export type ContributionType=typeof contributionTypes[number];
export const contributionSources=['VISION','OCR','AUTO_MAPPING','USER_MANUAL','MAPPER','ADMIN','ORGANIZATION'] as const;
export type ContributionSource=typeof contributionSources[number];
export type ContributionStatus='PENDING'|'CORROBORATING'|'COMMUNITY_VERIFIED'|'OFFICIAL'|'REJECTED'|'CONFLICTED'|'STALE';
export type PlaceVisibility='PRIVATE'|'PUBLIC_CANDIDATE'|'PUBLIC_VERIFIED'|'OFFICIAL';
export type MapDecision='CREATE'|'UPDATE'|'MERGE'|'ALIAS'|'CLOSE_EDGE'|'REOPEN_EDGE';
export type IssueType='PLACE_MISSING'|'WRONG_NAME'|'PLACE_MOVED'|'ROAD_CLOSED'|'ELEVATOR_MISSING'|'WRONG_FLOOR'|'WRONG_ACCESSIBILITY'|'UNMARKED_STAIRS'|'BLIND_UNFRIENDLY'|'OTHER';
export type IssueDuration='TEMPORARY'|'PERSISTENT'|'UNKNOWN';

/** Only public entity facts are allowed. No frame, route history, home, saved-place ID or public identity. */
export interface ContributionProposal {
  name:string|null;roomNumber:string|null;aliases:string[];placeType:Place['placeType']|null;
  floorId:string;x:number|null;y:number|null;targetPlaceId:string|null;targetNodeId:string|null;targetEdgeId:string|null;
  geometry:{from:{x:number;y:number};to:{x:number;y:number}}|null;
  fromNodeId:string|null;toNodeId:string|null;transitionToFloorId:string|null;pathType:MapEdge['pathType']|null;distanceMeters:number|null;
  accessibilityInformation:string|null;visuallyImpairedFriendly:boolean|null;temporarilyClosed:boolean|null;
}
export interface ContributionEvidence {
  observedAt:number;localizationConfidence:number|null;ocrConfidence:number|null;
  visualAnchorConfidence:number|null;sourceSessionKey:string|null;sourceDeviceKey:string|null;
  observedFloorId:string|null;observedX:number|null;observedY:number|null;
  floorConsistent:boolean;placeConsistent:boolean;
}
export interface SharedMapContribution {
  id:string;rootId:string;buildingId:string;type:ContributionType;source:ContributionSource;
  status:ContributionStatus;visibility:PlaceVisibility;proposal:ContributionProposal;
  evidence:Omit<ContributionEvidence,'sourceSessionKey'|'sourceDeviceKey'>;
  confidence:number;independentConfirmations:number;conflictCount:number;
  fingerprint:string;createdAt:string;updatedAt:string;reviewedAt:string|null;
}
export interface ContributionConfirmation {id:string;contributionId:string;observedAt:string;confidence:number;source:ContributionSource}
export interface MapConflict {id:string;buildingId:string;rootId:string;opposingContributionId:string;kind:'ROOM_MISMATCH'|'LOCATION_MISMATCH'|'FLOOR_MISMATCH'|'TYPE_MISMATCH'|'OFFICIAL_DISAGREEMENT';status:'OPEN'|'RESOLVED';createdAt:string}
export interface PlaceChangeCandidate {id:string;buildingId:string;previousPlace:Pick<Place,'id'|'name'|'roomNumber'|'floorId'|'localX'|'localY'>;proposedPlace:ContributionProposal;evidence:Omit<ContributionEvidence,'sourceSessionKey'|'sourceDeviceKey'>[];confidence:number;observedAt:string;independentConfirmations:number;status:'PENDING'|'APPROVED'|'REJECTED'}
export interface MapVersion {buildingId:string;version:number;updatedAt:string}
export interface MapChange {id:string;buildingId:string;version:number;changeIndex:number;action:MapDecision|'ROLLBACK';entityType:'PLACE'|'MAP_NODE'|'MAP_EDGE';entityId:string;before:Record<string,unknown>|null;after:Record<string,unknown>|null;sourceType:ContributionSource|'ROLLBACK';createdAt:string}
export interface MapIssueReport {id:string;buildingId:string;floorId:string|null;type:IssueType;duration:IssueDuration;description:string;targetPlaceId:string|null;targetEdgeId:string|null;status:'PENDING'|'REVIEWED'|'DISMISSED';createdAt:string}
export interface SharedMapPolicy {
  minimumIndependentActors:number;minimumDistinctSessions:number;minimumDistinctDevices:number;
  minimumConfidence:number;minimumLocalizationConfidence:number;maximumProximityMeters:number;
  maximumAgeDays:number;minimumObservationSpanHours:number;highImpactObservationSpanHours:number;
  contributionLimitPerHour:number;confirmationLimitPerDay:number;issueLimitPerDay:number;
  sourceReliability:Record<ContributionSource,number>;
}
export const DEFAULT_SHARED_MAP_POLICY:SharedMapPolicy={
  minimumIndependentActors:3,minimumDistinctSessions:2,minimumDistinctDevices:2,
  minimumConfidence:.75,minimumLocalizationConfidence:.55,maximumProximityMeters:3,
  maximumAgeDays:365,minimumObservationSpanHours:0,highImpactObservationSpanHours:24,
  contributionLimitPerHour:20,confirmationLimitPerDay:60,issueLimitPerDay:20,
  sourceReliability:{VISION:.9,OCR:.95,AUTO_MAPPING:.95,USER_MANUAL:.9,MAPPER:1,ADMIN:1,ORGANIZATION:1},
};
export type OperationalEntity=Place|MapNode|MapEdge;
