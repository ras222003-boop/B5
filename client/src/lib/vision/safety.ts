import type { BoundingBox, DistanceBand, HorizontalDirection, ObstacleDetection, RiskLevel, VerticalPosition, VisionDetection, VisionObjectType } from '@shared/vision';
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
  if (!depth || depth.source === 'MONOCULAR_ESTIMATE' || depth.confidence < config.minDepthConfidence || !Number.isFinite(depth.distanceMeters) || depth.distanceMeters <= 0) return 'UNKNOWN';
  if (depth.distanceMeters < config.distanceMeters.veryClose) return 'VERY_CLOSE';
  if (depth.distanceMeters < config.distanceMeters.close) return 'CLOSE';
  if (depth.distanceMeters < config.distanceMeters.medium) return 'MEDIUM';
  return 'FAR';
}
export function metricDistanceMeters(detection: VisionDetection, minConfidence = 0.7): number | null {
  const depth = detection.approximateDistance;
  if (!depth || depth.source === 'MONOCULAR_ESTIMATE' || depth.confidence < minConfidence || !Number.isFinite(depth.distanceMeters) || depth.distanceMeters <= 0) return null;
  return depth.distanceMeters;
}
const riskRank: Record<RiskLevel, number> = { INFORMATION: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export function rankRisk(risk: RiskLevel) { return riskRank[risk]; }
const central = (d: VisionDetection) => ['FRONT_LEFT','FRONT','FRONT_RIGHT'].includes(d.horizontalDirection);
const vehicles = new Set<VisionObjectType>(['VEHICLE', 'CAR', 'BUS', 'TRUCK', 'MOTORCYCLE']);
const namedObstacles = new Set<VisionObjectType>(['PERSON', 'CHAIR', 'TABLE', 'BICYCLE', 'CART', 'BOX', 'SOFA', 'BED', 'BENCH', 'BACKPACK', 'HANDBAG', 'SUITCASE', 'POTTED_PLANT', 'VEHICLE', 'CAR', 'BUS', 'TRUCK', 'MOTORCYCLE']);

export class BasiraSafetyEngine {
  private alertDistanceMeters: number;
  private readonly previous = new Map<string,{meters:number;at:number}>();
  constructor(private readonly config: VisionConfig) { this.alertDistanceMeters = config.alertDistanceMeters; }
  setAlertDistanceMeters(value: number) {
    this.alertDistanceMeters = Number.isFinite(value) ? Math.max(0.5, Math.min(10, value)) : this.config.alertDistanceMeters;
  }
  classify(detection: VisionDetection): ObstacleDetection {
    const band = distanceBand(detection, this.config);
    const meters=metricDistanceMeters(detection,this.config.minDepthConfidence);
    const key=detection.trackId??`${detection.type}:${detection.horizontalDirection}`;
    const previous=this.previous.get(key);
    const elapsed=previous?(detection.timestamp-previous.at)/1000:0;
    const approachSpeedMps=meters!==null&&previous&&elapsed>=0.15&&elapsed<=3
      ?Math.max(0,Math.min(5,(previous.meters-meters)/elapsed)):0;
    if(meters!==null&&(!previous||detection.timestamp>previous.at))this.previous.set(key,{meters,at:detection.timestamp});
    if(this.previous.size>100)this.previous.forEach((value,id)=>{if(detection.timestamp-value.at>10_000)this.previous.delete(id);});
    const centered = central(detection);
    const metricDistance = metricDistanceMeters(detection, this.config.minDepthConfidence);
    const reliableNear = (band === 'VERY_CLOSE' || band === 'CLOSE') && metricDistance !== null;
    const inRange=metricDistance!==null&&metricDistance<=this.alertDistanceMeters;
    const namedObjectWithinRange = centered && detection.confidence >= 0.65 && inRange;
    let riskLevel: RiskLevel = 'INFORMATION';
    let reason: ObstacleDetection['reason'] = 'TYPE';
    switch (detection.type) {
      case 'STAIRS_DOWN':
      case 'DROP_OFF':
        riskLevel = centered && reliableNear && detection.confidence >= 0.8 ? 'CRITICAL' : 'HIGH';
        reason = band === 'UNKNOWN' ? 'UNCERTAIN' : 'PROXIMITY'; break;
      case 'STAIRS_UP': case 'STAIRS_UNCERTAIN': case 'DROP_OFF_UNCERTAIN':
        riskLevel = 'HIGH'; reason = detection.type.endsWith('UNCERTAIN') ? 'UNCERTAIN' : 'TYPE'; break;
      default:
        if (vehicles.has(detection.type)) {
          riskLevel = namedObjectWithinRange ? (reliableNear && detection.confidence >= 0.75 ? 'CRITICAL' : 'HIGH') : 'MEDIUM';
          reason = metricDistance === null ? 'UNCERTAIN' : 'PROXIMITY'; break;
        }
        if (namedObstacles.has(detection.type)) {
          riskLevel = namedObjectWithinRange ? 'HIGH' : 'MEDIUM';
          reason = metricDistance === null ? 'UNCERTAIN' : 'PROXIMITY'; break;
        }
        riskLevel = 'INFORMATION';
        break;
      case 'BARRIER': case 'COLUMN': case 'WALL':
        riskLevel = centered ? 'HIGH' : 'MEDIUM'; break;
      case 'UNKNOWN_OBSTACLE':
        riskLevel = centered && reliableNear ? 'CRITICAL' : centered ? 'HIGH' : 'MEDIUM'; reason = 'UNCERTAIN'; break;
    }
    if(inRange&&approachSpeedMps>=0.5&&centered&&namedObstacles.has(detection.type)&&detection.confidence>=0.65&&riskLevel==='MEDIUM')riskLevel='HIGH';
    if(inRange&&meters!==null&&meters<=0.75&&centered&&namedObstacles.has(detection.type)&&detection.confidence>=0.75&&riskLevel==='HIGH')riskLevel='CRITICAL';
    return { ...detection, riskLevel, distanceBand: band, reason, approachSpeedMps };
  }
  classifyAll(detections: VisionDetection[]) {
    return detections.map(d => this.classify(d)).sort((a,b) => rankRisk(b.riskLevel)-rankRisk(a.riskLevel) || hazardPriority(b.type)-hazardPriority(a.type) || b.confidence-a.confidence);
  }
}

export function hazardPriority(type:VisionDetection['type']):number {
  if(type==='DROP_OFF'||type==='DROP_OFF_UNCERTAIN'||type==='STAIRS_DOWN')return 7;
  if(['VEHICLE','CAR','BUS','TRUCK','MOTORCYCLE'].includes(type))return 6;
  if(type==='UNKNOWN_OBSTACLE')return 5;
  if(type==='STAIRS_UP'||type==='STAIRS_UNCERTAIN')return 4;
  if(type==='BARRIER'||type==='COLUMN'||type==='WALL')return 3;
  if(['PERSON','CHAIR','TABLE','BICYCLE','CART','BOX','SOFA','BED','BENCH','BACKPACK','HANDBAG','SUITCASE','POTTED_PLANT'].includes(type))return 2;
  return 1;
}

const bandRank: Record<DistanceBand, number> = { UNKNOWN: 0, FAR: 1, MEDIUM: 2, CLOSE: 3, VERY_CLOSE: 4 };
/** Memory-only tracking; a higher risk or newly closer object can interrupt cooldown. */
export class AlertDeduplicator {
  private readonly recent = new Map<string, { at: number; risk: number; band: number; meters:number|null }>();
  constructor(private readonly cooldownMs: number) {}
  shouldAnnounce(event: ObstacleDetection, now: number): boolean {
    const key = event.trackId ?? `${event.type}:${event.horizontalDirection}`;
    const previous = this.recent.get(key);
    const risk = rankRisk(event.riskLevel), band = bandRank[event.distanceBand];
    const meters=event.distanceBand==='UNKNOWN'?null:event.approximateDistance?.distanceMeters??null;
    const closer=previous?.meters!==null&&previous?.meters!==undefined&&meters!==null&&previous.meters-meters>=0.5;
    if (previous && now - previous.at < this.cooldownMs && risk <= previous.risk && band <= previous.band && !closer) return false;
    this.recent.set(key, { at: now, risk, band, meters });
    if (this.recent.size > 100) this.recent.forEach((item,id)=>{if(now-item.at>this.cooldownMs*3)this.recent.delete(id);});
    return true;
  }
  reset() { this.recent.clear(); }
}
