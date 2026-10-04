import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MapImportValidator } from './mapImportValidator';

const f1=randomUUID(),f2=randomUUID(),p1=randomUUID(),n1=randomUUID(),n2=randomUUID(),n3=randomUUID();
const sample=()=>({format:'BASIRA_JSON',version:1,floors:[{id:f1,floorNumber:0,name:'Ground'},{id:f2,floorNumber:1,name:'First'}],places:[{id:p1,floorId:f2,name:'Room 121',roomNumber:'121',placeType:'CLASSROOM',x:5,y:0}],nodes:[{id:n1,floorId:f1,x:0,y:0,nodeType:'STAIRS'},{id:n2,floorId:f2,x:0,y:0,nodeType:'STAIRS'},{id:n3,floorId:f2,placeId:p1,x:5,y:0,nodeType:'ROOM'}],edges:[{id:randomUUID(),fromNodeId:n1,toNodeId:n2,distanceMeters:3,pathType:'STAIRS'},{id:randomUUID(),fromNodeId:n2,toNodeId:n3,distanceMeters:5,pathType:'CORRIDOR'}]});
describe('MapImportValidator',()=>{
  it('previews a connected two-floor import with an explicit transition',()=>{const {report}=new MapImportValidator().validate(sample());expect(report.valid).toBe(true);expect(report.summary).toMatchObject({buildings:1,floors:2,places:1,nodes:3,edges:2,transitions:1});});
  it('rejects a dangling edge and duplicate IDs before any database write',()=>{const doc=sample();doc.edges[0].toNodeId=randomUUID();doc.nodes[1].id=doc.nodes[0].id;const {report}=new MapImportValidator().validate(doc);expect(report.valid).toBe(false);expect(report.errors.some(item=>item.includes('Duplicate id'))).toBe(true);expect(report.errors.some(item=>item.includes('dangling'))).toBe(true);});
  it('rejects cross-floor corridors and missing floors',()=>{const doc=sample();doc.edges[0].pathType='CORRIDOR';doc.places[0].floorId=randomUUID();const {report}=new MapImportValidator().validate(doc);expect(report.errors.some(item=>item.includes('crosses floors'))).toBe(true);expect(report.errors.some(item=>item.includes('unknown floor'))).toBe(true);});
  it('rejects unbounded or malformed input',()=>{const {report}=new MapImportValidator().validate({format:'BASIRA_JSON',version:1,floors:[],places:[],nodes:Array(1501).fill({}),edges:[]});expect(report.valid).toBe(false);});
});
