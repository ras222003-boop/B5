/** Real MySQL validation. Run only against a new, isolated basira_validation_* database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import mysql, { type RowDataPacket } from 'mysql2/promise';

const mode=process.argv[2];
assert(mode==='fresh'||mode==='upgrade','Expected fresh or upgrade mode');
const uri=process.env.DATABASE_URL;
assert(uri,'DATABASE_URL is required');
const target=new URL(uri);
assert(['127.0.0.1','localhost'].includes(target.hostname),'Only a local isolated MySQL server is allowed');
const database=target.pathname.slice(1);
assert(/^basira_validation_[a-z0-9_]+$/.test(database),'Database name must start with basira_validation_');
const adminUri=new URL(uri);adminUri.pathname='/';
const admin=mysql.createPool({uri:adminUri.href,connectionLimit:2});
const suffix=randomUUID().slice(0,8);
const id=()=>randomUUID();

async function createEmptyDatabase(){
  const [found]=await admin.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database]);
  assert.equal(found.length,0,`Test database ${database} must be new and empty`);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}
async function applyB1ToB5(pool:typeof import('../server/auth').pool){
  for(let number=1;number<=5;number++){
    const filename=['0001_auth.sql','0002_support.sql','0003_navigation.sql','0004_localization.sql','0005_shared_map.sql'][number-1];
    const contents=await readFile(resolve(process.cwd(),'server/migrations',filename),'utf8');
    for(const statement of contents.split(';').map(item=>item.trim()).filter(Boolean))await pool.query(statement);
  }
}
async function schemaEvidence(pool:typeof import('../server/auth').pool){
  const tables=['basira_organizations','basira_organization_memberships','basira_official_map_imports','basira_organization_map_audit_log'];
  const columns=['organization_id','official_map_source','official_approved_by','official_reviewed_at'];
  for(const table of tables){const [found]=await pool.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);assert.equal(found.length,1,`Missing ${table}`);}
  for(const column of columns){const [found]=await pool.query<RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='basira_buildings' AND COLUMN_NAME=?",[column]);assert.equal(found.length,1,`Missing buildings.${column}`);}
  for(const [constraint,column] of [['building_organization_fk','organization_id'],['building_official_approver_fk','official_approved_by']]){
    const [found]=await pool.query<RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='basira_buildings' AND CONSTRAINT_NAME=? AND COLUMN_NAME=?",[constraint,column]);assert.equal(found.length,1,`Missing ${constraint}`);
  }
  return {tables:tables.length,columns:columns.length,foreignKeys:2};
}
async function counts(pool:typeof import('../server/auth').pool,buildingId:string){
  const output:Record<string,number>={};
  for(const table of ['basira_floors','basira_places','basira_map_nodes','basira_map_edges','basira_saved_places','basira_map_versions']){
    const [rows]=await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table} WHERE building_id=?`,[buildingId]);output[table]=Number(rows[0].count);
  }
  return output;
}
async function runUpgrade(pool:typeof import('../server/auth').pool,ensureSchema:()=>Promise<void>){
  await applyB1ToB5(pool);
  const user=id(),building=id(),floor=id(),place=id(),start=id(),end=id(),edge=id(),saved=id();
  await pool.execute('INSERT INTO `user` (id,name,email,emailVerified) VALUES (?,?,?,0)',[user,'Upgrade user',`upgrade-${suffix}@example.test`]);
  await pool.execute("INSERT INTO basira_buildings (id,name,building_type,created_by) VALUES (?,?,'University',?)",[building,'Existing B5 building',user]);
  await pool.execute('INSERT INTO basira_floors (id,building_id,floor_number,name) VALUES (?,?,0,?)',[floor,building,'Ground']);
  await pool.execute("INSERT INTO basira_places (id,building_id,floor_id,name,place_type,local_x,local_y) VALUES (?,?,?,?,'CLASSROOM',5,0)",[place,building,floor,'Room 121']);
  await pool.execute("INSERT INTO basira_map_nodes (id,building_id,floor_id,x,y,node_type) VALUES (?,?,?,0,0,'ENTRANCE'),(?,?,?,5,0,'ROOM')",[start,building,floor,end,building,floor]);
  await pool.execute("INSERT INTO basira_map_edges (id,building_id,from_node_id,to_node_id,distance_meters,path_type) VALUES (?,?,?,?,5,'CORRIDOR')",[edge,building,start,end]);
  await pool.execute('INSERT INTO basira_saved_places (id,user_id,name,building_id,floor_id,place_id) VALUES (?,?,?,?,?,?)',[saved,user,'Private saved room',building,floor,place]);
  await pool.execute('INSERT INTO basira_map_versions (building_id,current_version) VALUES (?,7)',[building]);
  const before=await counts(pool,building);
  const [oldColumns]=await pool.query<RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='basira_buildings' AND COLUMN_NAME='organization_id'");
  assert.equal(oldColumns.length,0,'Upgrade fixture must have B5 schema only');
  await ensureSchema();const schema=await schemaEvidence(pool);
  assert.deepEqual(await counts(pool,building),before,'B5 rows changed during upgrade');
  await ensureSchema();assert.deepEqual(await counts(pool,building),before,'B5 rows changed during rerun');
  const [version]=await pool.query<RowDataPacket[]>('SELECT current_version FROM basira_map_versions WHERE building_id=?',[building]);assert.equal(Number(version[0].current_version),7);
  const [savedPlace]=await pool.query<RowDataPacket[]>('SELECT user_id,name FROM basira_saved_places WHERE id=?',[saved]);assert.equal(savedPlace[0].user_id,user);
  console.log(JSON.stringify({mode:'upgrade',schema,preserved:before,rerun:'PASS',currentVersion:7}));
}
async function runFresh(pool:typeof import('../server/auth').pool,auth:typeof import('../server/auth').auth,ensureSchema:()=>Promise<void>){
  await ensureSchema();const schema=await schemaEvidence(pool);await ensureSchema();
  const {registerNavigationRoutes}=await import('../server/navigation');
  const app=express();app.use(express.json({limit:'1mb'}));registerNavigationRoutes(app);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolveReady=>server.once('listening',resolveReady));
  const address=server.address();assert(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
  async function signUp(label:string){
    const response=await auth.api.signUpEmail({body:{name:label,email:`gate-${label}-${suffix}@example.test`,password:'validation-only-password-123'},asResponse:true});
    assert.equal(response.status,200,`Failed to create ${label}`);
    const user=(await response.json() as {user:{id:string}}).user;
    const cookie=response.headers.getSetCookie()[0]?.split(';')[0];assert(cookie,'Missing real auth session cookie');
    return {userId:user.id,cookie};
  }
  async function request(method:string,path:string,cookie?:string,body?:unknown){
    const response=await fetch(`${origin}/api/navigation${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
    const text=await response.text();let data:any=null;try{data=JSON.parse(text);}catch{/* 204 or parser error */}
    return {status:response.status,data};
  }
  try{
    const global=await signUp('global'),manager=await signUp('manager'),ordinary=await signUp('ordinary'),other=await signUp('other');
    assert.equal(global.userId.length,32,'The real auth ID shape changed; review membership validation');
    await pool.execute("INSERT INTO basira_navigation_roles (user_id,role) VALUES (?,'admin')",[global.userId]);
    const created=await request('POST','/organizations',global.cookie,{name:'Validation University',type:'UNIVERSITY'});assert.equal(created.status,201,JSON.stringify(created.data));
    const orgId=created.data.organization.id as string;
    const member=await request('POST',`/organizations/${orgId}/members`,global.cookie,{userId:manager.userId,role:'organization_admin'});assert.equal(member.status,200,`Real auth membership failed: ${JSON.stringify(member.data)}`);
    const buildingResponse=await request('POST',`/organizations/${orgId}/buildings`,manager.cookie,{name:'Validation Building',buildingType:'University'});assert.equal(buildingResponse.status,201,JSON.stringify(buildingResponse.data));
    const building=buildingResponse.data.building.id as string;
    const floorResponse=await request('POST',`/buildings/${building}/floors`,manager.cookie,{floorNumber:0,name:'Ground'});assert.equal(floorResponse.status,201,JSON.stringify(floorResponse.data));
    const ground=floorResponse.data.floor.id as string,upper=id(),room=id(),n0=id(),n1=id(),n2=id(),ramp=id(),corridor=id();
    const document={format:'BASIRA_JSON',version:1,floors:[{id:ground,floorNumber:0,name:'Ground'},{id:upper,floorNumber:1,name:'First'}],places:[{id:room,floorId:upper,name:'Room 121',roomNumber:'121',placeType:'CLASSROOM',x:5,y:0}],nodes:[{id:n0,floorId:ground,x:0,y:0,nodeType:'ENTRANCE'},{id:n1,floorId:upper,x:0,y:0,nodeType:'CORRIDOR'},{id:n2,floorId:upper,placeId:room,x:5,y:0,nodeType:'ROOM'}],edges:[{id:ramp,fromNodeId:n0,toNodeId:n1,distanceMeters:5,pathType:'RAMP',wheelchairAccessible:true},{id:corridor,fromNodeId:n1,toNodeId:n2,distanceMeters:5,pathType:'CORRIDOR',wheelchairAccessible:true}]};
    const preview=await request('POST',`/organizations/${orgId}/buildings/${building}/imports`,manager.cookie,document);assert.equal(preview.status,201,JSON.stringify(preview.data));assert.equal(preview.data.report.valid,true);assert.equal(preview.data.report.summary.transitions,1);
    const importId=preview.data.importId as string;
    const deniedApproval=await request('POST',`/organizations/${orgId}/buildings/${building}/imports/${importId}/approve`,ordinary.cookie,{});assert.equal(deniedApproval.status,403);
    const approval=await request('POST',`/organizations/${orgId}/buildings/${building}/imports/${importId}/approve`,manager.cookie,{});assert.equal(approval.status,200,JSON.stringify(approval.data));assert.equal(approval.data.version,2);
    const [rampRows]=await pool.query<RowDataPacket[]>('SELECT path_type,has_ramp,has_stairs FROM basira_map_edges WHERE id=?',[ramp]);assert.deepEqual([rampRows[0].path_type,Number(rampRows[0].has_ramp),Number(rampRows[0].has_stairs)],['RAMP',1,0]);
    const [auditRows]=await pool.query<RowDataPacket[]>("SELECT action FROM basira_organization_map_audit_log WHERE building_id=? AND action='IMPORT_APPROVE'",[building]);assert.equal(auditRows.length,1);
    const graph=await request('GET',`/buildings/${building}/graph`);assert.equal(graph.status,200);assert.equal(graph.data.edges.length,2);
    const {RoutePlanner}=await import('../client/src/lib/guidance/route');
    const route=new RoutePlanner(graph.data.building,graph.data.nodes,graph.data.edges).plan(n0,{kind:'place',id:room,name:'Room 121',buildingId:building,floorId:upper,nodeId:n2,placeId:room},'ACCESSIBLE');
    assert(route?.orderedEdges.some(edge=>edge.pathType==='RAMP'),'B4 did not use the approved ramp');
    const beforeInvalid=await counts(pool,building);
    const invalidCases=[
      {name:'dangling',edit:(doc:any)=>{doc.edges[0].toNodeId=id();}},
      {name:'duplicate-node',edit:(doc:any)=>{doc.nodes[1].id=doc.nodes[0].id;}},
      {name:'invalid-floor',edit:(doc:any)=>{doc.places[0].floorId=id();}},
      {name:'corridor-transition',edit:(doc:any)=>{doc.edges[0].pathType='CORRIDOR';}},
      {name:'door-transition',edit:(doc:any)=>{doc.edges[0].pathType='DOOR';}},
    ];
    for(const test of invalidCases){const broken=structuredClone(document);test.edit(broken);const result=await request('POST',`/organizations/${orgId}/buildings/${building}/imports`,manager.cookie,broken);assert.equal(result.status,422,`${test.name}: ${JSON.stringify(result.data)}`);}
    assert.equal((await request('POST',`/organizations/${orgId}/buildings/${building}/imports`,manager.cookie,'{')).status,400);
    assert.equal((await request('POST',`/organizations/${orgId}/buildings/${building}/imports`,manager.cookie,{padding:'x'.repeat(1_100_000)})).status,413);
    assert.deepEqual(await counts(pool,building),beforeInvalid,'Invalid preview changed B1');
    const empty=await request('POST',`/organizations/${orgId}/buildings`,manager.cookie,{name:'Rollback target',buildingType:'University'});assert.equal(empty.status,201);const targetBuilding=empty.data.building.id as string;
    const targetFloor=id(),targetUpper=id(),targetPlace=id(),targetNode=id();
    await pool.execute('INSERT INTO basira_floors (id,building_id,floor_number,name) VALUES (?,?,0,?)',[targetFloor,targetBuilding,'Ground']);
    await pool.execute("INSERT INTO basira_places (id,building_id,floor_id,name,place_type,local_x,local_y) VALUES (?,?,?,?,'CLASSROOM',1,1)",[targetPlace,targetBuilding,targetFloor,'Existing place']);
    await pool.execute("INSERT INTO basira_map_nodes (id,building_id,floor_id,place_id,x,y,node_type) VALUES (?,?,?, ?,1,1,'ROOM')",[targetNode,targetBuilding,targetFloor,targetPlace]);
    const targetBefore=await counts(pool,targetBuilding);
    const conflicting={...structuredClone(document),floors:[{id:targetFloor,floorNumber:0,name:'Ground'},{id:targetUpper,floorNumber:1,name:'First'}],places:[{...document.places[0],id:id(),floorId:targetUpper}],nodes:[{...document.nodes[0],id:id(),floorId:targetFloor},{...document.nodes[1],id:id(),floorId:targetUpper},{...document.nodes[2],id:id(),floorId:targetUpper,placeId:undefined}],edges:[]};
    const conflictPreview=await request('POST',`/organizations/${orgId}/buildings/${targetBuilding}/imports`,manager.cookie,conflicting);assert.equal(conflictPreview.status,201);
    const conflictApproval=await request('POST',`/organizations/${orgId}/buildings/${targetBuilding}/imports/${conflictPreview.data.importId}/approve`,manager.cookie,{});assert(conflictApproval.status>=400);
    const [targetRows]=await pool.query<RowDataPacket[]>('SELECT map_status,verification_status FROM basira_buildings WHERE id=?',[targetBuilding]);assert.deepEqual([targetRows[0].map_status,targetRows[0].verification_status],['UNMAPPED','DISCOVERED']);
    assert.deepEqual(await counts(pool,targetBuilding),targetBefore,'Rejected existing map changed B1');
    const saved=await request('POST','/saved-places',ordinary.cookie,{name:'Private place',latitude:18.22,longitude:42.5});assert.equal(saved.status,201,JSON.stringify(saved.data));const savedId=saved.data.savedPlace.id as string;
    for(const [method,body] of [['GET',undefined],['PATCH',{name:'Stolen'}],['DELETE',undefined]] as const){const result=await request(method,`/saved-places/${savedId}`,other.cookie,body);assert.equal(result.status,404,`${method} private place returned ${result.status}`);}
    assert.equal((await request('GET',`/organizations/${orgId}/buildings`,ordinary.cookie)).status,403);
    assert.equal((await request('POST',`/organizations/${orgId}/members`,ordinary.cookie,{userId:other.userId,role:'viewer'})).status,403);
    assert.equal((await request('POST',`/shared-map/buildings/${building}/rollback`,ordinary.cookie,{version:2})).status,403);
    const contribution=id();await pool.execute('INSERT INTO basira_shared_map_contributions (id,root_id,building_id,floor_id,contribution_type,`source`,proposal,evidence,fingerprint,actor_key,contributed_by,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[contribution,contribution,building,upper,'PLACE','MANUAL','{}','{}','a'.repeat(64),'b'.repeat(64),ordinary.userId,id()]);
    assert.equal((await request('POST',`/shared-map/contributions/${contribution}/review`,ordinary.cookie,{decision:'APPROVE',action:'CREATE',resolveConflicts:false})).status,403);
    const officialEdit=await request('PATCH',`/buildings/${building}`,ordinary.cookie,{name:'Changed'});assert(officialEdit.status>=400);
    console.log(JSON.stringify({mode:'fresh',schema,rerun:'PASS',organization:'PASS',officialImport:'PASS',ramp:'PASS',invalidPreviewCases:7,transactionRollback:'PASS',savedPlaceIdor:'PASS',authorization:'PASS',mapVersion:2}));
  }finally{server.close();}
}

await createEmptyDatabase();
process.env.MANUS_JWT_SECRET='basira-validation-gate-local-only-secret';
const {pool,auth}=await import('../server/auth');
const {ensureSchema}=await import('../server/migrations');
try{if(mode==='fresh')await runFresh(pool,auth,ensureSchema);else await runUpgrade(pool,ensureSchema);}
finally{await pool.end();await admin.end();}
