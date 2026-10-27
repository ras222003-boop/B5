export type ApproachSensitivity = 'LOW' | 'BALANCED' | 'HIGH';
export type ApproachMode = 'RELATIVE' | 'TRUSTED_METRIC';
export type HapticIntensity = 'GENTLE' | 'NORMAL' | 'STRONG';
export type HapticPattern = 'STANDARD' | 'SINGLE' | 'DOUBLE';

export interface ApproachPreferences {
  hapticsEnabled: boolean;
  audioEnabled: boolean;
  sensitivity: ApproachSensitivity;
  hapticIntensity: HapticIntensity;
  mode: ApproachMode;
  pattern: HapticPattern;
  /** User alert limits, never sensor calibration or a claim of measurement accuracy. */
  metricThresholdsMeters: { caution: number; high: number; critical: number };
}

const storageKey = 'basira-approach-preferences-v1';
export const DEFAULT_APPROACH_PREFERENCES: ApproachPreferences = {
  hapticsEnabled: false,
  audioEnabled: false,
  sensitivity: 'BALANCED',
  hapticIntensity: 'NORMAL',
  mode: 'RELATIVE',
  pattern: 'STANDARD',
  metricThresholdsMeters: { caution: 2.5, high: 1.5, critical: 0.8 },
};

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? value as T : fallback;

export function validMetricThresholds(value: ApproachPreferences['metricThresholdsMeters']): boolean {
  const { caution, high, critical } = value;
  return [caution, high, critical].every(Number.isFinite) &&
    caution >= 0.5 && caution <= 5 && high >= 0.4 && high <= 4 &&
    critical >= 0.25 && critical <= 3 && caution > high + 0.09 && high > critical + 0.09;
}

/** Invalid or old stored values fall back to a quiet, known configuration. */
export function sanitizeApproachPreferences(value: unknown): ApproachPreferences {
  const source = value && typeof value === 'object' ? value as Partial<ApproachPreferences> : {};
  const incoming = source.metricThresholdsMeters;
  const caution = incoming?.caution, high = incoming?.high, critical = incoming?.critical;
  const validThresholds = validMetricThresholds({ caution: caution!, high: high!, critical: critical! });
  return {
    hapticsEnabled: source.hapticsEnabled === true,
    audioEnabled: source.audioEnabled === true,
    sensitivity: oneOf(source.sensitivity, ['LOW', 'BALANCED', 'HIGH'], 'BALANCED'),
    hapticIntensity: oneOf(source.hapticIntensity, ['GENTLE', 'NORMAL', 'STRONG'], 'NORMAL'),
    mode: oneOf(source.mode, ['RELATIVE', 'TRUSTED_METRIC'], 'RELATIVE'),
    pattern: oneOf(source.pattern, ['STANDARD', 'SINGLE', 'DOUBLE'], 'STANDARD'),
    metricThresholdsMeters: validThresholds ? { caution: caution!, high: high!, critical: critical! }
      : { ...DEFAULT_APPROACH_PREFERENCES.metricThresholdsMeters },
  };
}

export function getApproachPreferences(): ApproachPreferences {
  try { return sanitizeApproachPreferences(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
  catch { return sanitizeApproachPreferences(null); }
}

export function saveApproachPreferences(value: ApproachPreferences): ApproachPreferences {
  const safe = sanitizeApproachPreferences(value);
  try { localStorage.setItem(storageKey, JSON.stringify(safe)); } catch { /* Storage is optional. */ }
  return safe;
}

export function resetApproachPreferences(): ApproachPreferences {
  try { localStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
  return sanitizeApproachPreferences(null);
}
