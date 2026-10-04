import { navApi, navigationRequest, json, type BuildingGraph } from './navigationApi';
import type { ContributionEvidence, ContributionProposal, ContributionSource, ContributionType, IssueDuration, IssueType, MapDecision, SharedMapContribution } from '@shared/sharedMap';

export type Submission={buildingId:string;type:ContributionType;source:ContributionSource;proposal:ContributionProposal;evidence:ContributionEvidence;idempotencyKey:string;consent:true};
export type IssueSubmission={buildingId:string;floorId:string|null;type:IssueType;duration:IssueDuration;description:string;targetPlaceId:string|null;targetEdgeId:string|null;idempotencyKey:string;consent:true};
type Queued={kind:'contribution';body:Submission}|{kind:'issue';body:IssueSubmission};
const queueKey='basira-shared-map-opt-in-pending-v1';
const queue=():Queued[]=>{try{return JSON.parse(sessionStorage.getItem(queueKey)??'[]') as Queued[];}catch{return [];}};
function enqueue(item:Queued){const pending=queue();if(!pending.some(old=>old.body.idempotencyKey===item.body.idempotencyKey))sessionStorage.setItem(queueKey,JSON.stringify([...pending,item].slice(-30)));}
export async function flushSharedMapQueue():Promise<{sent:number;remaining:number}>{
  if(!navigator.onLine)return {sent:0,remaining:queue().length};
  const pending=queue(),left:Queued[]=[];let sent=0;
  for(const item of pending){try{await navigationRequest(item.kind==='issue'?'/shared-map/issues':'/shared-map/contributions',json('POST',item.body));sent++;}catch{left.push(item);}}
  sessionStorage.setItem(queueKey,JSON.stringify(left));return {sent,remaining:left.length};
}
export const sharedMapApi={
  version:(buildingId:string)=>navigationRequest<{buildingId:string;version:number;updatedAt:string|null}>(`/shared-map/buildings/${buildingId}/version`),
  sync:(buildingId:string,sinceVersion:number)=>navigationRequest<{buildingId:string;version:number;changed:boolean;changes:{version:number;action:string;entity_type:string;entity_id:string}[];hasMore:boolean;pendingCount:number}>(`/shared-map/buildings/${buildingId}/sync?sinceVersion=${sinceVersion}`),
  contributions:(buildingId:string)=>navigationRequest<{contributions:SharedMapContribution[]}>(`/shared-map/buildings/${buildingId}/contributions`),
  contribution:(id:string)=>navigationRequest<{contribution:SharedMapContribution;current:Record<string,unknown>|null;conflicts:{id:string;kind:string;status:string;created_at:string}[]}>(`/shared-map/contributions/${id}`),
  issues:(buildingId:string)=>navigationRequest<{issues:{id:string;type:IssueType;duration:IssueDuration;description:string;status:string;created_at:string}[]}>(`/shared-map/buildings/${buildingId}/issues`),
  history:(buildingId:string)=>navigationRequest<{history:{version:number;action:string;entity_type:string;entity_id:string;created_at:string}[]}>(`/shared-map/buildings/${buildingId}/history`),
  submit:async(body:Submission)=>{if(!navigator.onLine){enqueue({kind:'contribution',body});return {queued:true};}try{return await navigationRequest<{contribution:SharedMapContribution;duplicate?:boolean}>('/shared-map/contributions',json('POST',body));}catch(error){if(!navigator.onLine){enqueue({kind:'contribution',body});return {queued:true};}throw error;}},
  report:async(body:IssueSubmission)=>{if(!navigator.onLine){enqueue({kind:'issue',body});return {queued:true};}try{return await navigationRequest<{issue:{id:string;status:string};duplicate?:boolean}>('/shared-map/issues',json('POST',body));}catch(error){if(!navigator.onLine){enqueue({kind:'issue',body});return {queued:true};}throw error;}},
  confirm:(id:string,evidence:ContributionEvidence)=>navigationRequest(`/shared-map/contributions/${id}/confirm`,json('POST',{evidence,idempotencyKey:crypto.randomUUID()})),
  review:(id:string,decision:'APPROVE'|'REJECT'|'MORE_EVIDENCE',action:MapDecision|null,resolveConflicts=false)=>navigationRequest(`/shared-map/contributions/${id}/review`,json('POST',{decision,action,resolveConflicts})),
  reviewIssue:(id:string,status:'REVIEWED'|'DISMISSED')=>navigationRequest(`/shared-map/issues/${id}/review`,json('POST',{status})),
  rollback:(buildingId:string,version:number)=>navigationRequest(`/shared-map/buildings/${buildingId}/rollback`,json('POST',{version})),
  importSuggestion:(id:string)=>navigationRequest(`/shared-map/map-suggestions/${id}/import`,{method:'POST'}),
};
export function emptyProposal(floorId:string):ContributionProposal{return {name:null,roomNumber:null,aliases:[],placeType:null,floorId,x:null,y:null,targetPlaceId:null,targetNodeId:null,targetEdgeId:null,geometry:null,fromNodeId:null,toNodeId:null,transitionToFloorId:null,pathType:null,distanceMeters:null,accessibilityInformation:null,visuallyImpairedFriendly:null,temporarilyClosed:null};}
export function observedEvidence(floorId:string,x:number|null,y:number|null,localizationConfidence:number,ocrConfidence:number|null=null):ContributionEvidence{return {observedAt:Date.now(),localizationConfidence,ocrConfidence,visualAnchorConfidence:null,sourceSessionKey:sessionKey(),sourceDeviceKey:deviceKey(),observedFloorId:floorId,observedX:x,observedY:y,floorConsistent:true,placeConsistent:true};}
function sessionKey(){const key='basira-shared-map-session-key';let value=sessionStorage.getItem(key);if(!value){value=crypto.randomUUID();sessionStorage.setItem(key,value);}return value;}
function deviceKey(){const key='basira-shared-map-device-key';let value=localStorage.getItem(key);if(!value){value=crypto.randomUUID();localStorage.setItem(key,value);}return value;}
export function updatePolicy(changes:{action:string;entity_type:string}[],navigating:boolean):'APPLY'|'DEFER'|'URGENT'{if(!navigating)return 'APPLY';return changes.some(change=>change.entity_type==='MAP_EDGE'&&['CLOSE_EDGE','ROLLBACK'].includes(change.action))?'URGENT':'DEFER';}
/** Fetches only an approved B1 graph when the building version advances. Pending contributions are never a navigation dependency. */
export class SharedMapSyncService {
  async latest(buildingId:string,sinceVersion:number,navigating:boolean):Promise<{version:number;graph:BuildingGraph;policy:'APPLY'|'DEFER'|'URGENT'}|null>{
    const metadata=await sharedMapApi.sync(buildingId,sinceVersion);if(!metadata.changed)return null;
    const graph=await navApi.graph(buildingId);return {version:metadata.version,graph,policy:updatePolicy(metadata.changes,navigating)};
  }
}
