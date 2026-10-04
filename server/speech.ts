import type { Express } from 'express';
import { GoogleAuth } from 'google-auth-library';
import { SpeechRequestSchema, VOICES, normalizeSpeechText, routeVoice, voicesFor, type SpeechRequest, type Voice } from '../shared/speech';

export interface TtsProvider {
  readonly id: Voice['provider'];
  isAvailable(): boolean;
  listVoices(): readonly Voice[];
  synthesize(input: SpeechRequest, voice: Voice, signal: AbortSignal): Promise<Buffer>;
}

const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
export class GoogleChirpProvider implements TtsProvider {
  readonly id = 'GOOGLE' as const;
  isAvailable() { return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT); }
  listVoices() { return VOICES.filter(voice => voice.provider === this.id); }
  async synthesize(input: SpeechRequest, voice: Voice, signal: AbortSignal) {
    const client = await googleAuth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('google_auth_unavailable');
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: normalizeSpeechText(input) }, voice: { languageCode: voice.locale, name: voice.id }, audioConfig: { audioEncoding: 'MP3', speakingRate: input.rate } }),
    });
    if (!response.ok) throw new Error(`google_tts_${response.status}`);
    const data = await response.json() as { audioContent?: string };
    if (!data.audioContent) throw new Error('google_tts_empty');
    return Buffer.from(data.audioContent, 'base64');
  }
}

function escapeXml(text: string) { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!); }
export class AzureSaudiProvider implements TtsProvider {
  readonly id = 'AZURE' as const;
  isAvailable() { return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION); }
  listVoices() { return VOICES.filter(voice => voice.provider === this.id); }
  async synthesize(input: SpeechRequest, voice: Voice, signal: AbortSignal) {
    const region = process.env.AZURE_SPEECH_REGION;
    if (!region || !/^[a-z0-9]+$/.test(region)) throw new Error('azure_region_invalid');
    const ratePercent = Math.round((input.rate - 1) * 100);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-SA"><voice name="${voice.id}"><prosody rate="${ratePercent >= 0 ? '+' : ''}${ratePercent}%">${escapeXml(normalizeSpeechText(input))}</prosody></voice></speak>`;
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST', signal,
      headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY!, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'BasiraSpeechEngine' },
      body: ssml,
    });
    if (!response.ok) throw new Error(`azure_tts_${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

export class SpeechProviderRouter {
  constructor(private readonly providers: readonly TtsProvider[] = [new GoogleChirpProvider(), new AzureSaudiProvider()]) {}
  listVoices() { return VOICES.map(voice => ({ ...voice, available: Boolean(this.providers.find(provider => provider.id === voice.provider)?.isAvailable()) })); }
  route(input: SpeechRequest) {
    const voice = routeVoice(input);
    const provider = this.providers.find(candidate => candidate.id === voice.provider && candidate.isAvailable());
    return { voice, provider };
  }
}

export function registerSpeechRoutes(app: Express, router = new SpeechProviderRouter()) {
  const calls = new Map<string, { count: number; resetsAt: number }>();
  app.get('/api/speech/voices', (_req, res) => res.set('Cache-Control', 'no-store').json({ voices: router.listVoices() }));
  app.post('/api/speech/synthesize', async (req, res) => {
    const parsed = SpeechRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_speech_request' });
    if (parsed.data.voiceId && !voicesFor(parsed.data.language, parsed.data.arabicStyle).some(voice => voice.id === parsed.data.voiceId)) return res.status(400).json({ error: 'invalid_voice' });
    const now = Date.now(), key = req.ip ?? 'unknown';
    const previous = calls.get(key);
    const next = previous && previous.resetsAt > now ? { count: previous.count + 1, resetsAt: previous.resetsAt } : { count: 1, resetsAt: now + 60_000 };
    calls.set(key, next);
    if (calls.size > 5000) calls.forEach((value, ip) => { if (value.resetsAt <= now) calls.delete(ip); });
    if (next.count > 60) return res.status(429).set('Cache-Control', 'no-store').json({ error: 'speech_rate_limited' });
    const { voice, provider } = router.route(parsed.data);
    if (!provider) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'premium_voice_unavailable' });
    const started = performance.now();
    const disconnected = new AbortController();
    const onClose = () => disconnected.abort();
    res.once('close', onClose);
    try {
      const audio = await provider.synthesize(parsed.data, voice, AbortSignal.any([AbortSignal.timeout(15000), disconnected.signal]));
      if (!audio.length || audio.length > 8_000_000) return res.status(502).json({ error: 'invalid_audio_response' });
      const elapsed = Math.round(performance.now() - started);
      return res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store', 'Server-Timing': `synthesis;dur=${elapsed}` }).send(audio);
    } catch {
      // Deliberately never log the request body, provider response, or sensitive speech text.
      return res.status(502).set('Cache-Control', 'no-store').json({ error: 'premium_voice_failed' });
    } finally {
      res.off('close', onClose);
    }
  });
}
