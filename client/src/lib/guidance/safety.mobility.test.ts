import { describe, expect, it } from 'vitest';
import type { Building, MapEdge, MapNode } from '@shared/navigation';
import type { NavigationDestination } from '@shared/guidance';
import type { LocalizationEstimate } from '@shared/localization';
import type { SceneDescription, VisionDetection } from '@shared/vision';
import { NavigationSafetyFusion } from './safety';
import { RoutePlanner } from './route';

const building = { id: 'b', mapStatus: 'MAPPED', verificationStatus: 'OFFICIAL' } as Building;
const node = (id: string, x: number, y: number): MapNode => ({ id, buildingId: 'b', floorId: 'f', placeId: null, x, y, nodeType: 'CORRIDOR', accessibilityLevel: 'ACCESSIBLE' });
const edge = (id: string, a: string, b: string, distanceMeters: number, changes: Partial<MapEdge> = {}): MapEdge => ({
  id, buildingId: 'b', fromNodeId: a, toNodeId: b, distanceMeters, direction: null, pathType: 'CORRIDOR',
  accessibilityLevel: 'ACCESSIBLE', hasStairs: false, hasRamp: false, wheelchairAccessible: true,
  visuallyImpairedFriendly: true, temporarilyClosed: false, riskLevel: 'LOW', ...changes,
});
const nodes = [node('a', 0, 0), node('b', 5, 0), node('c', 10, 0), node('d', 5, 5)];
const edges = [edge('ab', 'a', 'b', 5), edge('bc', 'b', 'c', 5), edge('ad', 'a', 'd', 7), edge('dc', 'd', 'c', 7)];
const destination: NavigationDestination = { kind: 'place', id: 'dest', name: 'Room', buildingId: 'b', floorId: 'f', nodeId: 'c' };
const route = new RoutePlanner(building, nodes, [...edges]).plan('a', destination)!;
const location: LocalizationEstimate = { buildingId: 'b', floorId: 'f', x: 0, y: 0, headingDegrees: 90,
  confidence: .9, uncertaintyRadius: 1, sources: ['MANUAL'], timestamp: 1000, lastStrongAnchorAt: 1000, state: 'TRACKING' };
const detection = (type: VisionDetection['type'], distanceMeters: number | null = null, changes: Partial<VisionDetection> = {}): VisionDetection => ({
  id: type, trackId: type, type, confidence: .9, boundingBox: { x: .4, y: .35, width: .2, height: .3 },
  horizontalDirection: 'FRONT', verticalPosition: 'MIDDLE', approximateDistance: distanceMeters === null ? null :
    { distanceMeters, confidence: .9, source: 'LIDAR' }, timestamp: 1000, source: 'NATIVE', ...changes,
});
const scene = (object: VisionDetection, at: number): SceneDescription => ({ shortText: '', detailedText: '', riskLevel: 'HIGH',
  objects: [object], recognizedPlace: null, capturedAt: at, walkableArea: { pathAhead: 'UNKNOWN', freeSpaceLeft: 0,
    freeSpaceCenter: 0, freeSpaceRight: 0, confidence: 0, source: 'SEMANTIC_SEGMENTATION' } });

describe('blind mobility safety decisions', () => {
  it('uses two stable metric-depth observations for relative approach, but never blocks a route edge for a person', () => {
    const safety = new NavigationSafetyFusion();
    const first = safety.evaluate(route, 0, location, scene(detection('PERSON', 4), 1000), 1000);
    expect(first.timeToCollisionSeconds).toBeNull();
    const approaching = safety.evaluate(route, 0, location, scene(detection('PERSON', 1.6), 2000), 2000);
    expect(approaching.level).toBe('STOP');
    expect(approaching.objectType).toBe('PERSON');
    expect(approaching.direction).toBe('FRONT');
    expect(approaching.distanceMeters).toBe(1.6);
    expect(approaching.relativeSpeedMps).toBeCloseTo(2.4);
    expect(approaching.timeToCollisionSeconds).toBeCloseTo(1.6 / 2.4);
    expect(approaching.edgeId).toBeNull();
    expect(safety.persistent(approaching, 2000)).toBe(false);
  });

  it('keeps monocular depth non-metric and does not invent collision time', () => {
    const safety = new NavigationSafetyFusion();
    const object = detection('CHAIR', null, { approximateDistance: { distanceMeters: .4, confidence: .9, source: 'MONOCULAR_ESTIMATE' } });
    const first = safety.evaluate(route, 0, location, scene(object, 1000), 1000);
    const repeated = safety.evaluate(route, 0, location, scene(object, 2000), 2000);
    expect(first.level).toBe('CAUTION');
    expect(repeated.level).toBe('WARNING');
    expect(repeated.distanceMeters).toBeNull();
    expect(repeated.timeToCollisionSeconds).toBeNull();
    expect(repeated.message).not.toContain('متر');
  });

  it('raises a possible head-level warning without claiming measured height', () => {
    const safety = new NavigationSafetyFusion();
    const object = detection('BARRIER', null, { verticalPosition: 'TOP', boundingBox: { x: .4, y: .05, width: .2, height: .2 } });
    const decision = safety.evaluate(route, 0, location, scene(object, 1000), 1000);
    expect(decision.level).toBe('WARNING');
    expect(decision.heightEvidence).toBe('POSSIBLE_HEAD_LEVEL');
    expect(decision.priority).toBeGreaterThanOrEqual(7);
    expect(decision.message).toContain('قد يوجد عائق مرتفع');
    expect(decision.distanceMeters).toBeNull();
  });

  it('treats an uncertain downward surface as STOP without asserting a stair count', () => {
    const safety = new NavigationSafetyFusion();
    const decision = safety.evaluate(route, 0, location, scene(detection('STAIRS_UNCERTAIN'), 1000), 1000);
    expect(decision.level).toBe('STOP');
    expect(decision.message).toContain('غير محدد الاتجاه');
    expect(decision.message).not.toMatch(/\d+ درجات/);
  });

  it('keeps fresh stair and drop-off STOP alerts during localization loss without attributing them to a map edge', () => {
    const safety = new NavigationSafetyFusion();
    const lost: LocalizationEstimate = { ...location, floorId: null, x: null, y: null,
      headingDegrees: null, confidence: .1, state: 'LOCALIZATION_LOST' };
    const stair = safety.evaluate(route, 0, lost, scene(detection('STAIRS_UNCERTAIN'), 1000), 1000);
    expect(stair).toMatchObject({ level: 'STOP', objectType: 'STAIRS_UNCERTAIN', edgeId: null });
    expect(safety.persistent(stair, 1000)).toBe(false);
    const dropOff = safety.evaluate(route, 0, null, scene(detection('DROP_OFF_UNCERTAIN'), 2000), 2000);
    expect(dropOff).toMatchObject({ level: 'STOP', objectType: 'DROP_OFF_UNCERTAIN', edgeId: null });
    expect(safety.persistent(dropOff, 2000)).toBe(false);
    const noHazard = safety.evaluate(route, 0, lost, { ...scene(detection('DOOR'), 3000), objects: [] }, 3000);
    expect(noHazard).toMatchObject({ state: 'ROUTE_UNCERTAIN', edgeId: null });
    expect(noHazard.message).toContain('الموقع غير مؤكدين');
  });

  it('requires credible or repeated evidence before STOP for uncertain stairs and drop-offs', () => {
    const safety = new NavigationSafetyFusion();
    const weakStair = detection('STAIRS_UNCERTAIN', null, { confidence: .51 });
    const first = safety.evaluate(route, 0, location, scene(weakStair, 1000), 1000);
    expect(first).toMatchObject({ level: 'WARNING', edgeId: null });
    const repeated = safety.evaluate(route, 0, location, scene(weakStair, 2000), 2000);
    expect(repeated).toMatchObject({ level: 'STOP', edgeId: null });
    const strongDrop = safety.evaluate(route, 0, location,
      scene(detection('DROP_OFF_UNCERTAIN', null, { confidence: .68 }), 3000), 3000);
    expect(strongDrop).toMatchObject({ level: 'STOP', edgeId: null });
  });

  it('does not turn very weak detections or a low-confidence blocked mask into STOP or a clear-path claim', () => {
    const safety = new NavigationSafetyFusion();
    const clearMask = { pathAhead: 'CLEAR' as const, freeSpaceLeft: 1, freeSpaceCenter: 1, freeSpaceRight: 1,
      confidence: .9, source: 'SEMANTIC_SEGMENTATION' as const };
    const falseStair = safety.evaluate(route, 0, location, { ...scene(detection('STAIRS_UNCERTAIN', null, { confidence: .12 }), 1000), walkableArea: clearMask }, 1000);
    expect(falseStair).toMatchObject({ state: 'ROUTE_UNCERTAIN', level: 'INFO', hazard: null, edgeId: null });
    const falseChair = safety.evaluate(route, 0, location, { ...scene(detection('CHAIR', .4, { confidence: .2 }), 2000), walkableArea: clearMask }, 2000);
    expect(falseChair).toMatchObject({ state: 'ROUTE_UNCERTAIN', level: 'INFO', hazard: null, edgeId: null });
    const weakMask = safety.evaluate(route, 0, location, { ...scene(detection('DOOR'), 3000), objects: [],
      walkableArea: { ...clearMask, pathAhead: 'BLOCKED', confidence: .2 } }, 3000);
    expect(weakMask).toMatchObject({ state: 'ROUTE_UNCERTAIN', level: 'INFO', edgeId: null });
  });

  it('does not turn a moving vehicle into a persistent map constraint', () => {
    const safety = new NavigationSafetyFusion();
    let decision = safety.evaluate(route, 0, location, scene(detection('VEHICLE'), 1000), 1000);
    decision = safety.evaluate(route, 0, location, scene(detection('VEHICLE'), 2000), 2000);
    decision = safety.evaluate(route, 0, location, scene(detection('VEHICLE'), 3000), 3000);
    expect(decision.level).toBe('WARNING');
    expect(decision.edgeId).toBeNull();
    expect(safety.persistent(decision, 3000)).toBe(false);
  });

  it('refuses a high-risk shortcut even when SHORTEST was selected', () => {
    const risky = [edge('ac', 'a', 'c', 1, { riskLevel: 'HIGH' }), ...edges];
    expect(new RoutePlanner(building, nodes, risky).plan('a', destination, 'SHORTEST')?.orderedEdges.map(item => item.id)).toEqual(['ab', 'bc']);
  });
});
