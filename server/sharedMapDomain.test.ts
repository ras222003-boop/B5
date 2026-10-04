import { describe,expect,it } from 'vitest';
import type { ContributionEvidence,ContributionProposal } from '../shared/sharedMap';
import { DEFAULT_SHARED_MAP_POLICY } from '../shared/sharedMap';
import { ContributionCorroborationService,ContributorTrustModel,contributionFingerprint,MapConflictDetector,MapPromotionService,SharedMapConfidenceEngine,SharedPlaceResolver } from './sharedMapDomain';

const building='11111111-1111-4111-8111-111111111111',floor='22222222-2222-4222-8222-222222222222';
const proposal=(name:string,roomNumber:string|null=null,x=10):ContributionProposal=>({name,roomNumber,aliases:[],placeType:'ROOM',floorId:floor,x,y:20,targetPlaceId:null,targetNodeId:null,targetEdgeId:null,geometry:null,fromNodeId:null,toNodeId:null,transitionToFloorId:null,pathType:null,distanceMeters:null,accessibilityInformation:null,visuallyImpairedFriendly:null,temporarilyClosed:null});
const now=Date.now();
const evidence=(observedAt=now):ContributionEvidence=>({observedAt,localizationConfidence:.9,ocrConfidence:.9,visualAnchorConfidence:.9,sourceSessionKey:null,sourceDeviceKey:null,observedFloorId:floor,observedX:10,observedY:20,floorConsistent:true,placeConsistent:true});
const records=[
  {actorKey:'a',sessionKey:'s1',deviceKey:'d1',source:'OCR' as const,quality:evidence(now-26*3_600_000),trust:1},
  {actorKey:'b',sessionKey:'s2',deviceKey:'d2',source:'OCR' as const,quality:evidence(now-25*3_600_000),trust:1},
  {actorKey:'c',sessionKey:'s3',deviceKey:'d3',source:'USER_MANUAL' as const,quality:evidence(now),trust:1},
];

describe('B5 public map identity and confidence',()=>{
  it('corroborates Arabic, numeric and English room aliases on the same floor nearby',()=>{
    const resolver=new SharedPlaceResolver();const first=proposal('قاعة 121'),second=proposal('121',null,11),third=proposal('Room 121',null,12);
    expect(resolver.relationship(first,second)).toBe('SAME');expect(resolver.relationship(second,third)).toBe('SAME');
    const service=new ContributionCorroborationService();expect(service.rootFor(third,[{id:'1',rootId:'root',proposal:first,type:'PLACE'}],'PLACE')).toMatchObject({rootId:'root',relationship:'SAME'});
    expect(contributionFingerprint(building,'PLACE',first)).toBe(contributionFingerprint(building,'PLACE',proposal('Room 121')));
  });
  it('deduplicates a door and reversed corridor geometry',()=>{
    const service=new ContributionCorroborationService(),door=proposal('');door.name=null;door.placeType=null;
    expect(service.rootFor({...door,x:10.5},[{id:'1',rootId:'door',proposal:door,type:'DOOR'}],'DOOR')?.rootId).toBe('door');
    const corridor={...door,geometry:{from:{x:0,y:0},to:{x:8,y:0}}};
    expect(service.rootFor({...corridor,geometry:{from:{x:8,y:0},to:{x:0,y:0}}},[{id:'2',rootId:'edge',proposal:corridor,type:'CORRIDOR'}],'CORRIDOR')?.rootId).toBe('edge');
  });
  it('counts each actor once even after repeated confirmations',()=>{
    const engine=new SharedMapConfidenceEngine();const result=engine.evaluate([records[0],{...records[0],sessionKey:'s-new',deviceKey:'d-new'},records[1]],0,now);
    expect(result.independentActors).toBe(2);expect(result.distinctSessions).toBe(2);expect(new MapPromotionService().communityStatus(result,0,'PLACE')).toBe('CORROBORATING');
  });
  it('requires independent users, devices, sessions, confidence and no conflict',()=>{
    const engine=new SharedMapConfidenceEngine(),promotion=new MapPromotionService();
    const strong=engine.evaluate(records,0,now);expect(promotion.communityStatus(strong,0,'PLACE')).toBe('COMMUNITY_VERIFIED');
    expect(promotion.communityStatus(strong,1,'PLACE')).not.toBe('COMMUNITY_VERIFIED');
    expect(promotion.communityStatus(engine.evaluate(records.map(item=>({...item,deviceKey:'one-device'})),0,now),0,'PLACE')).not.toBe('COMMUNITY_VERIFIED');
    expect(promotion.communityStatus(strong,0,'MAP_EDGE')).toBe('COMMUNITY_VERIFIED');
    expect(promotion.communityStatus(engine.evaluate(records.map(item=>({...item,quality:evidence(now)})),0,now),0,'MAP_EDGE')).not.toBe('COMMUNITY_VERIFIED');
    expect(DEFAULT_SHARED_MAP_POLICY.minimumIndependentActors).toBe(3);
  });
  it('detects a moved clinic or conflicting room, without silently replacing the original',()=>{
    const old={...proposal('عيادة العيون 305','305'),targetPlaceId:'place-1'};
    const moved={...proposal('عيادة العيون 312','312'),targetPlaceId:'place-1'};
    expect(new SharedPlaceResolver().relationship(old,moved)).toBe('POSSIBLE_CHANGE');
    expect(new MapConflictDetector().detect(moved,old)).toBe('ROOM_MISMATCH');
    expect(new MapConflictDetector().detect({...old,x:30},old)).toBe('LOCATION_MISMATCH');
  });
  it('reserves OFFICIAL for human review and retains stale candidates',()=>{
    const promotion=new MapPromotionService();expect(()=>promotion.reviewStatus(null,'APPROVE')).toThrow('mapper_role_required');
    expect(promotion.reviewStatus('mapper','APPROVE')).toBe('OFFICIAL');
    expect(promotion.stale(now-366*86_400_000,now-366*86_400_000,now)).toBe(true);
    expect(new ContributorTrustModel().weight('user')).toBeGreaterThan(0);
  });
});
