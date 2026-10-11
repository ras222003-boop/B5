import type {Building,Floor,Place} from '@shared/navigation';

/** Landmark enrollment comes ONLY from a vetted institution, not camera text. */
export interface VerifiedVenueTarget {
  targetName:string;
  buildingId:string;
  floorId:string;
  placeId:string;
  reviewedAt:string;
  approvedBy:string;
  targetAssetPath:string;
}
export type VerifiedVenueMatch=Readonly<{
  status:'VERIFIED_LANDMARK_MATCH';
  placeId:string;
  placeName:string;
  buildingId:string;
  floorId:string;
  /** This is not continuous localization or collision safety certification. */
  confidence:'LANDMARK_IDENTIFICATION_ONLY';
}>;

/**
 * A registered, official target can identify a named place. It does NOT prove
 * the user's physical position without a secure on-site enrollment/field test.
 * This function is pure, introduces no new API endpoints or persisted mapping.
 */
export function resolveVettedVenueLandmark(
  detectedName:string,
  enrollments:readonly VerifiedVenueTarget[],
  buildings:readonly Building[],
  floors:readonly Floor[],
  places:readonly Place[],
):VerifiedVenueMatch|null {
  if(!/^[a-z0-9][a-z0-9_-]{3,79}$/.test(detectedName))return null;
  const matching=enrollments.filter(entry=>entry.targetName===detectedName);
  if(matching.length!==1)return null;
  const enrollment=matching[0];
  if(!enrollment.approvedBy.trim() ||
     !Number.isFinite(Date.parse(enrollment.reviewedAt)) ||
     !/^\/ar\/targets\/[a-z0-9_-]+\.json$/.test(enrollment.targetAssetPath))return null;
  const building=buildings.find(item=>item.id===enrollment.buildingId &&
    item.status==='ACTIVE' && item.verificationStatus==='OFFICIAL');
  const floor=floors.find(item=>item.id===enrollment.floorId && item.buildingId===building?.id);
  const place=places.find(item=>item.id===enrollment.placeId &&
    item.buildingId===building?.id && item.floorId===floor?.id &&
    item.verificationStatus==='OFFICIAL' && item.isPublic);
  if(!building || !floor || !place)return null;
  // Avoid mapping raw demo markers to any real building, even if configured by mistake.
  if(detectedName==='basira-lab-entrance')return null;
  return {
    status:'VERIFIED_LANDMARK_MATCH',
    placeId:place.id,placeName:place.name,buildingId:building.id,floorId:floor.id,
    confidence:'LANDMARK_IDENTIFICATION_ONLY',
  };
}
