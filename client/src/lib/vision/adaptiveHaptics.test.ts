import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AdaptiveHapticAlerts,ApproachAudioPacer,type ApproachRiskSignal} from './adaptiveHaptics';
import {DEFAULT_APPROACH_PREFERENCES,resetApproachPreferences,sanitizeApproachPreferences,validMetricThresholds} from './approachPreferences';

const signal=(level:ApproachRiskSignal['level'],capturedAt=Date.now()):ApproachRiskSignal=>
  ({level,capturedAt,trackId:'chair-1'});
const prefs={...DEFAULT_APPROACH_PREFERENCES,hapticsEnabled:true};
const platform=()=>({
  capabilities:vi.fn(async()=>({supported:true,intensityControl:true,source:'NATIVE' as const})),
  pulse:vi.fn(async(_intensity:number,_durationMs:number)=>true),
  test:vi.fn(async()=>true),
  stop:vi.fn(),
});

describe('adaptive approach haptics',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(1000));});
  afterEach(()=>vi.useRealTimers());

  it('never pulses for unavailable, no risk, disabled preferences, or an expired frame',async()=>{
    const fake=platform(), alerts=new AdaptiveHapticAlerts(prefs,fake,()=>Date.now());
    await alerts.refreshCapabilities();
    alerts.update(signal('NONE'));alerts.update(signal('UNAVAILABLE'));
    alerts.update(signal('HIGH',100));
    await vi.runOnlyPendingTimersAsync();
    expect(fake.pulse).not.toHaveBeenCalled();
    alerts.setPreferences({...prefs,hapticsEnabled:false});
    alerts.update(signal('CRITICAL'));
    await vi.runOnlyPendingTimersAsync();
    expect(fake.pulse).not.toHaveBeenCalled();
  });

  it('increases pulse strength and rate with evidenced level, while bounding each pulse',async()=>{
    const fake=platform(), alerts=new AdaptiveHapticAlerts(prefs,fake,()=>Date.now());
    await alerts.refreshCapabilities();
    alerts.update(signal('CAUTION'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pulse).toHaveBeenCalledWith(.36,42);
    await vi.advanceTimersByTimeAsync(270);
    alerts.update(signal('HIGH'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pulse).toHaveBeenLastCalledWith(.58,65);
    await vi.advanceTimersByTimeAsync(270);
    alerts.update(signal('CRITICAL'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pulse).toHaveBeenLastCalledWith(.8,85);
    await vi.advanceTimersByTimeAsync(270);
    expect(fake.pulse).toHaveBeenCalledTimes(4); // Distinct second pulse clears native 250 ms spacing.
    expect(fake.pulse.mock.calls.every(([,duration])=>duration<=100)).toBe(true);
    alerts.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.pulse).toHaveBeenCalledTimes(4);
  });

  it('cancels a queued second pulse when the evidence disappears',async()=>{
    const fake=platform(), alerts=new AdaptiveHapticAlerts({...prefs,pattern:'DOUBLE'},fake,()=>Date.now());
    await alerts.refreshCapabilities();
    alerts.update(signal('HIGH'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pulse).toHaveBeenCalledTimes(1);
    alerts.update(signal('NONE'));
    await vi.advanceTimersByTimeAsync(500);
    expect(fake.pulse).toHaveBeenCalledTimes(1);
    expect(fake.stop).toHaveBeenCalled();
  });

  it('paces speech per track and admits a genuine escalation',()=>{
    const pacer=new ApproachAudioPacer();
    expect(pacer.shouldAnnounce(signal('CAUTION',1000),1000)).toBe(true);
    expect(pacer.shouldAnnounce(signal('CAUTION',1100),1100)).toBe(false);
    expect(pacer.shouldAnnounce(signal('HIGH',1800),1800)).toBe(true);
    expect(pacer.shouldAnnounce(signal('HIGH',1000),3000)).toBe(false);
  });
});

describe('approach preferences',()=>{
  it('uses quiet defaults and rejects malformed stored options',()=>{
    const result=sanitizeApproachPreferences({hapticsEnabled:'true',audioEnabled:true,mode:'UNVERIFIED',
      metricThresholdsMeters:{caution:1,high:2,critical:.25}});
    expect(result.hapticsEnabled).toBe(false);
    expect(result.audioEnabled).toBe(true);
    expect(result.mode).toBe('RELATIVE');
    expect(result.metricThresholdsMeters).toEqual(DEFAULT_APPROACH_PREFERENCES.metricThresholdsMeters);
    expect(validMetricThresholds({caution:2.5,high:1.5,critical:.25})).toBe(true);
    expect(resetApproachPreferences().hapticsEnabled).toBe(false);
  });
});
