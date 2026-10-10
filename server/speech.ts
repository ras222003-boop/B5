import type { Express, NextFunction, Request, Response as ExpressResponse } from 'express';
import { GoogleAuth } from 'google-auth-library';
import { fromNodeHeaders } from 'better-auth/node';
import { SpeechRequestSchema, VOICES, normalizeSpeechText, routeVoice, voicesFor, type SpeechRequest, type Voice } from '../shared/speech';

export interface TtsProvider {
  readonly id: Voice['provider'];
  isAvailable(): boolean;
  listVoices(): readonly Voice[];
  synthesize(input: SpeechRequest, voice: Voice, signal: AbortSignal): Promise<Buffer>;
}

const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const enabled = (name: string) => process.env[name] === 'true';
const MAX_AUDIO_BYTES = 8_000_000;
// Accept the documented names and the existing project-secret aliases during migration.
// Values are never logged or sent anywhere except Azure's Speech endpoint.
const azureSpeechKey = () => process.env.AZURE_SPEECH_KEY || process.env.AZURESPEECHKEY || '';
const azureSpeechRegion = () => {
  const raw = (process.env.BASIRA_AZURE_SPEECH_REGION || process.env.AZURE_SPEECH_REGION || process.env.AZURESPEECHREGION || process.env.AZYRESPEECHREGION || '').trim();
  if (/^[a-z0-9-]{2,64}$/i.test(raw)) return raw.toLowerCase();
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.tts\.speech\.microsoft\.com$/);
    return match?.[1] ?? '';
  } catch { return ''; }
};
const azureSpeechEndpoint = () => {
  const raw = (process.env.BASIRA_AZURE_SPEECH_REGION || process.env.AZURE_SPEECH_REGION || process.env.AZURESPEECHREGION || process.env.AZYRESPEECHREGION || '').trim();
  const region = azureSpeechRegion();
  if (region) return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (/^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(host)) return `https://${host}/cognitiveservices/v1`;
    if (/^[a-z0-9-]+\.api\.cognitive\.microsoft\.com$/.test(host)) return `https://${host}/cognitiveservices/v1`;
  } catch { /* An invalid configured endpoint is treated as unavailable. */ }
  return '';
};
async function boundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_provider_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('provider_response_too_large');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); }
}
export class GoogleChirpProvider implements TtsProvider {
  readonly id = 'GOOGLE' as const;
  isAvailable() { return enabled('GOOGLE_TTS_ENABLED') && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS && (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT)); }
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
    const data = JSON.parse((await boundedBody(response, Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 4096)).toString('utf8')) as { audioContent?: string };
    if (!data.audioContent) throw new Error('google_tts_empty');
    return Buffer.from(data.audioContent, 'base64');
  }
}

function escapeXml(text: string) { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!); }
export class AzureSaudiProvider implements TtsProvider {
  readonly id = 'AZURE' as const;
  isAvailable() { return process.env.AZURE_TTS_ENABLED !== 'false' && Boolean(azureSpeechKey() && azureSpeechEndpoint()); }
  listVoices() { return VOICES.filter(voice => voice.provider === this.id); }
  async synthesize(input: SpeechRequest, voice: Voice, signal: AbortSignal) {
    const endpoint = azureSpeechEndpoint();
    if (!endpoint) throw new Error('azure_endpoint_invalid');
    const ratePercent = Math.round((input.rate - 1) * 100);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-SA"><voice name="${voice.id}"><prosody rate="${ratePercent >= 0 ? '+' : ''}${ratePercent}%">${escapeXml(normalizeSpeechText(input))}</prosody></voice></speak>`;
    const response = await fetch(endpoint, {
      method: 'POST', signal,
      headers: { 'Ocp-Apim-Subscription-Key': azureSpeechKey(), 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'BasiraSpeechEngine' },
      body: ssml,
    });
    if (!response.ok) throw new Error(`azure_tts_${response.status}`);
    return boundedBody(response, MAX_AUDIO_BYTES);
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

type Usage = { requests: number; characters: number; resetsAt: number };
export type SpeechLimits = { userRequestsPerMinute: number; userCharactersPerMinute: number; userCharactersPerDay: number; globalCharactersPerDay: number; ipRequestsPerMinute: number; concurrent: number };
const limit = (name: string, fallback: number, ceiling: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, ceiling) : fallback;
};
const defaultLimits = (): SpeechLimits => ({
  userRequestsPerMinute: limit('TTS_USER_REQUESTS_PER_MINUTE', 12, 60),
  userCharactersPerMinute: limit('TTS_USER_CHARACTERS_PER_MINUTE', 8000, 20000),
  userCharactersPerDay: limit('TTS_USER_CHARACTERS_PER_DAY', 50000, 200000),
  globalCharactersPerDay: limit('TTS_GLOBAL_CHARACTERS_PER_DAY', 250000, 1000000),
  ipRequestsPerMinute: limit('TTS_IP_REQUESTS_PER_MINUTE', 40, 120),
  concurrent: limit('TTS_MAX_CONCURRENT', 4, 8),
});
async function sessionUser(req: Request): Promise<string | null> {
  const { auth } = await import('./auth');
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return session?.user?.id ?? null;
}
export type SpeechRouteOptions = { resolveUser?: (req: Request) => Promise<string | null>; limits?: SpeechLimits; premiumEnabled?: () => boolean; allowGuestAzure?: () => boolean };

export function registerSpeechRoutes(app: Express, router = new SpeechProviderRouter(), options: SpeechRouteOptions = {}) {
  const limits = options.limits ?? defaultLimits();
  const premiumEnabled = () => options.premiumEnabled?.() ?? router.listVoices().some(voice => voice.available);
  // The website itself remains access-controlled. Allowing the configured Saudi
  // Azure voice for a visitor prevents an unauthenticated session from silently
  // falling back to the browser voice; IP and global quotas remain enforced.
  const allowGuestAzure = () => options.allowGuestAzure?.() ?? process.env.AZURE_GUEST_TTS_ENABLED !== 'false';
  const userMinute = new Map<string, Usage>();
  const userDay = new Map<string, Usage>();
  const globalDay = new Map<string, Usage>();
  const ipMinute = new Map<string, Usage>();
  let active = 0;
  const consume = (map: Map<string, Usage>, key: string, now: number, reset: number, chars: number, maxRequests: number, maxChars: number) => {
    const previous = map.get(key);
    const current = previous && previous.resetsAt > now ? previous : { requests: 0, characters: 0, resetsAt: reset };
    if (current.requests + 1 > maxRequests || current.characters + chars > maxChars) return false;
    map.set(key, { requests: current.requests + 1, characters: current.characters + chars, resetsAt: current.resetsAt });
    return true;
  };
  const prune = (map: Map<string, Usage>, now: number) => {
    if (map.size > 1000) map.forEach((value, key) => { if (value.resetsAt <= now) map.delete(key); });
  };
  app.use('/api/speech', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/speech/voices', (_req, res) => res.json({ voices: router.listVoices().map(voice => ({ ...voice, available: premiumEnabled() && voice.available })) }));
  app.post('/api/speech/synthesize', async (req, res) => {
    if (!premiumEnabled()) return res.status(503).json({ error: 'premium_voice_disabled', fallback: 'browser' });
    const parsed = SpeechRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_speech_request' });
    if (parsed.data.voiceId && !voicesFor(parsed.data.language, parsed.data.arabicStyle).some(voice => voice.id === parsed.data.voiceId)) return res.status(400).json({ error: 'invalid_voice' });
    const { voice, provider } = router.route(parsed.data);
    if (!provider) return res.status(503).json({ error: 'premium_voice_unavailable', fallback: 'browser' });
    let userId: string | null;
    try { userId = await (options.resolveUser ?? sessionUser)(req); }
    catch { return res.status(503).json({ error: 'premium_auth_unavailable', fallback: 'browser' }); }
    const anonymous = !userId;
    if (anonymous && !(voice.provider === 'AZURE' && allowGuestAzure())) return res.status(401).json({ error: 'sign_in_required', fallback: 'browser' });
    const actorId = userId ?? `guest:${req.ip ?? 'unknown'}`;
    const actorLimits = anonymous ? {
      ...limits,
      userRequestsPerMinute: Math.min(limits.userRequestsPerMinute, 6),
      userCharactersPerMinute: Math.min(limits.userCharactersPerMinute, 1800),
      userCharactersPerDay: Math.min(limits.userCharactersPerDay, 6000),
    } : limits;
    if (active >= limits.concurrent) return res.status(429).json({ error: 'speech_capacity_limited', fallback: 'browser' });
    const now = Date.now(), chars = Array.from(parsed.data.text).length;
    const ip = req.ip ?? 'unknown';
    const minuteReset = now + 60_000;
    const dayReset = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;
    // Check all buckets before charging any. All updates are synchronous in one event loop.
    const minute = userMinute.get(actorId), day = userDay.get(actorId), globalUsage = globalDay.get('all'), ipUsage = ipMinute.get(ip);
    const liveMinute = minute && minute.resetsAt > now ? minute : undefined;
    const liveDay = day && day.resetsAt > now ? day : undefined;
    const liveGlobal = globalUsage && globalUsage.resetsAt > now ? globalUsage : undefined;
    const liveIp = ipUsage && ipUsage.resetsAt > now ? ipUsage : undefined;
    if ((liveMinute?.requests ?? 0) + 1 > actorLimits.userRequestsPerMinute ||
        (liveMinute?.characters ?? 0) + chars > actorLimits.userCharactersPerMinute ||
        (liveDay?.characters ?? 0) + chars > actorLimits.userCharactersPerDay ||
        (liveGlobal?.characters ?? 0) + chars > limits.globalCharactersPerDay ||
        (liveIp?.requests ?? 0) + 1 > limits.ipRequestsPerMinute) return res.status(429).json({ error: 'speech_quota_exceeded', fallback: 'browser' });
    consume(userMinute, actorId, now, minuteReset, chars, actorLimits.userRequestsPerMinute, actorLimits.userCharactersPerMinute);
    consume(userDay, actorId, now, dayReset, chars, Number.MAX_SAFE_INTEGER, actorLimits.userCharactersPerDay);
    consume(globalDay, 'all', now, dayReset, chars, Number.MAX_SAFE_INTEGER, limits.globalCharactersPerDay);
    consume(ipMinute, ip, now, minuteReset, 0, limits.ipRequestsPerMinute, Number.MAX_SAFE_INTEGER);
    prune(userMinute, now); prune(userDay, now); prune(ipMinute, now);
    active++;
    const started = performance.now();
    const disconnected = new AbortController();
    const onClose = () => disconnected.abort();
    res.once('close', onClose);
    try {
      const signal = AbortSignal.any([AbortSignal.timeout(15000), disconnected.signal]);
      const audio = await Promise.race([provider.synthesize(parsed.data, voice, signal), new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(new Error('speech_aborted'));
        else signal.addEventListener('abort', () => reject(new Error('speech_aborted')), { once: true });
      })]);
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) return res.status(502).json({ error: 'invalid_audio_response', fallback: 'browser' });
      const elapsed = Math.round(performance.now() - started);
      return res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store', 'Server-Timing': `synthesis;dur=${elapsed}` }).send(audio);
    } catch {
      // Deliberately never log the request body, provider response, or sensitive speech text.
      if (res.destroyed || res.headersSent) return;
      return res.status(502).json({ error: 'premium_voice_failed', fallback: 'browser' });
    } finally {
      active--;
      res.off('close', onClose);
    }
  });
  // Body parser failures can contain excerpts of the submitted text in their
  // exception message; never let Express render or log that exception.
  app.use('/api/speech', (_error: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) => {
    res.set('Cache-Control', 'no-store').status(400).json({ error: 'invalid_speech_request', fallback: 'browser' });
  });
}
