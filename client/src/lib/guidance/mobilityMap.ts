import type { NavigationRoute } from "@shared/guidance";
import type {
  Floor,
  MapEdge,
  MapNode,
  NavigationZone,
  Place,
} from "@shared/navigation";

/** This is map knowledge, not a live obstacle detector or a localization fix. */
export type MobilitySourceKind =
  | "ROUTE_GRAPH"
  | "PLACE"
  | "FLOOR"
  | "ZONE"
  | "DERIVED_GEOMETRY";
export interface MobilitySource {
  kind: MobilitySourceKind;
  id: string;
  /** Heuristic evidence score inherited from the route/map. It is not a measured safety probability. */
  confidence: number;
}
export interface MobilityLandmark {
  id: string;
  name: string;
  kind: "PLACE" | "ZONE";
  floorId: string;
  nodeId: string | null;
  roomNumber: string | null;
  source: MobilitySource;
}
export interface MobilityTurn {
  nodeId: string;
  edgeIndex: number;
  direction: "LEFT" | "RIGHT" | "STRAIGHT" | "BACK";
  /** A bend in mapped local coordinates, not the user's measured heading. */
  angleDegrees: number;
  landmarkId: string | null;
  source: MobilitySource;
}
export interface MobilityDoor {
  id: string;
  nodeId: string | null;
  edgeId: string | null;
  placeId: string | null;
  roomNumber: string | null;
  /** Door opening and side are not represented by the existing map contracts. */
  state: "UNKNOWN";
  relativeSide: null;
  source: MobilitySource;
}
export interface MobilityAccessPoint {
  nodeId: string;
  kind: "ENTRANCE" | "EXIT";
  name: string | null;
  /** A mapped portal does not prove that it is usable at this moment. */
  currentAccess: "UNKNOWN";
  source: MobilitySource;
}
export interface MobilityFloorTransition {
  edgeId: string;
  fromFloorId: string;
  toFloorId: string;
  fromFloorName: string | null;
  toFloorName: string | null;
  method: "STAIRS" | "ELEVATOR" | "RAMP";
  verticalDirection: "UP" | "DOWN" | "UNKNOWN";
  /** The graph does not contain a number of steps or a confirmed landing. */
  stepCount: null;
  landing: "UNKNOWN";
  sources: MobilitySource[];
}
export interface MobilityDocumentedHazard {
  id: string;
  edgeId: string;
  label: string;
  /** Map metadata; never interpreted as a current observed obstacle. */
  severity: "MEDIUM" | "HIGH" | "UNSPECIFIED";
  source: MobilitySource;
}
export interface MobilityAnchorCandidate {
  nodeId: string;
  placeId: string;
  label: string;
  /** A recognizable mapped place, not a QR/NFC/visual observation. */
  observationRequired: true;
  source: MobilitySource;
}
export interface MobilitySegment {
  index: number;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  fromFloorId: string;
  toFloorId: string;
  pathType: MapEdge["pathType"];
  distanceMeters: number;
  mappedDirection: string | null;
  /** The existing graph does not encode corridor width. */
  widthMeters: null;
  accessibilityLevel: MapEdge["accessibilityLevel"];
  riskLevel: MapEdge["riskLevel"];
  temporarilyClosed: boolean;
  landmarkIds: string[];
  hazardIds: string[];
  doorIds: string[];
  accessPointNodeIds: string[];
  transitionEdgeId: string | null;
  confidence: number;
  sources: MobilitySource[];
}
export interface MobilityMap {
  routeId: string;
  destinationName: string;
  destinationRoomNumber: string | null;
  confidence: number;
  valid: boolean;
  issues: string[];
  segments: MobilitySegment[];
  landmarks: MobilityLandmark[];
  turns: MobilityTurn[];
  doors: MobilityDoor[];
  accessPoints: MobilityAccessPoint[];
  floorTransitions: MobilityFloorTransition[];
  documentedHazards: MobilityDocumentedHazard[];
  relocalizationCandidates: MobilityAnchorCandidate[];
}
export interface MobilityMapContext {
  places?: readonly Place[];
  floors?: readonly Floor[];
  zones?: readonly NavigationZone[];
}

const clamp = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const scoreForPlace = (place: Place, routeConfidence: number) =>
  Math.min(
    clamp(routeConfidence),
    place.confidenceScore === null
      ? place.verificationStatus === "OFFICIAL"
        ? 0.9
        : place.verificationStatus === "COMMUNITY_VERIFIED"
          ? 0.75
          : 0.5
      : clamp(place.confidenceScore)
  );
const bearing = (a: MapNode, b: MapNode) =>
  (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
const signedTurn = (previous: MapNode, current: MapNode, next: MapNode) =>
  ((bearing(current, next) - bearing(previous, current) + 540) % 360) - 180;
const contains = (zone: NavigationZone, point: MapNode) =>
  point.floorId === zone.floorId &&
  point.x >= zone.minX &&
  point.x <= zone.maxX &&
  point.y >= zone.minY &&
  point.y <= zone.maxY;
/** Segment/axis-aligned-zone overlap, including a corridor that crosses a zone between nodes. */
function crossesZone(
  zone: NavigationZone,
  from: MapNode,
  to: MapNode
): boolean {
  if (from.floorId !== zone.floorId || to.floorId !== zone.floorId)
    return false;
  if (contains(zone, from) || contains(zone, to)) return true;
  const dx = to.x - from.x,
    dy = to.y - from.y;
  let enter = 0,
    leave = 1;
  for (const [p, q] of [
    [-dx, from.x - zone.minX],
    [dx, zone.maxX - from.x],
    [-dy, from.y - zone.minY],
    [dy, zone.maxY - from.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

/** Derive only what the current graph and mapped place/zone records can actually support. */
export function buildMobilityMap(
  route: NavigationRoute,
  context: MobilityMapContext = {}
): MobilityMap {
  const result: MobilityMap = {
    routeId: route.id,
    destinationName: route.destination.name,
    destinationRoomNumber: null,
    confidence: clamp(route.confidence),
    valid: true,
    issues: [],
    segments: [],
    landmarks: [],
    turns: [],
    doors: [],
    accessPoints: [],
    floorTransitions: [],
    documentedHazards: [],
    relocalizationCandidates: [],
  };
  const nodes = route.orderedNodes,
    edges = route.orderedEdges;
  if (
    nodes.length !== edges.length + 1 ||
    nodes[0]?.id !== route.origin.id ||
    nodes.at(-1)?.id !== route.destination.nodeId
  ) {
    result.valid = false;
    result.issues.push("route_structure_mismatch");
    return result;
  }
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index],
      from = nodes[index],
      to = nodes[index + 1];
    const connects =
      (edge.fromNodeId === from.id && edge.toNodeId === to.id) ||
      (edge.toNodeId === from.id && edge.fromNodeId === to.id);
    if (
      !connects ||
      from.buildingId !== route.destination.buildingId ||
      to.buildingId !== route.destination.buildingId ||
      edge.buildingId !== route.destination.buildingId ||
      !Number.isFinite(edge.distanceMeters) ||
      edge.distanceMeters <= 0 ||
      (from.floorId !== to.floorId &&
        !["STAIRS", "ELEVATOR", "RAMP"].includes(edge.pathType))
    ) {
      result.valid = false;
      result.issues.push(`invalid_segment:${index}`);
    }
    if (edge.temporarilyClosed) {
      result.valid = false;
      result.issues.push(`closed_edge:${edge.id}`);
    }
  }
  if (!result.valid) return result;

  const places = (context.places ?? []).filter(
    place => place.buildingId === route.destination.buildingId
  );
  const placeById = new Map(places.map(place => [place.id, place]));
  const floors = new Map(
    (context.floors ?? [])
      .filter(floor => floor.buildingId === route.destination.buildingId)
      .map(floor => [floor.id, floor])
  );
  const zones = (context.zones ?? []).filter(
    zone => zone.buildingId === route.destination.buildingId
  );
  const destinationPlace = route.destination.placeId
    ? placeById.get(route.destination.placeId)
    : undefined;
  result.destinationRoomNumber = destinationPlace?.roomNumber?.trim() || null;

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const candidatePlace = node.placeId
      ? placeById.get(node.placeId)
      : undefined;
    const place =
      candidatePlace?.floorId === node.floorId ? candidatePlace : undefined;
    if (place) {
      const source: MobilitySource = {
        kind: "PLACE",
        id: place.id,
        confidence: scoreForPlace(place, route.confidence),
      };
      if (!result.landmarks.some(item => item.id === `place:${place.id}`))
        result.landmarks.push({
          id: `place:${place.id}`,
          name: place.name,
          kind: "PLACE",
          floorId: node.floorId,
          nodeId: node.id,
          roomNumber: place.roomNumber?.trim() || null,
          source,
        });
      if (
        place.verificationStatus !== "DISCOVERED" &&
        (place.roomNumber?.trim() || place.name.trim())
      ) {
        result.relocalizationCandidates.push({
          nodeId: node.id,
          placeId: place.id,
          label: place.roomNumber?.trim() || place.name,
          observationRequired: true,
          source,
        });
      }
    }
    if (node.nodeType === "DOOR") {
      result.doors.push({
        id: `node:${node.id}`,
        nodeId: node.id,
        edgeId: null,
        placeId: place?.id ?? null,
        roomNumber: place?.roomNumber?.trim() || null,
        state: "UNKNOWN",
        relativeSide: null,
        source: {
          kind: "ROUTE_GRAPH",
          id: node.id,
          confidence: clamp(route.confidence),
        },
      });
    }
    if (node.nodeType === "ENTRANCE" || node.nodeType === "EXIT") {
      result.accessPoints.push({
        nodeId: node.id,
        kind: node.nodeType,
        name: place?.name ?? null,
        currentAccess: "UNKNOWN",
        source: {
          kind: "ROUTE_GRAPH",
          id: node.id,
          confidence: clamp(route.confidence),
        },
      });
    }
    if (
      index > 0 &&
      index < nodes.length - 1 &&
      nodes[index - 1].floorId === node.floorId &&
      nodes[index + 1].floorId === node.floorId
    ) {
      const angleDegrees = signedTurn(nodes[index - 1], node, nodes[index + 1]);
      const magnitude = Math.abs(angleDegrees);
      const direction: MobilityTurn["direction"] | null =
        magnitude >= 155
          ? "BACK"
          : magnitude >= 40
            ? angleDegrees > 0
              ? "RIGHT"
              : "LEFT"
            : node.nodeType === "INTERSECTION"
              ? "STRAIGHT"
              : null;
      if (direction)
        result.turns.push({
          nodeId: node.id,
          edgeIndex: index,
          direction,
          angleDegrees: Math.round(angleDegrees),
          landmarkId: place ? `place:${place.id}` : null,
          source: {
            kind: "DERIVED_GEOMETRY",
            id: node.id,
            confidence: Math.min(clamp(route.confidence), 0.8),
          },
        });
    }
  }

  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    const from = nodes[index],
      to = nodes[index + 1];
    const graphSource: MobilitySource = {
      kind: "ROUTE_GRAPH",
      id: edge.id,
      confidence: clamp(route.confidence),
    };
    if (
      edge.pathType === "DOOR" &&
      from.nodeType !== "DOOR" &&
      to.nodeType !== "DOOR"
    ) {
      const toPlace = to.placeId ? placeById.get(to.placeId) : undefined;
      const fromPlace = from.placeId ? placeById.get(from.placeId) : undefined;
      const endpointPlace =
        toPlace?.floorId === to.floorId
          ? toPlace
          : fromPlace?.floorId === from.floorId
            ? fromPlace
            : undefined;
      result.doors.push({
        id: `edge:${edge.id}`,
        nodeId: null,
        edgeId: edge.id,
        placeId: endpointPlace?.id ?? null,
        roomNumber: endpointPlace?.roomNumber?.trim() || null,
        state: "UNKNOWN",
        relativeSide: null,
        source: graphSource,
      });
    }
    const segment: MobilitySegment = {
      index,
      edgeId: edge.id,
      fromNodeId: from.id,
      toNodeId: to.id,
      fromFloorId: from.floorId,
      toFloorId: to.floorId,
      pathType: edge.pathType,
      distanceMeters: edge.distanceMeters,
      mappedDirection: edge.direction?.trim() || null,
      widthMeters: null,
      accessibilityLevel: edge.accessibilityLevel,
      riskLevel: edge.riskLevel,
      temporarilyClosed: edge.temporarilyClosed,
      landmarkIds: [],
      hazardIds: [],
      doorIds: [],
      accessPointNodeIds: [],
      transitionEdgeId: null,
      confidence: clamp(route.confidence),
      sources: [graphSource],
    };
    const segmentNodeIds = new Set([from.id, to.id]);
    segment.landmarkIds = result.landmarks
      .filter(item => item.nodeId && segmentNodeIds.has(item.nodeId))
      .map(item => item.id);
    segment.doorIds = result.doors
      .filter(
        item =>
          item.edgeId === edge.id ||
          (item.nodeId !== null && segmentNodeIds.has(item.nodeId))
      )
      .map(item => item.id);
    segment.accessPointNodeIds = result.accessPoints
      .filter(item => segmentNodeIds.has(item.nodeId))
      .map(item => item.nodeId);
    if (edge.riskLevel !== "LOW") {
      const hazard: MobilityDocumentedHazard = {
        id: `edge:${edge.id}`,
        edgeId: edge.id,
        label:
          edge.riskLevel === "HIGH"
            ? "مستوى خطر مرتفع مسجل على هذا المقطع"
            : "مستوى خطر متوسط مسجل على هذا المقطع",
        severity: edge.riskLevel,
        source: graphSource,
      };
      result.documentedHazards.push(hazard);
      segment.hazardIds.push(hazard.id);
    }
    for (const zone of zones) {
      if (!crossesZone(zone, from, to)) continue;
      const source: MobilitySource = {
        kind: "ZONE",
        id: zone.id,
        confidence: Math.min(clamp(route.confidence), 0.6),
      };
      if (zone.zoneType === "HAZARD") {
        const hazard: MobilityDocumentedHazard = {
          id: `zone:${zone.id}:${edge.id}`,
          edgeId: edge.id,
          label: zone.accessibilityNote?.trim() || zone.name,
          severity: "UNSPECIFIED",
          source,
        };
        result.documentedHazards.push(hazard);
        segment.hazardIds.push(hazard.id);
      } else if (zone.zoneType === "LANDMARK" || zone.zoneType === "SERVICE") {
        const id = `zone:${zone.id}`;
        if (!result.landmarks.some(item => item.id === id))
          result.landmarks.push({
            id,
            name: zone.name,
            kind: "ZONE",
            floorId: zone.floorId,
            nodeId: null,
            roomNumber: null,
            source,
          });
        segment.landmarkIds.push(id);
      }
    }
    if (from.floorId !== to.floorId) {
      const fromFloor = floors.get(from.floorId),
        toFloor = floors.get(to.floorId);
      const verticalDirection =
        fromFloor && toFloor
          ? toFloor.floorNumber > fromFloor.floorNumber
            ? "UP"
            : toFloor.floorNumber < fromFloor.floorNumber
              ? "DOWN"
              : "UNKNOWN"
          : "UNKNOWN";
      result.floorTransitions.push({
        edgeId: edge.id,
        fromFloorId: from.floorId,
        toFloorId: to.floorId,
        fromFloorName: fromFloor?.name ?? null,
        toFloorName: toFloor?.name ?? null,
        method: edge.pathType as MobilityFloorTransition["method"],
        verticalDirection,
        stepCount: null,
        landing: "UNKNOWN",
        sources: [
          graphSource,
          ...(fromFloor
            ? [
                {
                  kind: "FLOOR" as const,
                  id: fromFloor.id,
                  confidence: clamp(route.confidence),
                },
              ]
            : []),
          ...(toFloor
            ? [
                {
                  kind: "FLOOR" as const,
                  id: toFloor.id,
                  confidence: clamp(route.confidence),
                },
              ]
            : []),
        ],
      });
      segment.transitionEdgeId = edge.id;
    }
    result.segments.push(segment);
  }
  return result;
}

/** Short route preview. A mapped door or hazard is never presented as a live observation. */
export function mobilityMapVoiceSummary(
  map: MobilityMap,
  language: "ar" | "en" | "zh-CN" = "ar"
): string {
  if (!map.valid)
    return language === "en"
      ? "The mapped route needs review. Confirm your location before starting."
      : language === "zh-CN"
        ? "地图路线需要核实。出发前请确认位置。"
        : "المسار المسجل يحتاج مراجعة. تأكد من موقعك قبل البدء.";
  const destination = map.destinationName.trim();
  if (map.confidence < 0.55)
    return language === "en"
      ? `Route to ${destination}. Map confidence is low; confirm your location before starting.`
      : language === "zh-CN"
        ? `前往${destination}。地图可信度较低，出发前请确认位置。`
        : `المسار إلى ${destination}. ثقة الخريطة منخفضة؛ تأكد من موقعك قبل البدء.`;
  const transition = map.floorTransitions[0];
  const firstTurn = map.turns.find(
    turn => turn.direction !== "STRAIGHT" && turn.direction !== "BACK"
  );
  const room = map.destinationRoomNumber;
  if (language === "en") {
    const actions = [
      firstTurn
        ? `turn ${firstTurn.direction.toLowerCase()} at the mapped junction`
        : null,
      transition
        ? `use the ${transition.method.toLowerCase()} to ${transition.toFloorName ?? "the next floor"}`
        : null,
      room ? `check the sign for room ${room}` : null,
    ]
      .filter(Boolean)
      .slice(0, 2);
    return `Route to ${destination}. ${actions.length ? actions.join(", then ") + ". " : ""}Check your surroundings as you go.`;
  }
  if (language === "zh-CN") {
    const turn = firstTurn
      ? `在标记的路口向${firstTurn.direction === "LEFT" ? "左" : "右"}转。`
      : "";
    const move = transition
      ? `乘${transition.method === "ELEVATOR" ? "电梯" : transition.method === "STAIRS" ? "楼梯" : "坡道"}前往${transition.toFloorName ?? "下一层"}。`
      : "";
    const sign = room ? `核对${room}室的门牌。` : "";
    return `前往${destination}。${turn}${move}${sign}请留意周围环境。`;
  }
  const actions = [
    firstTurn
      ? `انعطف ${firstTurn.direction === "LEFT" ? "يسارًا" : "يمينًا"} عند التقاطع المسجل`
      : null,
    transition
      ? `استخدم ${transition.method === "ELEVATOR" ? "المصعد" : transition.method === "STAIRS" ? "الدرج" : "المنحدر"} إلى ${transition.toFloorName ?? "الطابق التالي"}`
      : null,
    room ? `تحقق من لوحة الغرفة ${room}` : null,
  ]
    .filter(Boolean)
    .slice(0, 2);
  return `المسار إلى ${destination}. ${actions.length ? actions.join("، ثم ") + ". " : ""}تحقق من محيطك أثناء السير.`;
}
