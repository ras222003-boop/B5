import { randomUUID } from 'node:crypto';
import type { Router, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { auth, pool } from './auth';
import { summarizeGraphRoute, type NodeRow, type EdgeRow } from './savedRouteDomain';

const uuid = z.string().uuid();
const routeInput = z.object({
  name: z.string().trim().min(1).max(255), buildingId: uuid,
  nodeIds: z.array(uuid).min(2).max(512), edgeIds: z.array(uuid).min(1).max(511),
  durationSeconds: z.number().int().min(1).max(86400).nullable().optional(),
}).strict().refine(value => value.edgeIds.length === value.nodeIds.length - 1, 'invalid_route_length');
const handler = (fn:(req:Request,res:Response)=>Promise<void>) => (req:Request,res:Response) => { void fn(req,res).catch(error => { console.error('Saved route API error',error); if (!res.headersSent) res.status(500).json({error:'server_error'}); }); };
async function owner(req:Request,res:Response) {
  const session = await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
  if (!session) { res.status(401).json({error:'sign_in_required'}); return null; }
  return session.user.id;
}
function present(row:Record<string,any>) {
  const data = typeof row.route_data === 'string' ? JSON.parse(row.route_data) : row.route_data;
  const count = Number(row.successful_arrival_count);
  return {id:row.id,name:row.name,buildingId:row.building_id,originNodeId:row.origin_node_id,destinationNodeId:row.destination_node_id,
    routeData:data,mapVersion:Number(row.map_version),successfulArrivalCount:count,typicalDurationSeconds:row.typical_duration_seconds === null ? null : Number(row.typical_duration_seconds),
    lastSuccessfulAt:row.last_successful_at,lastVerifiedAt:row.last_verified_at,createdAt:row.created_at,updatedAt:row.updated_at,
    familiarity:count >= 5 ? 'HIGH_CONFIDENCE' : count >= 2 ? 'FAMILIAR' : 'NEWLY_LEARNED'};
}
export function registerSavedRouteRoutes(api:Router) {
  api.get('/saved-routes',handler(async(req,res) => {
    const userId = await owner(req,res); if (!userId) return;
    const [found] = await pool.execute<any[]>('SELECT * FROM basira_saved_routes WHERE user_id=? ORDER BY last_successful_at DESC LIMIT 200',[userId]);
    res.set('Cache-Control','private, no-store').json({savedRoutes:found.map(present)});
  }));
  api.post('/saved-routes',handler(async(req,res) => {
    const userId = await owner(req,res); if (!userId) return;
    const parsed = routeInput.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({error:'invalid_input'}); return; }
    const data = parsed.data;
    const [buildings] = await pool.execute<any[]>("SELECT id,map_status FROM basira_buildings WHERE id=? AND status='ACTIVE'",[data.buildingId]);
    if (!buildings.length || buildings[0].map_status !== 'MAPPED') { res.status(400).json({error:'map_unavailable'}); return; }
    const [nodes] = await pool.execute<any[]>(`SELECT id,floor_id,place_id,x,y FROM basira_map_nodes WHERE building_id=? AND id IN (${data.nodeIds.map(()=>'?').join(',')})`,[data.buildingId,...data.nodeIds]);
    const [edges] = await pool.execute<any[]>(`SELECT id,from_node_id,to_node_id,temporarily_closed,risk_level,path_type FROM basira_map_edges WHERE building_id=? AND id IN (${data.edgeIds.map(()=>'?').join(',')})`,[data.buildingId,...data.edgeIds]);
    const routeData = summarizeGraphRoute(data.nodeIds,data.edgeIds,nodes as NodeRow[],edges as EdgeRow[]);
    if (!routeData) { res.status(400).json({error:'invalid_or_closed_route'}); return; }
    const [versions] = await pool.execute<any[]>('SELECT current_version FROM basira_map_versions WHERE building_id=?',[data.buildingId]);
    const routeId = randomUUID();
    await pool.execute('INSERT INTO basira_saved_routes (id,user_id,building_id,name,origin_node_id,destination_node_id,route_data,map_version,typical_duration_seconds) VALUES (?,?,?,?,?,?,?,?,?)',
      [routeId,userId,data.buildingId,data.name,data.nodeIds[0],data.nodeIds[data.nodeIds.length-1],JSON.stringify(routeData),Number(versions[0]?.current_version??1),data.durationSeconds??null]);
    const [saved] = await pool.execute<any[]>('SELECT * FROM basira_saved_routes WHERE id=? AND user_id=?',[routeId,userId]);
    res.set('Cache-Control','private, no-store').status(201).json({savedRoute:present(saved[0])});
  }));
  api.post('/saved-routes/:id/success',handler(async(req,res) => {
    const userId = await owner(req,res); if (!userId) return;
    if (!uuid.safeParse(req.params.id).success) { res.status(400).json({error:'invalid_id'}); return; }
    const parsed = z.object({durationSeconds:z.number().int().min(1).max(86400).nullable().optional()}).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({error:'invalid_input'}); return; }
    const [saved] = await pool.execute<any[]>('SELECT * FROM basira_saved_routes WHERE id=? AND user_id=?',[req.params.id,userId]);
    if (!saved.length) { res.status(404).json({error:'not_found'}); return; }
    // A reported successful arrival is user evidence, not a field-verified safety certificate.
    const previous = saved[0].typical_duration_seconds == null ? null : Number(saved[0].typical_duration_seconds);
    const duration = parsed.data.durationSeconds == null ? previous : previous == null ? parsed.data.durationSeconds : Math.round(previous*.7+parsed.data.durationSeconds*.3);
    await pool.execute('UPDATE basira_saved_routes SET successful_arrival_count=successful_arrival_count+1,last_successful_at=CURRENT_TIMESTAMP(3),typical_duration_seconds=? WHERE id=? AND user_id=?',[duration,req.params.id,userId]);
    const [updated] = await pool.execute<any[]>('SELECT * FROM basira_saved_routes WHERE id=? AND user_id=?',[req.params.id,userId]);
    res.set('Cache-Control','private, no-store').json({savedRoute:present(updated[0])});
  }));
  api.delete('/saved-routes/:id',handler(async(req,res) => {
    const userId = await owner(req,res); if (!userId) return;
    if (!uuid.safeParse(req.params.id).success) { res.status(400).json({error:'invalid_id'}); return; }
    const [result] = await pool.execute<any>('DELETE FROM basira_saved_routes WHERE id=? AND user_id=?',[req.params.id,userId]);
    res.status(result.affectedRows ? 204 : 404).end();
  }));
}
