import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPlaybackManager, type TtsProvider } from './speechEngine';
import type { SpeechRequest } from '@shared/speech';

const input: SpeechRequest = { text: 'Turn right', language: 'en', arabicStyle: 'MSA', context: 'NAVIGATION', rate: 1 };
afterEach(() => vi.unstubAllGlobals());

describe('audio playback manager', () => {
  it('uses local fallback offline and records a fallback without retaining text', async () => {
    const speak = vi.fn((utterance: { onend?: () => void }) => queueMicrotask(() => utterance.onend?.()));
    vi.stubGlobal('window', { speechSynthesis: { speak, getVoices: () => [], cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; rate = 1; voice = null; onend?: () => void; onerror?: () => void; constructor(public text: string) {} });
    const manager = new AudioPlaybackManager({ isAvailable: () => false, synthesize: vi.fn(), stop: vi.fn() });
    await manager.enqueue(input);
    expect(speak).toHaveBeenCalledOnce();
    expect(manager.status.mode).toBe('LOCAL');
    expect(manager.metrics.fallbacks).toBe(1);
    expect(JSON.stringify(manager.metrics)).not.toContain(input.text);
  });
  it('interrupts a lower priority request and plays safety next', async () => {
    class FakeAudio {
      src = ''; onended?: () => void; onerror?: () => void;
      constructor(src: string) { this.src = src; }
      play() { queueMicrotask(() => this.onended?.()); return Promise.resolve(); }
      pause() {}
    }
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock', revokeObjectURL: vi.fn() });
    vi.stubGlobal('window', { speechSynthesis: { cancel: vi.fn() } });
    let started = false;
    const premium: TtsProvider = {
      isAvailable: () => true, stop: vi.fn(),
      synthesize: (request, signal) => request.text === 'Turn right'
        ? new Promise((_resolve, reject) => { started = true; signal.addEventListener('abort', () => reject(new Error('cancelled'))); })
        : Promise.resolve(new Blob(['audio'])),
    };
    const manager = new AudioPlaybackManager(premium);
    const turn = manager.enqueue(input, 'TURN');
    expect(started).toBe(true);
    const safety = manager.enqueue({ ...input, text: 'Stop', context: 'SAFETY' }, 'CRITICAL_SAFETY');
    await Promise.all([turn, safety]);
    expect(manager.metrics.requests).toBe(2);
    expect(manager.metrics.fallbacks).toBe(0);
    expect(manager.status.mode).toBe('PREMIUM');
  });
  it('cancels prefetched requests during reroute', () => {
    let cancelled = false;
    const premium: TtsProvider = { isAvailable: () => true, stop: vi.fn(), synthesize: (_request, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); })) };
    const manager = new AudioPlaybackManager(premium);
    manager.prefetch('route-old:1', input);
    manager.clearPrefetch();
    expect(cancelled).toBe(true);
  });
  it('does not let ordinary speech replace an active safety warning', async () => {
    const utterances: Array<{ onend?: () => void }> = [];
    vi.stubGlobal('window', { speechSynthesis: { speak: (u: { onend?: () => void }) => utterances.push(u), getVoices: () => [], cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; rate = 1; voice = null; onend?: () => void; onerror?: () => void; constructor(public text: string) {} });
    const manager = new AudioPlaybackManager({ isAvailable: () => false, synthesize: vi.fn(), stop: vi.fn() });
    const safety = manager.enqueue({ ...input, text: 'Stop', context: 'SAFETY' }, 'CRITICAL_SAFETY');
    await vi.waitFor(() => expect(utterances).toHaveLength(1));
    const epoch = manager.cancellationEpoch;
    manager.replaceAtPriority('INFORMATION');
    const general = manager.enqueue(input, 'INFORMATION');
    expect(utterances).toHaveLength(1);
    utterances[0].onend?.();
    await safety;
    await vi.waitFor(() => expect(utterances).toHaveLength(2));
    utterances[1].onend?.();
    await general;
    expect(manager.cancellationEpoch).toBe(epoch);
  });
});
