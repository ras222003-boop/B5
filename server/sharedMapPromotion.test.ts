import type { PoolConnection } from 'mysql2/promise';
import { describe,expect,it } from 'vitest';
import type { ContributionProposal } from '../shared/sharedMap';
import { advanceMapVersion,applyApprovedContribution,rollbackMapVersion } from './sharedMapPromotion';

const building='11111111-1111-4111-8111-111111111111',floor='22222222-2222-4222-8222-222222222222';
class MemoryMap {
  places=new Map<string,Record<string,unknown>>();nodes=new Map<string,Record<string,unknown>>();versions=new Map<string,number>();history:Record<string,unknown>[]=[];
  async query<T>(_sql:string,params:any[]=[]):Promise<[T,[]]>{const sql=_sql.toLowerCase();let result:Record<string,unknown>[]=[];
    if(sql.startsWith('select * from basira_places'))result=this.places.has(params[0])?[this.places.get(params[0])!]:[];
    else if(sql.startsWith('select * from basira_map_nodes'))result=this.nodes.has(params[0])?[this.nodes.get(params[0])!]:[];
    else if(sql.startsWith('select id from basira_map_nodes'))result=[];
    else if(sql.startsWith('select current_version'))result=this.versions.has(params[0])?[{current_version:this.versions.get(params[0])}]:[];
    else if(sql.startsWith('select * from basira_map_change_log'))result=this.history.filter(item=>item.building_id===params[0]&&item.version===params[1]).sort((a,b)=>Number(b.change_index)-Number(a.change_index));
    else throw new Error(`unexpected query: ${_sql}`);
    return [result as T,[]];
  }
  async execute(sql:string,params:any[]=[]):Promise<[Record<string,unknown>,[]]>{const lower=sql.toLowerCase();
    if(lower.startsWith('insert into basira_places')){const [id,building_id,floor_id,name,room_number,aliases,place_type,local_x,local_y,accessibility_information]=params;this.places.set(id,{id,building_id,floor_id,name,room_number,aliases,place_type,local_x,local_y,accessibility_information,verification_status:'OFFICIAL',confidence_score:1,is_public:1});}
    else if(lower.startsWith('insert into basira_map_nodes')){const [id,building_id,floor_id,place_id,x,y]=params;this.nodes.set(id,{id,building_id,floor_id,place_id,x,y,node_type:'ROOM',accessibility_level:'UNKNOWN'});}
    else if(lower.startsWith('insert ignore into basira_map_versions')){if(!this.versions.has(params[0]))this.versions.set(params[0],1);}
    else if(lower.startsWith('update basira_map_versions'))this.versions.set(params[1],params[0]);
    else if(lower.startsWith('insert into basira_map_change_log')){const [id,building_id,version,change_index,action,entity_type,entity_id,before_json,after_json,source_type,reviewed_by]=params;this.history.push({id,building_id,version,change_index,action,entity_type,entity_id,before_json,after_json,source_type,reviewed_by});}
    else if(lower.startsWith('delete from basira_map_nodes'))this.nodes.delete(params[0]);
    else if(lower.startsWith('delete from basira_places'))this.places.delete(params[0]);
    else throw new Error(`unexpected execute: ${sql}`);
    return [{affectedRows:1},[]];
  }
}
describe('B5 controlled B1 promotion and version rollback',()=>{
  it('adds approved hospital lab to B1 with a node, increments its map version and reverses it',async()=>{
    const db=new MemoryMap(),connection=db as unknown as PoolConnection;
    const proposal:ContributionProposal={name:'المختبر',roomNumber:'121',aliases:['Lab 121'],placeType:'LAB',floorId:floor,x:10,y:20,targetPlaceId:null,targetNodeId:null,targetEdgeId:null,geometry:null,fromNodeId:null,toNodeId:null,transitionToFloorId:null,pathType:null,distanceMeters:null,accessibilityInformation:null,visuallyImpairedFriendly:null,temporarilyClosed:null};
    const changes=await applyApprovedContribution(connection,building,'PLACE',proposal,'CREATE');
    expect(changes.map(change=>change.entityType)).toEqual(['PLACE','MAP_NODE']);expect(db.places.size).toBe(1);expect(db.nodes.size).toBe(1);
    expect(await advanceMapVersion(connection,building,changes,'OCR','mapper')).toBe(2);expect(db.history).toHaveLength(2);
    expect(await rollbackMapVersion(connection,building,2,'admin')).toBe(3);expect(db.places.size).toBe(0);expect(db.nodes.size).toBe(0);expect(db.history).toHaveLength(4);
  });
});
