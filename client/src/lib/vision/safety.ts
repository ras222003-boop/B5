import type { BoundingBox, DistanceBand, HorizontalDirection, ObstacleDetection, RiskLevel, VerticalPosition, VisionDetection } from '@shared/vision';
import type { VisionConfig } from './config';

export function classifyDirection(box: BoundingBox): HorizontalDirection {
  const center = box.x + box.width / 2;
  if (center < 0.2) return 'LEFT';
  if (center < 0.4) return 'FRONT_LEFT';
  if (center <= 0.6) return 'FRONT';
  if (center <= 0.8) return 'FRONT_RIGHT';
  return 'RIGHT';
}
export function classifyVertical(box: BoundingBox): VerticalPosition {
  const center = box.y + box.height / 2;
  return center < 1 / 3 ? 'TOP' : center < 2 / 3 ? 'MIDDLE' : 'BOTTOM';
}
export function distanceBand(detection: VisionDetection, config: VisionConfig): DistanceBand {
  const depth = detection.approximateDistance;
  if (!depth || depth.confidence < config.minDepthConfidence || !Number.isFinite(depth.distanceMeters) || depth.distanceMeters <= 0) return 'UNKNOWN';
  if (depth.distanceMeters < config.distanceMeters.veryClose) return 'VERY_CLOSE';
  if (depth.distanceMeters < config.distanceMeters.close) return 'CLOSE';
  if (depth.distanceMeters < config.distanceMeters.medium) return 'MEDIUM';
  return 'FAR';
}
const riskRank: Record<RiskLevel, number> = { INFORMATION: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export function rankRisk(risk: RiskLevel) { return riskRank[risk]; }
const central = (d: VisionDetection) => ['FRONT_LEFT','FRONT','FRONT_RIGHT'].includes(d.horizontalDirection);

export class BasiraSafetyEngine {
  constructor(private readonly config: VisionConfig) {}
  classify(detection: VisionDetection): ObstacleDetection {
    const band = distanceBand(detection, this.config);
    const centered = central(detection);
    const reliableNear = (band === 'VERY_CLOSE' || band === 'CLOSE') && detection.approximateDistance?.source !== 'MONOCULAR_ESTIMATE';
    let riskLevel: RiskLevel = 'INFORMATION';
    let reason: ObstacleDetection['reason'] = 'TYPE';
    switch (detection.type) {
      case 'STAIRS_DOWN':
      case 'DROP_OFF':
        riskLevel = centered && reliableNear && detection.confidence >= 0.8 ? 'CRITICAL' : 'HIGH';
        reason = band === 'UNKNOWN' ? 'UNCERTAIN' : 'PROXIMITY'; break;
      case 'STAIRS_UP': case 'STAIRS_UNCERTAIN': case 'DROP_OFF_UNCERTAIN':
        riskLevel = 'HIGH'; reason = detection.type.endsWith('UNCERTAIN') ? 'UNCERTAIN' : 'TYPE'; break;
      case 'VEHICLE':
        riskLevel = centered && reliableNear && detection.confidence >= 0.75 ? 'CRITICAL' : 'HIGH';
        reason = band === 'UNKNOWN' ? 'UNCERTAIN' : 'PROXIMITY'; break;
      case 'BARRIER': case 'COLUMN': case 'WALL':
        riskLevel = centered ? 'HIGH' : 'MEDIUM'; break;
      case 'UNKNOWN_OBSTACLE':
        riskLevel = centered && reliableNear ? 'CRITICAL' : centered ? 'HIGH' : 'MEDIUM'; reason = 'UNCERTAIN'; break;
      case 'PERSON': case 'CHAIR': case 'TABLE': case 'BICYCLE': case 'CART': case 'BOX':
        riskLevel = centered && reliableNear ? 'HIGH' : 'MEDIUM';
        reason = band === 'UNKNOWN' ? 'UNCERTAIN' : 'PROXIMITY'; break;
      default: riskLevel = 'INFORMATION';
    }
    return { ...detection, riskLevel, distanceBand: band, reason };
  }
  classifyAll(detections: VisionDetection[]) {
    return detections.map(d => this.classify(d)).sort((a,b) => rankRisk(b.riskLevel)-rankRisk(a.riskLevel) || hazardPriority(b.type)-hazardPriority(a.type) || b.confidence-a.confidence);
  }
}

export function hazardPriority(type:VisionDetection['type']):number {
  if(type==='DROP_OFF'||type==='DROP_OFF_UNCERTAIN'||type==='STAIRS_DOWN')return 7;
  if(type==='VEHICLE')return 6;
  if(type==='UNKNOWN_OBSTACLE')return 5;
  if(type==='STAIRS_UP'||type==='STAIRS_UNCERTAIN')return 4;
  if(type==='BARRIER'||type==='COLUMN'||type==='WALL')return 3;
  if(['PERSON','CHAIR','TABLE','BICYCLE','CART','BOX'].includes(type))return 2;
  return 1;
}

const bandRank: Record<DistanceBand, number> = { UNKNOWN: 0, FAR: 1, MEDIUM: 2, CLOSE: 3, VERY_CLOSE: 4 };
/** Memory-only tracking; a higher risk or newly closer object can interrupt cooldown. */
export class AlertDeduplicator {
  private readonly recent = new Map<string, { at: number; risk: number; band: number }>();
  constructor(private readonly cooldownMs: number) {}
  shouldAnnounce(event: ObstacleDetection, now: number): boolean {
    const key = event.trackId ?? `${event.type}:${event.horizontalDirection}`;
    const previous = this.recent.get(key);
    const risk = rankRisk(event.riskLevel), band = bandRank[event.distanceBand];
    if (previous && now - previous.at < this.cooldownMs && risk <= previous.risk && band <= previous.band) return false;
    this.recent.set(key, { at: now, risk, band });
    if (this.recent.size > 100) this.recent.forEach((item,id)=>{if(now-item.at>this.cooldownMs*3)this.recent.delete(id);});
    return true;
  }
  reset() { this.recent.clear(); }
}
