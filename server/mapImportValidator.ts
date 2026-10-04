import { z } from 'zod';
import { nodeTypes, placeTypes, accessibilityLevels } from '../shared/navigation';

const uid = z.string().uuid();
const coordinate = z.number().finite().min(-100000).max(100000);
const short = z.string().trim().min(1).max(255);
const floor = z.object({ id: uid, floorNumber: z.number().int().min(-20).max(300), name: short }).strict();
const place = z.object({ id: uid, floorId: uid, name: short, roomNumber: z.string().trim().max(80).nullable().optional(), placeType: z.enum(placeTypes), x: coordinate, y: coordinate, accessibilityInformation: z.string().max(2000).nullable().optional() }).strict();
const node = z.object({ id: uid, floorId: uid, placeId: uid.nullable().optional(), x: coordinate, y: coordinate, nodeType: z.enum(nodeTypes), accessibilityLevel: z.enum(accessibilityLevels).default('UNKNOWN') }).strict();
const edge = z.object({ id: uid, fromNodeId: uid, toNodeId: uid, distanceMeters: z.number().finite().positive().max(100000), pathType: z.enum(['CORRIDOR','DOOR','STAIRS','RAMP','ELEVATOR','OTHER']), accessibilityLevel: z.enum(accessibilityLevels).default('UNKNOWN'), wheelchairAccessible: z.boolean().default(false), visuallyImpairedFriendly: z.boolean().default(false) }).strict();
export const basiraImportSchema = z.object({
  format: z.literal('BASIRA_JSON'), version: z.literal(1),
  floors: z.array(floor).max(100), places: z.array(place).max(1000),
  nodes: z.array(node).max(1500), edges: z.array(edge).max(3000),
}).strict();
export type BasiraImport = z.infer<typeof basiraImportSchema>;
export interface ImportReport { errors: string[]; warnings: string[]; summary: { buildings: number; floors: number; places: number; nodes: number; edges: number; transitions: number }; valid: boolean }

/** Validation is pure, bounded, and runs again at approval; no input is trusted from a saved preview. */
export class MapImportValidator {
  validate(raw: unknown): { document: BasiraImport | null; report: ImportReport } {
    const errors: string[] = [], warnings: string[] = [];
    const parsed = basiraImportSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 30)) errors.push(`${issue.path.join('.') || 'document'}: ${issue.message}`);
      return { document: null, report: { errors, warnings, summary: { buildings: 0, floors: 0, places: 0, nodes: 0, edges: 0, transitions: 0 }, valid: false } };
    }
    const doc = parsed.data;
    const summary: ImportReport['summary'] = { buildings: 1, floors: doc.floors.length, places: doc.places.length, nodes: doc.nodes.length, edges: doc.edges.length, transitions: 0 };
    if (!doc.floors.length) errors.push('At least one floor is required');
    if (!doc.nodes.length) errors.push('At least one navigation node is required');
    const ids = new Set<string>();
    for (const item of [...doc.floors, ...doc.places, ...doc.nodes, ...doc.edges]) {
      if (ids.has(item.id)) errors.push(`Duplicate id: ${item.id}`);
      ids.add(item.id);
    }
    const floorIds = new Set(doc.floors.map(item => item.id));
    if (floorIds.size !== new Set(doc.floors.map(item => item.floorNumber)).size) errors.push('Duplicate floor number');
    const places = new Map(doc.places.map(item => [item.id, item]));
    const nodes = new Map(doc.nodes.map(item => [item.id, item]));
    const placeKeys=new Set<string>(),roomKeys=new Set<string>();
    for(const item of doc.places){
      const key=`${item.floorId}:${item.name.toLocaleLowerCase()}`;
      if(placeKeys.has(key))errors.push(`Duplicate place on floor: ${item.name}`);placeKeys.add(key);
      if(item.roomNumber){const room=`${item.floorId}:${item.roomNumber.toLocaleLowerCase()}`;if(roomKeys.has(room))errors.push(`Duplicate room number on floor: ${item.roomNumber}`);roomKeys.add(room);}
    }
    const nodePositions=new Set<string>();
    for (const item of doc.places) if (!floorIds.has(item.floorId)) errors.push(`Place ${item.id} references an unknown floor`);
    for (const item of doc.nodes) {
      const position=`${item.floorId}:${item.x.toFixed(2)}:${item.y.toFixed(2)}`;
      if(nodePositions.has(position))errors.push(`Duplicate node coordinates on floor: ${item.id}`);nodePositions.add(position);
      if (!floorIds.has(item.floorId)) errors.push(`Node ${item.id} references an unknown floor`);
      if (item.placeId && !places.has(item.placeId)) errors.push(`Node ${item.id} references an unknown place`);
      if (item.placeId && places.get(item.placeId)?.floorId !== item.floorId) errors.push(`Node ${item.id} and its place have different floors`);
      if (item.accessibilityLevel === 'UNKNOWN') warnings.push(`Node ${item.id} has unknown accessibility`);
    }
    const adjacency = new Map(doc.nodes.map(item => [item.id, new Set<string>()]));
    const edgePairs = new Set<string>();
    for (const item of doc.edges) {
      const from = nodes.get(item.fromNodeId), to = nodes.get(item.toNodeId);
      if (!from || !to) { errors.push(`Edge ${item.id} has a dangling endpoint`); continue; }
      if (from.id === to.id) errors.push(`Edge ${item.id} is a self-loop`);
      const pair = [from.id, to.id].sort().join(':');
      if (edgePairs.has(pair)) errors.push(`Edge ${item.id} duplicates a connection`);
      edgePairs.add(pair);
      if (from.floorId !== to.floorId) {
        summary.transitions++;
        if (!['STAIRS','ELEVATOR','RAMP'].includes(item.pathType)) errors.push(`Edge ${item.id} crosses floors without a supported transition`);
        if (item.pathType === 'STAIRS' && (from.nodeType !== 'STAIRS' || to.nodeType !== 'STAIRS')) warnings.push(`Stairs edge ${item.id} has unlabelled endpoints`);
        if (item.pathType === 'ELEVATOR' && (from.nodeType !== 'ELEVATOR' || to.nodeType !== 'ELEVATOR')) warnings.push(`Elevator edge ${item.id} has unlabelled endpoints`);
      } else if (['STAIRS','ELEVATOR'].includes(item.pathType)) warnings.push(`Transition edge ${item.id} stays on one floor`);
      if(from.floorId===to.floorId&&Math.abs(Math.hypot(from.x-to.x,from.y-to.y)-item.distanceMeters)>Math.max(5,item.distanceMeters))warnings.push(`Edge ${item.id} distance differs from its coordinates`);
      if (item.accessibilityLevel === 'UNKNOWN') warnings.push(`Edge ${item.id} has unknown accessibility`);
      adjacency.get(from.id)?.add(to.id); adjacency.get(to.id)?.add(from.id);
    }
    if (doc.nodes.length) {
      const visited = new Set<string>(), stack = [doc.nodes[0].id];
      while (stack.length) { const current = stack.pop()!; if (visited.has(current)) continue; visited.add(current); stack.push(...Array.from(adjacency.get(current) ?? [])); }
      if (visited.size < doc.nodes.length) warnings.push(`${doc.nodes.length - visited.size} navigation nodes are disconnected`);
    }
    for (const item of doc.places) {
      if (!doc.nodes.some(candidate => candidate.placeId === item.id)) warnings.push(`Place ${item.id} has no linked navigation node`);
      if (!item.accessibilityInformation) warnings.push(`Place ${item.id} has no accessibility notes`);
    }
    return { document: doc, report: { errors, warnings: warnings.slice(0, 100), summary, valid: errors.length === 0 } };
  }
}
