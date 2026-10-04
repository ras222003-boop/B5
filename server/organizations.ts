import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import { auth, pool } from './auth';
import { MapImportValidator, type BasiraImport } from './mapImportValidator';
import { canGrantOrganizationRole, canOrganization, type OrganizationAction, type OrganizationRole } from './organizationPolicy';
import { advanceMapVersion, type Change } from './sharedMapPromotion';
import { buildingTypes } from '../shared/navigation';

const uid = z.string().uuid();
const organizationInput = z.object({ name: z.string().trim().min(1).max(255), type: z.enum(['UNIVERSITY','SCHOOL','HOSPITAL','AIRPORT','MALL','GOVERNMENT','COMPANY','DISABILITY_CENTER','OTHER']), description: z.string().trim().max(2000).nullable().optional(), country: z.string().trim().max(100).nullable().optional(), city: z.string().trim().max(100).nullable().optional(), website: z.url().max(500).nullable().optional() }).strict();
// Better Auth user IDs are opaque strings (32 characters by default), not UUIDs.
const membershipInput = z.object({ userId: z.string().min(1).max(36), role: z.enum(['organization_admin','mapper','reviewer','viewer']) }).strict();
const buildingInput = z.object({ name: z.string().trim().min(1).max(255), buildingType: z.enum(buildingTypes), address: z.string().trim().max(500).nullable().optional() }).strict();
const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { Promise.resolve(handler(req,res)).catch(error => { console.error('Organization API error', error); if (!res.headersSent) res.status(500).json({error:'server_error'}); }); };
async function rows(sql: string, args: unknown[] = [], connection: PoolConnection | typeof pool = pool): Promise<any[]> { const [result] = await connection.query(sql,args); return result as any[]; }
async function one(sql: string, args: unknown[] = [], connection: PoolConnection | typeof pool = pool): Promise<any | null> { return (await rows(sql,args,connection))[0] ?? null; }
async function audit(connection: PoolConnection | typeof pool, organizationId: string, buildingId: string | null, actorId: string, action: string, entityType: string, entityId: string, metadata: Record<string,unknown> = {}) {
  await connection.execute('INSERT INTO basira_organization_map_audit_log (id,organization_id,building_id,actor_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?,?,?,?)',[randomUUID(),organizationId,buildingId,actorId,action,entityType,entityId,JSON.stringify(metadata)]);
}
async function actor(req: Request, res: Response) {
  const session = await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
  if (!session) { res.status(401).json({error:'sign_in_required'}); return null; }
  const global = await one('SELECT role FROM basira_navigation_roles WHERE user_id=?',[session.user.id]);
  return {userId:session.user.id,globalAdmin:global?.role==='admin'};
}
async function permitted(req: Request, res: Response, action: OrganizationAction) {
  if (!uid.safeParse(req.params.orgId).success) { res.status(400).json({error:'invalid_organization_id'}); return null; }
  const identity = await actor(req,res); if (!identity) return null;
  const organization = await one('SELECT id FROM basira_organizations WHERE id=?',[req.params.orgId]);
  if (!organization) { res.status(404).json({error:'organization_not_found'}); return null; }
  const membership = await one('SELECT role FROM basira_organization_memberships WHERE organization_id=? AND user_id=?',[req.params.orgId,identity.userId]);
  const role = (membership?.role ?? null) as OrganizationRole | null;
  if (!canOrganization(role,identity.globalAdmin,action)) { res.status(403).json({error:'organization_role_required'}); return null; }
  return {...identity,role};
}
async function assigned(orgId:string,buildingId:string,connection:PoolConnection|typeof pool=pool) {
  return one('SELECT id,verification_status FROM basira_buildings WHERE id=? AND organization_id=?',[buildingId,orgId],connection);
}
const validator = new MapImportValidator();
const parsedJson = (value:unknown) => typeof value==='string' ? JSON.parse(value) as unknown : value;

/** Official import is previewed, then approved in a separate authenticated transaction. */
export function registerOrganizationRoutes(api: Router) {
  api.get('/organizations',route(async(req,res)=>{
    const identity=await actor(req,res);if(!identity)return;
    const organizations=identity.globalAdmin?await rows('SELECT * FROM basira_organizations ORDER BY name LIMIT 200'):await rows('SELECT o.*,m.role AS member_role FROM basira_organizations o JOIN basira_organization_memberships m ON m.organization_id=o.id WHERE m.user_id=? ORDER BY o.name LIMIT 200',[identity.userId]);
    res.set('Cache-Control','private, no-store').json({organizations,globalAdmin:identity.globalAdmin});
  }));
  api.post('/organizations',route(async(req,res)=>{
    const identity=await actor(req,res);if(!identity)return;if(!identity.globalAdmin)return res.status(403).json({error:'global_admin_required'});
    const parsed=organizationInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const item=parsed.data,newId=randomUUID();
    await pool.execute('INSERT INTO basira_organizations (id,name,type,description,country,city,website,created_by) VALUES (?,?,?,?,?,?,?,?)',[newId,item.name,item.type,item.description??null,item.country??null,item.city??null,item.website??null,identity.userId]);
    await audit(pool,newId,null,identity.userId,'ORGANIZATION_CREATE','ORGANIZATION',newId);
    res.status(201).json({organization:await one('SELECT * FROM basira_organizations WHERE id=?',[newId])});
  }));
  api.patch('/organizations/:orgId',route(async(req,res)=>{
    const identity=await permitted(req,res,'manage');if(!identity)return;
    const parsed=organizationInput.partial().extend({verificationStatus:z.enum(['UNVERIFIED','VERIFIED']).optional()}).safeParse(req.body);
    if(!parsed.success||!Object.keys(parsed.data).length)return res.status(400).json({error:'invalid_input'});
    if(parsed.data.verificationStatus&&!identity.globalAdmin)return res.status(403).json({error:'global_admin_required'});
    const columns:Record<string,string>={name:'name',type:'type',description:'description',country:'country',city:'city',website:'website',verificationStatus:'verification_status'};
    const entries=Object.entries(parsed.data);
    await pool.execute(`UPDATE basira_organizations SET ${entries.map(([key])=>`${columns[key]}=?`).join(',')} WHERE id=?`,[...entries.map(([,value])=>value??null),req.params.orgId]);
    await audit(pool,req.params.orgId,null,identity.userId,parsed.data.verificationStatus?'VERIFICATION_CHANGE':'ORGANIZATION_UPDATE','ORGANIZATION',req.params.orgId);
    res.json({organization:await one('SELECT * FROM basira_organizations WHERE id=?',[req.params.orgId])});
  }));
  api.get('/organizations/:orgId/members',route(async(req,res)=>{
    const identity=await permitted(req,res,'manage');if(!identity)return;
    res.set('Cache-Control','private, no-store').json({members:await rows('SELECT user_id,role,created_at FROM basira_organization_memberships WHERE organization_id=? ORDER BY created_at',[req.params.orgId])});
  }));
  api.post('/organizations/:orgId/members',route(async(req,res)=>{
    const identity=await permitted(req,res,'manage');if(!identity)return;
    const parsed=membershipInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    if(!canGrantOrganizationRole(identity.globalAdmin,parsed.data.role))return res.status(403).json({error:'global_admin_required'});
    if(!await one('SELECT id FROM `user` WHERE id=?',[parsed.data.userId]))return res.status(404).json({error:'user_not_found'});
    await pool.execute('INSERT INTO basira_organization_memberships (organization_id,user_id,role) VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role)',[req.params.orgId,parsed.data.userId,parsed.data.role]);
    await audit(pool,req.params.orgId,null,identity.userId,'ROLE_CHANGE','MEMBERSHIP',parsed.data.userId,{role:parsed.data.role});res.json({ok:true});
  }));
  api.get('/organizations/:orgId/buildings',route(async(req,res)=>{
    const identity=await permitted(req,res,'view');if(!identity)return;
    res.set('Cache-Control','private, no-store').json({buildings:await rows('SELECT * FROM basira_buildings WHERE organization_id=? ORDER BY name LIMIT 200',[req.params.orgId])});
  }));
  api.post('/organizations/:orgId/buildings',route(async(req,res)=>{
    const identity=await permitted(req,res,'manage');if(!identity)return;
    const parsed=buildingInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const organization=await one('SELECT name FROM basira_organizations WHERE id=?',[req.params.orgId]);
    const id=randomUUID();await pool.execute("INSERT INTO basira_buildings (id,name,building_type,address,organization_id,organization_name,verification_status,created_by) VALUES (?,?,?,?,?,?,'DISCOVERED',?)",[id,parsed.data.name,parsed.data.buildingType,parsed.data.address??null,req.params.orgId,organization.name,identity.userId]);
    await audit(pool,req.params.orgId,id,identity.userId,'BUILDING_CREATE','BUILDING',id);res.status(201).json({building:await one('SELECT * FROM basira_buildings WHERE id=?',[id])});
  }));
  api.post('/organizations/:orgId/buildings/:buildingId/assign',route(async(req,res)=>{
    const identity=await permitted(req,res,'manage');if(!identity)return;if(!identity.globalAdmin)return res.status(403).json({error:'global_admin_required'});
    if(!uid.safeParse(req.params.buildingId).success)return res.status(400).json({error:'invalid_building_id'});
    const [result]=await pool.execute('UPDATE basira_buildings SET organization_id=?,organization_name=(SELECT name FROM basira_organizations WHERE id=?) WHERE id=? AND organization_id IS NULL',[req.params.orgId,req.params.orgId,req.params.buildingId]);
    if(!(result as {affectedRows:number}).affectedRows)return res.status(409).json({error:'building_not_unassigned'});
    await audit(pool,req.params.orgId,req.params.buildingId,identity.userId,'BUILDING_ASSIGN','BUILDING',req.params.buildingId);res.json({ok:true});
  }));
  api.get('/organizations/:orgId/buildings/:buildingId/versions',route(async(req,res)=>{
    const identity=await permitted(req,res,'view');if(!identity)return;
    if(!await assigned(req.params.orgId,req.params.buildingId))return res.status(404).json({error:'building_not_found'});
    res.json({versions:await rows('SELECT version,MIN(created_at) AS created_at,MIN(source_type) AS source_type,MIN(reviewed_by) AS reviewed_by,COUNT(*) AS changes FROM basira_map_change_log WHERE building_id=? GROUP BY version ORDER BY version DESC LIMIT 100',[req.params.buildingId])});
  }));
  api.get('/organizations/:orgId/audit',route(async(req,res)=>{
    const identity=await permitted(req,res,'view');if(!identity)return;
    res.set('Cache-Control','private, no-store').json({events:await rows('SELECT id,building_id,actor_id,action,entity_type,entity_id,metadata,created_at FROM basira_organization_map_audit_log WHERE organization_id=? ORDER BY created_at DESC LIMIT 200',[req.params.orgId])});
  }));
  api.post('/organizations/:orgId/buildings/:buildingId/imports',route(async(req,res)=>{
    const identity=await permitted(req,res,'map');if(!identity)return;
    if(!uid.safeParse(req.params.buildingId).success||!await assigned(req.params.orgId,req.params.buildingId))return res.status(404).json({error:'building_not_found'});
    const raw=JSON.stringify(req.body);
    if(!raw||Buffer.byteLength(raw,'utf8')>1_000_000)return res.status(413).json({error:'import_too_large'});
    const {document,report}=validator.validate(req.body);
    if(!document)return res.status(422).json({report});
    if(!report.valid)return res.status(422).json({report});
    const recent=await one('SELECT COUNT(*) AS count FROM basira_official_map_imports WHERE created_by=? AND created_at>DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 1 HOUR)',[identity.userId]);
    if(Number(recent?.count??0)>=10)return res.status(429).json({error:'import_rate_limit'});
    const id=randomUUID(),hash=createHash('sha256').update(JSON.stringify(document)).digest('hex');
    await pool.execute('INSERT INTO basira_official_map_imports (id,organization_id,building_id,format,payload,payload_sha256,preview,created_by) VALUES (?,?,?,?,?,?,?,?)',[id,req.params.orgId,req.params.buildingId,document.format,JSON.stringify(document),hash,JSON.stringify(report),identity.userId]);
    await audit(pool,req.params.orgId,req.params.buildingId,identity.userId,'IMPORT_PREVIEW','IMPORT',id,{summary:report.summary});
    res.status(201).json({importId:id,report,status:'PENDING'});
  }));
  api.get('/organizations/:orgId/buildings/:buildingId/imports',route(async(req,res)=>{
    const identity=await permitted(req,res,'view');if(!identity)return;
    if(!uid.safeParse(req.params.buildingId).success||!await assigned(req.params.orgId,req.params.buildingId))return res.status(404).json({error:'building_not_found'});
    res.set('Cache-Control','private, no-store').json({imports:await rows('SELECT id,format,payload_sha256,preview,status,created_by,reviewed_by,created_at,reviewed_at FROM basira_official_map_imports WHERE organization_id=? AND building_id=? ORDER BY created_at DESC LIMIT 100',[req.params.orgId,req.params.buildingId])});
  }));
  api.post('/organizations/:orgId/buildings/:buildingId/imports/:importId/reject',route(async(req,res)=>{
    const identity=await permitted(req,res,'review');if(!identity)return;
    if(!uid.safeParse(req.params.buildingId).success||!uid.safeParse(req.params.importId).success||!await assigned(req.params.orgId,req.params.buildingId))return res.status(404).json({error:'import_not_found'});
    const [result]=await pool.execute("UPDATE basira_official_map_imports SET status='REJECTED',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND organization_id=? AND building_id=? AND status='PENDING'",[identity.userId,req.params.importId,req.params.orgId,req.params.buildingId]);
    if(!(result as {affectedRows:number}).affectedRows)return res.status(409).json({error:'pending_import_not_found'});
    await audit(pool,req.params.orgId,req.params.buildingId,identity.userId,'IMPORT_REJECT','IMPORT',req.params.importId);res.json({status:'REJECTED'});
  }));
  api.post('/organizations/:orgId/buildings/:buildingId/imports/:importId/approve',route(async(req,res)=>{
    const identity=await permitted(req,res,'review');if(!identity)return;
    if(!uid.safeParse(req.params.buildingId).success||!uid.safeParse(req.params.importId).success)return res.status(400).json({error:'invalid_id'});
    const connection=await pool.getConnection();
    try {
      await connection.beginTransaction();
      const importRow=await one("SELECT * FROM basira_official_map_imports WHERE id=? AND organization_id=? AND building_id=? AND status='PENDING' FOR UPDATE",[req.params.importId,req.params.orgId,req.params.buildingId],connection);
      if(!importRow){await connection.rollback();return res.status(404).json({error:'pending_import_not_found'});}
      const building=await one('SELECT * FROM basira_buildings WHERE id=? AND organization_id=? FOR UPDATE',[req.params.buildingId,req.params.orgId],connection);
      if(!building){await connection.rollback();return res.status(404).json({error:'building_not_found'});}
      const payload=parsedJson(importRow.payload),checked=validator.validate(payload);
      if(!checked.document||!checked.report.valid||createHash('sha256').update(JSON.stringify(checked.document)).digest('hex')!==importRow.payload_sha256){await connection.rollback();return res.status(409).json({error:'import_changed_or_invalid'});}
      const doc:BasiraImport=checked.document,changes:Change[]=[];
      const existingFloors=await rows('SELECT id,floor_number,name FROM basira_floors WHERE building_id=? FOR UPDATE',[req.params.buildingId],connection);
      const graphRows=await one('SELECT (SELECT COUNT(*) FROM basira_places WHERE building_id=?) AS places, (SELECT COUNT(*) FROM basira_map_nodes WHERE building_id=?) AS nodes, (SELECT COUNT(*) FROM basira_map_edges WHERE building_id=?) AS edges',[req.params.buildingId,req.params.buildingId,req.params.buildingId],connection);
      const matchingFloors=existingFloors.every(floor=>doc.floors.some(item=>item.id===floor.id&&item.floorNumber===floor.floor_number&&item.name===floor.name));
      if(!matchingFloors||Number(graphRows?.places??0)||Number(graphRows?.nodes??0)||Number(graphRows?.edges??0)){
        await connection.rollback();return res.status(409).json({error:'existing_map_requires_manual_review'});
      }
      await connection.execute("UPDATE basira_buildings SET map_status='MAPPED',verification_status='OFFICIAL',official_map_source='OFFICIAL_IMPORT',official_approved_by=?,official_reviewed_at=CURRENT_TIMESTAMP(3),number_of_floors=? WHERE id=?",[identity.userId,doc.floors.length,req.params.buildingId]);
      changes.push({action:'UPDATE',entityType:'BUILDING',entityId:req.params.buildingId,before:building,after:await one('SELECT * FROM basira_buildings WHERE id=?',[req.params.buildingId],connection)});
      const existingFloorIds=new Set(existingFloors.map(item=>item.id));
      for(const item of doc.floors){if(existingFloorIds.has(item.id))continue;await connection.execute('INSERT INTO basira_floors (id,building_id,floor_number,name) VALUES (?,?,?,?)',[item.id,req.params.buildingId,item.floorNumber,item.name]);changes.push({action:'CREATE',entityType:'FLOOR',entityId:item.id,before:null,after:await one('SELECT * FROM basira_floors WHERE id=?',[item.id],connection)});}
      for(const item of doc.places){await connection.execute("INSERT INTO basira_places (id,building_id,floor_id,name,room_number,aliases,place_type,local_x,local_y,accessibility_information,verification_status,is_public) VALUES (?,?,?,?,?,'[]',?,?,?,?,'OFFICIAL',1)",[item.id,req.params.buildingId,item.floorId,item.name,item.roomNumber??null,item.placeType,item.x,item.y,item.accessibilityInformation??null]);changes.push({action:'CREATE',entityType:'PLACE',entityId:item.id,before:null,after:await one('SELECT * FROM basira_places WHERE id=?',[item.id],connection)});}
      for(const item of doc.nodes){await connection.execute('INSERT INTO basira_map_nodes (id,building_id,floor_id,place_id,x,y,node_type,accessibility_level) VALUES (?,?,?,?,?,?,?,?)',[item.id,req.params.buildingId,item.floorId,item.placeId??null,item.x,item.y,item.nodeType,item.accessibilityLevel]);changes.push({action:'CREATE',entityType:'MAP_NODE',entityId:item.id,before:null,after:await one('SELECT * FROM basira_map_nodes WHERE id=?',[item.id],connection)});}
      for(const item of doc.edges){await connection.execute('INSERT INTO basira_map_edges (id,building_id,from_node_id,to_node_id,distance_meters,path_type,accessibility_level,has_stairs,has_ramp,wheelchair_accessible,visually_impaired_friendly) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[item.id,req.params.buildingId,item.fromNodeId,item.toNodeId,item.distanceMeters,item.pathType,item.accessibilityLevel,item.pathType==='STAIRS'?1:0,item.pathType==='RAMP'?1:0,item.wheelchairAccessible?1:0,item.visuallyImpairedFriendly?1:0]);changes.push({action:'CREATE',entityType:'MAP_EDGE',entityId:item.id,before:null,after:await one('SELECT * FROM basira_map_edges WHERE id=?',[item.id],connection)});}
      const version=await advanceMapVersion(connection,req.params.buildingId,changes,'OFFICIAL_IMPORT',identity.userId);
      await connection.execute("UPDATE basira_official_map_imports SET status='APPROVED',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP(3) WHERE id=?",[identity.userId,req.params.importId]);
      await audit(connection,req.params.orgId,req.params.buildingId,identity.userId,'IMPORT_APPROVE','IMPORT',req.params.importId,{version,summary:checked.report.summary});
      await connection.commit();res.json({status:'APPROVED',version,summary:checked.report.summary});
    } catch(error){await connection.rollback();throw error;} finally{connection.release();}
  }));
}
