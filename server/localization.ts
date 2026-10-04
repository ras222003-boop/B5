import { randomUUID } from 'node:crypto';
import type { Router, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { auth, pool } from './auth';
import { suggestionTypes } from '../shared/localization';
import { advanceMapVersion, type Change } from './sharedMapPromotion';

const id=z.string().uuid();
const position=z.number().finite().min(-100000).max(100000);
const confidence=z.number().finite().min(0).max(1);
const source=z.enum(['QR','MANUAL','VISUAL_PLACE','VISION_WALKABLE','GPS_BUILDING','STEP_MOTION','COMPASS','GYROSCOPE','NATIVE_AR','BEACON','WIFI','NFC','BAROMETER']);
const anchor=z.object({buildingId:id,floorId:id,x:position,y:position,headingDegrees:z.number().finite().nullable(),confidence,uncertaintyRadius:z.number().nonnegative().nullable(),source,timestamp:z.number().int().positive(),nodeId:id.nullable().optional(),placeId:id.nullable().optional()});
const sessionInput=z.object({buildingId:id,startAnchor:anchor.nullable(),deviceCapabilities:z.record(z.string(),z.boolean()),confidence});
const trackInput=z.object({points:z.array(z.object({timestamp:z.number().int().positive(),x:position,y:position,floorId:id.nullable(),headingDegrees:z.number().finite().nullable(),confidence,sourceSummary:z.array(source).max(12)})).max(2000)});
const anchorsInput=z.object({anchors:z.array(anchor).max(500)});
const floorEventsInput=z.object({events:z.array(z.object({type:z.enum(['ENTER_ELEVATOR','EXIT_ELEVATOR','STAIRS_TRANSITION','FLOOR_CONFIRMED']),floorId:id.nullable(),timestamp:z.number().int().positive(),source})).max(500)});
const geometry=z.object({from:z.object({x:position,y:position}),to:z.object({x:position,y:position})}).nullable();
const suggestionInput=z.object({suggestions:z.array(z.object({id,buildingId:id,floorId:id.nullable(),type:z.enum(suggestionTypes),confidence,x:position.nullable(),y:position.nullable(),name:z.string().trim().max(255).nullable(),placeId:id.nullable(),suggestedPlaceType:z.enum(['CLASSROOM','OFFICE','ELEVATOR','EXIT','ENTRANCE','PHARMACY','CLINIC','OTHER']).nullable(),fromNodeId:id.nullable(),toNodeId:id.nullable(),source:z.array(source).max(12),geometry,dedupKey:z.string().min(1).max(255)})).max(100)});
type Actor={userId:string;role:'mapper'|'admin'|null};
export function canManageMapping(role:string|null|undefined){return role==='mapper'||role==='admin';}
const jsonValue=(value:unknown)=>typeof value==='string'?JSON.parse(value):value;
const camel=(key:string)=>key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
const present=(row:Record<string,any>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[camel(key),
  ['start_anchor','device_capabilities','source_summary','source','geometry'].includes(key)?jsonValue(value):
  ['x','y','confidence','heading_degrees'].includes(key)&&value!==null?Number(value):value]));
async function rows(sql:string,params:any[]=[]){const [result]=await pool.execute(sql,params);return (result as Record<string,any>[]).map(present);}
async function one(sql:string,params:any[]=[]){return (await rows(sql,params))[0]??null;}
const route=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response)=>{Promise.resolve(fn(req,res)).catch(error=>{console.error('Localization API error',error);if(!res.headersSent)res.status(500).json({error:'server_error'});});};
async function actor(req:Request,res:Response):Promise<Actor|null>{
  const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
  if(!session){res.status(401).json({error:'sign_in_required'});return null;}
  const grant=await one('SELECT role FROM basira_navigation_roles WHERE user_id=?',[session.user.id]);
  if(!canManageMapping(grant?.role)){res.status(403).json({error:'mapper_role_required'});return null;}
  return {userId:session.user.id,role:grant.role};
}
async function session(req:Request,res:Response,viewer:Actor){
  if(!id.safeParse(req.params.sessionId).success){res.status(400).json({error:'invalid_id'});return null;}
  const item=await one('SELECT * FROM basira_mapping_sessions WHERE id=?',[req.params.sessionId]);
  if(!item){res.status(404).json({error:'not_found'});return null;}
  if(item.startedBy!==viewer.userId&&viewer.role!=='admin'){res.status(403).json({error:'session_owner_required'});return null;}
  return item;
}
async function sameFloor(buildingId:string,floorId:string|null){return floorId!==null&&Boolean(await one('SELECT id FROM basira_floors WHERE id=? AND building_id=?',[floorId,buildingId]));}
async function validAnchor(buildingId:string,value:z.infer<typeof anchor>|null){
  if(!value)return true;
  if(value.buildingId!==buildingId||!await sameFloor(buildingId,value.floorId))return false;
  if(value.nodeId){const node=await one('SELECT id,x,y,floor_id FROM basira_map_nodes WHERE id=? AND building_id=?',[value.nodeId,buildingId]);if(!node||node.floorId!==value.floorId||Math.hypot(node.x-value.x,node.y-value.y)>1)return false;}
  if(value.placeId){const place=await one('SELECT id,floor_id FROM basira_places WHERE id=? AND building_id=? AND is_public=1',[value.placeId,buildingId]);if(!place||place.floorId!==value.floorId)return false;}
  return true;
}

export function registerLocalizationRoutes(api:Router){
  api.get('/buildings/:id/anchors',route(async(req,res)=>{
    if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    const anchors=await rows('SELECT n.id,n.building_id,n.floor_id,n.place_id,n.x,n.y,n.node_type,p.name AS place_name FROM basira_map_nodes n LEFT JOIN basira_places p ON p.id=n.place_id AND p.is_public=1 WHERE n.building_id=? AND (n.place_id IS NULL OR p.id IS NOT NULL)',[req.params.id]);
    res.json({anchors});
  }));
  api.get('/buildings/:id/mapping-sessions',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    const list=await rows('SELECT * FROM basira_mapping_sessions WHERE building_id=? AND (started_by=? OR ?=\'admin\') ORDER BY started_at DESC LIMIT 100',[req.params.id,viewer.userId,viewer.role]);
    res.set('Cache-Control','private, no-store').json({sessions:list});
  }));
  api.post('/mapping-sessions',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    const parsed=sessionInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const data=parsed.data;
    if(!await one("SELECT id FROM basira_buildings WHERE id=? AND status='ACTIVE'",[data.buildingId]))return res.status(404).json({error:'building_not_found'});
    if(!await validAnchor(data.buildingId,data.startAnchor))return res.status(400).json({error:'invalid_anchor'});
    const newId=randomUUID();
    await pool.execute('INSERT INTO basira_mapping_sessions (id,building_id,started_by,start_anchor,confidence,device_capabilities) VALUES (?,?,?,?,?,?)',
      [newId,data.buildingId,viewer.userId,data.startAnchor?JSON.stringify(data.startAnchor):null,data.confidence,JSON.stringify(data.deviceCapabilities)]);
    res.status(201).json({session:await one('SELECT * FROM basira_mapping_sessions WHERE id=?',[newId])});
  }));
  api.get('/mapping-sessions/:sessionId',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    const item=await session(req,res,viewer);if(!item)return;
    const [track,suggestions,anchors,floorEvents]=await Promise.all([rows('SELECT session_id,recorded_at AS timestamp,x,y,floor_id,heading_degrees,confidence,source_summary FROM basira_mapping_track WHERE session_id=? ORDER BY recorded_at LIMIT 5000',[item.id]),rows('SELECT * FROM basira_map_suggestions WHERE session_id=? ORDER BY created_at',[item.id]),rows('SELECT * FROM basira_mapping_anchors WHERE session_id=? ORDER BY observed_at',[item.id]),rows('SELECT * FROM basira_mapping_floor_events WHERE session_id=? ORDER BY occurred_at',[item.id])]);
    res.set('Cache-Control','private, no-store').json({session:item,track,suggestions,anchors,floorEvents});
  }));
  api.post('/mapping-sessions/:sessionId/anchors',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    const item=await session(req,res,viewer);if(!item)return;
    if(item.status!=='ACTIVE')return res.status(409).json({error:'session_closed'});
    const parsed=anchorsInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    for(const a of parsed.data.anchors)if(!await validAnchor(item.buildingId,a))return res.status(400).json({error:'invalid_anchor'});
    for(const a of parsed.data.anchors)await pool.execute('INSERT INTO basira_mapping_anchors (session_id,observed_at,floor_id,node_id,place_id,x,y,confidence,`source`) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE floor_id=VALUES(floor_id),node_id=VALUES(node_id),place_id=VALUES(place_id),x=VALUES(x),y=VALUES(y),confidence=VALUES(confidence),`source`=VALUES(`source`)',
      [item.id,new Date(a.timestamp),a.floorId,a.nodeId??null,a.placeId??null,a.x,a.y,a.confidence,a.source]);
    if(parsed.data.anchors.length)await pool.execute('UPDATE basira_mapping_sessions SET start_anchor=COALESCE(start_anchor,?),confidence=? WHERE id=?',
      [JSON.stringify(parsed.data.anchors[0]),parsed.data.anchors.at(-1)!.confidence,item.id]);
    res.status(201).json({saved:parsed.data.anchors.length});
  }));
  api.post('/mapping-sessions/:sessionId/floor-events',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    const item=await session(req,res,viewer);if(!item)return;
    if(item.status!=='ACTIVE')return res.status(409).json({error:'session_closed'});
    const parsed=floorEventsInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    for(const event of parsed.data.events)if(event.floorId&&!await sameFloor(item.buildingId,event.floorId))return res.status(400).json({error:'floor_building_mismatch'});
    for(const event of parsed.data.events)await pool.execute('INSERT IGNORE INTO basira_mapping_floor_events (session_id,occurred_at,`type`,floor_id,`source`) VALUES (?,?,?,?,?)',
      [item.id,new Date(event.timestamp),event.type,event.floorId,event.source]);
    res.status(201).json({saved:parsed.data.events.length});
  }));
  api.post('/mapping-sessions/:sessionId/track',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    const item=await session(req,res,viewer);if(!item)return;
    if(item.status!=='ACTIVE')return res.status(409).json({error:'session_closed'});
    const parsed=trackInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const points=parsed.data.points;
    for(const point of points)if(!await sameFloor(item.buildingId,point.floorId))return res.status(400).json({error:'floor_building_mismatch'});
    for(const point of points)await pool.execute('INSERT INTO basira_mapping_track (session_id,recorded_at,floor_id,x,y,heading_degrees,confidence,source_summary) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE floor_id=VALUES(floor_id),x=VALUES(x),y=VALUES(y),heading_degrees=VALUES(heading_degrees),confidence=VALUES(confidence),source_summary=VALUES(source_summary)',
      [item.id,new Date(point.timestamp),point.floorId,point.x,point.y,point.headingDegrees,point.confidence,JSON.stringify(point.sourceSummary)]);
    res.status(201).json({saved:points.length});
  }));
  api.post('/mapping-sessions/:sessionId/suggestions',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    const item=await session(req,res,viewer);if(!item)return;
    if(item.status!=='ACTIVE')return res.status(409).json({error:'session_closed'});
    const parsed=suggestionInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    for(const s of parsed.data.suggestions){
      if(s.buildingId!==item.buildingId||!await sameFloor(item.buildingId,s.floorId))return res.status(400).json({error:'floor_building_mismatch'});
      if(s.placeId){const place=await one('SELECT floor_id FROM basira_places WHERE id=? AND building_id=? AND is_public=1',[s.placeId,item.buildingId]);if(!place||place.floorId!==s.floorId)return res.status(400).json({error:'place_floor_mismatch'});}
    }
    for(const s of parsed.data.suggestions)await pool.execute('INSERT IGNORE INTO basira_map_suggestions (id,session_id,building_id,floor_id,`type`,confidence,x,y,name,place_id,suggested_place_type,from_node_id,to_node_id,`source`,`geometry`,dedup_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [s.id,item.id,s.buildingId,s.floorId,s.type,s.confidence,s.x,s.y,s.name,s.placeId,s.suggestedPlaceType,s.fromNodeId,s.toNodeId,JSON.stringify(s.source),s.geometry?JSON.stringify(s.geometry):null,s.dedupKey]);
    res.status(201).json({submitted:parsed.data.suggestions.length});
  }));
  api.post('/mapping-sessions/:sessionId/finalize',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    const item=await session(req,res,viewer);if(!item)return;
    if(item.status!=='ACTIVE')return res.status(409).json({error:'session_closed'});
    const body=z.object({cancel:z.boolean().default(false)}).safeParse(req.body);if(!body.success)return res.status(400).json({error:'invalid_input'});
    if(body.data.cancel){await pool.execute('DELETE FROM basira_mapping_track WHERE session_id=?',[item.id]);await pool.execute('DELETE FROM basira_mapping_anchors WHERE session_id=?',[item.id]);await pool.execute('DELETE FROM basira_mapping_floor_events WHERE session_id=?',[item.id]);await pool.execute('DELETE FROM basira_map_suggestions WHERE session_id=?',[item.id]);}
    const pending=await one("SELECT COUNT(*) AS count FROM basira_map_suggestions WHERE session_id=? AND status='PENDING'",[item.id]);
    const status=body.data.cancel?'CANCELLED':Number(pending?.count)>0?'REVIEW_REQUIRED':'COMPLETED';
    await pool.execute('UPDATE basira_mapping_sessions SET status=?,ended_at=CURRENT_TIMESTAMP(3) WHERE id=?',[status,item.id]);
    res.json({status});
  }));
  api.get('/buildings/:id/map-suggestions',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    const suggestions=await rows('SELECT s.* FROM basira_map_suggestions s JOIN basira_mapping_sessions m ON m.id=s.session_id WHERE s.building_id=? AND (m.started_by=? OR ?=\'admin\') ORDER BY s.created_at DESC LIMIT 500',[req.params.id,viewer.userId,viewer.role]);
    res.set('Cache-Control','private, no-store').json({suggestions});
  }));
  api.post('/map-suggestions/:id/review',route(async(req,res)=>{
    const viewer=await actor(req,res);if(!viewer)return;
    if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    const body=z.object({decision:z.enum(['ACCEPTED','REJECTED'])}).safeParse(req.body);if(!body.success)return res.status(400).json({error:'invalid_input'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [found]=await connection.query<any[]>('SELECT * FROM basira_map_suggestions WHERE id=? FOR UPDATE',[req.params.id]);
      const s=found[0];
      if(!s){await connection.rollback();return res.status(404).json({error:'not_found'});}
      if(s.status!=='PENDING'){await connection.rollback();return res.status(409).json({error:'already_reviewed'});}
      const [sessions]=await connection.query<any[]>('SELECT status FROM basira_mapping_sessions WHERE id=?',[s.session_id]);
      if(sessions[0]?.status==='ACTIVE'){await connection.rollback();return res.status(409).json({error:'session_active'});}
      const changes:Change[]=[];
      const snapshot=async(entity:Change['entityType'],entityId:string)=>{const table={PLACE:'basira_places',MAP_NODE:'basira_map_nodes',MAP_EDGE:'basira_map_edges'}[entity];const [records]=await connection.query<any[]>(`SELECT * FROM ${table} WHERE id=?`,[entityId]);return records[0]??null;};
      let version:number|null=null;
      if(body.data.decision==='ACCEPTED'){
        if(!s.floor_id){await connection.rollback();return res.status(400).json({error:'floor_required'});}
        const [floors]=await connection.query<any[]>('SELECT id FROM basira_floors WHERE id=? AND building_id=?',[s.floor_id,s.building_id]);
        if(!floors.length){await connection.rollback();return res.status(400).json({error:'invalid_floor'});}
        const nodeType:Record<string,string>={NEW_NODE:'POINT',INTERSECTION:'INTERSECTION',DOOR:'DOOR',ELEVATOR:'ELEVATOR',STAIRS:'STAIRS',ENTRANCE:'ENTRANCE',EXIT:'EXIT',PLACE_ANCHOR:'ROOM',FLOOR_TRANSITION:'POINT'};
        if(nodeType[s.type]){
          if(s.x===null||s.y===null){await connection.rollback();return res.status(400).json({error:'coordinates_required'});}
          let placeId=s.place_id;
          if(s.type==='PLACE_ANCHOR'&&!placeId&&s.name){
            const [places]=await connection.query<any[]>('SELECT id FROM basira_places WHERE building_id=? AND floor_id=? AND name=? AND local_x IS NOT NULL AND local_y IS NOT NULL AND SQRT(POW(local_x-?,2)+POW(local_y-?,2))<=2.5 LIMIT 1',[s.building_id,s.floor_id,s.name,s.x,s.y]);
            placeId=places[0]?.id??randomUUID();
            if(!places.length){await connection.execute("INSERT INTO basira_places (id,building_id,floor_id,name,place_type,local_x,local_y,verification_status,confidence_score,is_public,created_by) VALUES (?,?,?,?,?,?,?,'DISCOVERED',?,1,?)",
              [placeId,s.building_id,s.floor_id,s.name,s.suggested_place_type??'OTHER',s.x,s.y,s.confidence,viewer.userId]);changes.push({action:'CREATE',entityType:'PLACE',entityId:placeId,before:null,after:await snapshot('PLACE',placeId)});}
          }
          const [existing]=await connection.query<any[]>('SELECT id FROM basira_map_nodes WHERE building_id=? AND floor_id=? AND SQRT(POW(x-?,2)+POW(y-?,2))<=1.5 LIMIT 1',[s.building_id,s.floor_id,s.x,s.y]);
          if(!existing.length){const newNodeId=randomUUID();await connection.execute("INSERT INTO basira_map_nodes (id,building_id,floor_id,place_id,x,y,node_type,accessibility_level) VALUES (?,?,?,?,?,?,?,'UNKNOWN')",
            [newNodeId,s.building_id,s.floor_id,placeId,s.x,s.y,nodeType[s.type]]);changes.push({action:'CREATE',entityType:'MAP_NODE',entityId:newNodeId,before:null,after:await snapshot('MAP_NODE',newNodeId)});}
          else if(placeId){const before=await snapshot('MAP_NODE',existing[0].id);await connection.execute('UPDATE basira_map_nodes SET place_id=? WHERE id=? AND place_id IS NULL',[placeId,existing[0].id]);const after=await snapshot('MAP_NODE',existing[0].id);if(JSON.stringify(before)!==JSON.stringify(after))changes.push({action:'UPDATE',entityType:'MAP_NODE',entityId:existing[0].id,before,after});}
        }else if(s.type==='CORRIDOR'||s.type==='NEW_EDGE'){
          const g=jsonValue(s.geometry);
          if(!geometry.safeParse(g).success||!g){await connection.rollback();return res.status(400).json({error:'geometry_required'});}
          const length=Math.hypot(g.to.x-g.from.x,g.to.y-g.from.y);
          if(length<.5||length>200){await connection.rollback();return res.status(400).json({error:'invalid_edge_length'});}
          const ends=[] as string[];
          for(const p of [g.from,g.to]){
            const [near]=await connection.query<any[]>('SELECT id FROM basira_map_nodes WHERE building_id=? AND floor_id=? AND SQRT(POW(x-?,2)+POW(y-?,2))<=1.5 LIMIT 1',[s.building_id,s.floor_id,p.x,p.y]);
            const nodeId=near[0]?.id??randomUUID();
            if(!near.length){await connection.execute("INSERT INTO basira_map_nodes (id,building_id,floor_id,x,y,node_type,accessibility_level) VALUES (?,?,?,?,?,'CORRIDOR','UNKNOWN')",[nodeId,s.building_id,s.floor_id,p.x,p.y]);changes.push({action:'CREATE',entityType:'MAP_NODE',entityId:nodeId,before:null,after:await snapshot('MAP_NODE',nodeId)});}
            ends.push(nodeId);
          }
          if(ends[0]===ends[1]){await connection.rollback();return res.status(400).json({error:'edge_collapsed'});}
          const [edge]=await connection.query<any[]>('SELECT id FROM basira_map_edges WHERE building_id=? AND ((from_node_id=? AND to_node_id=?) OR (from_node_id=? AND to_node_id=?)) LIMIT 1',[s.building_id,ends[0],ends[1],ends[1],ends[0]]);
          if(!edge.length){const newEdgeId=randomUUID();await connection.execute("INSERT INTO basira_map_edges (id,building_id,from_node_id,to_node_id,distance_meters,path_type,accessibility_level) VALUES (?,?,?,?,?,'CORRIDOR','UNKNOWN')",[newEdgeId,s.building_id,ends[0],ends[1],length]);changes.push({action:'CREATE',entityType:'MAP_EDGE',entityId:newEdgeId,before:null,after:await snapshot('MAP_EDGE',newEdgeId)});}
        }
        await connection.execute("UPDATE basira_buildings SET map_status='IN_PROGRESS' WHERE id=? AND map_status='UNMAPPED'",[s.building_id]);
        if(changes.length)version=await advanceMapVersion(connection,s.building_id,changes,'AUTO_MAPPING',viewer.userId);
      }
      await connection.execute('UPDATE basira_map_suggestions SET status=?,reviewed_at=CURRENT_TIMESTAMP(3),reviewed_by=? WHERE id=?',[body.data.decision,viewer.userId,s.id]);
      await connection.commit();
      res.json({status:body.data.decision,version});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }));
}
