import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import type { ContributionProposal, ContributionSource, ContributionType, MapDecision } from '../shared/sharedMap';

type Entity='PLACE'|'MAP_NODE'|'MAP_EDGE';
export type Change={action:MapDecision|'ROLLBACK';entityType:Entity;entityId:string;before:Record<string,unknown>|null;after:Record<string,unknown>|null};
const tables:Record<Entity,string>={PLACE:'basira_places',MAP_NODE:'basira_map_nodes',MAP_EDGE:'basira_map_edges'};
const columns:Record<Entity,string[]>={
  PLACE:['id','building_id','floor_id','name','room_number','aliases','department_name','description','place_type','local_x','local_y','latitude','longitude','entrance_direction','accessibility_information','verification_status','confidence_score','is_public','created_by'],
  MAP_NODE:['id','building_id','floor_id','place_id','x','y','node_type','accessibility_level'],
  MAP_EDGE:['id','building_id','from_node_id','to_node_id','distance_meters','direction','path_type','accessibility_level','has_stairs','has_ramp','wheelchair_accessible','visually_impaired_friendly','temporarily_closed','risk_level'],
};
const data=(value:unknown)=>typeof value==='string'?JSON.parse(value):value;
async function row(connection:PoolConnection,entity:Entity,id:string):Promise<Record<string,unknown>|null>{const [rows]=await connection.query<any[]>(`SELECT * FROM ${tables[entity]} WHERE id=? FOR UPDATE`,[id]);return rows[0]??null;}
async function change(connection:PoolConnection,changes:Change[],entity:Entity,id:string,action:MapDecision,mutate:()=>Promise<void>){const before=await row(connection,entity,id);await mutate();const after=await row(connection,entity,id);changes.push({action,entityType:entity,entityId:id,before,after});}
async function nearNode(connection:PoolConnection,buildingId:string,floorId:string,x:number,y:number):Promise<string|null>{const [found]=await connection.query<any[]>('SELECT id FROM basira_map_nodes WHERE building_id=? AND floor_id=? AND SQRT(POW(x-?,2)+POW(y-?,2))<=1.5 ORDER BY SQRT(POW(x-?,2)+POW(y-?,2)) LIMIT 1',[buildingId,floorId,x,y,x,y]);return found[0]?.id??null;}
const nodeType:Record<string,string>={PLACE:'ROOM',MAP_NODE:'POINT',INTERSECTION:'INTERSECTION',DOOR:'DOOR',ELEVATOR:'ELEVATOR',STAIRS:'STAIRS',ENTRANCE:'ENTRANCE',EXIT:'EXIT',FLOOR_TRANSITION:'POINT'};

/** Must be called inside a transaction after review authorization and contribution row locking. */
export async function applyApprovedContribution(connection:PoolConnection,buildingId:string,type:ContributionType,proposal:ContributionProposal,decision:MapDecision):Promise<Change[]>{
  const changes:Change[]=[];
  if(decision==='CLOSE_EDGE'||decision==='REOPEN_EDGE'){
    if(!proposal.targetEdgeId)throw new Error('edge_required');
    const before=await row(connection,'MAP_EDGE',proposal.targetEdgeId);if(!before||before.building_id!==buildingId)throw new Error('invalid_edge');
    await change(connection,changes,'MAP_EDGE',proposal.targetEdgeId,decision,async()=>{await connection.execute('UPDATE basira_map_edges SET temporarily_closed=? WHERE id=? AND building_id=?',[decision==='CLOSE_EDGE'?1:0,proposal.targetEdgeId,buildingId]);});
    return changes;
  }
  if(decision==='ALIAS'||decision==='MERGE'||decision==='UPDATE'){
    if(proposal.targetPlaceId){
      const before=await row(connection,'PLACE',proposal.targetPlaceId);if(!before||before.building_id!==buildingId)throw new Error('invalid_place');
      if(decision==='ALIAS'||decision==='MERGE'){
        const aliases=Array.isArray(data(before.aliases))?data(before.aliases) as string[]:[];
        const additional=[proposal.name,...proposal.aliases].filter((name):name is string=>!!name&&name!==before.name);
        const merged=Array.from(new Set([...aliases,...additional])).slice(0,30);
        await change(connection,changes,'PLACE',proposal.targetPlaceId,decision,async()=>{await connection.execute("UPDATE basira_places SET aliases=?,verification_status='OFFICIAL' WHERE id=? AND building_id=?",[JSON.stringify(merged),proposal.targetPlaceId,buildingId]);});
      }else{
        const updates:Record<string,unknown>={verification_status:'OFFICIAL'};
        if(type==='ACCESSIBILITY_INFO'){if(proposal.accessibilityInformation!==null)updates.accessibility_information=proposal.accessibilityInformation;}
        else {if(proposal.name!==null)updates.name=proposal.name;if(proposal.roomNumber!==null)updates.room_number=proposal.roomNumber;if(type==='PLACE_MOVED')updates.floor_id=proposal.floorId;if(proposal.x!==null&&proposal.y!==null){updates.local_x=proposal.x;updates.local_y=proposal.y;}}
        await change(connection,changes,'PLACE',proposal.targetPlaceId,decision,async()=>{await connection.execute(`UPDATE basira_places SET ${Object.keys(updates).map(key=>`${key}=?`).join(',')} WHERE id=? AND building_id=?`,[...Object.values(updates),proposal.targetPlaceId,buildingId] as any[]);});
        if(type==='PLACE_MOVED'&&proposal.x!==null&&proposal.y!==null){
          const [linked]=await connection.query<any[]>('SELECT id FROM basira_map_nodes WHERE building_id=? AND place_id=? LIMIT 1',[buildingId,proposal.targetPlaceId]);
          if(linked[0])await change(connection,changes,'MAP_NODE',linked[0].id,'UPDATE',async()=>{await connection.execute('UPDATE basira_map_nodes SET floor_id=?,x=?,y=? WHERE id=? AND building_id=?',[proposal.floorId,proposal.x,proposal.y,linked[0].id,buildingId]);});
        }
      }
      return changes;
    }
    if(proposal.targetEdgeId&&type==='ACCESSIBILITY_INFO'){
      const before=await row(connection,'MAP_EDGE',proposal.targetEdgeId);if(!before||before.building_id!==buildingId)throw new Error('invalid_edge');
      if(proposal.visuallyImpairedFriendly===null)throw new Error('accessibility_value_required');
      await change(connection,changes,'MAP_EDGE',proposal.targetEdgeId,'UPDATE',async()=>{await connection.execute('UPDATE basira_map_edges SET visually_impaired_friendly=? WHERE id=? AND building_id=?',[proposal.visuallyImpairedFriendly?1:0,proposal.targetEdgeId,buildingId]);});
      return changes;
    }
    throw new Error('target_required');
  }
  if(decision!=='CREATE')throw new Error('unsupported_decision');
  if(type==='PLACE'){
    if(!proposal.name||!proposal.placeType||proposal.x===null||proposal.y===null)throw new Error('place_fields_required');
    const id=randomUUID();
    await change(connection,changes,'PLACE',id,'CREATE',async()=>{await connection.execute("INSERT INTO basira_places (id,building_id,floor_id,name,room_number,aliases,place_type,local_x,local_y,accessibility_information,verification_status,confidence_score,is_public) VALUES (?,?,?,?,?,?,?,?,?,?,'OFFICIAL',1,1)",[id,buildingId,proposal.floorId,proposal.name,proposal.roomNumber,JSON.stringify(proposal.aliases),proposal.placeType,proposal.x,proposal.y,proposal.accessibilityInformation]);});
    const existing=await nearNode(connection,buildingId,proposal.floorId,proposal.x,proposal.y);
    if(existing){const linked=await row(connection,'MAP_NODE',existing);if(linked?.place_id)throw new Error('node_already_has_place');await change(connection,changes,'MAP_NODE',existing,'UPDATE',async()=>{await connection.execute('UPDATE basira_map_nodes SET place_id=? WHERE id=? AND building_id=? AND place_id IS NULL',[id,existing,buildingId]);});}
    else{const nodeId=randomUUID();await change(connection,changes,'MAP_NODE',nodeId,'CREATE',async()=>{await connection.execute("INSERT INTO basira_map_nodes (id,building_id,floor_id,place_id,x,y,node_type,accessibility_level) VALUES (?,?,?,?,?,?,'ROOM','UNKNOWN')",[nodeId,buildingId,proposal.floorId,id,proposal.x,proposal.y]);});}
    return changes;
  }
  if(type==='FLOOR_TRANSITION'||(type==='MAP_EDGE'&&proposal.fromNodeId&&proposal.toNodeId)){
    if(!proposal.fromNodeId||!proposal.toNodeId||proposal.fromNodeId===proposal.toNodeId)throw new Error('invalid_edge_nodes');
    const from=await row(connection,'MAP_NODE',proposal.fromNodeId),to=await row(connection,'MAP_NODE',proposal.toNodeId);
    const transition=from?.floor_id!==to?.floor_id;
    if(!from||!to||from.building_id!==buildingId||to.building_id!==buildingId||!proposal.distanceMeters||proposal.distanceMeters<=0||type==='FLOOR_TRANSITION'&&!transition||transition&&!['ELEVATOR','STAIRS','RAMP'].includes(proposal.pathType??''))throw new Error('invalid_edge_nodes');
    const pathType=proposal.pathType??'CORRIDOR';
    const [existing]=await connection.query<any[]>('SELECT id FROM basira_map_edges WHERE building_id=? AND ((from_node_id=? AND to_node_id=?) OR (from_node_id=? AND to_node_id=?)) LIMIT 1',[buildingId,proposal.fromNodeId,proposal.toNodeId,proposal.toNodeId,proposal.fromNodeId]);
    if(existing[0])throw new Error('duplicate_edge');
    const id=randomUUID();await change(connection,changes,'MAP_EDGE',id,'CREATE',async()=>{await connection.execute("INSERT INTO basira_map_edges (id,building_id,from_node_id,to_node_id,distance_meters,path_type,accessibility_level,has_stairs,has_ramp) VALUES (?,?,?,?,?,?,'UNKNOWN',?,?)",[id,buildingId,proposal.fromNodeId,proposal.toNodeId,proposal.distanceMeters,pathType,pathType==='STAIRS'?1:0,pathType==='RAMP'?1:0]);});return changes;
  }
  if(type==='MAP_EDGE'||type==='CORRIDOR'){
    const geometry=proposal.geometry;if(!geometry)throw new Error('geometry_required');
    const length=Math.hypot(geometry.to.x-geometry.from.x,geometry.to.y-geometry.from.y);if(length<.5||length>200)throw new Error('invalid_edge_length');
    const endpoints:string[]=[];
    for(const point of [geometry.from,geometry.to]){
      const existing=await nearNode(connection,buildingId,proposal.floorId,point.x,point.y);
      if(existing){endpoints.push(existing);continue;}
      const id=randomUUID();await change(connection,changes,'MAP_NODE',id,'CREATE',async()=>{await connection.execute("INSERT INTO basira_map_nodes (id,building_id,floor_id,x,y,node_type,accessibility_level) VALUES (?,?,?,?,?,'CORRIDOR','UNKNOWN')",[id,buildingId,proposal.floorId,point.x,point.y]);});endpoints.push(id);
    }
    if(endpoints[0]===endpoints[1])throw new Error('edge_collapsed');
    const [existing]=await connection.query<any[]>('SELECT id FROM basira_map_edges WHERE building_id=? AND ((from_node_id=? AND to_node_id=?) OR (from_node_id=? AND to_node_id=?)) LIMIT 1',[buildingId,endpoints[0],endpoints[1],endpoints[1],endpoints[0]]);
    if(existing[0])throw new Error('duplicate_edge');
    const id=randomUUID();await change(connection,changes,'MAP_EDGE',id,'CREATE',async()=>{await connection.execute("INSERT INTO basira_map_edges (id,building_id,from_node_id,to_node_id,distance_meters,path_type,accessibility_level) VALUES (?,?,?,?,?,'CORRIDOR','UNKNOWN')",[id,buildingId,endpoints[0],endpoints[1],length]);});return changes;
  }
  if(nodeType[type]){
    if(proposal.x===null||proposal.y===null)throw new Error('coordinates_required');
    if(await nearNode(connection,buildingId,proposal.floorId,proposal.x,proposal.y))throw new Error('duplicate_node');
    const id=randomUUID();await change(connection,changes,'MAP_NODE',id,'CREATE',async()=>{await connection.execute("INSERT INTO basira_map_nodes (id,building_id,floor_id,x,y,node_type,accessibility_level) VALUES (?,?,?,?,?,?,'UNKNOWN')",[id,buildingId,proposal.floorId,proposal.x,proposal.y,nodeType[type]]);});return changes;
  }
  throw new Error('review_action_required');
}

export async function advanceMapVersion(connection:PoolConnection,buildingId:string,changes:Change[],sourceType:ContributionSource|'ROLLBACK',reviewedBy:string):Promise<number>{
  if(!changes.length)throw new Error('no_map_change');
  await connection.execute('INSERT IGNORE INTO basira_map_versions (building_id,current_version) VALUES (?,1)',[buildingId]);
  const [versions]=await connection.query<any[]>('SELECT current_version FROM basira_map_versions WHERE building_id=? FOR UPDATE',[buildingId]);
  const next=Number(versions[0].current_version)+1;
  await connection.execute('UPDATE basira_map_versions SET current_version=? WHERE building_id=?',[next,buildingId]);
  for(let index=0;index<changes.length;index++){const item=changes[index];await connection.execute('INSERT INTO basira_map_change_log (id,building_id,version,change_index,`action`,entity_type,entity_id,before_json,after_json,source_type,reviewed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [randomUUID(),buildingId,next,index,item.action,item.entityType,item.entityId,item.before?JSON.stringify(item.before):null,item.after?JSON.stringify(item.after):null,sourceType,reviewedBy]);
  }
  return next;
}

const normalized=(value:Record<string,unknown>|null)=>value?JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key])=>!['updated_at','created_at'].includes(key)).map(([key,item])=>[key,item instanceof Date?item.toISOString():item]))):null;
async function restore(connection:PoolConnection,entity:Entity,id:string,snapshot:Record<string,unknown>|null){
  const table=tables[entity];if(!snapshot){await connection.execute(`DELETE FROM ${table} WHERE id=?`,[id]);return;}
  const fields=columns[entity].filter(key=>snapshot[key]!==undefined);
  const values=fields.map(key=>['aliases'].includes(key)&&typeof snapshot[key]!=='string'?JSON.stringify(snapshot[key]):snapshot[key]);
  const existing=await row(connection,entity,id);
  if(existing)await connection.execute(`UPDATE ${table} SET ${fields.filter(key=>key!=='id').map(key=>`${key}=?`).join(',')} WHERE id=?`,[...fields.filter(key=>key!=='id').map(key=>values[fields.indexOf(key)]),id] as any[]);
  else await connection.execute(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`,values as any[]);
}
export async function rollbackMapVersion(connection:PoolConnection,buildingId:string,targetVersion:number,adminId:string):Promise<number>{
  const [versions]=await connection.query<any[]>('SELECT current_version FROM basira_map_versions WHERE building_id=? FOR UPDATE',[buildingId]);
  if(!versions.length||targetVersion<2||targetVersion>Number(versions[0].current_version))throw new Error('invalid_version');
  const [history]=await connection.query<any[]>('SELECT * FROM basira_map_change_log WHERE building_id=? AND version=? ORDER BY change_index DESC FOR UPDATE',[buildingId,targetVersion]);
  if(!history.length)throw new Error('version_not_found');
  const inverse:Change[]=[];
  for(const item of history){
    const entity=item.entity_type as Entity,expected=data(item.after_json) as Record<string,unknown>|null,before=data(item.before_json) as Record<string,unknown>|null;
    if(!tables[entity])throw new Error('invalid_history_entity');
    const current=await row(connection,entity,item.entity_id);
    if(normalized(current)!==normalized(expected))throw new Error('map_changed_since_version');
    await restore(connection,entity,item.entity_id,before);
    inverse.push({action:'ROLLBACK',entityType:entity,entityId:item.entity_id,before:current,after:await row(connection,entity,item.entity_id)});
  }
  return advanceMapVersion(connection,buildingId,inverse,'ROLLBACK',adminId);
}
