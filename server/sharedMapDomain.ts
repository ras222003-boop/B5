import { createHash } from 'node:crypto';
import type { ContributionEvidence, ContributionProposal, ContributionSource, ContributionStatus, ContributionType, SharedMapPolicy } from '../shared/sharedMap';
import { DEFAULT_SHARED_MAP_POLICY } from '../shared/sharedMap';
import { MapDeduplicationService } from '../shared/localizationDedup';
import type { MapSuggestionType } from '../shared/localization';

const arabic='٠١٢٣٤٥٦٧٨٩',persian='۰۱۲۳۴۵۶۷۸۹';
export function normalizePublicName(value:string):string{
  return value.normalize('NFKC').replace(/[٠-٩]/g,c=>String(arabic.indexOf(c))).replace(/[۰-۹]/g,c=>String(persian.indexOf(c)))
    .replace(/[\u064B-\u065F]/g,'').toLowerCase().replace(/\b(?:room|classroom|office)\b|قاعة|غرفة|مكتب|教室|房间/g,' ').replace(/[^a-z0-9\u0600-\u06ff\u4e00-\u9fff]+/g,' ').trim();
}
export function roomToken(value:string|null):string|null{return value?normalizePublicName(value).match(/(?:^|\s)(\d{2,4})(?:$|\s)/)?.[1]??null:null;}
export function semanticName(value:string|null):string{return normalizePublicName(value??'').replace(/\b\d{2,4}\b/g,'').trim();}
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
export function contributionFingerprint(buildingId:string,type:ContributionType,proposal:ContributionProposal):string{
  const cell=proposal.x===null||proposal.y===null?'unknown':`${Math.round(proposal.x/2)}:${Math.round(proposal.y/2)}`;
  const name=roomToken(proposal.roomNumber)??roomToken(proposal.name)??semanticName(proposal.name);
  return createHash('sha256').update(`${buildingId}|${proposal.floorId}|${type}|${name}|${proposal.targetPlaceId??proposal.targetNodeId??proposal.targetEdgeId??cell}`).digest('hex');
}
export class SharedPlaceResolver {
  constructor(private readonly policy:SharedMapPolicy=DEFAULT_SHARED_MAP_POLICY){}
  relationship(a:ContributionProposal,b:ContributionProposal):'SAME'|'POSSIBLE_CHANGE'|'DIFFERENT'{
    if(a.floorId!==b.floorId)return a.targetPlaceId&&a.targetPlaceId===b.targetPlaceId?'POSSIBLE_CHANGE':'DIFFERENT';
    if(a.targetPlaceId&&b.targetPlaceId&&a.targetPlaceId===b.targetPlaceId){
      const roomA=roomToken(a.roomNumber??a.name),roomB=roomToken(b.roomNumber??b.name);
      if(roomA&&roomB&&roomA!==roomB)return 'POSSIBLE_CHANGE';
      if(a.x!==null&&a.y!==null&&b.x!==null&&b.y!==null&&distance({x:a.x,y:a.y},{x:b.x,y:b.y})>this.policy.maximumProximityMeters*2)return 'POSSIBLE_CHANGE';
      return 'SAME';
    }
    if(a.targetNodeId&&a.targetNodeId===b.targetNodeId)return 'SAME';
    if(a.targetEdgeId&&a.targetEdgeId===b.targetEdgeId)return 'SAME';
    if(a.placeType&&b.placeType&&a.placeType!==b.placeType)return 'DIFFERENT';
    const an=[a.name??'',a.roomNumber??'',...a.aliases].map(normalizePublicName).filter(Boolean);
    const bn=[b.name??'',b.roomNumber??'',...b.aliases].map(normalizePublicName).filter(Boolean);
    const roomA=roomToken(a.roomNumber??a.name),roomB=roomToken(b.roomNumber??b.name);
    const sameName=an.some(value=>bn.includes(value))||Boolean(roomA&&roomA===roomB);
    const near=a.x!==null&&a.y!==null&&b.x!==null&&b.y!==null&&distance({x:a.x,y:a.y},{x:b.x,y:b.y})<=this.policy.maximumProximityMeters;
    if(sameName&&(near||a.targetNodeId&&a.targetNodeId===b.targetNodeId))return 'SAME';
    if(semanticName(a.name)&&semanticName(a.name)===semanticName(b.name)&&roomA&&roomB&&roomA!==roomB)return 'POSSIBLE_CHANGE';
    return 'DIFFERENT';
  }
}
export class ContributionCorroborationService {
  constructor(private readonly resolver=new SharedPlaceResolver(),private readonly b3Dedup=new MapDeduplicationService()){}
  rootFor(proposal:ContributionProposal,candidates:{id:string;rootId:string;proposal:ContributionProposal;type?:ContributionType}[],type?:ContributionType):{rootId:string;relationship:'SAME'|'POSSIBLE_CHANGE'|'DIFFERENT'}|null{
    const ranked=candidates.filter(candidate=>!type||candidate.type===type).map(candidate=>{
      let relationship=this.resolver.relationship(proposal,candidate.proposal);
      const b3Type=type==='PLACE'?'PLACE_ANCHOR':type==='MAP_NODE'?'NEW_NODE':type==='MAP_EDGE'?'NEW_EDGE':type;
      if(relationship==='DIFFERENT'&&b3Type&&['PLACE_ANCHOR','NEW_NODE','NEW_EDGE','CORRIDOR','INTERSECTION','DOOR','ELEVATOR','STAIRS','ENTRANCE','EXIT','FLOOR_TRANSITION'].includes(b3Type)){
        const asSuggestion=(item:ContributionProposal)=>({type:b3Type as MapSuggestionType,floorId:item.floorId,x:item.x,y:item.y,name:item.name,placeId:item.targetPlaceId});
        if(this.b3Dedup.duplicate(asSuggestion(proposal),[asSuggestion(candidate.proposal)]))relationship='SAME';
      }
      if(type&&['DOOR','ELEVATOR','STAIRS','ENTRANCE','EXIT','MAP_NODE','INTERSECTION'].includes(type)&&proposal.floorId===candidate.proposal.floorId&&proposal.x!==null&&proposal.y!==null&&candidate.proposal.x!==null&&candidate.proposal.y!==null&&distance({x:proposal.x,y:proposal.y},{x:candidate.proposal.x,y:candidate.proposal.y})<=1.5)relationship='SAME';
      if(type&&['CORRIDOR','MAP_EDGE'].includes(type)&&proposal.geometry&&candidate.proposal.geometry){const a=proposal.geometry,b=candidate.proposal.geometry;if(Math.min(distance(a.from,b.from)+distance(a.to,b.to),distance(a.from,b.to)+distance(a.to,b.from))<=3)relationship='SAME';}
      return {...candidate,relationship};
    }).filter(candidate=>candidate.relationship!=='DIFFERENT');
    const same=ranked.find(candidate=>candidate.relationship==='SAME');if(same)return {rootId:same.rootId,relationship:'SAME'};
    const change=ranked.find(candidate=>candidate.relationship==='POSSIBLE_CHANGE');return change?{rootId:change.rootId,relationship:'POSSIBLE_CHANGE'}:null;
  }
}
export class MapConflictDetector {
  constructor(private readonly resolver=new SharedPlaceResolver()){}
  detect(proposal:ContributionProposal,existing:ContributionProposal):'ROOM_MISMATCH'|'LOCATION_MISMATCH'|'FLOOR_MISMATCH'|'TYPE_MISMATCH'|null{
    if(proposal.targetPlaceId&&proposal.targetPlaceId===existing.targetPlaceId&&proposal.floorId!==existing.floorId)return 'FLOOR_MISMATCH';
    if(proposal.placeType&&existing.placeType&&proposal.placeType!==existing.placeType&&proposal.targetPlaceId===existing.targetPlaceId)return 'TYPE_MISMATCH';
    const a=roomToken(proposal.roomNumber??proposal.name),b=roomToken(existing.roomNumber??existing.name);
    if(a&&b&&a!==b&&this.resolver.relationship(proposal,existing)==='POSSIBLE_CHANGE')return 'ROOM_MISMATCH';
    if(proposal.x!==null&&proposal.y!==null&&existing.x!==null&&existing.y!==null&&proposal.targetPlaceId===existing.targetPlaceId&&distance({x:proposal.x,y:proposal.y},{x:existing.x,y:existing.y})>6)return 'LOCATION_MISMATCH';
    return null;
  }
}
export class ContributorTrustModel {
  weight(role:'user'|'mapper'|'admin'|'organization',accepted=0,rejected=0):number{
    const base=role==='admin'?1.2:role==='mapper'?1.12:role==='organization'?1.2:1;
    const history=(accepted+rejected)>=5?Math.max(-.15,Math.min(.12,(accepted-rejected)/(accepted+rejected)*.12)):0;
    return Math.max(.8,Math.min(1.3,base+history));
  }
}
export interface IndependentEvidence {actorKey:string;sessionKey:string|null;deviceKey:string|null;source:ContributionSource;quality:ContributionEvidence;trust:number}
export interface ConfidenceResult {confidence:number;independentActors:number;distinctSessions:number;distinctDevices:number;observationSpanHours:number;averageLocalization:number}
export class SharedMapConfidenceEngine {
  constructor(readonly policy:SharedMapPolicy=DEFAULT_SHARED_MAP_POLICY){}
  evaluate(records:IndependentEvidence[],conflicts=0,now=Date.now()):ConfidenceResult{
    const best=new Map<string,IndependentEvidence>();
    for(const item of records){const existing=best.get(item.actorKey);if(!existing||this.quality(item)>this.quality(existing))best.set(item.actorKey,item);}
    const independent=Array.from(best.values()),sessions=new Set(independent.map(item=>item.sessionKey).filter(Boolean)),devices=new Set(independent.map(item=>item.deviceKey).filter(Boolean));
    const quality=independent.length?independent.reduce((sum,item)=>sum+this.quality(item),0)/independent.length:0;
    const averageLocalization=independent.length?independent.reduce((sum,item)=>sum+(item.quality.localizationConfidence??0),0)/independent.length:0;
    const times=independent.map(item=>item.quality.observedAt),span=times.length>1?(Math.max(...times)-Math.min(...times))/3_600_000:0;
    const freshness=times.length?Math.max(0,1-(now-Math.max(...times))/(this.policy.maximumAgeDays*86_400_000)):0;
    const confidence=Math.max(0,Math.min(1,.12+Math.min(.36,independent.length*.12)+quality*.3+Math.min(.1,sessions.size*.05)+Math.min(.1,devices.size*.05)+freshness*.08-conflicts*.25));
    return {confidence,independentActors:independent.length,distinctSessions:sessions.size,distinctDevices:devices.size,observationSpanHours:span,averageLocalization};
  }
  private quality(item:IndependentEvidence):number{
    const e=item.quality;
    return Math.min(1,((e.localizationConfidence??0)*.35+(e.ocrConfidence??0)*.2+(e.visualAnchorConfidence??0)*.15+(e.floorConsistent?.15:0)+(e.placeConsistent?.15:0))*item.trust*this.policy.sourceReliability[item.source]);
  }
}
export class MapPromotionService {
  constructor(private readonly policy:SharedMapPolicy=DEFAULT_SHARED_MAP_POLICY){}
  communityStatus(result:ConfidenceResult,conflicts:number,type:ContributionType):ContributionStatus{
    const highImpact=['ACCESSIBILITY_INFO','TEMPORARY_CLOSURE_REPORT','FLOOR_TRANSITION','MAP_EDGE'].includes(type);
    const span=highImpact?this.policy.highImpactObservationSpanHours:this.policy.minimumObservationSpanHours;
    return conflicts===0&&result.independentActors>=this.policy.minimumIndependentActors&&result.distinctSessions>=this.policy.minimumDistinctSessions&&result.distinctDevices>=this.policy.minimumDistinctDevices&&result.averageLocalization>=this.policy.minimumLocalizationConfidence&&result.confidence>=this.policy.minimumConfidence&&result.observationSpanHours>=span?'COMMUNITY_VERIFIED':result.independentActors>=2?'CORROBORATING':'PENDING';
  }
  reviewStatus(role:'mapper'|'admin'|null,decision:'APPROVE'|'REJECT'|'MORE_EVIDENCE'):ContributionStatus{
    if(!role)throw new Error('mapper_role_required');
    return decision==='APPROVE'?'OFFICIAL':decision==='REJECT'?'REJECTED':'CORROBORATING';
  }
  stale(createdAt:number,lastConfirmedAt:number,now=Date.now()){return now-Math.max(createdAt,lastConfirmedAt)>this.policy.maximumAgeDays*86_400_000;}
}
