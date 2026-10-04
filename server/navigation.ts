import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { auth, pool } from './auth';
import { buildingTypes, placeTypes, nodeTypes, savedCategories, verificationStatuses, accessibilityLevels } from '../shared/navigation';
import { registerLocalizationRoutes } from './localization';
import { registerSharedMapRoutes } from './sharedMap';
import { registerOrganizationRoutes } from './organizations';
import { SAFE_DEFAULT_FLAGS, type SafetyFlags } from '../shared/safetyFlags';
import { allowedNavigationMutation } from './navigationSecurity';

const id = z.string().uuid();
const name = z.string().trim().min(1).max(255);
const text = (max = 2000) => z.string().trim().max(max).nullable().optional();
const latitude = z.number().min(-90).max(90).nullable().optional();
const longitude = z.number().min(-180).max(180).nullable().optional();
const pair = z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional();
const buildingInput = z.object({
  name, alternativeNames: z.array(name).max(20).default([]), organizationName: text(255),
  buildingType: z.enum(buildingTypes), description: text(), address: text(500),
  latitude, longitude, numberOfFloors: z.number().int().min(0).max(300).nullable().optional(),
  status: z.enum(['ACTIVE','INACTIVE']).optional(), mapStatus: z.enum(['UNMAPPED','IN_PROGRESS','MAPPED']).optional(),
  verificationStatus: z.enum(verificationStatuses).optional(),
});
const floorInput = z.object({ floorNumber: z.number().int().min(-20).max(300), name, description: text(), floorPlanReference: text(500), localOrigin: pair });
const placeInput = z.object({
  name, roomNumber: text(80), aliases: z.array(name).max(20).default([]), departmentName: text(255),
  floorId: id, description: text(), placeType: z.enum(placeTypes), localX: z.number().finite().nullable().optional(),
  localY: z.number().finite().nullable().optional(), latitude, longitude, entranceDirection: text(80),
  accessibilityInformation: text(), verificationStatus: z.enum(verificationStatuses).optional(),
  confidenceScore: z.number().min(0).max(1).nullable().optional(), isPublic: z.boolean().optional(),
});
const savedInput = z.object({
  name, category: z.enum(savedCategories).default('OTHER'), notes: text(), latitude, longitude,
  buildingId: id.nullable().optional(), floorId: id.nullable().optional(), placeId: id.nullable().optional(),
  localX: z.number().finite().min(-100000).max(100000).nullable().optional(),
  localY: z.number().finite().min(-100000).max(100000).nullable().optional(),
  localizationConfidence: z.number().min(0).max(1).nullable().optional(),
  isFavorite: z.boolean().optional(),
});
const nodeInput = z.object({ floorId: id, placeId: id.nullable().optional(), x: z.number().finite(), y: z.number().finite(), nodeType: z.enum(nodeTypes), accessibilityLevel: z.enum(accessibilityLevels).default('UNKNOWN') });
const edgeInput = z.object({
  fromNodeId: id, toNodeId: id, distanceMeters: z.number().positive().max(100000), direction: text(80),
  pathType: z.enum(['CORRIDOR','DOOR','STAIRS','RAMP','ELEVATOR','OTHER']), accessibilityLevel: z.enum(accessibilityLevels).default('UNKNOWN'),
  hasStairs: z.boolean().default(false), hasRamp: z.boolean().default(false), wheelchairAccessible: z.boolean().default(false),
  visuallyImpairedFriendly: z.boolean().default(false), temporarilyClosed: z.boolean().default(false), riskLevel: z.enum(['LOW','MEDIUM','HIGH']).default('LOW'),
});

type Data = Record<string, any>;
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const booleans = new Set(['is_public','is_favorite','has_stairs','has_ramp','wheelchair_accessible','visually_impaired_friendly','temporarily_closed']);
const numbers = new Set(['latitude','longitude','local_x','local_y','x','y','distance_meters','confidence_score','localization_confidence']);
function present(value: Data): Data {
  const out: Data = {};
  for (const [key, raw] of Object.entries(value)) {
    out[camel(key)] = booleans.has(key) ? Boolean(raw) : numbers.has(key) && raw !== null ? Number(raw) :
      ['aliases','alternative_names','local_origin'].includes(key) && typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return out;
}
async function rows(sql: string, values: any[] = []): Promise<Data[]> {
  const [result] = await pool.execute(sql, values);
  return (result as Data[]).map(present);
}
async function one(sql: string, values: any[] = []): Promise<Data | null> { return (await rows(sql, values))[0] ?? null; }
const value = (v: unknown): any => v === undefined ? null : v;
const bool = (v: unknown) => v ? 1 : 0;
const uuid = (req: Request, key = 'id') => id.safeParse(req.params[key]).success;
const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  Promise.resolve(handler(req, res)).catch(error => {
    console.error('Navigation API error', error);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  });
};
async function identity(req: Request) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return { userId: null, role: null };
  const grant = await one('SELECT role FROM basira_navigation_roles WHERE user_id=?', [session.user.id]);
  return { userId: session.user.id, role: grant?.role as 'mapper' | 'admin' | null ?? null };
}
async function editor(req: Request, res: Response, buildingId?: string) {
  const actor = await identity(req);
  if (!actor.userId) { res.status(401).json({ error: 'sign_in_required' }); return null; }
  if (buildingId) {
    const building = await one('SELECT organization_id,verification_status FROM basira_buildings WHERE id=?',[buildingId]);
    if (!building) { res.status(404).json({error:'building_not_found'}); return null; }
    // Official maps change only through a reviewed, versioned workflow.
    if (building.verificationStatus === 'OFFICIAL') { res.status(409).json({error:'official_map_requires_review'}); return null; }
    if (actor.role === 'admin') return actor;
    if (building.organizationId) {
      const member = await one('SELECT role FROM basira_organization_memberships WHERE organization_id=? AND user_id=?',[building.organizationId,actor.userId]);
      if (!['organization_admin','mapper'].includes(member?.role)) { res.status(403).json({error:'organization_mapper_required'}); return null; }
      return actor;
    }
  }
  if (!actor.role) { res.status(403).json({ error: 'mapper_role_required' }); return null; }
  return actor;
}
async function owner(req: Request, res: Response) {
  const actor = await identity(req);
  if (!actor.userId) { res.status(401).json({ error: 'sign_in_required' }); return null; }
  return actor.userId;
}
async function exists(table: 'basira_buildings' | 'basira_floors' | 'basira_places' | 'basira_map_nodes', entityId: string, buildingId?: string) {
  return Boolean(await one(`SELECT id FROM ${table} WHERE id=?${buildingId ? ' AND building_id=?' : ''}`, buildingId ? [entityId, buildingId] : [entityId]));
}
async function validLocation(input: { buildingId?: string | null; floorId?: string | null; placeId?: string | null }) {
  if (input.buildingId && !await exists('basira_buildings', input.buildingId)) return false;
  if (input.floorId && (!input.buildingId || !await exists('basira_floors', input.floorId, input.buildingId))) return false;
  if (input.placeId) {
    const p = await one('SELECT building_id, floor_id, is_public FROM basira_places WHERE id=?', [input.placeId]);
    if (!p || !p.isPublic || p.buildingId !== input.buildingId || p.floorId !== input.floorId) return false;
  }
  return true;
}
function parse<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) { res.status(400).json({ error: 'invalid_input', details: result.error.flatten() }); return null; }
  return result.data;
}
function queryText(req: Request) { return typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''; }
function like(term: string) { return `%${term.replace(/[\\%_]/g, '\\$&')}%`; }

/** Search ranking stays independent of the HTTP route for later navigation clients. */
export class PlaceSearchService {
  async search(term: string, userId: string | null, currentBuildingId: string | null, includeOtherBuildings: boolean) {
    const queryPlaces=async (buildingId:string|null) => rows(`SELECT p.*,f.name AS floor_name,b.name AS building_name FROM basira_places p JOIN basira_floors f ON f.id=p.floor_id JOIN basira_buildings b ON b.id=p.building_id WHERE p.is_public=1 AND b.status='ACTIVE' AND (? IS NULL OR p.building_id=?) AND (p.name LIKE ? OR p.room_number LIKE ? OR p.department_name LIKE ? OR b.name LIKE ? OR f.name LIKE ? OR JSON_SEARCH(p.aliases,'one',?) IS NOT NULL) LIMIT 100`,[buildingId,buildingId,like(term),like(term),like(term),like(term),like(term),term]);
    const local=currentBuildingId?await queryPlaces(currentBuildingId):[];
    const other=(!currentBuildingId||!local.length||includeOtherBuildings)?await queryPlaces(null):[];
    const saved=userId?await rows(`SELECT s.*,b.name AS building_name,f.name AS floor_name FROM basira_saved_places s LEFT JOIN basira_buildings b ON b.id=s.building_id LEFT JOIN basira_floors f ON f.id=s.floor_id WHERE s.user_id=? AND (s.name LIKE ? OR s.notes LIKE ?) LIMIT 50`,[userId,like(term),like(term)]):[];
    const localIds=new Set(local.map(p=>p.id));
    const priority=(p:Data)=>p.verificationStatus==='OFFICIAL'?2:p.verificationStatus==='COMMUNITY_VERIFIED'?3:4;
    return [
      ...local.map(p=>({kind:'place',priority:0,item:p})),
      ...saved.map(p=>({kind:'saved',priority:1,item:p})),
      ...other.filter(p=>!localIds.has(p.id)).map(p=>({kind:'place',priority:priority(p),item:p})),
    ].sort((a,b)=>a.priority-b.priority).slice(0,100);
  }
}

/** Register the same routes in production Express and the Vite development server. */
export function registerNavigationRoutes(app: Express) {
  const api = express.Router();
  app.use('/api/navigation', api);
  api.use((req,res,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method)||allowedNavigationMutation(req.get('origin'),req.get('host'),req.get('sec-fetch-site')))return next();
    res.status(403).json({error:'cross_site_write_denied'});
  });
  registerLocalizationRoutes(api);
  registerSharedMapRoutes(api);
  registerOrganizationRoutes(api);
  api.get('/safety-flags',(_req,res)=>{
    const flags=Object.fromEntries(Object.keys(SAFE_DEFAULT_FLAGS).map(key=>[key,process.env[`BASIRA_${key.replace(/[A-Z]/g,letter=>`_${letter}`).toUpperCase()}`]==='true'])) as unknown as SafetyFlags;
    res.set('Cache-Control','no-store').json(flags);
  });
  api.get('/access', asyncRoute(async (req, res) => res.set('Cache-Control','no-store').json(await identity(req))));
  api.get('/buildings', asyncRoute(async (req, res) => {
    const q = queryText(req);
    const list = await rows(`SELECT * FROM basira_buildings WHERE status='ACTIVE' AND (?='' OR name LIKE ? OR organization_name LIKE ? OR address LIKE ? OR JSON_SEARCH(alternative_names,'one',?) IS NOT NULL) ORDER BY FIELD(verification_status,'OFFICIAL','COMMUNITY_VERIFIED','DISCOVERED'),name LIMIT 100`, [q,like(q),like(q),like(q),q]);
    res.json({ buildings: list });
  }));
  api.get('/buildings/current', asyncRoute(async (req, res) => {
    const lat = Number(req.query.latitude), lon = Number(req.query.longitude);
    if (!Number.isFinite(lat) || Math.abs(lat)>90 || !Number.isFinite(lon) || Math.abs(lon)>180) return res.status(400).json({ error:'invalid_coordinates' });
    const candidate = await one(`SELECT *, (6371000 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(latitude - ?)/2),2)+COS(RADIANS(?))*COS(RADIANS(latitude))*POWER(SIN(RADIANS(longitude - ?)/2),2)))) AS distance_meters FROM basira_buildings WHERE status='ACTIVE' AND latitude IS NOT NULL AND longitude IS NOT NULL HAVING distance_meters <= 150 ORDER BY distance_meters LIMIT 1`, [lat,lat,lon]);
    res.set('Cache-Control','no-store').json({ building: candidate });
  }));
  api.get('/buildings/:id', asyncRoute(async (req, res) => {
    if (!uuid(req)) return res.status(400).json({ error:'invalid_id' });
    const building = await one("SELECT * FROM basira_buildings WHERE id=? AND status='ACTIVE'",[req.params.id]);
    if (!building) return res.status(404).json({ error:'not_found' });
    res.json({ building });
  }));
  api.post('/buildings', asyncRoute(async (req,res) => {
    const actor=await editor(req,res); if (!actor) return;
    const data=parse(buildingInput,req,res); if (!data) return;
    if ((data.verificationStatus && data.verificationStatus !== 'DISCOVERED') || (data.mapStatus && data.mapStatus !== 'UNMAPPED')) return res.status(403).json({error:'map_status_requires_review'});
    const newId=randomUUID();
    await pool.execute(`INSERT INTO basira_buildings (id,name,alternative_names,organization_name,building_type,description,address,latitude,longitude,number_of_floors,status,map_status,verification_status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId,data.name,JSON.stringify(data.alternativeNames),value(data.organizationName),data.buildingType,value(data.description),value(data.address),value(data.latitude),value(data.longitude),value(data.numberOfFloors),data.status??'ACTIVE',data.mapStatus??'UNMAPPED',data.verificationStatus??'DISCOVERED',actor.userId]);
    res.status(201).json({ building: await one('SELECT * FROM basira_buildings WHERE id=?',[newId]) });
  }));
  api.patch('/buildings/:id', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const actor=await editor(req,res,req.params.id); if (!actor) return;
    const data=parse(buildingInput.partial(),req,res); if (!data) return;
    if (data.verificationStatus !== undefined || data.mapStatus === 'MAPPED') return res.status(403).json({error:'official_map_requires_review'});
    const columns: Record<string,string>={name:'name',alternativeNames:'alternative_names',organizationName:'organization_name',buildingType:'building_type',description:'description',address:'address',latitude:'latitude',longitude:'longitude',numberOfFloors:'number_of_floors',status:'status',mapStatus:'map_status',verificationStatus:'verification_status'};
    const entries=Object.entries(data); if (!entries.length) return res.status(400).json({error:'empty_update'});
    await pool.execute(`UPDATE basira_buildings SET ${entries.map(([k])=>`${columns[k]}=?`).join(',')} WHERE id=?`,[...entries.map(([k,v])=>k==='alternativeNames'?JSON.stringify(v):value(v)),req.params.id]);
    const building=await one('SELECT * FROM basira_buildings WHERE id=?',[req.params.id]);
    res.status(building?200:404).json(building?{building}:{error:'not_found'});
  }));
  api.get('/buildings/:id/floors', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    res.json({ floors: await rows('SELECT * FROM basira_floors WHERE building_id=? ORDER BY floor_number',[req.params.id]) });
  }));
  api.post('/buildings/:id/floors', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const actor=await editor(req,res,req.params.id); if (!actor) return;
    const data=parse(floorInput,req,res); if (!data) return;
    if (!await exists('basira_buildings',req.params.id)) return res.status(404).json({error:'building_not_found'});
    const newId=randomUUID();
    await pool.execute('INSERT INTO basira_floors (id,building_id,floor_number,name,description,floor_plan_reference,local_origin) VALUES (?,?,?,?,?,?,?)',[newId,req.params.id,data.floorNumber,data.name,value(data.description),value(data.floorPlanReference),data.localOrigin?JSON.stringify(data.localOrigin):null]);
    res.status(201).json({floor:await one('SELECT * FROM basira_floors WHERE id=?',[newId])});
  }));
  api.get('/buildings/:id/places', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const q=queryText(req), f=typeof req.query.floorId==='string'&&id.safeParse(req.query.floorId).success?req.query.floorId:null;
    const list=await rows(`SELECT p.*,f.name AS floor_name,b.name AS building_name FROM basira_places p JOIN basira_floors f ON f.id=p.floor_id JOIN basira_buildings b ON b.id=p.building_id WHERE p.building_id=? AND p.is_public=1 AND (? IS NULL OR p.floor_id=?) AND (?='' OR p.name LIKE ? OR p.room_number LIKE ? OR p.department_name LIKE ? OR JSON_SEARCH(p.aliases,'one',?) IS NOT NULL) ORDER BY f.floor_number,p.name LIMIT 200`,[req.params.id,f,f,q,like(q),like(q),like(q),q]);
    res.json({places:list});
  }));
  api.post('/buildings/:id/places', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const actor=await editor(req,res,req.params.id); if (!actor) return;
    const data=parse(placeInput,req,res); if (!data) return;
    if (data.verificationStatus && data.verificationStatus !== 'DISCOVERED') return res.status(403).json({error:'official_map_requires_review'});
    if (!await exists('basira_floors',data.floorId,req.params.id)) return res.status(400).json({error:'floor_building_mismatch'});
    const newId=randomUUID();
    await pool.execute(`INSERT INTO basira_places (id,building_id,floor_id,name,room_number,aliases,department_name,description,place_type,local_x,local_y,latitude,longitude,entrance_direction,accessibility_information,verification_status,confidence_score,is_public,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId,req.params.id,data.floorId,data.name,value(data.roomNumber),JSON.stringify(data.aliases),value(data.departmentName),value(data.description),data.placeType,value(data.localX),value(data.localY),value(data.latitude),value(data.longitude),value(data.entranceDirection),value(data.accessibilityInformation),data.verificationStatus??'DISCOVERED',value(data.confidenceScore),bool(data.isPublic??true),actor.userId]);
    res.status(201).json({place:await one('SELECT * FROM basira_places WHERE id=?',[newId])});
  }));
  api.get('/places/:id', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const place=await one(`SELECT p.*,f.name AS floor_name,b.name AS building_name FROM basira_places p JOIN basira_floors f ON f.id=p.floor_id JOIN basira_buildings b ON b.id=p.building_id WHERE p.id=? AND p.is_public=1`,[req.params.id]);
    res.status(place?200:404).json(place?{place}:{error:'not_found'});
  }));
  api.patch('/places/:id', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const current=await one('SELECT * FROM basira_places WHERE id=?',[req.params.id]); if (!current) return res.status(404).json({error:'not_found'});
    const actor=await editor(req,res,current.buildingId); if (!actor) return;
    const data=parse(placeInput.partial(),req,res); if (!data) return;
    if (data.verificationStatus !== undefined) return res.status(403).json({error:'official_map_requires_review'});
    if (data.floorId && !await exists('basira_floors',data.floorId,current.buildingId)) return res.status(400).json({error:'floor_building_mismatch'});
    const columns:Record<string,string>={name:'name',roomNumber:'room_number',aliases:'aliases',departmentName:'department_name',floorId:'floor_id',description:'description',placeType:'place_type',localX:'local_x',localY:'local_y',latitude:'latitude',longitude:'longitude',entranceDirection:'entrance_direction',accessibilityInformation:'accessibility_information',verificationStatus:'verification_status',confidenceScore:'confidence_score',isPublic:'is_public'};
    const entries=Object.entries(data); if (!entries.length) return res.status(400).json({error:'empty_update'});
    await pool.execute(`UPDATE basira_places SET ${entries.map(([k])=>`${columns[k]}=?`).join(',')} WHERE id=?`,[...entries.map(([k,v])=>k==='aliases'?JSON.stringify(v):k==='isPublic'?bool(v):value(v)),req.params.id]);
    res.json({place:await one('SELECT * FROM basira_places WHERE id=?',[req.params.id])});
  }));
  api.get('/search', asyncRoute(async (req,res) => {
    const q=queryText(req); if (!q) return res.json({results:[]});
    const actor=await identity(req); const current=typeof req.query.currentBuildingId==='string'&&id.safeParse(req.query.currentBuildingId).success?req.query.currentBuildingId:null;
    const includeOthers=req.query.includeOtherBuildings==='true';
    const results=await new PlaceSearchService().search(q,actor.userId,current,includeOthers);
    res.set('Cache-Control','no-store').json({results});
  }));
  api.get('/saved-places', asyncRoute(async (req,res) => {
    const userId=await owner(req,res); if (!userId) return;
    const q=queryText(req); const filter=req.query.filter;
    const clause=filter==='favorites'?' AND s.is_favorite=1':filter==='recent'?' AND s.last_used_at IS NOT NULL':'';
    const saved=await rows(`SELECT s.*,b.name AS building_name,f.name AS floor_name FROM basira_saved_places s LEFT JOIN basira_buildings b ON b.id=s.building_id LEFT JOIN basira_floors f ON f.id=s.floor_id WHERE s.user_id=? AND (?='' OR s.name LIKE ?)${clause} ORDER BY ${filter==='recent'?'s.last_used_at':'s.updated_at'} DESC LIMIT 200`,[userId,q,like(q)]);
    res.set('Cache-Control','private, no-store').json({savedPlaces:saved});
  }));
  api.get('/saved-places/:id', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const userId=await owner(req,res); if (!userId) return;
    const savedPlace=await one(`SELECT s.*,b.name AS building_name,f.name AS floor_name FROM basira_saved_places s LEFT JOIN basira_buildings b ON b.id=s.building_id LEFT JOIN basira_floors f ON f.id=s.floor_id WHERE s.id=? AND s.user_id=?`,[req.params.id,userId]);
    res.set('Cache-Control','private, no-store').status(savedPlace?200:404).json(savedPlace?{savedPlace}:{error:'not_found'});
  }));
  api.post('/saved-places', asyncRoute(async (req,res) => {
    const userId=await owner(req,res); if (!userId) return;
    const data=parse(savedInput,req,res); if (!data) return;
    if (!await validLocation(data)) return res.status(400).json({error:'location_mismatch'});
    if ((data.localX!=null||data.localY!=null) && (!data.buildingId||!data.floorId||data.localX==null||data.localY==null)) return res.status(400).json({error:'invalid_local_position'});
    if (!data.placeId && (data.latitude==null||data.longitude==null) && !data.buildingId) return res.status(400).json({error:'location_required'});
    const newId=randomUUID();
    await pool.execute(`INSERT INTO basira_saved_places (id,user_id,name,category,notes,latitude,longitude,building_id,floor_id,place_id,is_favorite,local_x,local_y,localization_confidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[newId,userId,data.name,data.category,value(data.notes),value(data.latitude),value(data.longitude),value(data.buildingId),value(data.floorId),value(data.placeId),bool(data.isFavorite),value(data.localX),value(data.localY),value(data.localizationConfidence)]);
    res.set('Cache-Control','private, no-store').status(201).json({savedPlace:await one('SELECT * FROM basira_saved_places WHERE id=? AND user_id=?',[newId,userId])});
  }));
  api.patch('/saved-places/:id', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const userId=await owner(req,res); if (!userId) return;
    const data=parse(savedInput.partial(),req,res); if (!data) return;
    const old=await one('SELECT * FROM basira_saved_places WHERE id=? AND user_id=?',[req.params.id,userId]); if (!old) return res.status(404).json({error:'not_found'});
    if (((data.buildingId!==undefined&&data.buildingId!==old.buildingId)||(data.floorId!==undefined&&data.floorId!==old.floorId)||(data.placeId!==undefined&&data.placeId!==old.placeId))&&data.localX===undefined&&data.localY===undefined) {
      data.localX=null;data.localY=null;data.localizationConfidence=null;
    }
    if (!await validLocation({...old,...data})) return res.status(400).json({error:'location_mismatch'});
    const position={...old,...data};
    if ((position.localX!=null||position.localY!=null) && (!position.buildingId||!position.floorId||position.localX==null||position.localY==null)) return res.status(400).json({error:'invalid_local_position'});
    const columns:Record<string,string>={name:'name',category:'category',notes:'notes',latitude:'latitude',longitude:'longitude',buildingId:'building_id',floorId:'floor_id',placeId:'place_id',isFavorite:'is_favorite',localX:'local_x',localY:'local_y',localizationConfidence:'localization_confidence'};
    const entries=Object.entries(data); if (!entries.length) return res.status(400).json({error:'empty_update'});
    await pool.execute(`UPDATE basira_saved_places SET ${entries.map(([k])=>`${columns[k]}=?`).join(',')} WHERE id=? AND user_id=?`,[...entries.map(([k,v])=>k==='isFavorite'?bool(v):value(v)),req.params.id,userId]);
    res.set('Cache-Control','private, no-store').json({savedPlace:await one('SELECT * FROM basira_saved_places WHERE id=? AND user_id=?',[req.params.id,userId])});
  }));
  api.delete('/saved-places/:id', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const userId=await owner(req,res); if (!userId) return;
    const [result]=await pool.execute('DELETE FROM basira_saved_places WHERE id=? AND user_id=?',[req.params.id,userId]);
    res.status((result as {affectedRows:number}).affectedRows?204:404).end();
  }));
  api.post('/saved-places/:id/favorite', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const userId=await owner(req,res); if (!userId) return;
    const data=parse(z.object({isFavorite:z.boolean()}),req,res); if (!data) return;
    const [result]=await pool.execute('UPDATE basira_saved_places SET is_favorite=? WHERE id=? AND user_id=?',[bool(data.isFavorite),req.params.id,userId]);
    res.status((result as {affectedRows:number}).affectedRows?200:404).json((result as {affectedRows:number}).affectedRows?{isFavorite:data.isFavorite}:{error:'not_found'});
  }));
  api.post('/saved-places/:id/select', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const userId=await owner(req,res); if (!userId) return;
    const [result]=await pool.execute('UPDATE basira_saved_places SET last_used_at=CURRENT_TIMESTAMP(3) WHERE id=? AND user_id=?',[req.params.id,userId]);
    res.status((result as {affectedRows:number}).affectedRows?200:404).json((result as {affectedRows:number}).affectedRows?{selected:true}:{error:'not_found'});
  }));
  api.get('/buildings/:id/graph', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const building=await one("SELECT * FROM basira_buildings WHERE id=? AND status='ACTIVE'",[req.params.id]);
    if (!building) return res.status(404).json({error:'not_found'});
    const [nodes,edges]=await Promise.all([rows('SELECT n.id,n.building_id,n.floor_id,CASE WHEN p.is_public=1 THEN n.place_id ELSE NULL END AS place_id,n.x,n.y,n.node_type,n.accessibility_level FROM basira_map_nodes n LEFT JOIN basira_places p ON p.id=n.place_id WHERE n.building_id=?',[req.params.id]),rows('SELECT * FROM basira_map_edges WHERE building_id=?',[req.params.id])]);
    res.json({building,nodes,edges});
  }));
  api.get('/buildings/:id/nodes', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const graph=await rows('SELECT n.id,n.building_id,n.floor_id,CASE WHEN p.is_public=1 THEN n.place_id ELSE NULL END AS place_id,n.x,n.y,n.node_type,n.accessibility_level FROM basira_map_nodes n LEFT JOIN basira_places p ON p.id=n.place_id WHERE n.building_id=?',[req.params.id]);
    res.json({nodes:graph});
  }));
  api.get('/buildings/:id/edges', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    res.json({edges:await rows('SELECT * FROM basira_map_edges WHERE building_id=?',[req.params.id])});
  }));
  api.post('/buildings/:id/nodes', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const actor=await editor(req,res,req.params.id); if (!actor) return;
    const data=parse(nodeInput,req,res); if (!data) return;
    if (!await exists('basira_floors',data.floorId,req.params.id)) return res.status(400).json({error:'floor_building_mismatch'});
    if (data.placeId) { const p=await one('SELECT floor_id FROM basira_places WHERE id=? AND building_id=?',[data.placeId,req.params.id]); if (!p||p.floorId!==data.floorId) return res.status(400).json({error:'place_floor_mismatch'}); }
    const newId=randomUUID();
    await pool.execute('INSERT INTO basira_map_nodes (id,building_id,floor_id,place_id,x,y,node_type,accessibility_level) VALUES (?,?,?,?,?,?,?,?)',[newId,req.params.id,data.floorId,value(data.placeId),data.x,data.y,data.nodeType,data.accessibilityLevel]);
    await pool.execute("UPDATE basira_buildings SET map_status='IN_PROGRESS' WHERE id=? AND map_status='UNMAPPED'",[req.params.id]);
    res.status(201).json({node:await one('SELECT * FROM basira_map_nodes WHERE id=?',[newId])});
  }));
  api.post('/buildings/:id/edges', asyncRoute(async (req,res) => {
    if (!uuid(req)) return res.status(400).json({error:'invalid_id'});
    const actor=await editor(req,res,req.params.id); if (!actor) return;
    const data=parse(edgeInput,req,res); if (!data) return;
    if (data.fromNodeId===data.toNodeId || !await exists('basira_map_nodes',data.fromNodeId,req.params.id) || !await exists('basira_map_nodes',data.toNodeId,req.params.id)) return res.status(400).json({error:'invalid_nodes'});
    const newId=randomUUID();
    await pool.execute(`INSERT INTO basira_map_edges (id,building_id,from_node_id,to_node_id,distance_meters,direction,path_type,accessibility_level,has_stairs,has_ramp,wheelchair_accessible,visually_impaired_friendly,temporarily_closed,risk_level) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[newId,req.params.id,data.fromNodeId,data.toNodeId,data.distanceMeters,value(data.direction),data.pathType,data.accessibilityLevel,bool(data.hasStairs),bool(data.hasRamp),bool(data.wheelchairAccessible),bool(data.visuallyImpairedFriendly),bool(data.temporarilyClosed),data.riskLevel]);
    await pool.execute("UPDATE basira_buildings SET map_status='IN_PROGRESS' WHERE id=? AND map_status='UNMAPPED'",[req.params.id]);
    res.status(201).json({edge:await one('SELECT * FROM basira_map_edges WHERE id=?',[newId])});
  }));
}
