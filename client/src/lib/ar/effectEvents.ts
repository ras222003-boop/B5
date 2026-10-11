/** Minimal privacy-preserving events: never persist facial meshes or pixels. */
export type EffectKind = 'face' | 'sky';
export type EffectState =
  | 'loading'
  | 'scanning'
  | 'found'
  | 'updated'
  | 'lost';

export type BasiraEffectObservation = Readonly<{
  kind: EffectKind;
  state: EffectState;
  observedAt: number;
}>;

export const BASIRA_EFFECT_EVENT_MAP: Readonly<Record<EffectKind, Readonly<Record<string, EffectState>>>> = Object.freeze({
  face: Object.freeze({
    'reality.faceloading': 'loading',
    'reality.facescanning': 'scanning',
    'reality.facefound': 'found',
    'reality.faceupdated': 'updated',
    'reality.facelost': 'lost',
  }),
  sky: Object.freeze({
    'reality.layerloading': 'loading',
    'reality.layerscanning': 'scanning',
    'reality.layerfound': 'found',
    'reality.layerupdated': 'updated',
    'reality.layerlost': 'lost',
  }),
});

export function parseBasiraEffectEvent(
  kind: EffectKind,
  eventName: string,
  detail: unknown,
  now: number,
): BasiraEffectObservation | null {
  const state = BASIRA_EFFECT_EVENT_MAP[kind][eventName];
  if (!state || !Number.isFinite(now) || now < 0) return null;
  // Layers events may contain the name of a semantic layer, but sky must be the only one.
  if (kind === 'sky' && detail && typeof detail === 'object') {
    const layer = detail as {name?: unknown; layer?: unknown};
    if (layer.name !== undefined && layer.name !== 'sky') return null;
    if (layer.layer !== undefined && layer.layer !== 'sky') return null;
  }
  return {kind, state, observedAt: now};
}

/** Accessibility-safe guidance. Never equates facial/sky tracking with finding hazards. */
export function effectHint(kind: EffectKind, state: EffectState, lang: 'ar' | 'en' | 'zh-CN'): string {
  const messages = {
    face: {
      ar: {loading: 'جارٍ تحميل تتبع الوجه.', scanning: 'جارٍ البحث عن وجه داخل إطار الكاميرا.', found: 'تم اكتشاف وجه في تجربة بصرية اختيارية.', updated: 'يجري تتبع الوجه.', lost: 'فُقد تتبع الوجه.'},
      en: {loading:'Loading face tracking.',scanning:'Looking for a face in camera view.',found:'Face found for the optional visual experiment.',updated:'Tracking face.',lost:'Face no longer tracked.'},
      'zh-CN': {loading:'正在加载人脸跟踪。',scanning:'正在相机画面中寻找人脸。',found:'实验中检测到人脸。',updated:'正在跟踪人脸。',lost:'已失去人脸跟踪。'},
    },
    sky: {
      ar: {loading:'جارٍ تحميل فصل السماء.',scanning:'وجّه الكاميرا نحو السماء من مكان آمن وثابت.',found:'تم اكتشاف منطقة سماء. هذا ليس كشفًا للعوائق.',updated:'يجري تحديث طبقة السماء.',lost:'فُقد تتبع منطقة السماء.'},
      en: {loading:'Loading sky segmentation.',scanning:'Point the camera at the sky from a safe stationary place.',found:'Sky region found. This is not obstacle detection.',updated:'Updating sky mask.',lost:'Sky region no longer tracked.'},
      'zh-CN': {loading:'正在加载天空分割。',scanning:'请在安全的静止地点将相机对准天空。',found:'检测到天空区域；不能用于避障。',updated:'正在更新天空区域。',lost:'失去天空区域跟踪。'},
    },
  } as const;
  return messages[kind][lang][state];
}
