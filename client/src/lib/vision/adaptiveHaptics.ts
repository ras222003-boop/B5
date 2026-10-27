import type { ApproachPreferences, HapticIntensity, HapticPattern } from './approachPreferences';

export type ApproachAlertLevel = 'UNAVAILABLE' | 'NONE' | 'CAUTION' | 'HIGH' | 'CRITICAL';
export interface ApproachRiskSignal {
  level: ApproachAlertLevel;
  /** performance.now() clock, matching the detector frame. */
  capturedAt: number;
  trackId?: string;
  text?: string;
}
export interface NativeHapticBridge {
  capabilities(): Promise<{ supported: boolean; intensityControl: boolean }>;
  pulse(options: { intensity: number; durationMs: number }): Promise<boolean>;
  test(): Promise<boolean>;
  stop(): Promise<void>;
}
declare global {
  interface Window { BasiraNativeHaptics?: NativeHapticBridge }
}

export interface HapticCapabilities {
  supported: boolean;
  intensityControl: boolean;
  source: 'NATIVE' | 'WEB' | 'NONE';
}
interface HapticPlatform {
  capabilities(): Promise<HapticCapabilities>;
  pulse(intensity: number, durationMs: number): Promise<boolean>;
  test(): Promise<boolean>;
  stop(): void;
}

const noHaptics: HapticCapabilities = { supported: false, intensityControl: false, source: 'NONE' };
const nativeBridge = () => typeof window === 'undefined' ? undefined : window.BasiraNativeHaptics;
const webVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  ? navigator.vibrate.bind(navigator) : null;

/** The web path only uses a real Vibration API; Safari has no vibration fallback. */
function devicePlatform(): HapticPlatform {
  return {
    async capabilities() {
      const bridge = nativeBridge();
      if (bridge) {
        try {
          const result = await bridge.capabilities();
          return result.supported ? { supported: true, intensityControl: result.intensityControl === true, source: 'NATIVE' }
            : noHaptics;
        } catch { return noHaptics; }
      }
      return webVibrate() ? { supported: true, intensityControl: false, source: 'WEB' } : noHaptics;
    },
    async pulse(intensity, durationMs) {
      const bridge = nativeBridge();
      if (bridge) {
        try { return await bridge.pulse({ intensity, durationMs }); } catch { return false; }
      }
      return webVibrate()?.(durationMs) === true;
    },
    async test() {
      const bridge = nativeBridge();
      if (bridge) {
        try { return await bridge.test(); } catch { return false; }
      }
      return webVibrate()?.([50, 90, 50]) === true;
    },
    stop() {
      const bridge = nativeBridge();
      if (bridge) { void bridge.stop().catch(() => {}); return; }
      webVibrate()?.(0);
    },
  };
}

const severity = (level: ApproachAlertLevel) => ({ UNAVAILABLE: 0, NONE: 0, CAUTION: 1, HIGH: 2, CRITICAL: 3 })[level];
const intensityFactor = (choice: HapticIntensity) => ({ GENTLE: 0.7, NORMAL: 1, STRONG: 1.25 })[choice];
const rhythm = (level: ApproachAlertLevel, pattern: HapticPattern) => {
  const base = level === 'CRITICAL' ? { intervalMs: 650, durationMs: 85, intensity: 0.8 }
    : level === 'HIGH' ? { intervalMs: 1050, durationMs: 65, intensity: 0.58 }
      : { intervalMs: 1900, durationMs: 42, intensity: 0.36 };
  return { ...base, double: pattern === 'DOUBLE' || pattern === 'STANDARD' && level === 'CRITICAL' };
};

/** Bounded pulses are emitted only while a fresh, evidenced risk remains present. */
export class AdaptiveHapticAlerts {
  private capabilities: HapticCapabilities = noHaptics;
  private active: ApproachRiskSignal | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private secondPulse: ReturnType<typeof setTimeout> | null = null;
  private lastPulseAt = -Infinity;
  private epoch = 0;
  constructor(private preferences: ApproachPreferences,
    private readonly platform: HapticPlatform = devicePlatform(),
    private readonly now: () => number = () => performance.now()) {}

  async refreshCapabilities(): Promise<HapticCapabilities> {
    this.capabilities = await this.platform.capabilities();
    if (!this.capabilities.supported) this.stop();
    return this.capabilities;
  }
  getCapabilities() { return this.capabilities; }
  setPreferences(preferences: ApproachPreferences) {
    this.preferences = preferences;
    if (!preferences.hapticsEnabled) this.stop();
  }
  update(signal: ApproachRiskSignal) {
    const now = this.now();
    if (!this.preferences.hapticsEnabled || !this.capabilities.supported ||
      !freshApproachSignal(signal, now) || severity(signal.level) === 0) {
      this.stop();
      return;
    }
    const previous = this.active;
    this.active = signal;
    if (previous?.level === signal.level && this.timer !== null) return;
    this.clearTimers();
    const delay = Math.max(0, 250 - (now - this.lastPulseAt));
    this.timer = setTimeout(() => this.tick(), delay);
  }
  private tick() {
    this.timer = null;
    const signal = this.active, now = this.now();
    if (!signal || !freshApproachSignal(signal, now) || !this.preferences.hapticsEnabled ||
      !this.capabilities.supported || severity(signal.level) === 0) { this.stop(); return; }
    const settings = rhythm(signal.level, this.preferences.pattern);
    const intensity = Math.min(1, settings.intensity * intensityFactor(this.preferences.hapticIntensity));
    const duration = Math.min(100, settings.durationMs);
    const epoch = this.epoch;
    this.lastPulseAt = now;
    void this.platform.pulse(intensity, duration);
    if (settings.double) this.secondPulse = setTimeout(() => {
      this.secondPulse = null;
      if (epoch === this.epoch && this.active && freshApproachSignal(this.active, this.now()) && this.preferences.hapticsEnabled)
        void this.platform.pulse(intensity, duration);
    }, 270);
    this.timer = setTimeout(() => this.tick(), settings.intervalMs);
  }
  async test(): Promise<boolean> {
    if (!this.capabilities.supported) return false;
    return this.platform.test();
  }
  stop() {
    this.epoch++;
    this.clearTimers();
    this.active = null;
    this.platform.stop();
  }
  private clearTimers() {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.secondPulse !== null) clearTimeout(this.secondPulse);
    this.timer = this.secondPulse = null;
  }
}

export function freshApproachSignal(signal: ApproachRiskSignal, now: number): boolean {
  return Number.isFinite(signal.capturedAt) && Number.isFinite(now) &&
    signal.capturedAt <= now + 5 && now - signal.capturedAt <= 800;
}

/** Speech announces a new risk or a real escalation, without replaying every frame. */
export class ApproachAudioPacer {
  private previous = new Map<string, { level: number; at: number }>();
  private lastSpeechAt = -Infinity;
  shouldAnnounce(signal: ApproachRiskSignal, now: number): boolean {
    const level = severity(signal.level);
    if (level === 0 || !freshApproachSignal(signal, now)) return false;
    const key = signal.trackId ?? 'unknown';
    const old = this.previous.get(key);
    const escalation = !!old && level > old.level;
    if (now - this.lastSpeechAt < (escalation ? 700 : 2500) ||
      old && !escalation && now - old.at < 15_000) return false;
    this.previous.set(key, { level, at: now });
    this.lastSpeechAt = now;
    for (const [id, value] of Array.from(this.previous)) if (now - value.at > 30_000) this.previous.delete(id);
    return true;
  }
  reset() { this.previous.clear(); this.lastSpeechAt = -Infinity; }
}
