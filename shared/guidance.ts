import type { MapEdge, MapNode, Place } from './navigation';
import type { LocalizationEstimate } from './localization';
import type { HorizontalDirection } from './vision';

export type NavigationState = 'PREPARING'|'READY'|'NAVIGATING'|'PAUSED'|'RELOCALIZING'|'LOST'|'REROUTING'|'ARRIVED'|'CANCELLED'|'FAILED';
export type RouteType = 'RECOMMENDED'|'SHORTEST'|'ACCESSIBLE';
export type RouteSafetyState = 'ROUTE_CLEAR'|'ROUTE_BLOCKED'|'ROUTE_UNCERTAIN';
export type RerouteReason = 'CLOSED_EDGE'|'PERSISTENT_OBSTACLE'|'OFF_ROUTE'|'USER_REQUEST';
export interface NavigationDestination { kind:'place'|'saved'; id:string; name:string; buildingId:string; floorId:string; nodeId:string; placeId?:string|null }
export interface NavigationRoute {
  id:string;origin:MapNode;destination:NavigationDestination;floors:string[];
  orderedNodes:MapNode[];orderedEdges:MapEdge[];totalDistance:number;estimatedSteps:number|null;
  accessibilityScore:number;riskScore:number;confidence:number;routeType:RouteType;
}
export interface NavigationInstruction {id:string;edgeId:string|null;nodeId:string;text:string;kind:'START'|'CONTINUE'|'TURN_LEFT'|'TURN_RIGHT'|'FLOOR_TRANSITION'|'ARRIVAL'|'RELOCALIZE';distanceMeters:number|null;floorId:string;confidence:number}
export interface RouteConstraint {edgeId:string;kind:'OBSTACLE'|'TEMPORARY_CLOSURE'|'CROWD'|'UNCERTAIN_HAZARD';createdAt:number;expiresAt:number}
export interface RouteProgress {nodeIndex:number;edgeIndex:number;distanceRemaining:number|null;fraction:number|null;offRoute:boolean;timestamp:number}
export interface ArrivalEvidence {nodeProximity:boolean;visualPlace:boolean;ocrMatch:boolean;manualConfirmation?:boolean;localizationConfidence:number;doorDirection?:HorizontalDirection|null}
export type NavigationIntent =
  | {type:'NAVIGATE_TO';query:string}
  | {type:'WHERE_AM_I'|'WHAT_IS_AHEAD'|'WHAT_IS_AROUND'|'REPEAT_INSTRUCTION'|'PAUSE_NAVIGATION'|'RESUME_NAVIGATION'|'CANCEL_NAVIGATION'|'REROUTE'}
  | {type:'FIND_OBJECT';query:string}
  | {type:'START_NAVIGATION'}
  | {type:'ACKNOWLEDGE_DISCLAIMER'}
  | {type:'CONFIRM_LOCATION';query:string}
  | {type:'CONFIRM_ARRIVAL'}
  | {type:'NEAREST_PLACE';query:string}
  | {type:'SAVE_PLACE';name:string}
  | {type:'UNKNOWN'};
export interface NavigationSession {id:string;state:NavigationState;route:NavigationRoute|null;destination:NavigationDestination|null;location:LocalizationEstimate|null;progress:RouteProgress|null;instruction:NavigationInstruction|null;safety:RouteSafetyState;startedAt:number;endedAt:number|null;lastRerouteReason:RerouteReason|null;failureReason:string|null}
export interface NavigationPlaceLookup {places:Place[]}
