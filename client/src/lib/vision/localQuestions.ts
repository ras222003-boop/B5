import type {VisionObjectType} from '@shared/vision';
import type {VisionCopy} from './scene';
import {currentPerception,type PerceptionSnapshot} from './perception';

export type LocalAnswer={route:'LOCAL';text:string}|{route:'CLOUD'};
const normalize=(text:string)=>text.replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064b-\u065f]/g,'').trim();
const names:Partial<Record<VisionObjectType,string[]>>={CHAIR:['كرسي','كراسي'],TABLE:['طاوله','طاولة','طاولات'],CAR:['سياره','سيارة','سيارات'],PERSON:['شخص','اشخاص'],BUS:['حافله','حافلة'],BICYCLE:['دراجه','دراجة'],DOOR:['باب','ابواب'],SOFA:['اريكه','أريكة','كنبه','كنبة'],BED:['سرير'],BACKPACK:['حقيبة ظهر','حقيبه ظهر'],SUITCASE:['حقيبة سفر','حقيبه سفر'],BOX:['صندوق'],WALL:['جدار'],COLUMN:['عمود']};
export type VisionCommand='OBJECTS_ON'|'OBJECTS_OFF'|'ALERTS_ON'|'ALERTS_OFF'|'RADAR_ON'|'RADAR_OFF'|'REPEAT'|'STOP';
export function localVoiceCommand(text:string):VisionCommand|null{
 const value=normalize(text).replace(/[.!؟،]/g,'');
 const commands:Record<string,VisionCommand>={'شغل وصف الاشياء':'OBJECTS_ON','اوقف وصف الاشياء':'OBJECTS_OFF','شغل التنبيهات التجريبية':'ALERTS_ON','اوقف التنبيهات التجريبية':'ALERTS_OFF','شغل الخريطة':'RADAR_ON','اوقف الخريطة':'RADAR_OFF','اعد اخر وصف':'REPEAT','اوقف الكاميرا':'STOP'};
 return commands[value]??null;
}
/** Local observations answer direct questions before any auth, image capture or network call. */
export function answerLocalQuestion(question:string,snapshot:PerceptionSnapshot|null,now:number,copy:VisionCopy,previous:PerceptionSnapshot|null=null):LocalAnswer{
 const q=normalize(question);
 if(/متر|امتار|المسافه|المسافة|كم يبعد/.test(q))return {route:'LOCAL',text:'المسافة غير معروفة؛ لا يتوفر هنا قياس موثوق للمسافة.'};
 if(/لون|احمر|ازرق|اخضر|ابيض|اسود|يفعل|يحمل|مكتوب|اقرا|نص|فوق الطاول|تفصيل|بالتفصيل|ما هذا الشي|ماهو هذا|ما هو هذا/.test(q))return {route:'CLOUD'};
 const type=(Object.entries(names) as [VisionObjectType,string[]][]).find(([,terms])=>terms.some(term=>q.includes(normalize(term))))?.[0];
 const stairs=/درج|سلم|سلالم/.test(q),ground=/الارض|اسفل|السفلي/.test(q),approach=/اقترب|اقتراب|تقترب/.test(q),changes=/تغير/.test(q);
 const right=/يمين/.test(q),left=/يسار/.test(q),general=/ماذا|ما الموجود|ماذا يوجد|ما الذي|امام الكاميرا/.test(q);
 if(!type&&!stairs&&!ground&&!approach&&!changes&&!right&&!left&&!general)return {route:'CLOUD'};
 const current=currentPerception(snapshot,now);
 if(!current)return {route:'LOCAL',text:'لا توجد قراءة حديثة للكاميرا. شغّل التحليل وانتظر إطارًا جديدًا.'};
 if(approach){const cues=current.approach.filter(item=>item.state==='POSSIBLE_APPROACH'||item.state==='STRONG_APPROACH');
   return {route:'LOCAL',text:cues.length?'توجد مؤشرات اقتراب بصرية تجريبية. لا يمكن تحديد احتمال اصطدام أو مسار آمن.':'لا تتوفر أدلة حركة كافية لتحديد الاقتراب. هذا لا يعني غياب العوائق.'};}
 if(stairs){const found=current.ground.observations.some(item=>item.kind==='VISIBLE_STAIRS');
   return {route:'LOCAL',text:found?'تظهر منطقة درج محتملة؛ لم يتأكد تصنيفها ولا اتجاه الدرج.':'لم تُرصد درجات في القراءة الحالية؛ لا يمكن تأكيد عدم وجودها.'};}
 if(ground){const observations=current.ground.observations;
   return {route:'LOCAL',text:observations.length?observations.slice(0,3).map(item=>item.labelAr).join(' '):'لا توجد ملاحظة أرضية مؤكدة حاليًا. الجزء السفلي من الصورة لا يثبت أن جسمًا على الأرض.'};}
 let objects=current.observations.filter(item=>item.validity==='CURRENT'&&item.detection.confidence>=.65).map(item=>item.detection);
 if(changes){if(!previous||now-previous.capturedAt>10_000||previous.capturedAt>=current.capturedAt)return {route:'LOCAL',text:'لا توجد مقارنة حديثة كافية بين مشهدين.'};
   const before=new Set(previous.observations.map(item=>item.detection.trackId));
   objects=objects.filter(item=>item.trackId&&!before.has(item.trackId));
   return {route:'LOCAL',text:objects.length?`رُصد الآن: ${objects.slice(0,4).map(item=>copy.object[item.type]).join('، ')}. قد يكون التغير بسبب حركة الكاميرا أو تغير التتبع.`:'لم يرصد التتبع أجسامًا جديدة مؤكدة في المقارنة؛ قد تكون هناك تغيرات لم تُكتشف.'};}
 if(type)objects=objects.filter(item=>item.type===type);
 if(right)objects=objects.filter(item=>['RIGHT','FRONT_RIGHT'].includes(item.horizontalDirection));
 if(left)objects=objects.filter(item=>['LEFT','FRONT_LEFT'].includes(item.horizontalDirection));
 return {route:'LOCAL',text:objects.length?objects.slice(0,5).map(item=>`${copy.object[item.type]} ${copy.direction[item.horizontalDirection]}`).join('، ')+'.':'لم يُرصد المطلوب بثقة كافية في الإطار الحالي. هذا لا يثبت عدم وجوده.'};
}
