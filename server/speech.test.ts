import { describe, expect, it } from 'vitest';
import { SpeechProviderRouter, type TtsProvider } from './speech';
import { VOICES, type SpeechRequest } from '../shared/speech';
import express from 'express';
import { registerSpeechRoutes } from './speech';

const request: SpeechRequest = { text: 'اختبار', language: 'ar', arabicStyle: 'SAUDI', context: 'EXAM', rate: 1 };
function provider(id: TtsProvider['id'], available: boolean): TtsProvider {
  return { id, isAvailable: () => available, listVoices: () => VOICES.filter(v => v.provider === id), synthesize: async () => Buffer.from('mock-audio') };
}
describe('provider routing', () => {
  it('selects configured Saudi provider and never silently substitutes MSA', () => {
    const router = new SpeechProviderRouter([provider('GOOGLE', true), provider('AZURE', true)]);
    expect(router.route(request).provider?.id).toBe('AZURE');
    expect(router.route({ ...request, arabicStyle: 'MSA' }).provider?.id).toBe('GOOGLE');
  });
  it('reports missing credentials for browser fallback without changing accents', () => {
    const router = new SpeechProviderRouter([provider('GOOGLE', true), provider('AZURE', false)]);
    expect(router.route(request).provider).toBeUndefined();
    expect(router.route(request).voice.locale).toBe('ar-SA');
    expect(router.listVoices().find(v => v.id === 'ar-SA-HamedNeural')?.available).toBe(false);
  });
  it('validates the API and returns mocked audio without exposing text in errors', async () => {
    const app = express(); app.use(express.json());
    registerSpeechRoutes(app, new SpeechProviderRouter([provider('AZURE', true)]));
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('server_address');
      const url = `http://127.0.0.1:${address.port}/api/speech/synthesize`;
      const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect((await post({ ...request, voiceId: 'en-US-Chirp3-HD-Kore' })).status).toBe(400);
      const invalid = await post({ ...request, text: 'x'.repeat(4501) });
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).not.toContain('xxxx');
      const response = await post({ ...request, voiceId: 'ar-SA-HamedNeural' });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('audio/mpeg');
      expect(await response.text()).toBe('mock-audio');
    } finally { server.close(); }
  });
});
