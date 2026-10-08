import { describe, expect, it } from "vitest";
import type { NavigationRoute } from "@shared/guidance";
import type {
  Floor,
  MapEdge,
  MapNode,
  NavigationZone,
  Place,
} from "@shared/navigation";
import { buildMobilityMap, mobilityMapVoiceSummary } from "./mobilityMap";

const node = (
  id: string,
  x: number,
  y: number,
  floorId: string,
  nodeType: MapNode["nodeType"],
  placeId: string | null = null
): MapNode => ({
  id,
  x,
  y,
  floorId,
  nodeType,
  placeId,
  buildingId: "b",
  accessibilityLevel: "ACCESSIBLE",
});
const edge = (
  id: string,
  fromNodeId: string,
  toNodeId: string,
  pathType: MapEdge["pathType"] = "CORRIDOR",
  extras: Partial<MapEdge> = {}
): MapEdge => ({
  id,
  buildingId: "b",
  fromNodeId,
  toNodeId,
  distanceMeters: 10,
  direction: null,
  pathType,
  accessibilityLevel: "ACCESSIBLE",
  hasStairs: pathType === "STAIRS",
  hasRamp: pathType === "RAMP",
  wheelchairAccessible: pathType !== "STAIRS",
  visuallyImpairedFriendly: true,
  temporarilyClosed: false,
  riskLevel: "LOW",
  ...extras,
});
const place = (
  id: string,
  name: string,
  floorId: string,
  roomNumber: string | null = null,
  verificationStatus: Place["verificationStatus"] = "OFFICIAL"
): Place =>
  ({
    id,
    name,
    floorId,
    roomNumber,
    verificationStatus,
    buildingId: "b",
    confidenceScore: null,
  }) as Place;
const zone = (
  id: string,
  floorId: string,
  zoneType: NavigationZone["zoneType"],
  minX: number,
  maxX: number
): NavigationZone =>
  ({
    id,
    floorId,
    zoneType,
    minX,
    maxX,
    minY: -1,
    maxY: 1,
    name: id,
    buildingId: "b",
    guidanceHint: null,
    accessibilityNote: null,
  }) as NavigationZone;
const nodes = [
  node("gate", 0, 0, "f0", "ENTRANCE", "gate-place"),
  node("junction", 10, 0, "f0", "INTERSECTION", "reception"),
  node("lift-0", 10, 10, "f0", "ELEVATOR"),
  node("lift-1", 10, 10, "f1", "ELEVATOR"),
  node("door", 12, 10, "f1", "DOOR"),
  node("room", 14, 10, "f1", "ROOM", "room-place"),
];
const edges = [
  edge("walk", "gate", "junction", "CORRIDOR", { riskLevel: "MEDIUM" }),
  edge("turn", "junction", "lift-0"),
  edge("lift", "lift-0", "lift-1", "ELEVATOR"),
  edge("hall", "lift-1", "door"),
  edge("door-edge", "door", "room", "DOOR"),
];
const route = (changes: Partial<NavigationRoute> = {}): NavigationRoute => ({
  id: "r",
  origin: nodes[0],
  destination: {
    kind: "place",
    id: "room-place",
    name: "قاعة الاختبار",
    buildingId: "b",
    floorId: "f1",
    nodeId: "room",
    placeId: "room-place",
  },
  floors: ["f0", "f1"],
  orderedNodes: nodes,
  orderedEdges: edges,
  totalDistance: 42,
  estimatedSteps: null,
  accessibilityScore: 0.8,
  riskScore: 0.1,
  confidence: 0.9,
  routeType: "RECOMMENDED",
  ...changes,
});
const context = {
  places: [
    place("gate-place", "البوابة", "f0"),
    place("reception", "الاستقبال", "f0", null, "COMMUNITY_VERIFIED"),
    place("room-place", "قاعة الاختبار", "f1", "121"),
  ],
  floors: [
    { id: "f0", buildingId: "b", floorNumber: 0, name: "الأرضي" },
    { id: "f1", buildingId: "b", floorNumber: 1, name: "الأول" },
  ] as Floor[],
  zones: [
    zone("tactile landmark", "f0", "LANDMARK", 7, 8),
    zone("construction", "f0", "HAZARD", 3, 4),
    zone("wrong floor", "f1", "HAZARD", 3, 4),
  ],
};

describe("blind-first mobility map", () => {
  it("derives turns, map landmarks, a floor transition and documented risks without inventing width, door state or step count", () => {
    const map = buildMobilityMap(route(), context);
    expect(map.valid).toBe(true);
    expect(map.segments).toHaveLength(5);
    expect(map.segments[0]).toMatchObject({
      pathType: "CORRIDOR",
      widthMeters: null,
      landmarkIds: expect.arrayContaining([
        "place:gate-place",
        "place:reception",
        "zone:tactile landmark",
      ]),
      hazardIds: expect.arrayContaining([
        "edge:walk",
        "zone:construction:walk",
      ]),
    });
    expect(
      map.documentedHazards.some(item => item.id.includes("wrong floor"))
    ).toBe(false);
    expect(map.turns).toContainEqual(
      expect.objectContaining({
        nodeId: "junction",
        direction: "LEFT",
        landmarkId: "place:reception",
      })
    );
    expect(map.floorTransitions).toContainEqual(
      expect.objectContaining({
        edgeId: "lift",
        fromFloorName: "الأرضي",
        toFloorName: "الأول",
        verticalDirection: "UP",
        stepCount: null,
        landing: "UNKNOWN",
      })
    );
    expect(map.doors).toContainEqual(
      expect.objectContaining({
        id: "node:door",
        state: "UNKNOWN",
        relativeSide: null,
      })
    );
    expect(map.accessPoints).toContainEqual(
      expect.objectContaining({
        nodeId: "gate",
        kind: "ENTRANCE",
        name: "البوابة",
        currentAccess: "UNKNOWN",
      })
    );
    expect(map.segments[0].accessPointNodeIds).toContain("gate");
    expect(map.destinationRoomNumber).toBe("121");
    expect(
      map.relocalizationCandidates.every(item => item.observationRequired)
    ).toBe(true);
    const preview = mobilityMapVoiceSummary(map);
    expect(preview).toContain("انعطف يسارًا");
    expect(preview).toContain("المصعد");
    expect(preview).not.toMatch(/مفتوح|آمن|درجة/);
  });

  it("records a door edge without falsely assigning its physical position or open state", () => {
    const shortNodes = [
      node("corridor", 0, 0, "f0", "CORRIDOR"),
      node("room", 2, 0, "f0", "ROOM", "room-place"),
    ];
    const shortRoute = route({
      origin: shortNodes[0],
      destination: { ...route().destination, floorId: "f0" },
      floors: ["f0"],
      orderedNodes: shortNodes,
      orderedEdges: [edge("entry", "corridor", "room", "DOOR")],
    });
    const map = buildMobilityMap(shortRoute, {
      places: [place("room-place", "قاعة الاختبار", "f0", "121")],
    });
    expect(map.doors).toEqual([
      expect.objectContaining({
        id: "edge:entry",
        nodeId: null,
        edgeId: "entry",
        state: "UNKNOWN",
        relativeSide: null,
        roomNumber: "121",
      }),
    ]);
    expect(map.segments[0].doorIds).toEqual(["edge:entry"]);
  });

  it("fails closed on broken or closed routes rather than offering a misleading spoken preview", () => {
    const broken = buildMobilityMap(
      route({
        orderedEdges: [edge("wrong", "gate", "room"), ...edges.slice(1)],
      }),
      context
    );
    expect(broken.valid).toBe(false);
    expect(broken.segments).toHaveLength(0);
    expect(mobilityMapVoiceSummary(broken)).toContain("يحتاج مراجعة");

    const closed = buildMobilityMap(
      route({
        orderedEdges: [
          { ...edges[0], temporarilyClosed: true },
          ...edges.slice(1),
        ],
      }),
      context
    );
    expect(closed.valid).toBe(false);
    expect(closed.issues).toContain("closed_edge:walk");
  });

  it("withholds turn-by-turn preview when map confidence is low", () => {
    const map = buildMobilityMap(route({ confidence: 0.4 }), context);
    expect(map.valid).toBe(true);
    expect(mobilityMapVoiceSummary(map)).toContain("تأكد من موقعك");
    expect(mobilityMapVoiceSummary(map)).not.toContain("انعطف");
  });
});
