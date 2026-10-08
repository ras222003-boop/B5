import type { NavigationRoute } from '@shared/guidance';
import type { Floor } from '@shared/navigation';
import type { SceneDescription, VisionDetection } from '@shared/vision';

export type StairDirection = 'UP' | 'DOWN' | 'UNKNOWN';
export type StairPhase = 'IDLE' | 'APPROACH' | 'ASCENDING' | 'DESCENDING' | 'LANDING' | 'VERIFY_END';
export type StepCueMode = 'OFF' | 'HAPTIC_ONLY' | 'SOUND_ONLY' | 'SOUND_HAPTIC';

export interface StairEvidence {
  direction: StairDirection;
  confidence: number;
  source: 'MAP' | 'VISION' | 'NATIVE' | 'USER';
  timestamp: number;
  /** These observations require a separately calibrated native/vision provider. */
  visibleSteps?: number | null;
  stepCountConfidence?: number;
  landingConfidence?: number;
  flatSurfaceConfidence?: number;
  motionTransitionConfidence?: number;
}

export interface StairUpdate {
  phase: StairPhase;
  message: string | null;
  estimatedStepCue: boolean;
  /** Never an assertion that the foot landed on a particular stair. */
  detectedStep: false;
}

const update = (phase: StairPhase, message: string | null = null, estimatedStepCue = false): StairUpdate =>
  ({ phase, message, estimatedStepCue, detectedStep: false });

/** A mapped stair edge gives a planned floor transition, not a camera observation. */
export function mappedStairEvidence(route: NavigationRoute | null, edgeIndex: number, floors: Floor[], now: number): StairEvidence | null {
  const edge = route?.orderedEdges[edgeIndex];
  const from = route?.orderedNodes[edgeIndex], to = route?.orderedNodes[edgeIndex + 1];
  if (!edge || !(edge.pathType === 'STAIRS' || edge.hasStairs) || !from || !to) return null;
  const fromNumber = floors.find(floor => floor.id === from.floorId)?.floorNumber;
  const toNumber = floors.find(floor => floor.id === to.floorId)?.floorNumber;
  const direction = fromNumber === undefined || toNumber === undefined || fromNumber === toNumber
    ? 'UNKNOWN' : toNumber > fromNumber ? 'UP' : 'DOWN';
  return { direction, confidence: 0.7, source: 'MAP', timestamp: now };
}

/** Web segmentation currently supplies only STAIRS_UNCERTAIN. Do not infer up/down from its box. */
export function observedStairEvidence(scene: SceneDescription | null, now: number): StairEvidence | null {
  if (!scene || now - scene.capturedAt > 3000) return null;
  const stairs = scene.objects.filter(object => ['STAIRS_UP', 'STAIRS_DOWN', 'STAIRS_UNCERTAIN'].includes(object.type)
    && ['FRONT_LEFT', 'FRONT', 'FRONT_RIGHT'].includes(object.horizontalDirection))
    .sort((a, b) => b.confidence - a.confidence)[0] as VisionDetection | undefined;
  if (!stairs) return null;
  const strongDirection = stairs.confidence >= 0.8 && stairs.source !== 'SEGMENTATION';
  return {
    direction: strongDirection ? stairs.type === 'STAIRS_UP' ? 'UP' : stairs.type === 'STAIRS_DOWN' ? 'DOWN' : 'UNKNOWN' : 'UNKNOWN',
    confidence: stairs.confidence,
    source: stairs.source === 'NATIVE' ? 'NATIVE' : 'VISION',
    timestamp: scene.capturedAt,
  };
}

/** Conservative stair phase controller. It cannot certify a staircase from a map or pedometer alone. */
export class StairAssistantEngine {
  phase: StairPhase = 'IDLE';
  direction: StairDirection = 'UNKNOWN';
  source: StairEvidence['source'] | null = null;
  private lastEvidence: StairEvidence | null = null;
  private lastMotionCue = -Infinity;
  private latestLanding: StairEvidence | null = null;
  private latestEnd: StairEvidence | null = null;
  private conflict = false;

  constructor(public cueMode: StepCueMode = 'OFF') {}

  setCueMode(mode: StepCueMode) { this.cueMode = mode; }

  approach(evidence: StairEvidence, now = Date.now()): StairUpdate {
    if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0.55 || now - evidence.timestamp > 3000) return update(this.phase);
    if (this.phase !== 'IDLE' && this.phase !== 'APPROACH') return update(this.phase);
    if (this.conflict) return update(this.phase);
    if (this.phase === 'APPROACH' && this.direction !== 'UNKNOWN' && evidence.direction === 'UNKNOWN') return update(this.phase);
    if (this.phase === 'APPROACH' && this.direction !== 'UNKNOWN' && evidence.direction !== 'UNKNOWN' && evidence.direction !== this.direction) {
      this.direction = 'UNKNOWN'; this.conflict = true;
      return update(this.phase, 'تعارضت الخريطة والرؤية بشأن اتجاه الدرج. توقف وتحقق من اتجاهه بنفسك قبل البدء.');
    }
    const unchanged = this.phase === 'APPROACH' && this.direction === evidence.direction && this.source === evidence.source;
    this.lastEvidence = evidence;
    this.phase = 'APPROACH';
    this.direction = evidence.direction;
    this.source = evidence.source;
    if (unchanged) return update(this.phase);
    if (evidence.direction === 'UNKNOWN') return update(this.phase, 'قد يوجد درج أمامك، لكن اتجاهه غير مؤكد. توقف وتحقق بوسيلة التنقل المعتادة.');
    const kind = evidence.direction === 'UP' ? 'صاعد' : 'نازل';
    const source = evidence.source === 'MAP' ? 'الخريطة تشير إلى' : 'رُصد';
    return update(this.phase, `${source} درج ${kind} أمامك. توقف وتحقق من بدايته واتجاهه قبل المتابعة.`);
  }

  /** Explicit user confirmation means only that the user checked the stair start. */
  confirmStart(now = Date.now()): StairUpdate {
    if (this.phase !== 'APPROACH' || !this.lastEvidence || now - this.lastEvidence.timestamp > 30_000 || this.direction === 'UNKNOWN') return update(this.phase);
    this.phase = this.direction === 'DOWN' ? 'DESCENDING' : 'ASCENDING';
    return update(this.phase, `بدأ وضع الدرج ${this.direction === 'DOWN' ? 'النازل' : 'الصاعد'}. ثبّت اتجاهك وتحقق بكل خطوة بوسيلة التنقل المعتادة؛ التنبيهات الإيقاعية لا تؤكد موضع القدم.`);
  }

  chooseDirection(direction: Exclude<StairDirection, 'UNKNOWN'>, now = Date.now()): StairUpdate {
    if (this.phase !== 'APPROACH') return update(this.phase);
    this.conflict = false;
    this.direction = direction;
    this.source = 'USER';
    this.lastEvidence = { direction, confidence: 0.8, source: 'USER', timestamp: now };
    return update(this.phase, `سُجل اتجاه الدرج ${direction === 'UP' ? 'الصاعد' : 'النازل'} حسب تأكيدك. تحقق من الحافة والدرابزين قبل البدء.`);
  }

  /** IMU walking events are rhythm estimates, never detected staircase steps. */
  motionStep(now = Date.now()): StairUpdate {
    if (!['ASCENDING', 'DESCENDING'].includes(this.phase) || this.cueMode === 'OFF' || now - this.lastMotionCue < 350) return update(this.phase);
    this.lastMotionCue = now;
    return update(this.phase, null, true);
  }

  observeLanding(evidence: StairEvidence, now = Date.now()): StairUpdate {
    if (!['ASCENDING', 'DESCENDING'].includes(this.phase) || evidence.source === 'MAP' || evidence.source === 'USER' || now - evidence.timestamp > 1500 ||
      (evidence.landingConfidence ?? 0) < 0.8 || (evidence.flatSurfaceConfidence ?? 0) < 0.8) return update(this.phase);
    this.latestLanding = evidence;
    this.phase = 'LANDING';
    return update(this.phase, 'قد تكون وصلت إلى بسطة. توقف وتحقق من استمرار الدرج أو نهايته.');
  }

  confirmLanding(): StairUpdate {
    if (!['ASCENDING', 'DESCENDING'].includes(this.phase)) return update(this.phase);
    this.phase = 'LANDING';
    return update(this.phase, 'أنت عند بسطة حسب تأكيدك. تحقق من اتجاه الجزء التالي قبل المتابعة.');
  }

  continueFlight(): StairUpdate {
    if (this.phase !== 'LANDING') return update(this.phase);
    this.phase = this.direction === 'DOWN' ? 'DESCENDING' : 'ASCENDING';
    return update(this.phase, 'يستمر الدرج وفق تأكيدك. تحقق من أول درجة في الجزء التالي.');
  }

  observeEnd(evidence: StairEvidence, now = Date.now()): StairUpdate {
    if (!['ASCENDING', 'DESCENDING', 'LANDING'].includes(this.phase) || evidence.source === 'MAP' || evidence.source === 'USER' || now - evidence.timestamp > 1500 ||
      (evidence.flatSurfaceConfidence ?? 0) < 0.85 || (evidence.motionTransitionConfidence ?? 0) < 0.8) return update(this.phase);
    this.latestEnd = evidence;
    this.phase = 'VERIFY_END';
    return update(this.phase, 'قد يكون الدرج انتهى. تحقق من السطح المستوي قبل استئناف التوجيه.');
  }

  confirmEnd(): StairUpdate {
    if (!['ASCENDING', 'DESCENDING', 'LANDING', 'VERIFY_END'].includes(this.phase)) return update(this.phase);
    const supported = this.latestEnd !== null;
    this.reset();
    return update('IDLE', supported ? 'انتهى وضع الدرج بعد تحققك من السطح المستوي.' : 'أنهيت وضع الدرج بتأكيدك. أعد تحديد موقعك قبل التعليمات الدقيقة.');
  }

  /** A visible count is announced only with calibrated non-map evidence. */
  countDescription(evidence: StairEvidence): string | null {
    const count = evidence.visibleSteps;
    if (evidence.source === 'MAP' || evidence.source === 'USER' || !Number.isInteger(count) || count! < 1 || count! > 11 ||
      (evidence.stepCountConfidence ?? 0) < 0.9) return null;
    return `يبدو أن الجزء المرئي يحوي نحو ${count} درجات؛ تحقق من كل درجة.`;
  }

  reset() {
    this.phase = 'IDLE'; this.direction = 'UNKNOWN'; this.source = null;
    this.lastEvidence = null; this.latestLanding = null; this.latestEnd = null; this.lastMotionCue = -Infinity; this.conflict = false;
  }
}
