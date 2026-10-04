import { createHmac, randomUUID } from 'node:crypto';
import type { Router, Request, Response } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { auth, pool } from './auth';
import { contributionSources, contributionTypes, DEFAULT_SHARED_MAP_POLICY, type ContributionEvidence, type ContributionProposal, type ContributionSource, type MapDecision } from '../shared/sharedMap';
import { placeTypes } from '../shared/navigation';
import { ContributionCorroborationService, ContributorTrustModel, contributionFingerprint, MapConflictDetector, MapPromotionService, SharedMapConfidenceEngine } from './sharedMapDomain';
import { advanceMapVersion, applyApprovedContribution, rollbackMapVersion } from './sharedMapPromotion';

const id=z.string().uuid(),position=z.number().finite().min(-100000).max(100000),confidence=z.number().min(0).max(1);
const proposalSchema=z.object({name:z.string().trim().min(1).max(255).nullable(),roomNumber:z.string().trim().max(80).nullable(),aliases:z.array(z.string().trim().min(1).max(255)).max(20),placeType:z.enum(placeTypes).nullable(),floorId:id,x:position.nullable(),y:position.nullable(),targetPlaceId:id.nullable(),targetNodeId:id.nullable(),targetEdgeId:id.nullable(),geometry:z.object({from:z.object({x:position,y:position}),to:z.object({x:position,y:position})}).nullable(),fromNodeId:id.nullable(),toNodeId:id.nullable(),transitionToFloorId:id.nullable(),pathType:z.enum(['CORRIDOR','DOOR','STAIRS','RAMP','ELEVATOR','OTHER']).nullable(),distanceMeters:z.number().positive().max(100000).nullable(),accessibilityInformation:z.string().trim().max(1000).nullable(),visuallyImpairedFriendly:z.boolean().nullable(),temporarilyClosed:z.boolean().nullable()}).strict();
const evidenceSchema=z.object({observedAt:z.number().int().positive(),localizationConfidence:confidence.nullable(),ocrConfidence:confidence.nullable(),visualAnchorConfidence:confidence.nullable(),sourceSessionKey:z.string().min(8).max(80).nullable(),sourceDeviceKey:z.string().min(8).max(80).nullable(),observedFloorId:id.nullable(),observedX:position.nullable(),observedY:position.nullable(),floorConsistent:z.boolean(),placeConsistent:z.boolean()}).strict();
const contributionSchema=z.object({buildingId:id,type:z.enum(contributionTypes),source:z.enum(contributionSources),proposal:proposalSchema,evidence:evidenceSchema,idempotencyKey:id,consent:z.literal(true)}).strict();
const confirmationSchema=z.object({evidence:evidenceSchema,idempotencyKey:id}).strict();
const issueSchema=z.object({buildingId:id,floorId:id.nullable(),type:z.enum(['PLACE_MISSING','WRONG_NAME','PLACE_MOVED','ROAD_CLOSED','ELEVATOR_MISSING','WRONG_FLOOR','WRONG_ACCESSIBILITY','UNMARKED_STAIRS','BLIND_UNFRIENDLY','OTHER']),duration:z.enum(['TEMPORARY','PERSISTENT','UNKNOWN']),description:z.string().trim().min(8).max(500),targetPlaceId:id.nullable(),targetEdgeId:id.nullable(),idempotencyKey:id,consent:z.literal(true)}).strict();
const reviewSchema=z.object({decision:z.enum(['APPROVE','REJECT','MORE_EVIDENCE']),action:z.enum(['CREATE','UPDATE','MERGE','ALIAS','CLOSE_EDGE','REOPEN_EDGE']).nullable(),resolveConflicts:z.boolean().default(false)}).strict();
const durationMs=86_400_000;
type Actor={userId:string;role:'mapper'|'admin'|null};
type Raw=Record<string,any>;
const policy=DEFAULT_SHARED_MAP_POLICY,confidenceEngine=new SharedMapConfidenceEngine(policy),promotion=new MapPromotionService(policy),corroboration=new ContributionCorroborationService(),conflictDetector=new MapConflictDetector(),trustModel=new ContributorTrustModel();
const parseJson=<T>(value:unknown):T=>typeof value==='string'?JSON.parse(value) as T:value as T;
const nowMs=(value:unknown)=>value instanceof Date?value.getTime():new Date(String(value)).getTime();
function hash(buildingId:string,kind:'actor'|'session'|'device',value:string){return createHmac('sha256',process.env.MANUS_JWT_SECRET!).update(`basira-shared-map-v1:${buildingId}:${kind}:${value}`).digest('hex');}
function hiddenEvidence(value:ContributionEvidence){const {sourceSessionKey:_session,sourceDeviceKey:_device,...publicEvidence}=value;return publicEvidence;}
function presentContribution(row:Raw){return {id:row.id,rootId:row.root_id,buildingId:row.building_id,type:row.contribution_type,source:row.source,status:row.status,visibility:row.visibility,proposal:parseJson(row.proposal),evidence:parseJson(row.evidence),confidence:Number(row.confidence),independentConfirmations:Number(row.independent_confirmations),conflictCount:Number(row.conflict_count),fingerprint:row.fingerprint,createdAt:row.created_at,updatedAt:row.updated_at,reviewedAt:row.reviewed_at};}
const route=(handler:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response)=>{Promise.resolve(handler(req,res)).catch(error=>{console.error('Shared map API error',{name:error instanceof Error?error.name:'unknown'});if(!res.headersSent)res.status(500).json({error:'server_error'});});};
async function rows(sql:string,params:unknown[]=[],connection:PoolConnection|typeof pool=pool):Promise<Raw[]>{const [result]=await connection.query<any[]>(sql,params);return result;}
async function one(sql:string,params:unknown[]=[],connection:PoolConnection|typeof pool=pool):Promise<Raw|null>{return (await rows(sql,params,connection))[0]??null;}
async function identity(req:Request,res:Response):Promise<Actor|null>{const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});if(!session){res.status(401).json({error:'sign_in_required'});return null;}const grant=await one('SELECT role FROM basira_navigation_roles WHERE user_id=?',[session.user.id]);return {userId:session.user.id,role:grant?.role==='admin'?'admin':grant?.role==='mapper'?'mapper':null};}
async function reviewer(req:Request,res:Response,admin=false):Promise<Actor|null>{const actor=await identity(req,res);if(!actor)return null;if(!actor.role||(admin&&actor.role!=='admin')){res.status(403).json({error:admin?'admin_role_required':'mapper_role_required'});return null;}return actor;}
async function limit(userId:string,table:'basira_shared_map_contributions'|'basira_shared_map_confirmations'|'basira_map_issue_reports',column:string,limitCount:number,hours:number,connection:PoolConnection){const found=await one(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column}=? AND created_at>DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL ? HOUR)`,[userId,hours],connection);return Number(found?.count??0)<limitCount;}
async function validProposal(buildingId:string,proposal:ContributionProposal,connection:PoolConnection){
  const building=await one("SELECT id FROM basira_buildings WHERE id=? AND status='ACTIVE'",[buildingId],connection);
  const floor=await one('SELECT id FROM basira_floors WHERE id=? AND building_id=?',[proposal.floorId,buildingId],connection);
  if(!building||!floor)return false;
  if(proposal.targetPlaceId&&!await one('SELECT id FROM basira_places WHERE id=? AND building_id=? AND is_public=1',[proposal.targetPlaceId,buildingId],connection))return false;
  if(proposal.targetEdgeId&&!await one('SELECT id FROM basira_map_edges WHERE id=? AND building_id=?',[proposal.targetEdgeId,buildingId],connection))return false;
  for(const nodeId of [proposal.targetNodeId,proposal.fromNodeId,proposal.toNodeId])if(nodeId&&!await one('SELECT id FROM basira_map_nodes WHERE id=? AND building_id=?',[nodeId,buildingId],connection))return false;
  if(proposal.transitionToFloorId&&!await one('SELECT id FROM basira_floors WHERE id=? AND building_id=?',[proposal.transitionToFloorId,buildingId],connection))return false;
  return true;
}
function validEvidence(evidence:ContributionEvidence,proposal:ContributionProposal){
  if(evidence.observedAt>Date.now()+300_000||evidence.observedAt<Date.now()-policy.maximumAgeDays*durationMs)return false;
  if(evidence.observedFloorId!==proposal.floorId)return false;
  if(proposal.x!==null&&proposal.y!==null){if(evidence.observedX===null||evidence.observedY===null||Math.hypot(evidence.observedX-proposal.x,evidence.observedY-proposal.y)>policy.maximumProximityMeters)return false;}
  return true;
}
async function trust(actor:Actor,connection:PoolConnection){const history=await rows("SELECT status,COUNT(*) AS count FROM basira_shared_map_contributions WHERE contributed_by=? AND status IN ('OFFICIAL','REJECTED') GROUP BY status",[actor.userId],connection);return trustModel.weight(actor.role??'user',Number(history.find(r=>r.status==='OFFICIAL')?.count??0),Number(history.find(r=>r.status==='REJECTED')?.count??0));}
async function updateGroup(rootId:string,connection:PoolConnection){
  const contributions=await rows('SELECT * FROM basira_shared_map_contributions WHERE root_id=?',[rootId],connection);
  if(!contributions.length)throw new Error('missing_root');
  const confirmations=await rows('SELECT * FROM basira_shared_map_confirmations WHERE root_id=?',[rootId],connection);
  const conflicts=await one("SELECT COUNT(*) AS count FROM basira_shared_map_conflicts WHERE root_id=? AND status='OPEN'",[rootId],connection);const conflictCount=Number(conflicts?.count??0);
  const records=[...contributions,...confirmations].map(row=>({actorKey:row.actor_key,sessionKey:row.session_key_hash,deviceKey:row.device_key_hash,source:row.source as ContributionSource,quality:parseJson<ContributionEvidence>(row.evidence),trust:Number(row.trust_weight)}));
  const result=confidenceEngine.evaluate(records,conflictCount);
  let status=promotion.communityStatus(result,conflictCount,contributions[0].contribution_type);
  if(conflictCount)status='CONFLICTED';
  if(promotion.stale(nowMs(contributions[0].created_at),Math.max(...[...contributions,...confirmations].map(row=>nowMs(row.created_at)))))status='STALE';
  await connection.execute("UPDATE basira_shared_map_contributions SET status=?,visibility=?,confidence=?,independent_confirmations=?,conflict_count=? WHERE root_id=? AND status NOT IN ('OFFICIAL','REJECTED')",[status,status==='COMMUNITY_VERIFIED'?'PUBLIC_VERIFIED':'PUBLIC_CANDIDATE',result.confidence,result.independentActors,conflictCount,rootId]);
  await connection.execute('UPDATE basira_place_change_candidates SET confidence=?,independent_confirmations=?,evidence=? WHERE contribution_id IN (SELECT id FROM basira_shared_map_contributions WHERE root_id=?) AND status=\'PENDING\'',[result.confidence,result.independentActors,JSON.stringify([...contributions,...confirmations].map(row=>parseJson<ContributionEvidence>(row.evidence))),rootId]);
  return {status,...result,conflictCount};
}
async function currentPublicEntity(proposal:ContributionProposal,connection:PoolConnection|typeof pool){
  if(proposal.targetPlaceId){const place=await one('SELECT id,name,room_number,place_type,floor_id,local_x,local_y,accessibility_information,verification_status FROM basira_places WHERE id=? AND is_public=1',[proposal.targetPlaceId],connection);return place??null;}
  if(proposal.targetEdgeId){const edge=await one('SELECT id,from_node_id,to_node_id,path_type,temporarily_closed,visually_impaired_friendly FROM basira_map_edges WHERE id=?',[proposal.targetEdgeId],connection);return edge??null;}
  return null;
}
async function refreshStale(buildingId:string){await pool.execute("UPDATE basira_shared_map_contributions SET status='STALE',visibility='PUBLIC_CANDIDATE' WHERE building_id=? AND status IN ('PENDING','CORROBORATING','COMMUNITY_VERIFIED','CONFLICTED') AND updated_at<DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL ? DAY)",[buildingId,policy.maximumAgeDays]);}

export function registerSharedMapRoutes(api:Router){
  api.post('/shared-map/contributions',route(async(req,res)=>{
    const actor=await identity(req,res);if(!actor)return;
    const parsed=contributionSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const {buildingId,type,source,proposal,evidence,idempotencyKey}=parsed.data;
    if(source==='ORGANIZATION'||(['AUTO_MAPPING','MAPPER','ADMIN'].includes(source)&&!actor.role)||(source==='ADMIN'&&actor.role!=='admin'))return res.status(403).json({error:'source_role_required'});
    if(/(?:منزلي|بيتي|سيارتي|مكتبي الشخصي|my home|my car|friend.?s home)/i.test(proposal.name??''))return res.status(400).json({error:'private_place_not_shareable'});
    if(!validEvidence(evidence,proposal)||!evidence.floorConsistent||evidence.localizationConfidence===null||evidence.localizationConfidence<policy.minimumLocalizationConfidence)return res.status(400).json({error:'insufficient_location_evidence'});
    if(type==='PLACE'&&(!proposal.name||!proposal.placeType||proposal.x===null||proposal.y===null))return res.status(400).json({error:'incomplete_place'});
    const connection=await pool.getConnection();try{
      await connection.beginTransaction();
      const prior=await one('SELECT * FROM basira_shared_map_contributions WHERE contributed_by=? AND idempotency_key=? FOR UPDATE',[actor.userId,idempotencyKey],connection);
      if(prior){await connection.commit();return res.set('Cache-Control','private, no-store').json({contribution:presentContribution(prior),duplicate:true});}
      if(!await limit(actor.userId,'basira_shared_map_contributions','contributed_by',policy.contributionLimitPerHour,1,connection)){await connection.rollback();return res.status(429).json({error:'contribution_rate_limit'});}
      if(!await validProposal(buildingId,proposal,connection)){await connection.rollback();return res.status(400).json({error:'invalid_public_location'});}
      const actorKey=hash(buildingId,'actor',actor.userId),fingerprint=contributionFingerprint(buildingId,type,proposal);
      const candidates=await rows("SELECT id,root_id,contribution_type,proposal,actor_key,status FROM basira_shared_map_contributions WHERE building_id=? AND status NOT IN ('REJECTED','STALE') ORDER BY created_at DESC LIMIT 200",[buildingId],connection);
      const found=corroboration.rootFor(proposal,candidates.map(candidate=>({id:candidate.id,rootId:candidate.root_id,type:candidate.contribution_type,proposal:parseJson(candidate.proposal)})),type);
      if(found?.relationship==='SAME'&&candidates.some(candidate=>candidate.root_id===found.rootId&&candidate.status==='OFFICIAL')){
        const official=await one("SELECT * FROM basira_shared_map_contributions WHERE root_id=? AND status='OFFICIAL' LIMIT 1",[found.rootId],connection);
        await connection.commit();return res.json({contribution:presentContribution(official!),duplicate:true,alreadyOfficial:true});
      }
      if(found?.relationship==='SAME'){
        const sameActor=candidates.find(candidate=>candidate.root_id===found.rootId&&candidate.actor_key===actorKey);
        if(sameActor){const item=await one('SELECT * FROM basira_shared_map_contributions WHERE id=?',[sameActor.id],connection);await connection.commit();return res.set('Cache-Control','private, no-store').json({contribution:presentContribution(item!),duplicate:true});}
      }
      const newId=randomUUID(),rootId=found?.relationship==='SAME'?found.rootId:newId,weight=await trust(actor,connection);
      const keySession=evidence.sourceSessionKey?hash(buildingId,'session',evidence.sourceSessionKey):null,keyDevice=evidence.sourceDeviceKey?hash(buildingId,'device',evidence.sourceDeviceKey):null;
      await connection.execute('INSERT INTO basira_shared_map_contributions (id,root_id,building_id,floor_id,contribution_type,`source`,`status`,visibility,proposal,evidence,fingerprint,actor_key,session_key_hash,device_key_hash,contributed_by,idempotency_key,trust_weight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [newId,rootId,buildingId,proposal.floorId,type,source,'PENDING','PUBLIC_CANDIDATE',JSON.stringify(proposal),JSON.stringify(hiddenEvidence(evidence)),fingerprint,actorKey,keySession,keyDevice,actor.userId,idempotencyKey,weight]);
      if(found?.relationship==='POSSIBLE_CHANGE'){
        const kind=conflictDetector.detect(proposal,parseJson(candidates.find(candidate=>candidate.root_id===found.rootId)!.proposal))??'LOCATION_MISMATCH';
        await connection.execute("INSERT IGNORE INTO basira_shared_map_conflicts (id,building_id,root_id,opposing_contribution_id,kind) VALUES (?,?,?,?,?)",[randomUUID(),buildingId,found.rootId,newId,kind]);
        await connection.execute("INSERT IGNORE INTO basira_shared_map_conflicts (id,building_id,root_id,opposing_contribution_id,kind) VALUES (?,?,?,?,?)",[randomUUID(),buildingId,newId,newId,kind]);
        await updateGroup(found.rootId,connection);
      }
      if(proposal.targetPlaceId){
        const existing=await currentPublicEntity(proposal,connection);
        if(existing){const old={name:existing.name,roomNumber:existing.room_number,floorId:existing.floor_id,x:existing.local_x===null?null:Number(existing.local_x),y:existing.local_y===null?null:Number(existing.local_y),placeType:existing.place_type,aliases:[],targetPlaceId:proposal.targetPlaceId,targetNodeId:null,targetEdgeId:null,geometry:null,fromNodeId:null,toNodeId:null,transitionToFloorId:null,pathType:null,distanceMeters:null,accessibilityInformation:null,visuallyImpairedFriendly:null,temporarilyClosed:null} as ContributionProposal;
          const kind=conflictDetector.detect(proposal,old);
          if(kind){await connection.execute("INSERT IGNORE INTO basira_shared_map_conflicts (id,building_id,root_id,opposing_contribution_id,kind) VALUES (?,?,?,?,?)",[randomUUID(),buildingId,rootId,newId,existing.verification_status==='OFFICIAL'?'OFFICIAL_DISAGREEMENT':kind]);
            if(type==='PLACE_MOVED'||kind==='ROOM_MISMATCH'||kind==='LOCATION_MISMATCH')await connection.execute('INSERT INTO basira_place_change_candidates (id,building_id,target_place_id,contribution_id,previous_place,proposed_place,evidence,observed_at) VALUES (?,?,?,?,?,?,?,?)',[randomUUID(),buildingId,proposal.targetPlaceId,newId,JSON.stringify(existing),JSON.stringify(proposal),JSON.stringify([hiddenEvidence(evidence)]),new Date(evidence.observedAt)]);
          }
        }
      }
      await updateGroup(rootId,connection);
      const created=await one('SELECT * FROM basira_shared_map_contributions WHERE id=?',[newId],connection);
      await connection.commit();res.set('Cache-Control','private, no-store').status(201).json({contribution:presentContribution(created!)});
    }catch(error){await connection.rollback();if((error as {code?:string}).code==='ER_DUP_ENTRY'){const duplicate=await one('SELECT * FROM basira_shared_map_contributions WHERE contributed_by=? AND idempotency_key=?',[actor.userId,idempotencyKey])??await one('SELECT * FROM basira_shared_map_contributions WHERE building_id=? AND actor_key=? AND fingerprint=? ORDER BY created_at DESC LIMIT 1',[buildingId,hash(buildingId,'actor',actor.userId),contributionFingerprint(buildingId,type,proposal)]);if(duplicate)return res.json({contribution:presentContribution(duplicate),duplicate:true});}throw error;}finally{connection.release();}
  }));
  api.post('/shared-map/contributions/:id/confirm',route(async(req,res)=>{
    const actor=await identity(req,res);if(!actor)return;if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    const parsed=confirmationSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const connection=await pool.getConnection();try{await connection.beginTransaction();
      const target=await one('SELECT * FROM basira_shared_map_contributions WHERE id=? FOR UPDATE',[req.params.id],connection);
      if(!target||['REJECTED','OFFICIAL'].includes(target.status)){await connection.rollback();return res.status(404).json({error:'not_confirmable'});}
      const proposal=parseJson<ContributionProposal>(target.proposal),evidence=parsed.data.evidence;
      if(!validEvidence(evidence,proposal)||evidence.observedFloorId!==proposal.floorId||evidence.localizationConfidence===null||evidence.localizationConfidence<policy.minimumLocalizationConfidence){await connection.rollback();return res.status(400).json({error:'insufficient_location_evidence'});}
      const actorKey=hash(target.building_id,'actor',actor.userId);
      const sameContribution=await one('SELECT id FROM basira_shared_map_contributions WHERE root_id=? AND actor_key=?',[target.root_id,actorKey],connection);
      const prior=await one('SELECT id FROM basira_shared_map_confirmations WHERE root_id=? AND actor_key=?',[target.root_id,actorKey],connection);
      if(sameContribution||prior){const stats=await updateGroup(target.root_id,connection);await connection.commit();return res.json({duplicate:true,status:stats.status,independentConfirmations:stats.independentActors});}
      if(!await limit(actor.userId,'basira_shared_map_confirmations','confirmed_by',policy.confirmationLimitPerDay,24,connection)){await connection.rollback();return res.status(429).json({error:'confirmation_rate_limit'});}
      const weight=await trust(actor,connection);
      await connection.execute('INSERT INTO basira_shared_map_confirmations (id,root_id,contribution_id,actor_key,session_key_hash,device_key_hash,confirmed_by,`source`,trust_weight,evidence) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [randomUUID(),target.root_id,target.id,actorKey,evidence.sourceSessionKey?hash(target.building_id,'session',evidence.sourceSessionKey):null,evidence.sourceDeviceKey?hash(target.building_id,'device',evidence.sourceDeviceKey):null,actor.userId,'USER_MANUAL',weight,JSON.stringify(hiddenEvidence(evidence))]);
      const stats=await updateGroup(target.root_id,connection);await connection.commit();res.json({status:stats.status,confidence:stats.confidence,independentConfirmations:stats.independentActors});
    }catch(error){await connection.rollback();if((error as {code?:string}).code==='ER_DUP_ENTRY')return res.json({duplicate:true});throw error;}finally{connection.release();}
  }));
  api.get('/shared-map/buildings/:id/contributions',route(async(req,res)=>{
    if(!await reviewer(req,res))return;if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    await refreshStale(req.params.id);
    const found=await rows('SELECT * FROM basira_shared_map_contributions WHERE building_id=? ORDER BY created_at DESC LIMIT 100',[req.params.id]);
    res.set('Cache-Control','private, no-store').json({contributions:found.map(presentContribution)});
  }));
  api.get('/shared-map/buildings/:id/candidates',route(async(req,res)=>{
    if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    await refreshStale(req.params.id);
    const found=await rows("SELECT * FROM basira_shared_map_contributions WHERE building_id=? AND id=root_id AND status IN ('PENDING','CORROBORATING','COMMUNITY_VERIFIED') AND contribution_type IN ('PLACE','PLACE_NAME_CHANGE','PLACE_MOVED','DOOR','ELEVATOR','STAIRS','ENTRANCE','EXIT') ORDER BY created_at DESC LIMIT 50",[req.params.id]);
    res.json({candidates:found.map(row=>({id:row.id,type:row.contribution_type,status:row.status,proposal:parseJson<ContributionProposal>(row.proposal),independentConfirmations:Number(row.independent_confirmations),confidence:Number(row.confidence)}))});
  }));
  api.get('/shared-map/contributions/:id',route(async(req,res)=>{
    const actor=await identity(req,res);if(!actor)return;
    const found=await one('SELECT * FROM basira_shared_map_contributions WHERE id=?',[req.params.id]);
    if(!found||!actor.role&&found.contributed_by!==actor.userId)return res.status(404).json({error:'not_found'});
    const conflicts=actor.role?await rows('SELECT id,kind,status,created_at FROM basira_shared_map_conflicts WHERE root_id=?',[found.root_id]):[];
    const current=actor.role?await currentPublicEntity(parseJson<ContributionProposal>(found.proposal),pool):null;
    res.set('Cache-Control','private, no-store').json({contribution:presentContribution(found),current,conflicts});
  }));
  api.post('/shared-map/contributions/:id/conflicts',route(async(req,res)=>{
    const actor=await identity(req,res);if(!actor)return;
    const parsed=z.object({kind:z.enum(['ROOM_MISMATCH','LOCATION_MISMATCH','FLOOR_MISMATCH','TYPE_MISMATCH']),description:z.string().trim().min(8).max(500)}).strict().safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const connection=await pool.getConnection();try{await connection.beginTransaction();
      const target=await one('SELECT * FROM basira_shared_map_contributions WHERE id=? FOR UPDATE',[req.params.id],connection);
      if(!target){await connection.rollback();return res.status(404).json({error:'not_found'});}
      if(!await limit(actor.userId,'basira_map_issue_reports','reporter_user_id',policy.issueLimitPerDay,24,connection)){await connection.rollback();return res.status(429).json({error:'issue_rate_limit'});}
      const issueId=randomUUID();await connection.execute('INSERT INTO basira_map_issue_reports (id,building_id,floor_id,issue_type,duration,description,reporter_user_id,idempotency_key) VALUES (?,?,?,?,?,?,?,?)',[issueId,target.building_id,target.floor_id,'OTHER','UNKNOWN',parsed.data.description,actor.userId,issueId]);
      await connection.execute('INSERT IGNORE INTO basira_shared_map_conflicts (id,building_id,root_id,opposing_contribution_id,kind) VALUES (?,?,?,?,?)',[randomUUID(),target.building_id,target.root_id,target.id,parsed.data.kind]);
      await updateGroup(target.root_id,connection);await connection.commit();res.status(201).json({issueId,status:'CONFLICTED'});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }));
  api.post('/shared-map/issues',route(async(req,res)=>{
    const actor=await identity(req,res);if(!actor)return;
    const parsed=issueSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const item=parsed.data,connection=await pool.getConnection();try{await connection.beginTransaction();
      const prior=await one('SELECT id,status FROM basira_map_issue_reports WHERE reporter_user_id=? AND idempotency_key=?',[actor.userId,item.idempotencyKey],connection);
      if(prior){await connection.commit();return res.json({issue:prior,duplicate:true});}
      if(!await limit(actor.userId,'basira_map_issue_reports','reporter_user_id',policy.issueLimitPerDay,24,connection)){await connection.rollback();return res.status(429).json({error:'issue_rate_limit'});}
      if(!await one('SELECT id FROM basira_buildings WHERE id=?',[item.buildingId],connection)||item.floorId&&!await one('SELECT id FROM basira_floors WHERE id=? AND building_id=?',[item.floorId,item.buildingId],connection)||item.targetPlaceId&&!await one('SELECT id FROM basira_places WHERE id=? AND building_id=? AND is_public=1',[item.targetPlaceId,item.buildingId],connection)||item.targetEdgeId&&!await one('SELECT id FROM basira_map_edges WHERE id=? AND building_id=?',[item.targetEdgeId,item.buildingId],connection)){await connection.rollback();return res.status(400).json({error:'invalid_public_location'});}
      const issueId=randomUUID();await connection.execute('INSERT INTO basira_map_issue_reports (id,building_id,floor_id,issue_type,duration,description,target_place_id,target_edge_id,reporter_user_id,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?)',[issueId,item.buildingId,item.floorId,item.type,item.duration,item.description,item.targetPlaceId,item.targetEdgeId,actor.userId,item.idempotencyKey]);
      await connection.commit();res.status(201).json({issue:{id:issueId,status:'PENDING',type:item.type,duration:item.duration}});
    }catch(error){await connection.rollback();if((error as {code?:string}).code==='ER_DUP_ENTRY'){const duplicate=await one('SELECT id,status FROM basira_map_issue_reports WHERE reporter_user_id=? AND idempotency_key=?',[actor.userId,item.idempotencyKey]);if(duplicate)return res.json({issue:duplicate,duplicate:true});}throw error;}finally{connection.release();}
  }));
  api.get('/shared-map/buildings/:id/issues',route(async(req,res)=>{
    if(!await reviewer(req,res))return;
    const issues=await rows("SELECT id,building_id,floor_id,issue_type AS type,duration,description,target_place_id,target_edge_id,status,created_at FROM basira_map_issue_reports WHERE building_id=? ORDER BY CASE WHEN issue_type IN ('UNMARKED_STAIRS','ROAD_CLOSED','WRONG_ACCESSIBILITY') THEN 0 ELSE 1 END,created_at DESC LIMIT 100",[req.params.id]);
    res.set('Cache-Control','private, no-store').json({issues});
  }));
  api.post('/shared-map/issues/:id/review',route(async(req,res)=>{
    if(!await reviewer(req,res))return;
    const parsed=z.object({status:z.enum(['REVIEWED','DISMISSED'])}).strict().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const [result]=await pool.execute<any>("UPDATE basira_map_issue_reports SET status=?,reviewed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND status='PENDING'",[parsed.data.status,req.params.id]);
    if(!result.affectedRows)return res.status(404).json({error:'not_found'});res.json({status:parsed.data.status});
  }));
  api.post('/shared-map/contributions/:id/review',route(async(req,res)=>{
    const actor=await reviewer(req,res);if(!actor)return;
    const parsed=reviewSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const connection=await pool.getConnection();try{await connection.beginTransaction();
      const item=await one('SELECT * FROM basira_shared_map_contributions WHERE id=? FOR UPDATE',[req.params.id],connection);
      if(!item){await connection.rollback();return res.status(404).json({error:'not_found'});}
      if(['OFFICIAL','REJECTED'].includes(item.status)){await connection.rollback();return res.status(409).json({error:'already_reviewed'});}
      const review=parsed.data,status=promotion.reviewStatus(actor.role,review.decision);
      if(review.decision==='APPROVE'){
        if(!review.action){await connection.rollback();return res.status(400).json({error:'action_required'});}
        if(item.conflict_count>0&&!review.resolveConflicts){await connection.rollback();return res.status(409).json({error:'open_conflict_review_required'});}
        const proposal=parseJson<ContributionProposal>(item.proposal);
        let changes;try{changes=await applyApprovedContribution(connection,item.building_id,item.contribution_type,proposal,review.action as MapDecision);}catch(error){await connection.rollback();return res.status(409).json({error:error instanceof Error?error.message:'invalid_map_change'});}
        const version=await advanceMapVersion(connection,item.building_id,changes,item.source,actor.userId);
        await connection.execute("UPDATE basira_shared_map_contributions SET status='OFFICIAL',visibility='OFFICIAL',reviewed_at=CURRENT_TIMESTAMP(3),reviewed_by=? WHERE root_id=? AND status NOT IN ('OFFICIAL','REJECTED')",[actor.userId,item.root_id]);
        if(review.resolveConflicts)await connection.execute("UPDATE basira_shared_map_conflicts SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP(3) WHERE root_id=? AND status='OPEN'",[item.root_id]);
        await connection.execute("UPDATE basira_place_change_candidates SET status='APPROVED',reviewed_at=CURRENT_TIMESTAMP(3) WHERE contribution_id=?",[item.id]);
        await connection.commit();return res.json({status:'OFFICIAL',version,changes:changes.length});
      }
      await connection.execute('UPDATE basira_shared_map_contributions SET status=?,reviewed_at=CURRENT_TIMESTAMP(3),reviewed_by=? WHERE root_id=? AND status NOT IN (\'OFFICIAL\',\'REJECTED\')',[status,actor.userId,item.root_id]);
      if(review.decision==='REJECT')await connection.execute("UPDATE basira_place_change_candidates SET status='REJECTED',reviewed_at=CURRENT_TIMESTAMP(3) WHERE contribution_id=?",[item.id]);
      await connection.commit();res.json({status});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }));
  api.get('/shared-map/buildings/:id/version',route(async(req,res)=>{
    if(!id.safeParse(req.params.id).success)return res.status(400).json({error:'invalid_id'});
    if(!await one("SELECT id FROM basira_buildings WHERE id=? AND status='ACTIVE'",[req.params.id]))return res.status(404).json({error:'not_found'});
    const version=await one('SELECT current_version,updated_at FROM basira_map_versions WHERE building_id=?',[req.params.id]);
    res.json({buildingId:req.params.id,version:Number(version?.current_version??1),updatedAt:version?.updated_at??null});
  }));
  api.get('/shared-map/buildings/:id/sync',route(async(req,res)=>{
    const since=Number(req.query.sinceVersion??0);if(!id.safeParse(req.params.id).success||!Number.isSafeInteger(since)||since<0)return res.status(400).json({error:'invalid_query'});
    const version=await one('SELECT current_version FROM basira_map_versions WHERE building_id=?',[req.params.id]);
    if(!version&&!await one("SELECT id FROM basira_buildings WHERE id=? AND status='ACTIVE'",[req.params.id]))return res.status(404).json({error:'not_found'});
    const current=Number(version?.current_version??1);const changes=since<current?await rows('SELECT version,change_index,action,entity_type,entity_id FROM basira_map_change_log WHERE building_id=? AND version>? ORDER BY version,change_index LIMIT 200',[req.params.id,since]):[];
    const [count]=await pool.query<any[]>("SELECT COUNT(*) AS pending FROM basira_shared_map_contributions WHERE building_id=? AND status NOT IN ('OFFICIAL','REJECTED','STALE')",[req.params.id]);
    res.json({buildingId:req.params.id,version:current,changed:current>since,changes,hasMore:changes.length===200,pendingCount:Number(count[0]?.pending??0)});
  }));
  api.get('/shared-map/buildings/:id/history',route(async(req,res)=>{
    if(!await reviewer(req,res,true))return;
    const history=await rows('SELECT version,change_index,action,entity_type,entity_id,source_type,created_at FROM basira_map_change_log WHERE building_id=? ORDER BY version DESC,change_index DESC LIMIT 200',[req.params.id]);
    res.set('Cache-Control','private, no-store').json({history});
  }));
  api.post('/shared-map/map-suggestions/:id/import',route(async(req,res)=>{
    const actor=await reviewer(req,res);if(!actor)return;
    const connection=await pool.getConnection();try{await connection.beginTransaction();
      const suggestion=await one("SELECT * FROM basira_map_suggestions WHERE id=? AND status='ACCEPTED' FOR UPDATE",[req.params.id],connection);
      if(!suggestion||!suggestion.floor_id){await connection.rollback();return res.status(404).json({error:'accepted_suggestion_required'});}
      const prior=await one('SELECT * FROM basira_shared_map_contributions WHERE external_suggestion_id=?',[suggestion.id],connection);
      if(prior){await connection.commit();return res.json({contribution:presentContribution(prior),duplicate:true});}
      const type=({NEW_NODE:'MAP_NODE',NEW_EDGE:'MAP_EDGE',PLACE_ANCHOR:'PLACE',CORRIDOR:'CORRIDOR'} as Record<string,string>)[suggestion.type]??suggestion.type;
      const proposal:ContributionProposal={name:suggestion.name??null,roomNumber:null,aliases:[],placeType:suggestion.suggested_place_type??null,floorId:suggestion.floor_id,x:suggestion.x===null?null:Number(suggestion.x),y:suggestion.y===null?null:Number(suggestion.y),targetPlaceId:suggestion.place_id??null,targetNodeId:null,targetEdgeId:null,geometry:parseJson(suggestion.geometry),fromNodeId:suggestion.from_node_id??null,toNodeId:suggestion.to_node_id??null,transitionToFloorId:null,pathType:null,distanceMeters:null,accessibilityInformation:null,visuallyImpairedFriendly:null,temporarilyClosed:null};
      const evidence:ContributionEvidence={observedAt:nowMs(suggestion.created_at),localizationConfidence:Number(suggestion.confidence),ocrConfidence:null,visualAnchorConfidence:null,sourceSessionKey:null,sourceDeviceKey:null,observedFloorId:suggestion.floor_id,observedX:proposal.x,observedY:proposal.y,floorConsistent:true,placeConsistent:true};
      const newId=randomUUID(),weight=await trust(actor,connection);
      await connection.execute('INSERT INTO basira_shared_map_contributions (id,root_id,building_id,floor_id,contribution_type,`source`,`status`,visibility,proposal,evidence,fingerprint,actor_key,contributed_by,external_suggestion_id,idempotency_key,trust_weight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[newId,newId,suggestion.building_id,suggestion.floor_id,type,'AUTO_MAPPING','PENDING','PUBLIC_CANDIDATE',JSON.stringify(proposal),JSON.stringify(hiddenEvidence(evidence)),contributionFingerprint(suggestion.building_id,type as typeof contributionTypes[number],proposal),hash(suggestion.building_id,'actor',actor.userId),actor.userId,suggestion.id,suggestion.id,weight]);
      await updateGroup(newId,connection);const created=await one('SELECT * FROM basira_shared_map_contributions WHERE id=?',[newId],connection);
      await connection.commit();res.status(201).json({contribution:presentContribution(created!),note:'B3 already applied accepted suggestion to B1; review B5 provenance without creating a duplicate entity.'});
    }catch(error){await connection.rollback();if((error as {code?:string}).code==='ER_DUP_ENTRY'){const duplicate=await one('SELECT * FROM basira_shared_map_contributions WHERE external_suggestion_id=?',[req.params.id]);if(duplicate)return res.json({contribution:presentContribution(duplicate),duplicate:true});}throw error;}finally{connection.release();}
  }));
  api.post('/shared-map/buildings/:id/rollback',route(async(req,res)=>{
    const actor=await reviewer(req,res,true);if(!actor)return;
    const parsed=z.object({version:z.number().int().min(2)}).strict().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_input'});
    const connection=await pool.getConnection();try{await connection.beginTransaction();
      let version;try{version=await rollbackMapVersion(connection,req.params.id,parsed.data.version,actor.userId);}catch(error){await connection.rollback();return res.status(409).json({error:error instanceof Error?error.message:'rollback_failed'});}
      await connection.commit();res.json({version,rolledBackVersion:parsed.data.version});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }));
}
