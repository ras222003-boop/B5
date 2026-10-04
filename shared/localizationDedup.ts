import type { MapSuggestion } from './localization';
import { DEFAULT_LOCALIZATION_CONFIG } from './localization';

/** B3 map suggestion deduplication, shared with B5's contribution resolver. */
export class MapDeduplicationService {
  constructor(private readonly radiusMeters:number=DEFAULT_LOCALIZATION_CONFIG.dedupRadiusMeters){}
  duplicate(candidate:Pick<MapSuggestion,'type'|'floorId'|'x'|'y'|'name'|'placeId'>,existing:Pick<MapSuggestion,'type'|'floorId'|'x'|'y'|'name'|'placeId'>[]):boolean {
    const normalized=(value:string|null)=>value?.normalize('NFKC').trim().toLocaleLowerCase()??'';
    return existing.some(item=>{
      if(item.floorId!==candidate.floorId)return false;
      if(item.placeId&&candidate.placeId&&item.placeId===candidate.placeId)return true;
      if(item.type!==candidate.type)return false;
      const named=normalized(item.name)&&normalized(item.name)===normalized(candidate.name);
      const nearby=item.x!==null&&item.y!==null&&candidate.x!==null&&candidate.y!==null&&Math.hypot(item.x-candidate.x,item.y-candidate.y)<=this.radiusMeters;
      return Boolean(named&&nearby||named&&candidate.x===null||nearby&&(!item.name||!candidate.name));
    });
  }
}
