import type { SceneDescription, VisionDetection, VisionObjectType } from '@shared/vision';
import type { GuidanceLanguage } from './instructions';

const labels: Record<GuidanceLanguage, Partial<Record<VisionObjectType, string>>> = {
  ar: { PERSON:'شخص', CHAIR:'كرسي', TABLE:'طاولة', DOOR:'باب', WALL:'جدار', COLUMN:'عمود', ELEVATOR:'مصعد', VEHICLE:'مركبة', BICYCLE:'دراجة', BARRIER:'حاجز', CORRIDOR:'ممر', ENTRANCE:'مدخل', EXIT:'مخرج', STAIRS_UP:'درج صاعد', STAIRS_DOWN:'درج نازل', STAIRS_UNCERTAIN:'درج غير واضح الاتجاه', DROP_OFF:'حافة هابطة', DROP_OFF_UNCERTAIN:'حافة هابطة محتملة' },
  en: { PERSON:'person', CHAIR:'chair', TABLE:'table', DOOR:'door', WALL:'wall', COLUMN:'column', ELEVATOR:'elevator', VEHICLE:'vehicle', BICYCLE:'bicycle', BARRIER:'barrier', CORRIDOR:'corridor', ENTRANCE:'entrance', EXIT:'exit', STAIRS_UP:'ascending stairs', STAIRS_DOWN:'descending stairs', STAIRS_UNCERTAIN:'stairs of uncertain direction', DROP_OFF:'drop-off', DROP_OFF_UNCERTAIN:'possible drop-off' },
  'zh-CN': { PERSON:'行人', CHAIR:'椅子', TABLE:'桌子', DOOR:'门', WALL:'墙', COLUMN:'柱子', ELEVATOR:'电梯', VEHICLE:'车辆', BICYCLE:'自行车', BARRIER:'障碍物', CORRIDOR:'走廊', ENTRANCE:'入口', EXIT:'出口', STAIRS_UP:'上行楼梯', STAIRS_DOWN:'下行楼梯', STAIRS_UNCERTAIN:'方向不明的楼梯', DROP_OFF:'落差', DROP_OFF_UNCERTAIN:'可能的落差' },
};
const directions:Record<GuidanceLanguage,Record<VisionDetection['horizontalDirection'],string>>={
  ar:{LEFT:'على يسارك',FRONT_LEFT:'أمامك إلى اليسار',FRONT:'أمامك',FRONT_RIGHT:'أمامك إلى اليمين',RIGHT:'على يمينك'},
  en:{LEFT:'to your left',FRONT_LEFT:'ahead to your left',FRONT:'ahead',FRONT_RIGHT:'ahead to your right',RIGHT:'to your right'},
  'zh-CN':{LEFT:'在左侧',FRONT_LEFT:'在左前方',FRONT:'在前方',FRONT_RIGHT:'在右前方',RIGHT:'在右侧'},
};
const unavailable:Record<GuidanceLanguage,string>={ar:'لا تتوفر رؤية حديثة كافية لوصف المكان. وجّه الكاميرا أمامك أو تحقق بوسيلتك المعتادة.',en:'A recent reliable camera view is unavailable. Point the camera ahead or check with your usual mobility aid.','zh-CN':'目前没有足够可靠的近期画面。请将摄像头朝前，或使用您惯用的行动辅助方式确认。'};
const missing:Record<GuidanceLanguage,string>={ar:'لم يظهر الشيء المطلوب بثقة في المجال المرئي الآن.',en:'The requested object is not reliably visible right now.','zh-CN':'当前视野中没有可靠识别到所找物体。'};
const forward=new Set<VisionDetection['horizontalDirection']>(['FRONT_LEFT','FRONT','FRONT_RIGHT']);
const fresh=(scene:SceneDescription|null,now:number)=>scene&&now-scene.capturedAt<=3000&&now>=scene.capturedAt?scene:null;
const useful=(object:VisionDetection)=>object.confidence>=.6&&labels.ar[object.type]!==undefined;
const phrase=(object:VisionDetection,language:GuidanceLanguage)=>`${labels[language][object.type]} ${directions[language][object.horizontalDirection]}`;

export function describeSceneForMobility(scene:SceneDescription|null,scope:'AHEAD'|'AROUND',language:GuidanceLanguage='ar',now=Date.now(),maxObjects=3):string {
  const current=fresh(scene,now);if(!current)return unavailable[language];
  const objects=current.objects.filter(useful).filter(object=>scope==='AROUND'||forward.has(object.horizontalDirection)).slice(0,Math.min(5,Math.max(1,maxObjects)));
  if(!objects.length)return scope==='AHEAD'
    ? language==='ar'?'لا يوجد وصف موثوق لما أمامك الآن؛ هذا لا يعني أن الطريق خالٍ من العوائق.':language==='en'?'No reliable description is available ahead; this does not mean the path is clear.':'目前没有可靠的前方描述；这不表示道路无障碍。'
    : missing[language];
  return objects.map(object=>phrase(object,language)).join(language==='zh-CN'?'、':'، ')+ (language==='zh-CN'?'。':'.');
}

export function findVisibleObject(scene:SceneDescription|null,query:string,language:GuidanceLanguage='ar',now=Date.now()):string {
  const current=fresh(scene,now);if(!current)return unavailable[language];
  const types:VisionObjectType[]=/باب|door|门/i.test(query)?['DOOR']:/مصعد|elevator|lift|电梯/i.test(query)?['ELEVATOR']:/كرسي|chair|椅子/i.test(query)?['CHAIR']:/استقبال|reception/i.test(query)?['TABLE','SIGN']:[];
  const object=current.objects.filter(useful).filter(item=>types.includes(item.type)).sort((a,b)=>b.confidence-a.confidence)[0];
  if(!object)return missing[language];
  if(/استقبال|reception/i.test(query))return language==='ar'?`قد يكون مكتب استقبال ${directions.ar[object.horizontalDirection]}؛ لا أستطيع تأكيد وظيفته من الصورة وحدها.`:language==='en'?`There may be a reception desk ${directions.en[object.horizontalDirection]}; the camera cannot confirm its function alone.`:`${directions['zh-CN'][object.horizontalDirection]}可能有接待台；仅凭画面无法确认。`;
  return phrase(object,language)+(language==='zh-CN'?'。':'.');
}
