import type { Floor } from '@shared/navigation';
import type { NavigationInstruction, NavigationRoute, ArrivalEvidence } from '@shared/guidance';
import type { HorizontalDirection } from '@shared/vision';
export type GuidanceLanguage='ar'|'en'|'zh-CN';
export type DirectionStyle='LEFT_RIGHT'|'CLOCK';

const copy={
  ar:{start:'ابدأ بالتقدم للأمام',continue:'استمر للأمام',short:'لمسافة قصيرة تقريبًا',near:'حتى نقطة الطريق التالية',turnLeft:'انعطف يسارًا',turnRight:'انعطف يمينًا',elevator:'استخدم المصعد إلى',stairs:'استخدم الدرج إلى',floor:'الطابق',arrived:'وصلت إلى',doorLeft:'الباب على يسارك.',doorRight:'الباب على يمينك.',doorFront:'الباب أمامك.',clock3:'اتجه إلى الساعة الثالثة',clock9:'اتجه إلى الساعة التاسعة'},
  en:{start:'Proceed ahead',continue:'Continue ahead',short:'for a short distance',near:'to the next point',turnLeft:'Turn left',turnRight:'Turn right',elevator:'Take the elevator to',stairs:'Take the stairs to',floor:'floor',arrived:'You have arrived at',doorLeft:'The door is on your left.',doorRight:'The door is on your right.',doorFront:'The door is ahead.',clock3:'Turn toward 3 o’clock',clock9:'Turn toward 9 o’clock'},
  'zh-CN':{start:'开始向前走',continue:'继续向前',short:'走一小段路',near:'到下一个节点',turnLeft:'向左转',turnRight:'向右转',elevator:'乘电梯到',stairs:'走楼梯到',floor:'楼层',arrived:'您已到达',doorLeft:'门在您的左侧。',doorRight:'门在您的右侧。',doorFront:'门在前方。',clock3:'朝三点钟方向转',clock9:'朝九点钟方向转'},
} as const;
const bearing=(a:{x:number;y:number},b:{x:number;y:number})=>((Math.atan2(b.x-a.x,b.y-a.y)*180/Math.PI)%360+360)%360;
const turnDelta=(a:number,b:number)=>((b-a+540)%360)-180;
export class NavigationInstructionGenerator {
  constructor(private readonly floors:Floor[],private readonly lang:GuidanceLanguage='ar',private readonly style:DirectionStyle='LEFT_RIGHT'){}
  forEdge(route:NavigationRoute,index:number,locationConfidence:number):NavigationInstruction {
    const edge=route.orderedEdges[index],from=route.orderedNodes[index],to=route.orderedNodes[index+1],t=copy[this.lang];
    if(!edge||!from||!to)return {id:'end',edgeId:null,nodeId:route.destination.nodeId,text:this.arrival(route.destination.name,null),kind:'ARRIVAL',distanceMeters:null,floorId:route.destination.floorId,confidence:route.confidence};
    const precise=locationConfidence>=.85&&route.confidence>=.8&&edge.distanceMeters>=3;
    const distanceText=precise?(this.lang==='ar'?`نحو ${Math.round(edge.distanceMeters)} أمتار`:this.lang==='en'?`about ${Math.round(edge.distanceMeters)} metres`:`约 ${Math.round(edge.distanceMeters)} 米`):edge.distanceMeters<10?t.short:t.near;
    let kind:NavigationInstruction['kind']=index===0?'START':'CONTINUE',text:string=index===0?`${t.start} ${distanceText}.`:`${t.continue} ${distanceText}.`;
    if(from.floorId!==to.floorId){kind='FLOOR_TRANSITION';const floor=this.floors.find(f=>f.id===to.floorId)?.name??`${t.floor} ${to.floorId}`;text=`${edge.pathType==='ELEVATOR'?t.elevator:t.stairs} ${floor}.`;}
    else if(index>0&&route.orderedNodes[index-1].floorId===from.floorId){
      const previous=route.orderedNodes[index-1];
      const delta=turnDelta(bearing(previous,from),bearing(from,to));
      if(Math.abs(delta)>=40&&Math.abs(delta)<=155){kind=delta>0?'TURN_RIGHT':'TURN_LEFT';text=`${this.style==='CLOCK'?(delta>0?t.clock3:t.clock9):(delta>0?t.turnRight:t.turnLeft)}. ${t.continue} ${distanceText}.`;}
    }
    return {id:`${route.id}:${index}`,edgeId:edge.id,nodeId:from.id,text,kind,distanceMeters:precise?edge.distanceMeters:null,floorId:from.floorId,confidence:Math.min(route.confidence,locationConfidence)};
  }
  arrival(name:string,door:HorizontalDirection|null){const t=copy[this.lang];const side=door==='LEFT'||door==='FRONT_LEFT'?t.doorLeft:door==='RIGHT'||door==='FRONT_RIGHT'?t.doorRight:door==='FRONT'?t.doorFront:'';return `${t.arrived} ${name}. ${side}`.trim();}
}
export function arrived(evidence:ArrivalEvidence){return evidence.nodeProximity&&evidence.localizationConfidence>=.65&&(evidence.visualPlace||evidence.ocrMatch||evidence.manualConfirmation);}
