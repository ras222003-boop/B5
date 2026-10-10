import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { GoogleChirpProvider, AzureSaudiProvider, registerSpeechRoutes, SpeechProviderRouter, type SpeechLimits, type TtsProvider } from './speech';
import { VOICES, type SpeechRequest } from '../shared/speech';

const request: SpeechRequest = { text: 'اختبار', language: 'ar', arabicStyle: 'SAUDI', context: 'EXAM', rate: 1 };
const limits: SpeechLimits = { userRequestsPerMinute: 2, userCharactersPerMinute: 20, userCharactersPerDay: 30, globalCharactersPerDay: 100, ipRequestsPerMinute: 3, concurrent: 1 };
function provider(id: TtsProvider['id'], available = true, synthesize = vi.fn(async () => Buffer.from('mock-audio'))): TtsProvider {
  return { id, isAvailable: () => available, listVoices: () => VOICES.filter(v => v.provider === id), synthesize };
}
async function withApi(run: (post: (body?: unknown) => Promise<Response>, voices: () => Promise<Response>, raw: (body: string) => Promise<Response>) => Promise<void>, options: {
  enabled?: boolean; user?: string | null; limits?: SpeechLimits; provider?: TtsProvider; resolveUser?: () => Promise<string | null>; allowGuestAzure?: boolean;
} = {}) {
  const app = express(); app.use(express.json());
  registerSpeechRoutes(app, new SpeechProviderRouter([options.provider ?? provider('AZURE')]), {
    premiumEnabled: () => options.enabled ?? true,
    resolveUser: options.resolveUser ?? (async () => options.user === undefined ? 'user-1' : options.user),
    limits: options.limits ?? limits,
    allowGuestAzure: () => options.allowGuestAzure ?? true,
  });
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server_address');
    const base = `http://127.0.0.1:${address.port}/api/speech`;
    await run(body => fetch(`${base}/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? request) }), () => fetch(`${base}/voices`), body => fetch(`${base}/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
afterEach(() => vi.unstubAllEnvs());

describe('provider routing', () => {
  it('selects configured Saudi provider and never silently substitutes MSA', () => {
    const router = new SpeechProviderRouter([provider('GOOGLE'), provider('AZURE')]);
    expect(router.route(request).provider?.id).toBe('AZURE');
    expect(router.route({ ...request, arabicStyle: 'MSA' }).provider?.id).toBe('GOOGLE');
  });
  it('reports missing provider without changing accents', () => {
    const router = new SpeechProviderRouter([provider('GOOGLE'), provider('AZURE', false)]);
    expect(router.route(request).provider).toBeUndefined();
    expect(router.route(request).voice.locale).toBe('ar-SA');
  });
  it('requires explicit switches and credentials for real providers', () => {
    vi.stubEnv('GOOGLE_TTS_ENABLED', 'false'); vi.stubEnv('AZURE_TTS_ENABLED', 'false');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', 'path'); vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'project');
    vi.stubEnv('AZURE_SPEECH_KEY', 'key'); vi.stubEnv('AZURE_SPEECH_REGION', 'region');
    expect(new GoogleChirpProvider().isAvailable()).toBe(false);
    expect(new AzureSaudiProvider().isAvailable()).toBe(false);
    vi.stubEnv('GOOGLE_TTS_ENABLED', 'true'); vi.stubEnv('AZURE_TTS_ENABLED', 'true');
    expect(new GoogleChirpProvider().isAvailable()).toBe(true);
    expect(new AzureSaudiProvider().isAvailable()).toBe(true);
  });
  it('accepts the existing project Azure secret aliases without exposing their values', () => {
    vi.stubEnv('AZURE_TTS_ENABLED', 'true');
    vi.stubEnv('AZURE_SPEECH_KEY', ''); vi.stubEnv('AZURE_SPEECH_REGION', '');
    vi.stubEnv('AZURESPEECHKEY', 'configured-key'); vi.stubEnv('AZYRESPEECHREGION', 'uaenorth');
    expect(new AzureSaudiProvider().isAvailable()).toBe(true);
  });
  it('accepts Azure regional TTS endpoint URLs without exposing the configured value', () => {
    vi.stubEnv('AZURE_TTS_ENABLED', 'true');
    vi.stubEnv('AZURE_SPEECH_KEY', 'configured-key');
    vi.stubEnv('AZURE_SPEECH_REGION', 'https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(new AzureSaudiProvider().isAvailable()).toBe(true);
  });
  it('accepts Azure Speech resource endpoints without exposing the configured value', () => {
    vi.stubEnv('AZURE_TTS_ENABLED', 'true');
    vi.stubEnv('AZURE_SPEECH_KEY', 'configured-key');
    vi.stubEnv('AZURE_SPEECH_REGION', 'https://basira-speech.cognitiveservices.azure.com/');
    expect(new AzureSaudiProvider().isAvailable()).toBe(true);
  });
});

describe('premium synthesis access and quotas', () => {
  it('uses the configured Saudi Azure voice for an anonymous visitor within strict quotas', async () => {
    const synthesize = vi.fn(async () => Buffer.from('audio'));
    await withApi(async post => {
      const response = await post();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(synthesize).toHaveBeenCalledOnce();
    }, { user: null, provider: provider('AZURE', true, synthesize) });
  });
  it('keeps non-Azure and explicitly disabled guest synthesis behind sign-in', async () => {
    await withApi(async post => {
      expect((await post({ ...request, language: 'en', arabicStyle: 'MSA', voiceId: 'en-US-Chirp3-HD-Aoede' })).status).toBe(401);
    }, { user: null, provider: provider('GOOGLE') });
    await withApi(async post => {
      expect((await post()).status).toBe(401);
    }, { user: null, provider: provider('AZURE'), allowGuestAzure: false });
  });
  it('allows an authenticated user within quota and validates the request', async () => {
    const synthesize = vi.fn(async () => Buffer.from('mock-audio'));
    await withApi(async post => {
      expect((await post({ ...request, voiceId: 'en-US-Chirp3-HD-Kore' })).status).toBe(400);
      const invalid = await post({ ...request, text: 'x'.repeat(4501) });
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).not.toContain('xxxx');
      const response = await post({ ...request, voiceId: 'ar-SA-HamedNeural' });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('audio/mpeg');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('mock-audio');
      expect(synthesize).toHaveBeenCalledOnce();
    }, { provider: provider('AZURE', true, synthesize) });
  });
  it('enforces per-user request and character quotas before synthesis', async () => {
    const synthesize = vi.fn(async () => Buffer.from('audio'));
    await withApi(async post => {
      expect((await post({ ...request, text: '1234567890' })).status).toBe(200);
      expect((await post({ ...request, text: '12345678901' })).status).toBe(429);
      expect((await post({ ...request, text: '1234567890' })).status).toBe(200);
      expect((await post({ ...request, text: 'x' })).status).toBe(429);
      expect(synthesize).toHaveBeenCalledTimes(2);
    }, { provider: provider('AZURE', true, synthesize) });
    await withApi(async post => {
      expect((await post({ ...request, text: '123456789012345' })).status).toBe(200);
      expect((await post({ ...request, text: '123456789012345' })).status).toBe(200);
      expect((await post({ ...request, text: 'x' })).status).toBe(429);
    }, { limits: { ...limits, userRequestsPerMinute: 3, userCharactersPerMinute: 40 } });
  });
  it('enforces IP and concurrent synthesis limits', async () => {
    let finish!: (value: Buffer) => void;
    const synthesize = vi.fn(() => new Promise<Buffer>(resolve => { finish = resolve; }));
    await withApi(async post => {
      const first = post();
      await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
      expect((await post()).status).toBe(429);
      finish(Buffer.from('audio'));
      expect((await first).status).toBe(200);
    }, { provider: provider('AZURE', true, synthesize) });
    await withApi(async post => {
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(429);
    }, { limits: { ...limits, userRequestsPerMinute: 5, userCharactersPerMinute: 100, ipRequestsPerMinute: 2 } });
  });
  it('caps aggregate daily characters across authenticated users', async () => {
    let user = 'user-1';
    const synthesize = vi.fn(async () => Buffer.from('audio'));
    await withApi(async post => {
      expect((await post({ ...request, text: '1234567890' })).status).toBe(200);
      user = 'user-2';
      expect((await post({ ...request, text: '1234567890' })).status).toBe(200);
      user = 'user-3';
      expect((await post({ ...request, text: 'x' })).status).toBe(429);
      expect(synthesize).toHaveBeenCalledTimes(2);
    }, { resolveUser: async () => user, provider: provider('AZURE', true, synthesize), limits: { ...limits, globalCharactersPerDay: 20 } });
  });
  it('disables premium with browser fallback and no provider call', async () => {
    const synthesize = vi.fn(async () => Buffer.from('audio'));
    await withApi(async (post, voices) => {
      const response = await post();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'premium_voice_disabled', fallback: 'browser' });
      expect((await (await voices()).json()).voices.every((voice: { available: boolean }) => !voice.available)).toBe(true);
      expect(synthesize).not.toHaveBeenCalled();
    }, { enabled: false, provider: provider('AZURE', true, synthesize) });
  });
  it('returns fallback for unavailable provider or auth service without invoking a provider', async () => {
    await withApi(async post => { expect((await post()).status).toBe(503); }, { provider: provider('AZURE', false) });
    const synthesize = vi.fn(async () => Buffer.from('audio'));
    await withApi(async post => {
      expect((await post()).status).toBe(503);
      expect(synthesize).not.toHaveBeenCalled();
    }, { provider: provider('AZURE', true, synthesize), resolveUser: async () => { throw new Error('session unavailable'); } });
  });
  it('does not expose sensitive text or provider errors in responses or server logs', async () => {
    const secret = 'ما عاصمة المملكة العربية السعودية؟';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withApi(async (post, _voices, raw) => {
        const response = await post({ ...request, text: secret });
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(secret);
        const malformed = await raw(`{"text":"${secret}",`);
        expect(malformed.status).toBe(400);
        expect(malformed.headers.get('cache-control')).toBe('no-store');
        expect(await malformed.text()).not.toContain(secret);
        expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      }, { provider: provider('AZURE', true, vi.fn(async () => { throw new Error(secret); })), limits: { ...limits, userCharactersPerMinute: 100, userCharactersPerDay: 100 } });
    } finally { log.mockRestore(); }
  });
});
