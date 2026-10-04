import { beforeEach,describe,expect,it,vi } from 'vitest';
import { emptyProposal,flushSharedMapQueue,sharedMapApi,updatePolicy,type Submission } from './sharedMap';

const memory=new Map<string,string>();
beforeEach(()=>{memory.clear();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value)});});
describe('B5 offline and navigation sync',()=>{
  it('stores only one offline opt-in submission per idempotency key and replays it once',async()=>{
    const floor='22222222-2222-4222-8222-222222222222',buildingId='11111111-1111-4111-8111-111111111111';
    const body:Submission={buildingId,type:'PLACE',source:'USER_MANUAL',proposal:{...emptyProposal(floor),name:'المختبر',placeType:'LAB',x:4,y:5},evidence:{observedAt:1,localizationConfidence:.7,ocrConfidence:null,visualAnchorConfidence:null,sourceSessionKey:null,sourceDeviceKey:null,observedFloorId:floor,observedX:4,observedY:5,floorConsistent:true,placeConsistent:true},idempotencyKey:'33333333-3333-4333-8333-333333333333',consent:true};
    vi.stubGlobal('navigator',{onLine:false});await sharedMapApi.submit(body);await sharedMapApi.submit(body);
    expect(JSON.parse(memory.get('basira-shared-map-opt-in-pending-v1')??'[]')).toHaveLength(1);
    vi.stubGlobal('navigator',{onLine:true});const fetch=vi.fn().mockResolvedValue({ok:true,status:201,json:async()=>({})});vi.stubGlobal('fetch',fetch);
    expect(await flushSharedMapQueue()).toEqual({sent:1,remaining:0});expect(fetch).toHaveBeenCalledTimes(1);
    expect(await flushSharedMapQueue()).toEqual({sent:0,remaining:0});
  });
  it('defers ordinary map updates mid-route but applies reviewed closures urgently',()=>{
    expect(updatePolicy([{action:'CREATE',entity_type:'PLACE'}],true)).toBe('DEFER');
    expect(updatePolicy([{action:'CLOSE_EDGE',entity_type:'MAP_EDGE'}],true)).toBe('URGENT');
    expect(updatePolicy([{action:'CREATE',entity_type:'PLACE'}],false)).toBe('APPLY');
  });
});
