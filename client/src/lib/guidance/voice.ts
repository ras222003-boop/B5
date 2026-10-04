import type { NavigationIntent } from '@shared/guidance';
import type { GuidanceLanguage } from './instructions';
import { speechEngine, speechInput } from '@/lib/speechEngine';

const normalize=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[ًٌٍَُِّْـ،؟.!]/g,' ').replace(/\s+/g,' ').trim();
/** Token/phrase intent matching tolerates wake words, filler and common synonyms. */
export class NavigationIntentService {
  parse(raw:string):NavigationIntent {
    const text=normalize(raw).replace(/^(بصيرة|basira|hey basira|嗨 بصيرة)\s*/,'');
    if(/(أين أنا|وين أنا|موقعي|where am i|my location|我在哪里)/i.test(text))return {type:'WHERE_AM_I'};
    if(/^(فهمت|موافق|i understand|understood|我明白了)$/i.test(text))return {type:'ACKNOWLEDGE_DISCLAIMER'};
    if(/(ابدأ التوجيه|ابدئي التوجيه|ابدأ التنقل|start navigation|start guidance|开始导航)/i.test(text))return {type:'START_NAVIGATION'};
    if(/(وصلت إلى الوجهة|أكد الوصول|confirm arrival|已到达目的地)/i.test(text))return {type:'CONFIRM_ARRIVAL'};
    const at=text.match(/(?:أنا عند|انا عند|موقعي عند|i am at|i'm at|我在)\s+(.+)/i);if(at)return {type:'CONFIRM_LOCATION',query:at[1].trim()};
    if(/(ماذا أمامي|ايش أمامي|وش قدامي|what.?s ahead|what is ahead|前面有什么)/i.test(text))return {type:'WHAT_IS_AHEAD'};
    if(/(أعد التعليمات|كرر التعليمات|عيدي التعليمات|repeat|再说一遍)/i.test(text))return {type:'REPEAT_INSTRUCTION'};
    if(/(أوقف التنقل|أوقف الملاحة|توقف مؤقتا|pause navigation|pause guidance|暂停导航)/i.test(text))return {type:'PAUSE_NAVIGATION'};
    if(/(تابع التنقل|استأنف|كمل الطريق|resume navigation|continue guidance|继续导航)/i.test(text))return {type:'RESUME_NAVIGATION'};
    if(/(إلغاء التنقل|الغ التنقل|انهي التنقل|cancel navigation|stop navigation|结束导航)/i.test(text))return {type:'CANCEL_NAVIGATION'};
    if(/(غير المسار|غيّر المسار|طريق آخر|reroute|change route|重新规划)/i.test(text))return {type:'REROUTE'};
    const save=text.match(/(?:احفظ|سجل|save)(?: هذا)?(?: المكان| place)?(?: باسم| as| named)\s+(.+)/i);if(save)return {type:'SAVE_PLACE',name:save[1].trim()};
    const nearest=text.match(/(?:أين|وين|ما|where is|find|找到)(?: ال| أقرب| nearest| closest)*\s*(مصعد|مخرج|دورة مياه|حمام|elevator|exit|restroom|lift|电梯|出口|洗手间)/i);if(nearest)return {type:'NEAREST_PLACE',query:nearest[1]};
    const go=text.match(/(?:خذيني|خذني|اذهب|وديني|أريد الذهاب|وجهني|navigate|take me|go to|带我去|导航到)\s*(?:إلى|الى|لـ|to)?\s*(.+)/i);if(go)return {type:'NAVIGATE_TO',query:go[1].trim()};
    return {type:'UNKNOWN'};
  }
}
export type AnnouncementPriority='CRITICAL_SAFETY'|'HIGH_SAFETY'|'RELOCALIZATION'|'TURN'|'ARRIVAL'|'INFORMATION';
const rank:Record<AnnouncementPriority,number>={CRITICAL_SAFETY:6,HIGH_SAFETY:5,RELOCALIZATION:4,TURN:3,ARRIVAL:2,INFORMATION:1};
export interface Announcement {text:string;priority:AnnouncementPriority;key:string;at:number;force?:boolean}
export class AnnouncementPriorityQueue {
  private pending:Announcement[]=[];private current:Announcement|null=null;private last=new Map<string,number>();
  constructor(private readonly speak:(item:Announcement,done:()=>void)=>void,private readonly interrupt:()=>void,private readonly cooldownMs=5000){}
  enqueue(item:Announcement){
    if(!item.force&&item.at-(this.last.get(item.key)??-Infinity)<this.cooldownMs)return false;
    this.last.set(item.key,item.at);
    if(this.current&&rank[item.priority]>rank[this.current.priority]){this.interrupt();this.current=null;this.pending=this.pending.filter(p=>rank[p.priority]>=rank[item.priority]);}
    this.pending.push(item);this.pending.sort((a,b)=>rank[b.priority]-rank[a.priority]||a.at-b.at);this.next();return true;
  }
  private next(){if(this.current||!this.pending.length)return;const item=this.pending.shift()!;this.current=item;this.speak(item,()=>{if(this.current===item){this.current=null;this.next();}});}
  clear(){this.interrupt();this.current=null;this.pending=[];this.last.clear();}
  get active(){return this.current;}
}
/** Navigation shares the premium audio player and its browser fallback with the rest of Basira. */
export class VoiceNavigationService {
  readonly queue:AnnouncementPriorityQueue;
  private muted=false;
  constructor(private language:GuidanceLanguage='ar'){
    this.queue=new AnnouncementPriorityQueue((item,done)=>this.speakNow(item,done),()=>this.stop());
  }
  setLanguage(value:GuidanceLanguage){this.language=value;}
  setScreenReaderMode(enabled:boolean){this.muted=enabled;if(enabled)this.queue.clear();}
  announce(text:string,priority:AnnouncementPriority,key=text,force=false){return this.queue.enqueue({text,priority,key,at:Date.now(),force});}
  prefetch(key:string,text:string){speechEngine.prefetch(key,speechInput(text,this.language,'NAVIGATION',1.05));}
  invalidateRoute(){speechEngine.clearPrefetch();}
  private speakNow(item:Announcement,done:()=>void){
    if(this.muted){done();return;}
    const context=item.priority==='CRITICAL_SAFETY'||item.priority==='HIGH_SAFETY'?'SAFETY':'NAVIGATION';
    void speechEngine.enqueue(speechInput(item.text,this.language,context,context==='SAFETY'?1:1.05),item.priority,0,item.key).then(done);
  }
  stop(){speechEngine.stop();}
  close(){this.queue.clear();speechEngine.clearPrefetch();}
}
export class HapticNavigationService {
  pulse(kind:'CONTINUE'|'RIGHT'|'LEFT'|'HAZARD'|'STOP'|'ARRIVAL'){
    if(typeof navigator==='undefined'||!('vibrate'in navigator))return false;
    const pattern:Record<typeof kind,number[]>={CONTINUE:[70],RIGHT:[70,70,170],LEFT:[170,70,70],HAZARD:[240,80,240,80,240],STOP:[350],ARRIVAL:[90,80,90,80,260]};
    try{return navigator.vibrate(pattern[kind]);}catch{return false;}
  }
}

interface RecognitionLike {lang:string;continuous:boolean;interimResults:boolean;onresult:((event:{results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>;resultIndex:number})=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void}
/** Starts only from an explicit control; the browser handles the first microphone permission. */
export class VoiceCommandListener {
  private recognition:RecognitionLike|null=null;
  private active=false;
  private restarting:number|null=null;
  constructor(private language:GuidanceLanguage,private readonly onCommand:(text:string)=>void,private readonly onStatus:(text:string)=>void){}
  start(){
    const Constructor=(window as Window & {SpeechRecognition?:new()=>RecognitionLike;webkitSpeechRecognition?:new()=>RecognitionLike}).SpeechRecognition??(window as Window & {webkitSpeechRecognition?:new()=>RecognitionLike}).webkitSpeechRecognition;
    if(!Constructor){this.onStatus('التعرف الصوتي غير متاح في هذا المتصفح. استخدم الأزرار أو البحث.');return false;}
    this.active=true;
    try{
      const recognition=new Constructor();this.recognition=recognition;recognition.lang=this.language==='ar'?'ar-SA':this.language==='en'?'en-US':'zh-CN';recognition.continuous=true;recognition.interimResults=false;
      recognition.onresult=event=>{for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)this.onCommand(event.results[i][0].transcript);};
      recognition.onerror=event=>{if(['not-allowed','service-not-allowed','audio-capture'].includes(event.error)){this.active=false;this.onStatus('تعذر استخدام الميكروفون. يمكنك الاستمرار بالأزرار.');}else if(event.error==='network'){this.active=false;this.onStatus('التعرف الصوتي يحتاج اتصالًا في هذا المتصفح. استخدم الأزرار.');}};
      recognition.onend=()=>{if(this.active)this.restarting=window.setTimeout(()=>{try{recognition.start();}catch{this.active=false;this.onStatus('توقف الاستماع الصوتي. شغّله مجددًا من الزر.');}},700);};
      recognition.start();this.onStatus('الاستماع للأوامر مفعل.');return true;
    }catch{this.active=false;this.onStatus('تعذر بدء التعرف الصوتي.');return false;}
  }
  stop(){this.active=false;if(this.restarting!==null)window.clearTimeout(this.restarting);this.restarting=null;try{this.recognition?.stop();}catch{}this.recognition=null;}
  get listening(){return this.active;}
}
