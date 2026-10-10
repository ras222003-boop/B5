import type { NavigationRoute, RouteConstraint, RouteSafetyState } from '@shared/guidance';
import type { LocalizationEstimate } from '@shared/localization';
import type { HorizontalDirection, SceneDescription, VisionDetection } from '@shared/vision';
import type { GuidanceLanguage } from './instructions';
import type { ArabicStyle } from '@shared/speech';
import { visionMessages } from '@/i18n/locales/vision';

export type SafetyLevel = 'INFO' | 'CAUTION' | 'WARNING' | 'STOP';
export type HeightEvidence = 'POSSIBLE_HEAD_LEVEL' | 'UNSPECIFIED';

const messages = {
  ar: {
    unknown: 'الرؤية أو الموقع غير مؤكدين حاليًا.', heading: 'اتجاه الكاميرا لا يطابق اتجاه المسار الحالي.',
    pathUnknown: 'حالة الممر أمامك غير مؤكدة.', clear: 'لم يُرصد عائق موثوق في الجزء المرئي من المسار.',
    blocked: 'الممر أمامك يبدو محجوبًا. توقف وتحقق.', obstacle: 'عائق محتمل',
    head: 'قد يوجد عائق مرتفع', stop: 'توقف.', warning: 'انتبه.',
    direction: { LEFT: 'على يسارك', FRONT_LEFT: 'أمامك إلى اليسار', FRONT: 'أمامك', FRONT_RIGHT: 'أمامك إلى اليمين', RIGHT: 'على يمينك' },
    object: { PERSON: 'شخص', CHAIR: 'كرسي', TABLE: 'طاولة أو مكتب', DOOR: 'باب', WALL: 'جدار', COLUMN: 'عمود', STAIRS_UP: 'درج صاعد', STAIRS_DOWN: 'درج نازل', STAIRS_UNCERTAIN: 'درج غير محدد الاتجاه', ELEVATOR: 'مصعد', VEHICLE: 'مركبة', CAR: 'سيارة', BUS: 'حافلة', TRUCK: 'شاحنة', MOTORCYCLE: 'دراجة نارية', BICYCLE: 'دراجة', CART: 'عربة', BOX: 'صندوق', BARRIER: 'حاجز', SIGN: 'لافتة', CORRIDOR: 'ممر', ENTRANCE: 'مدخل', EXIT: 'مخرج', UNKNOWN_OBSTACLE: 'جسم غير محدد', DROP_OFF: 'حافة هابطة', DROP_OFF_UNCERTAIN: 'حافة هابطة محتملة' },
    close: 'قريب جدًا', about: (meters: number) => `على بعد نحو ${meters} متر`,
  },
  'ar-SA': {
    unknown: 'الرؤية أو الموقع غير مؤكدين الآن.', heading: 'اتجاه الكاميرا مختلف عن المسار.',
    pathUnknown: 'حالة الطريق قدامك غير مؤكدة.', clear: 'ما رصدت عائقًا مؤكدًا في الجزء الظاهر من الطريق.',
    blocked: 'الطريق قدامك يبدو مسدودًا. وقف وتأكد.', obstacle: 'عائق محتمل',
    head: 'ممكن فيه عائق مرتفع', stop: 'وقف.', warning: 'انتبه.',
    direction: { LEFT: 'على يسارك', FRONT_LEFT: 'قدامك على اليسار', FRONT: 'قدامك', FRONT_RIGHT: 'قدامك على اليمين', RIGHT: 'على يمينك' },
    object: { PERSON: 'شخص', CHAIR: 'كرسي', TABLE: 'طاولة أو مكتب', DOOR: 'باب', WALL: 'جدار', COLUMN: 'عمود', STAIRS_UP: 'درج صاعد', STAIRS_DOWN: 'درج نازل', STAIRS_UNCERTAIN: 'درج غير واضح الاتجاه', ELEVATOR: 'مصعد', VEHICLE: 'مركبة', CAR: 'سيارة', BUS: 'حافلة', TRUCK: 'شاحنة', MOTORCYCLE: 'دراجة نارية', BICYCLE: 'دراجة', CART: 'عربة', BOX: 'صندوق', BARRIER: 'حاجز', SIGN: 'لوحة', CORRIDOR: 'ممر', ENTRANCE: 'مدخل', EXIT: 'مخرج', UNKNOWN_OBSTACLE: 'جسم غير واضح', DROP_OFF: 'حافة نازلة', DROP_OFF_UNCERTAIN: 'حافة نازلة محتملة' },
    close: 'قريب جدًا', about: (meters: number) => `على بعد نحو ${meters} متر`,
  },
  en: {
    unknown: 'Vision or location is uncertain right now.', heading: 'The camera heading does not match the route.',
    pathUnknown: 'The path ahead is uncertain.', clear: 'No reliable obstacle was detected in the visible route segment.',
    blocked: 'The path ahead appears blocked. Stop and check.', obstacle: 'Possible obstacle',
    head: 'There may be a raised obstacle', stop: 'Stop.', warning: 'Caution.',
    direction: { LEFT: 'to your left', FRONT_LEFT: 'ahead to your left', FRONT: 'ahead', FRONT_RIGHT: 'ahead to your right', RIGHT: 'to your right' },
    object: { PERSON: 'person', CHAIR: 'chair', TABLE: 'table or desk', DOOR: 'door', WALL: 'wall', COLUMN: 'column', STAIRS_UP: 'ascending stairs', STAIRS_DOWN: 'descending stairs', STAIRS_UNCERTAIN: 'stairs of uncertain direction', ELEVATOR: 'elevator', VEHICLE: 'vehicle', CAR: 'car', BUS: 'bus', TRUCK: 'truck', MOTORCYCLE: 'motorcycle', BICYCLE: 'bicycle', CART: 'cart', BOX: 'box', BARRIER: 'barrier', SIGN: 'sign', CORRIDOR: 'corridor', ENTRANCE: 'entrance', EXIT: 'exit', UNKNOWN_OBSTACLE: 'unidentified object', DROP_OFF: 'drop-off', DROP_OFF_UNCERTAIN: 'possible drop-off' },
    close: 'very close', about: (meters: number) => `about ${meters} metres away`,
  },
  'zh-CN': {
    unknown: '目前视觉或位置不确定。', heading: '摄像头方向与当前路线不一致。',
    pathUnknown: '前方通道情况不确定。', clear: '当前可见路线没有检测到可靠的障碍物。',
    blocked: '前方通道似乎受阻。请停下确认。', obstacle: '可能有障碍物',
    head: '可能有高处障碍物', stop: '请停下。', warning: '请注意。',
    direction: { LEFT: '在左侧', FRONT_LEFT: '在左前方', FRONT: '在前方', FRONT_RIGHT: '在右前方', RIGHT: '在右侧' },
    object: { PERSON: '行人', CHAIR: '椅子', TABLE: '桌子或办公桌', DOOR: '门', WALL: '墙', COLUMN: '柱子', STAIRS_UP: '上行楼梯', STAIRS_DOWN: '下行楼梯', STAIRS_UNCERTAIN: '方向不明的楼梯', ELEVATOR: '电梯', VEHICLE: '车辆', CAR: '汽车', BUS: '公交车', TRUCK: '卡车', MOTORCYCLE: '摩托车', BICYCLE: '自行车', CART: '推车', BOX: '箱子', BARRIER: '障碍物', SIGN: '标识', CORRIDOR: '走廊', ENTRANCE: '入口', EXIT: '出口', UNKNOWN_OBSTACLE: '不明物体', DROP_OFF: '落差', DROP_OFF_UNCERTAIN: '可能的落差' },
    close: '非常近', about: (meters: number) => `约 ${meters} 米远`,
  },
} as const;

/** Image position is not calibrated object height. It only warrants an uncertain raised-obstacle warning. */
function possibleHeadLevel(object: VisionDetection): boolean {
  return ['BARRIER', 'COLUMN', 'WALL', 'UNKNOWN_OBSTACLE'].includes(object.type)
    && object.verticalPosition === 'TOP'
    && object.boundingBox.y + object.boundingBox.height < .8;
}

/** Monocular depth is relative only; it must never become metres or collision time. */
function metricDistance(object: VisionDetection): number | null {
  const depth = object.approximateDistance;
  return depth && depth.source !== 'MONOCULAR_ESTIMATE' && depth.confidence >= .7
    && Number.isFinite(depth.distanceMeters) && depth.distanceMeters > 0 ? depth.distanceMeters : null;
}

export function hazardRank(object: VisionDetection): number {
  if (['DOOR', 'ELEVATOR', 'SIGN', 'CORRIDOR', 'ENTRANCE', 'EXIT'].includes(object.type)) return 0;
  if (object.type === 'DROP_OFF' || object.type === 'DROP_OFF_UNCERTAIN' || object.type === 'STAIRS_DOWN' || object.type === 'STAIRS_UNCERTAIN') return 8;
  if (['VEHICLE', 'CAR', 'BUS', 'TRUCK', 'MOTORCYCLE'].includes(object.type) || object.type === 'STAIRS_UP' || possibleHeadLevel(object)) return 7;
  const distance = metricDistance(object);
  if (distance !== null && distance < 1) return 6;
  if (object.type === 'BARRIER' || object.type === 'WALL') return 5;
  if (object.type === 'COLUMN' || object.type === 'UNKNOWN_OBSTACLE') return 4;
  if (['PERSON', 'CHAIR', 'TABLE', 'CART', 'BOX', 'BICYCLE'].includes(object.type)) return 3;
  return 0;
}

const dynamicTypes = new Set<VisionDetection['type']>(['PERSON', 'VEHICLE', 'CAR', 'BUS', 'TRUCK', 'MOTORCYCLE', 'BICYCLE', 'CART']);
const criticalSurfaces = new Set<VisionDetection['type']>(['DROP_OFF', 'DROP_OFF_UNCERTAIN', 'STAIRS_DOWN', 'STAIRS_UNCERTAIN']);
const credibleDetection = (object: VisionDetection) => Number.isFinite(object.confidence)
  && object.confidence <= 1 && object.confidence >= (criticalSurfaces.has(object.type) ? .5 : .55);

export interface SafetyDecision {
  state: RouteSafetyState;
  level: SafetyLevel;
  hazard: VisionDetection | null;
  objectType: VisionDetection['type'] | null;
  direction: HorizontalDirection | null;
  heightEvidence: HeightEvidence;
  distanceMeters: number | null;
  relativeSpeedMps: number | null;
  timeToCollisionSeconds: number | null;
  confidence: number;
  priority: number;
  message: string;
  edgeId: string | null;
}

type Motion = { relativeSpeedMps: number | null; timeToCollisionSeconds: number | null };
const noMotion: Motion = { relativeSpeedMps: null, timeToCollisionSeconds: null };
const forward = (object: VisionDetection) => ['FRONT_LEFT', 'FRONT', 'FRONT_RIGHT'].includes(object.horizontalDirection);
const levelPriority: Record<SafetyLevel, number> = { INFO: 0, CAUTION: 1, WARNING: 2, STOP: 3 };

export class NavigationSafetyFusion {
  private seen = new Map<string, { count: number; at: number }>();
  private depthHistory = new Map<string, { distance: number; at: number; type: VisionDetection['type']; direction: HorizontalDirection }>();
  constructor(private language: GuidanceLanguage = 'ar', private arabicStyle: ArabicStyle = 'MSA') {}
  setLanguage(value: GuidanceLanguage) { this.language = value; }
  setArabicStyle(value: ArabicStyle) { this.arabicStyle = value; }

  private countSeen(key: string, now: number): number {
    const previous = this.seen.get(key);
    const count = previous && now - previous.at < 8000 ? previous.count + 1 : 1;
    this.seen.set(key, { count, at: now });
    if (this.seen.size > 100) this.seen.forEach((sample, id) => {
      if (now - sample.at >= 8000) this.seen.delete(id);
    });
    return count;
  }

  private motion(object: VisionDetection, now: number): Motion {
    const distance = metricDistance(object), key = object.trackId;
    if (distance === null || !key) return noMotion;
    const previous = this.depthHistory.get(key);
    this.depthHistory.set(key, { distance, at: now, type: object.type, direction: object.horizontalDirection });
    if (this.depthHistory.size > 100) this.depthHistory.forEach((sample, id) => {
      if (now - sample.at > 5000) this.depthHistory.delete(id);
    });
    if (!previous || previous.type !== object.type || previous.direction !== object.horizontalDirection) return noMotion;
    const elapsed = (now - previous.at) / 1000;
    if (elapsed < .25 || elapsed > 5) return noMotion;
    const relativeSpeedMps = (previous.distance - distance) / elapsed;
    if (!Number.isFinite(relativeSpeedMps) || Math.abs(relativeSpeedMps) > 8) return noMotion;
    return { relativeSpeedMps, timeToCollisionSeconds: relativeSpeedMps >= .2 ? distance / relativeSpeedMps : null };
  }

  private empty(state: RouteSafetyState, message: string, edgeId: string | null = null, level: SafetyLevel = 'INFO', priority = 0, confidence = 0): SafetyDecision {
    return { state, level, hazard: null, objectType: null, direction: null, heightEvidence: 'UNSPECIFIED', distanceMeters: null,
      relativeSpeedMps: null, timeToCollisionSeconds: null, confidence, priority, message, edgeId };
  }

  evaluate(route: NavigationRoute | null, edgeIndex: number, location: LocalizationEstimate | null, scene: SceneDescription | null, now = Date.now()): SafetyDecision {
    const t = this.language === 'ar' && this.arabicStyle === 'SAUDI' ? messages['ar-SA'] : messages[this.language];
    if (!scene || now - scene.capturedAt > 10_000)
      return this.empty('ROUTE_UNCERTAIN', t.unknown);
    const from = route?.orderedNodes[edgeIndex], to = route?.orderedNodes[edgeIndex + 1];
    const expected = from && to && from.floorId === to.floorId ? ((Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI) % 360 + 360) % 360 : null;
    // A fresh visual hazard still matters during floor transitions or localization loss.
    // Without trusted pose, never attach that observation to a mapped route edge.
    const aligned = expected !== null && location?.state === 'TRACKING' && location.headingDegrees !== null
      && Math.abs(((location.headingDegrees - expected + 540) % 360) - 180) <= 70;
    const routeEdgeId = aligned ? route?.orderedEdges[edgeIndex]?.id ?? null : null;
    const possibleHazards = scene.objects.filter(forward).filter(object => hazardRank(object) >= 3);
    const weakVisualEvidence = possibleHazards.some(object => !credibleDetection(object));
    const candidates = possibleHazards.filter(credibleDetection).map(object => {
      const rank = hazardRank(object), distance = metricDistance(object), motion = this.motion(object, now);
      const raised = possibleHeadLevel(object);
      const plannedStair = route?.orderedEdges[edgeIndex]?.pathType === 'STAIRS' && object.type.startsWith('STAIRS_');
      const staticEdgeId = dynamicTypes.has(object.type) || plannedStair || object.type.endsWith('_UNCERTAIN') ? null : routeEdgeId;
      const key = `${staticEdgeId ?? 'none'}:${object.trackId ?? object.type}`;
      const count = this.countSeen(key, now);
      const imminent = motion.timeToCollisionSeconds !== null && motion.timeToCollisionSeconds <= 1.5;
      const immediate = criticalSurfaces.has(object.type) || imminent || distance !== null && distance < 1;
      const corroborated = object.confidence >= .65 || count >= 2;
      const level: SafetyLevel = immediate && corroborated ? 'STOP'
        : immediate || rank >= 5 || count >= 2 || motion.timeToCollisionSeconds !== null && motion.timeToCollisionSeconds <= 4 ? 'WARNING'
        : 'CAUTION';
      return { object, rank, distance, motion, raised, staticEdgeId, level };
    }).sort((a, b) => levelPriority[b.level] - levelPriority[a.level] || b.rank - a.rank);
    const top = candidates[0];
    if (top) {
      const { object, rank, distance, motion, raised, staticEdgeId, level } = top;
      const separator = this.language === 'en' ? ', ' : this.language === 'zh-CN' ? '，' : '، ';
      const distanceText = distance === null ? '' : distance < 1 ? `${separator}${t.close}` : `${separator}${t.about(Math.round(distance))}`;
      const direction = t.direction[object.horizontalDirection];
      const description = raised ? `${t.head} ${direction}${distanceText}`
        : `${t.obstacle}: ${(t.object as Record<string,string>)[object.type]??visionMessages[this.language].object[object.type]} ${direction}${distanceText}`;
      const message = `${level === 'STOP' ? t.stop : level === 'WARNING' ? t.warning : ''} ${description}.`.trim();
      return {
        state: level === 'STOP' || level === 'WARNING' ? 'ROUTE_BLOCKED' : 'ROUTE_UNCERTAIN',
        level, hazard: object, objectType: object.type, direction: object.horizontalDirection,
        heightEvidence: raised ? 'POSSIBLE_HEAD_LEVEL' : 'UNSPECIFIED', distanceMeters: distance,
        relativeSpeedMps: motion.relativeSpeedMps, timeToCollisionSeconds: motion.timeToCollisionSeconds,
        confidence: Math.min(object.confidence, object.approximateDistance?.confidence ?? 1),
        priority: level === 'STOP' ? Math.max(8, rank) : level === 'WARNING' ? Math.max(5, rank) : rank,
        message, edgeId: staticEdgeId,
      };
    }
    if (scene.walkableArea?.pathAhead === 'BLOCKED' && scene.walkableArea.confidence >= .55) {
      if (routeEdgeId) this.countSeen(`${routeEdgeId}:PATH`, now);
      return this.empty('ROUTE_BLOCKED', t.blocked, routeEdgeId, 'WARNING', 5, scene.walkableArea.confidence);
    }
    if (!aligned) return this.empty('ROUTE_UNCERTAIN', location?.state === 'TRACKING' ? t.heading : t.unknown);
    if (weakVisualEvidence || scene.walkableArea?.pathAhead !== 'CLEAR' || scene.walkableArea.confidence < .55)
      return this.empty('ROUTE_UNCERTAIN', t.pathUnknown, null, 'INFO', 0, scene.walkableArea?.confidence ?? 0);
    return this.empty('ROUTE_CLEAR', t.clear, null, 'INFO', 0, scene.walkableArea.confidence);
  }

  persistent(decision: SafetyDecision, now = Date.now()): boolean {
    if (!decision.edgeId || decision.hazard && dynamicTypes.has(decision.hazard.type)) return false;
    const seen = this.seen.get(`${decision.edgeId}:${decision.hazard?.trackId ?? decision.hazard?.type ?? 'PATH'}`);
    return !!seen && seen.count >= 3 && now - seen.at < 8000;
  }
}

export class TemporaryRouteConstraints {
  private constraints: RouteConstraint[] = [];
  add(edgeId: string, kind: RouteConstraint['kind'], now = Date.now(), ttlMs = 90_000) {
    this.constraints = this.active(now).filter(constraint => constraint.edgeId !== edgeId);
    this.constraints.push({ edgeId, kind, createdAt: now, expiresAt: now + ttlMs });
  }
  active(now = Date.now()) { this.constraints = this.constraints.filter(constraint => constraint.expiresAt > now); return [...this.constraints]; }
  clear() { this.constraints = []; }
}
