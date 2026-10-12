import type { HorizontalDirection, VisionDetection, VisionObjectType } from '@shared/vision';
import type { VisionCopy } from './scene';

const speechKey='basira-vision-object-speech-v1';
export function getObjectSpeechEnabled(){try{return localStorage.getItem(speechKey)!=='false';}catch{return true;}}
export function saveObjectSpeechEnabled(value:boolean){try{localStorage.setItem(speechKey,String(value));}catch{/* Storage is optional. */}return value;}

type Track={type:VisionObjectType;direction:HorizontalDirection;x:number;y:number;area:number;firstArea:number;firstAt:number;lastAt:number;seen:number;announcedDirection:HorizontalDirection|null;announcedAt:number;approachAt:number};
const excluded=new Set<VisionObjectType>(['STAIRS_UP','STAIRS_DOWN','STAIRS_UNCERTAIN','DROP_OFF','DROP_OFF_UNCERTAIN','UNKNOWN_OBSTACLE']);
const central=(direction:HorizontalDirection)=>direction==='FRONT'?2:direction==='FRONT_LEFT'||direction==='FRONT_RIGHT'?1:0;

/** Frame-to-frame identity and speech pacing are independent of metric depth. */
export class ObjectSpeechTracker {
  private tracks:Track[]=[];
  private lastSpeech=Number.NEGATIVE_INFINITY;
  constructor(private readonly copy:VisionCopy,private readonly minimumGapMs=4500,private readonly approachPhrase=(name:string,direction:string)=>`${name} ${direction} يبدو أكبر في الصورة، وقد تكون تقترب منه.`){}
  reset(){this.tracks=[];this.lastSpeech=Number.NEGATIVE_INFINITY;}
  observe(detections:readonly VisionDetection[],now:number,announce:(text:string)=>boolean):string|null {
    this.tracks=this.tracks.filter(track=>now-track.lastAt<5000);
    const used=new Set<Track>();
    for(const detection of detections){
      if(detection.confidence<.65||excluded.has(detection.type)||detection.source==='SEGMENTATION')continue;
      const box=detection.boundingBox,x=box.x+box.width/2,y=box.y+box.height/2,area=box.width*box.height;
      if(area<=0)continue;
      const track=this.tracks.filter(item=>!used.has(item)&&item.type===detection.type&&now-item.lastAt<3000)
        .sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];
      if(track&&Math.hypot(track.x-x,track.y-y)<.23){
        track.x=x;track.y=y;track.area=area;track.direction=detection.horizontalDirection;track.lastAt=now;track.seen++;used.add(track);
      }else{
        const created:Track={type:detection.type,direction:detection.horizontalDirection,x,y,area,firstArea:area,firstAt:now,lastAt:now,seen:1,announcedDirection:null,announcedAt:Number.NEGATIVE_INFINITY,approachAt:Number.NEGATIVE_INFINITY};
        this.tracks.push(created);used.add(created);
      }
    }
    if(now-this.lastSpeech<this.minimumGapMs)return null;
    const candidates=this.tracks.filter(track=>track.seen>=2&&now-track.lastAt<1200&&track.announcedDirection!==track.direction&&now-track.announcedAt>=9000)
      .sort((a,b)=>central(b.direction)-central(a.direction)||b.area-a.area);
    if(candidates.length){
      const selected=candidates.slice(0,2);
      const text=`${selected.map(track=>`${this.copy.object[track.type]} ${this.copy.direction[track.direction]}`).join('، ')}.`;
      if(!announce(text))return null;
      for(const track of selected){track.announcedDirection=track.direction;track.announcedAt=now;}
      this.lastSpeech=now;return text;
    }
    // Apparent growth is only a visual cue. Camera motion and zoom are unknown.
    const growing=this.tracks.find(track=>track.seen>=3&&track.announcedDirection!==null&&central(track.direction)>0&&
      now-track.firstAt>=1500&&track.area>=track.firstArea*1.8&&now-track.approachAt>=20000);
    if(growing){
      const text=this.approachPhrase(this.copy.object[growing.type],this.copy.direction[growing.direction]);
      if(!announce(text))return null;
      growing.approachAt=now;growing.firstArea=growing.area;this.lastSpeech=now;return text;
    }
    return null;
  }
}
