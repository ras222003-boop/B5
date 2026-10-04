import type { OCRDetection, PlaceCandidate, RecognizedPlace } from '@shared/vision';
import type { Place } from '@shared/navigation';
import { navApi } from '@/lib/navigationApi';

const arabicDigits='٠١٢٣٤٥٦٧٨٩', persianDigits='۰۱۲۳۴۵۶۷۸۹';
export function normalizePlaceText(text:string) {
  return text.normalize('NFKC').replace(/[٠-٩]/g,c=>String(arabicDigits.indexOf(c))).replace(/[۰-۹]/g,c=>String(persianDigits.indexOf(c)))
    .replace(/[\u064B-\u065F]/g,'').replace(/[^A-Za-z0-9\u0600-\u06FF\u4E00-\u9FFF]+/g,' ').trim().toLowerCase();
}
const relevant = /(?:قاعة|غرفة|مكتب|قسم|مختبر|مصعد|مخرج|مدخل|صيدلية|عيادة|طوارئ|استقبال|\b(?:room|classroom|office|department|lab|elevator|lift|exit|entrance|pharmacy|clinic|emergency|reception)\b|教室|房间|办公室|出口|入口|药房|电梯|诊所|接待|^\d{2,4}$)/i;
export function isNavigationText(text:string) { return relevant.test(normalizePlaceText(text)); }
export function suggestedType(text:string):PlaceCandidate['suggestedType'] {
  const value=normalizePlaceText(text);
  if (/(قاعة|room|classroom|教室|房间|^\d{2,4}$)/i.test(value)) return 'CLASSROOM';
  if (/(مكتب|office|办公室)/i.test(value)) return 'OFFICE';
  if (/(مصعد|elevator|lift|电梯)/i.test(value)) return 'ELEVATOR';
  if (/(مخرج|exit|出口)/i.test(value)) return 'EXIT';
  if (/(مدخل|entrance|入口)/i.test(value)) return 'ENTRANCE';
  if (/(صيدلية|pharmacy|药房)/i.test(value)) return 'PHARMACY';
  if (/(عيادة|clinic|诊所)/i.test(value)) return 'CLINIC';
  return 'OTHER';
}
export function matchPlace(text:string, places:Place[]):Place|null {
  const normalized=normalizePlaceText(text);
  if (!normalized) return null;
  const number=normalized.match(/\b\d{2,4}\b/)?.[0];
  const scored=places.map(place=>{
    const names=[place.name,place.roomNumber??'',...place.aliases].map(normalizePlaceText);
    let score=names.some(candidate=>candidate===normalized)?3:names.some(candidate=>candidate.includes(normalized)||normalized.includes(candidate)&&candidate.length>=3)?2:0;
    if (!score&&number&&place.roomNumber&&normalizePlaceText(place.roomNumber)===number) score=1;
    return {place,score};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
  if(scored.length>1&&scored[0].score===scored[1].score&&scored[0].place.id!==scored[1].place.id)return null;
  return scored[0]?.place??null;
}

/** Uses B1 search; unmatched navigation text stays a private in-memory candidate. */
export class VisualPlaceRecognitionService {
  constructor(private readonly buildingId: string|null,private readonly floorId:string|null) {}
  async recognize(reading:OCRDetection):Promise<{place:RecognizedPlace|null;candidate:PlaceCandidate|null}> {
    if (reading.confidence<0.6||!isNavigationText(reading.text)) return {place:null,candidate:null};
    let lookupStatus:PlaceCandidate['lookupStatus']='NOT_FOUND';
    try {
      const normalized=normalizePlaceText(reading.text);
      const queries=[reading.text,normalized,normalized.match(/\b\d{2,4}\b/)?.[0]].filter((item):item is string=>Boolean(item));
      for(const query of Array.from(new Set(queries))) {
        const results=(await navApi.search(query,this.buildingId)).results;
        const places=results.filter(result=>result.kind==='place').map(result=>result.item as Place)
          .filter(place=>!this.floorId||place.floorId===this.floorId);
        const matched=matchPlace(reading.text,places);
        if(matched) return {place:{placeId:matched.id,name:matched.name,buildingId:matched.buildingId,floorId:matched.floorId,confidence:reading.confidence},candidate:null};
      }
    } catch { lookupStatus='UNAVAILABLE'; }
    return {place:null,candidate:{id:crypto.randomUUID(),detectedText:reading.text,suggestedType:suggestedType(reading.text),confidence:reading.confidence,buildingId:this.buildingId,floorId:this.floorId,capturedAt:Date.now(),source:'VISION',reviewStatus:'PENDING',lookupStatus}};
  }
}
