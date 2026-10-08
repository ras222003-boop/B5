/** SIMULATED ONLY: invented KKU topology and injected observations, not a phone or field trial. */
import { describe, expect, it } from 'vitest';
import type { LocalizationEstimate } from '@shared/localization';
import type { Building, Floor, MapEdge, MapNode, Place, SavedRoute } from '@shared/navigation';
import type { SceneDescription, VisionDetection } from '@shared/vision';
import { summarizeGraphRoute } from '../../../../server/savedRouteDomain';
import { BasiraLocalizationEngine } from '../localization/engine';
import { BasiraNavigationEngine } from './engine';
import { assessFamiliarRoute } from './journey';
import { buildMobilityMap } from './mobilityMap';
import { resolveDestination, RoutePlanner } from './route';
import { WalkRecording } from './walkRecording';

const buildingId = 'kku-simulated';
const ground = 'ground-simulated';
const second = 'second-simulated';
const building = { id: buildingId, name: 'جامعة الملك خالد الافتراضية', mapStatus: 'MAPPED', verificationStatus: 'OFFICIAL' } as Building;
const floors = [
  { id: ground, buildingId, floorNumber: 1, name: 'الطابق الأرضي' },
  { id: second, buildingId, floorNumber: 2, name: 'الطابق الثاني' },
] as Floor[];
const node = (id: string, x: number, y: number, floorId = ground, nodeType: MapNode['nodeType'] = 'CORRIDOR', placeId: string | null = null): MapNode =>
  ({ id, buildingId, floorId, x, y, nodeType, placeId, accessibilityLevel: 'ACCESSIBLE' });
const nodes = [
  node('gate', 0, 0, ground, 'ENTRANCE'),
  node('walkway', 5, 0),
  node('turn', 10, 0, ground, 'INTERSECTION'),
  node('entrance', 10, 5, ground, 'ENTRANCE'),
  node('lift-ground', 10, 10, ground, 'ELEVATOR'),
  node('lift-second', 10, 10, second, 'ELEVATOR'),
  node('corridor-second', 10, 15, second),
  node('room-121', 15, 15, second, 'ROOM', 'place-121'),
  node('alternative-a', 0, 5),
  node('alternative-b', 5, 5),
];
const edge = (id: string, a: string, b: string, distanceMeters = 5, pathType: MapEdge['pathType'] = 'CORRIDOR'): MapEdge => ({
  id, buildingId, fromNodeId: a, toNodeId: b, distanceMeters, direction: null, pathType,
  accessibilityLevel: 'ACCESSIBLE', hasStairs: false, hasRamp: false,
  wheelchairAccessible: true, visuallyImpairedFriendly: true, temporarilyClosed: false, riskLevel: 'LOW',
});
const edges = [
  edge('gate-walkway', 'gate', 'walkway'),
  edge('walkway-turn', 'walkway', 'turn'),
  edge('turn-entrance', 'turn', 'entrance'),
  edge('entrance-lift', 'entrance', 'lift-ground'),
  edge('lift-up', 'lift-ground', 'lift-second', 3, 'ELEVATOR'),
  edge('lift-corridor', 'lift-second', 'corridor-second'),
  edge('corridor-room', 'corridor-second', 'room-121', 5, 'DOOR'),
  edge('gate-alternative-a', 'gate', 'alternative-a', 8),
  edge('alternative-a-b', 'alternative-a', 'alternative-b', 8),
  edge('alternative-b-entrance', 'alternative-b', 'entrance', 8),
];
const place = {
  id: 'place-121', buildingId, floorId: second, name: 'قاعة 121', roomNumber: '121',
  localX: 15, localY: 15, verificationStatus: 'OFFICIAL', placeType: 'CLASSROOM',
} as Place;
const indoor = (x: number, y: number, floorId: string, timestamp: number, lastStrongAnchorAt: number): LocalizationEstimate => ({
  buildingId, floorId, x, y, headingDegrees: x < 10 ? 90 : y < 15 ? 0 : 90,
  confidence: .9, uncertaintyRadius: 1, sources: ['STEP_MOTION'], timestamp,
  lastStrongAnchorAt, state: 'TRACKING',
});
const chairScene = (timestamp: number): SceneDescription => {
  const object: VisionDetection = {
    id: 'synthetic-chair', trackId: 'synthetic-chair', type: 'CHAIR', confidence: .9,
    boundingBox: { x: .42, y: .35, width: .18, height: .3 },
    horizontalDirection: 'FRONT', verticalPosition: 'MIDDLE',
    approximateDistance: { distanceMeters: 2.5, confidence: .9, source: 'LIDAR' },
    timestamp, source: 'NATIVE',
  };
  return { shortText: '', detailedText: '', riskLevel: 'MEDIUM', objects: [object], recognizedPlace: null, capturedAt: timestamp };
};

describe('SIMULATED KKU blind mobility journey and next-day replay', () => {
  it('walks the invented gate-to-room route, saves only observed graph IDs, and avoids a new closure on replay', () => {
    const t = Date.now();
    const destination = resolveDestination(place, 'place', nodes);
    expect(destination).not.toBeNull();
    if (!destination) return;
    const planner = new RoutePlanner(building, nodes, [...edges]);
    const route = planner.plan('gate', destination);
    expect(route?.orderedEdges.map(item => item.id)).toEqual([
      'gate-walkway', 'walkway-turn', 'turn-entrance', 'entrance-lift',
      'lift-up', 'lift-corridor', 'corridor-room',
    ]);
    if (!route) return;

    const map = buildMobilityMap(route, { places: [place], floors });
    expect(map.valid).toBe(true);
    expect(map.turns).toContainEqual(expect.objectContaining({ nodeId: 'turn', direction: 'LEFT' }));
    expect(map.accessPoints.map(item => item.nodeId)).toContain('entrance');
    expect(map.floorTransitions).toContainEqual(expect.objectContaining({ method: 'ELEVATOR', toFloorId: second, stepCount: null }));
    expect(map.destinationRoomNumber).toBe('121');

    const recording = new WalkRecording({ buildingId, nodes, edges, startNodeId: 'gate' });
    // Invented GPS samples give only an outdoor sketch. They do not establish an indoor floor.
    for (const [latitude, longitude, at] of [
      [18.25, 42.5, t], [18.25005, 42.50003, t + 2000], [18.2501, 42.50006, t + 4000],
    ]) expect(recording.observeOutdoor({ latitude, longitude, accuracy: 5, heading: null, timestamp: at }, at)).toBe(true);
    expect(recording.snapshot().outdoorSegments[0].points).toHaveLength(3);
    const localization = new BasiraLocalizationEngine();
    const gpsOnly = localization.anchor({ buildingId, floorId: null, x: null, y: null, headingDegrees: null,
      confidence: 1, uncertaintyRadius: 5, source: 'GPS_BUILDING', timestamp: t + 4000 });
    expect(gpsOnly.floorId).toBeNull();
    const gateAnchor = localization.anchor({ buildingId, floorId: ground, x: 0, y: 0, headingDegrees: 90,
      confidence: .95, uncertaintyRadius: 1, source: 'QR', timestamp: t + 5000 });
    const navigation = new BasiraNavigationEngine(planner, floors);
    expect(navigation.prepare(destination, gateAnchor, 'RECOMMENDED', place)).toBe(true);
    expect(navigation.start()).toBe(true);
    expect(recording.observeIndoor(gateAnchor)).toBe(true);

    // Each mapped edge has intermediate injected fixes; the recorder never copies the planned route into history.
    const groundWalk: Array<[number, number, number]> = [
      [1, 0, 6000], [3, 0, 7000], [5, 0, 8000], [6, 0, 9000], [8, 0, 10000],
      [10, 0, 11000], [10, 1, 12000], [10, 3, 13000], [10, 5, 14000],
      [10, 6, 15000], [10, 8, 16000], [10, 10, 17000],
    ];
    for (const [x, y, offset] of groundWalk) {
      const at = t + offset;
      const estimate = indoor(x, y, ground, at, t + 5000);
      expect(recording.observeIndoor(estimate)).toBe(true);
      expect(navigation.updateLocation(estimate, at)).toBe('PROGRESS');
      if (offset === 9000) {
        const caution = navigation.observeScene(chairScene(at), at);
        expect(caution).toMatchObject({ level: 'CAUTION', objectType: 'CHAIR', direction: 'FRONT', distanceMeters: 2.5 });
        expect(navigation.session.state).toBe('NAVIGATING');
      }
      if (offset === 12000) expect(navigation.session.instruction?.kind).toBe('TURN_LEFT');
    }

    expect(recording.observeFloorTransition('ELEVATOR', t + 17500)).toBe(true);
    const unknownFloor = localization.transition('ENTER_ELEVATOR', t + 18000);
    expect(recording.observeIndoor(unknownFloor)).toBe(false);
    expect(navigation.updateLocation(unknownFloor, t + 18000)).toBe('LOST');
    const secondFloorAnchor = localization.anchor({ buildingId, floorId: second, x: 10, y: 10, headingDegrees: 0,
      confidence: .95, uncertaintyRadius: 1, source: 'QR', timestamp: t + 19000 });
    expect(recording.observeIndoor(secondFloorAnchor)).toBe(true);
    expect(navigation.updateLocation(secondFloorAnchor, t + 19000)).toBe('RECOVERED');
    expect(navigation.session.state).toBe('NAVIGATING');

    for (const [x, y, offset] of [
      [10, 11, 20000], [10, 13, 21000], [10, 15, 22000],
      [11, 15, 23000], [13, 15, 24000], [15, 15, 25000],
    ]) {
      const at = t + offset;
      const estimate = indoor(x, y, second, at, t + 19000);
      expect(recording.observeIndoor(estimate)).toBe(true);
      expect(navigation.updateLocation(estimate, at)).toBe('PROGRESS');
    }
    // The place ID and OCR match are injected evidence, not output from a tested camera or OCR model.
    expect(navigation.considerArrival(place.id, true, 'RIGHT')).toBe(true);
    expect(navigation.session.state).toBe('ARRIVED');
    expect(navigation.session.instruction?.text).toContain('الباب على يمينك');
    const saved = recording.saveBody('بوابة الجامعة إلى قاعة 121', 'room-121', 180, edges);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.body.nodeIds).toEqual(route.orderedNodes.map(item => item.id));
    expect(saved.body.edgeIds).toEqual(route.orderedEdges.map(item => item.id));
    expect(Object.keys(saved.body).sort()).toEqual(['buildingId', 'durationSeconds', 'edgeIds', 'name', 'nodeIds']);
    expect(JSON.stringify(saved.body)).not.toMatch(/latitude|longitude|timestamp|confidence|points|rawTrack/);
    expect(recording.snapshot().indoorSegments.map(item => item.floorId)).toEqual([ground, second]);

    const summary = summarizeGraphRoute(saved.body.nodeIds, saved.body.edgeIds,
      nodes.map(item => ({ id: item.id, floor_id: item.floorId, place_id: item.placeId, x: item.x, y: item.y })),
      edges.map(item => ({ id: item.id, from_node_id: item.fromNodeId, to_node_id: item.toNodeId,
        temporarily_closed: Number(item.temporarilyClosed), risk_level: item.riskLevel, path_type: item.pathType })));
    expect(summary?.floorTransitions).toEqual([{ fromFloorId: ground, toFloorId: second, edgeId: 'lift-up' }]);
    expect(summary?.turnNodeIds).toContain('turn');
    if (!summary) return;
    const familiar: SavedRoute = {
      id: 'saved-simulated', name: saved.body.name, buildingId, originNodeId: 'gate', destinationNodeId: 'room-121',
      routeData: summary, mapVersion: 1, successfulArrivalCount: 1, typicalDurationSeconds: saved.body.durationSeconds,
      lastSuccessfulAt: new Date(t + 25000).toISOString(), lastVerifiedAt: null,
      createdAt: new Date(t).toISOString(), updatedAt: new Date(t + 25000).toISOString(), familiarity: 'NEWLY_LEARNED',
    };
    expect(assessFamiliarRoute(familiar, building, nodes, edges, 'gate', 'room-121', [], t + 86400000).reason).toBe('READY');

    // Next day: a reported new barrier closes the familiar walkway-to-turn edge.
    const updatedEdges = edges.map(item => item.id === 'walkway-turn' ? { ...item, temporarilyClosed: true } : item);
    const assessment = assessFamiliarRoute(familiar, building, nodes, updatedEdges, 'gate', 'room-121', [], t + 86400000);
    expect(assessment).toMatchObject({ eligible: false, reason: 'HAZARD' });
    const replayPlanner = new RoutePlanner(building, nodes, updatedEdges);
    replayPlanner.preferFamiliarEdges(new Set(familiar.routeData.edgeIds)); // Even a stale preference cannot reopen an edge.
    const replay = replayPlanner.plan('gate', destination);
    expect(replay?.orderedEdges.map(item => item.id)).toEqual([
      'gate-alternative-a', 'alternative-a-b', 'alternative-b-entrance',
      'entrance-lift', 'lift-up', 'lift-corridor', 'corridor-room',
    ]);
    const nextDayAnchor = indoor(0, 0, ground, t + 86400000, t + 86400000);
    const replayNavigation = new BasiraNavigationEngine(replayPlanner, floors);
    expect(replayNavigation.prepare(destination, nextDayAnchor, 'RECOMMENDED', place)).toBe(true);
    expect(replayNavigation.start()).toBe(true);
    expect(replayNavigation.session.route?.orderedEdges.some(item => item.id === 'walkway-turn')).toBe(false);
  });
});
