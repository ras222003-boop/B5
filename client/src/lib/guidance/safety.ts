import type { NavigationRoute, RouteConstraint, RouteSafetyState } from '@shared/guidance';
import type { LocalizationEstimate } from '@shared/localization';
import type { ObstacleDetection, SceneDescription, VisionDetection } from '@shared/vision';
import type { GuidanceLanguage } from './instructions';
import type { ArabicStyle } from '@shared/speech';

const messages={
  ar:{unknown:'الرؤية أو الموقع غير مؤكدين حاليًا.',danger:'تنبيه، قد يوجد خطر أمامك. توقف وتحقق من محيطك.',obstacle:'تنبيه، يوجد عائق محتمل أمامك.',blocked:'المنطقة أمامك تبدو محجوبة. توقف وتحقق.',heading:'اتجاه الكاميرا لا يطابق اتجاه المسار الحالي.',pathUnknown:'حالة الممر أمامك غير مؤكدة.',clear:'لم يتم رصد عائق موثوق على المسار الحالي.'},
  'ar-SA':{unknown:'الرؤية أو الموقع غير مؤكدين الآن.',danger:'وقف. ممكن فيه خطر قدامك. تأكد من المكان حولك.',obstacle:'انتبه. ممكن فيه عائق قدامك.',blocked:'وقف. الطريق قدامك يبدو مسدودًا. تأكد قبل المتابعة.',heading:'اتجاه الكاميرا مختلف عن المسار.',pathUnknown:'حالة الطريق قدامك غير مؤكدة.',clear:'ما رصدت عائقًا مؤكدًا على المسار.'},
  en:{unknown:'Vision or location is uncertain right now.',danger:'Warning, a hazard may be ahead. Stop and check your surroundings.',obstacle:'Warning, there may be an obstacle ahead.',blocked:'The area ahead appears blocked. Stop and check.',heading:'The camera heading does not match the current route.',pathUnknown:'The path ahead is uncertain.',clear:'No reliable obstacle was detected on the current visible route.'},
  'zh-CN':{unknown:'目前视觉或位置不确定。',danger:'警告，前方可能有危险。请停下并确认周围情况。',obstacle:'警告，前方可能有障碍物。',blocked:'前方区域似乎受阻。请停下并确认。',heading:'相机朝向与当前路线不一致。',pathUnknown:'前方通道情况不确定。',clear:'当前可见路线没有检测到可靠的障碍物。'},
} as const;

export function hazardRank(object:VisionDetection):number {
  if(object.type==='DROP_OFF'||object.type==='DROP_OFF_UNCERTAIN'||object.type==='STAIRS_DOWN'||object.type==='STAIRS_UNCERTAIN')return 8;
  if(object.type==='VEHICLE')return 7;
  if(object.approximateDistance?.source!=='MONOCULAR_ESTIMATE'&&object.approximateDistance?.confidence!==undefined&&object.approximateDistance.confidence>=.7&&object.approximateDistance.distanceMeters<1)return 6;
  if(object.type==='BARRIER')return 5;
  if(object.type==='COLUMN'||object.type==='UNKNOWN_OBSTACLE')return 4;
  if(['PERSON','CHAIR','TABLE','CART','BOX'].includes(object.type))return 3;
  return 0;
}
export interface SafetyDecision {state:RouteSafetyState;hazard:VisionDetection|null;priority:number;message:string;edgeId:string|null}
export class NavigationSafetyFusion {
  private seen=new Map<string,{count:number;at:number}>();
  constructor(private language:GuidanceLanguage='ar',private arabicStyle:ArabicStyle='MSA'){}
  setLanguage(value:GuidanceLanguage){this.language=value;}
  setArabicStyle(value:ArabicStyle){this.arabicStyle=value;}
  evaluate(route:NavigationRoute|null,edgeIndex:number,location:LocalizationEstimate|null,scene:SceneDescription|null,now=Date.now()):SafetyDecision {
    const t=this.language==='ar'&&this.arabicStyle==='SAUDI'?messages['ar-SA']:messages[this.language];
    if(!scene||now-scene.capturedAt>10_000||!location||location.state!=='TRACKING')return {state:'ROUTE_UNCERTAIN',hazard:null,priority:0,message:t.unknown,edgeId:null};
    const from=route?.orderedNodes[edgeIndex],to=route?.orderedNodes[edgeIndex+1];
    const expected=from&&to&&from.floorId===to.floorId?((Math.atan2(to.x-from.x,to.y-from.y)*180/Math.PI)%360+360)%360:null;
    const aligned=expected!==null&&expected!==undefined&&location.headingDegrees!==null&&Math.abs(((location.headingDegrees-expected+540)%360)-180)<=70;
    const forward=scene.objects.filter(o=>o.horizontalDirection==='FRONT'||o.horizontalDirection==='FRONT_LEFT'||o.horizontalDirection==='FRONT_RIGHT').sort((a,b)=>hazardRank(b)-hazardRank(a));
    const hazard=forward.find(o=>hazardRank(o)>=3)??null;
    const edgeId=aligned?route?.orderedEdges[edgeIndex]?.id??null:null;
    if(hazard){
      const key=`${edgeId??'none'}:${hazard.trackId??hazard.type}`;
      const previous=this.seen.get(key);
      const count=previous&&now-previous.at<8_000?previous.count+1:1;
      this.seen.set(key,{count,at:now});
      return {state:hazardRank(hazard)>=5||count>=2?'ROUTE_BLOCKED':'ROUTE_UNCERTAIN',hazard,priority:hazardRank(hazard),message:hazardRank(hazard)>=7?t.danger:t.obstacle,edgeId};
    }
    if(scene.walkableArea?.pathAhead==='BLOCKED'){
      if(edgeId){const key=`${edgeId}:PATH`;const previous=this.seen.get(key);this.seen.set(key,{count:previous&&now-previous.at<8_000?previous.count+1:1,at:now});}
      return {state:'ROUTE_BLOCKED',hazard:null,priority:5,message:t.blocked,edgeId};
    }
    if(!aligned)return {state:'ROUTE_UNCERTAIN',hazard:null,priority:0,message:t.heading,edgeId:null};
    if(scene.walkableArea?.pathAhead!=='CLEAR'||scene.walkableArea.confidence<.55)return {state:'ROUTE_UNCERTAIN',hazard:null,priority:0,message:t.pathUnknown,edgeId};
    return {state:'ROUTE_CLEAR',hazard:null,priority:0,message:t.clear,edgeId};
  }
  persistent(decision:SafetyDecision,now=Date.now()):boolean {
    if(!decision.edgeId)return false;
    const seen=this.seen.get(`${decision.edgeId}:${decision.hazard?.trackId??decision.hazard?.type??'PATH'}`);
    return !!seen&&seen.count>=3&&now-seen.at<8_000;
  }
}
export class TemporaryRouteConstraints {
  private constraints:RouteConstraint[]=[];
  add(edgeId:string,kind:RouteConstraint['kind'],now=Date.now(),ttlMs=90_000){this.constraints=this.active(now).filter(c=>c.edgeId!==edgeId);this.constraints.push({edgeId,kind,createdAt:now,expiresAt:now+ttlMs});}
  active(now=Date.now()){this.constraints=this.constraints.filter(c=>c.expiresAt>now);return [...this.constraints];}
  clear(){this.constraints=[];}
}
