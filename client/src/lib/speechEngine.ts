import { previewText, priorityRank, voicesFor, type ArabicStyle, type SpeechContext, type SpeechLanguage, type SpeechPriority, type SpeechRequest } from '@shared/speech';

export type SpeechPreferences = { language: SpeechLanguage; arabicStyle: ArabicStyle; gender: 'FEMALE' | 'MALE'; voiceId: string; rate: number; screenReaderMode: boolean; preferAzureArabic: boolean };
const storageKey = 'basira-speech-preferences-v1';
const defaults: SpeechPreferences = { language: 'ar', arabicStyle: 'SAUDI', gender: 'FEMALE', voiceId: 'ar-SA-ZariyahNeural', rate: 1, screenReaderMode: false, preferAzureArabic: true };
export function getSpeechPreferences(): SpeechPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<SpeechPreferences>;
    const language = ['ar', 'en', 'zh-CN'].includes(raw.language || '') ? raw.language! : defaults.language;
    // Earlier releases treated an absent setting as MSA, which selected a
    // non-configured provider and caused an invisible browser-voice fallback.
    const preferAzureArabic = raw.preferAzureArabic !== false;
    const arabicStyle = language === 'ar' && preferAzureArabic ? 'SAUDI' : raw.arabicStyle === 'SAUDI' ? 'SAUDI' : 'MSA';
    const gender = raw.gender === 'MALE' ? 'MALE' : 'FEMALE';
    const choices = voicesFor(language, arabicStyle);
    return { language, arabicStyle, gender, voiceId: choices.find(v => v.id === raw.voiceId && v.gender === gender)?.id ?? choices.find(v => v.gender === gender)!.id, rate: typeof raw.rate === 'number' && raw.rate >= .7 && raw.rate <= 1.3 ? raw.rate : 1, screenReaderMode: raw.screenReaderMode === true, preferAzureArabic };
  } catch { return { ...defaults }; }
}
export function saveSpeechPreferences(value: SpeechPreferences) {
  localStorage.setItem(storageKey, JSON.stringify(value));
  window.dispatchEvent(new Event('basira-speech-preferences'));
}

export type SpeechState = { mode: 'PREMIUM' | 'LOCAL' | 'MUTED'; isSpeaking: boolean; error?: 'PLAYBACK_BLOCKED' | 'NO_VOICE' };
export type SpeechMetrics = { requests: number; firstAudioMs: number[]; synthesisMs: number[]; playbackStartMs: number[]; fallbacks: number };
export interface TtsProvider {
  isAvailable(): boolean;
  synthesize(input: SpeechRequest, signal: AbortSignal): Promise<Blob>;
  stop(): void;
}

export class PremiumTtsProvider implements TtsProvider {
  isAvailable() { return typeof navigator !== 'undefined' && navigator.onLine; }
  async synthesize(input: SpeechRequest, signal: AbortSignal) {
    const response = await fetch('/api/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
    if (!response.ok) throw new Error('premium_unavailable');
    return response.blob();
  }
  stop() { /* Fetch cancellation is owned by the playback manager. */ }
}

type Item = { input: SpeechRequest; priority: SpeechPriority; pauseAfterMs: number; key?: string; expiresAt?:number; manualTest:boolean; localOnly:boolean; onStarted?:()=>void; resolve: () => void };
export class AudioPlaybackManager {
  private queue: Item[] = [];
  private current: Item | null = null;
  private abort: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerResolve: (() => void) | null = null;
  private generation = 0;
  private cancellations = 0;
  private suspended = false;
  private prepared = new Map<string, { input: SpeechRequest; promise: Promise<Blob>; abort: AbortController; startedAt: number; readyAt: number | null }>();
  private listeners = new Set<(state: SpeechState) => void>();
  private state: SpeechState = { mode: 'LOCAL', isSpeaking: false };
  readonly metrics: SpeechMetrics = { requests: 0, firstAudioMs: [], synthesisMs: [], playbackStartMs: [], fallbacks: 0 };
  constructor(private readonly premium: TtsProvider = new PremiumTtsProvider()) {}
  subscribe(listener: (state: SpeechState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(state: SpeechState) { this.state = state; this.listeners.forEach(listener => listener(state)); }
  get status() { return this.state; }
  get busy() { return this.current!==null||this.queue.length>0; }
  get cancellationEpoch() { return this.cancellations; }
  /** Capture before a feature fetch/timer. Text may still finish, but its old
   * automatic voice must not restart after Stop or native suspend/resume. */
  captureSpeechGuard() {
    const epoch=this.cancellations,eligible=!this.suspended;
    return()=>eligible&&!this.suspended&&epoch===this.cancellations;
  }
  private muted() { return typeof localStorage !== 'undefined' && getSpeechPreferences().screenReaderMode; }
  enqueueLocal(input:SpeechRequest,expiresAt?:number,manualTest=false) {
    return this.enqueue(input,'INFORMATION',0,undefined,manualTest,expiresAt,true);
  }
  /** Resolve true at actual playback start, false if cancelled, expired or unavailable. */
  enqueueLocalObserved(input:SpeechRequest,expiresAt:number) {
    return new Promise<boolean>(resolve=>{
      let started=false;
      void this.enqueue(input,'INFORMATION',0,undefined,false,expiresAt,true,()=>{started=true;resolve(true);}).then(()=>resolve(started));
    });
  }
  enqueue(input: SpeechRequest, priority: SpeechPriority = 'INFORMATION', pauseAfterMs = 0, key?: string, manualTest = false, expiresAt?:number,localOnly=false,onStarted?:()=>void) {
    // A late feature response or delayed callback must not recreate speech
    // after native tab/background suspension. Discard it rather than queue it.
    if(this.suspended)return Promise.resolve();
    if (!input.text.trim() || (this.muted() && !manualTest)) { this.update({ mode: 'MUTED', isSpeaking: false }); return Promise.resolve(); }
    return new Promise<void>(resolve => {
      const item = { input, priority, pauseAfterMs, key, expiresAt, manualTest,localOnly,onStarted, resolve };
      if (this.current && priorityRank[priority] > priorityRank[this.current.priority]) {
        this.cancelCurrent();
        this.queue = this.queue.filter(old => { if (priorityRank[old.priority] < priorityRank[priority]) { old.resolve(); return false; } return true; });
      }
      this.queue.push(item);
      this.queue.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]);
      void this.next();
    });
  }
  private cancelCurrent() {
    this.generation++;
    this.cancellations++;
    this.abort?.abort(); this.abort = null;
    this.premium.stop();
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
    try { window.speechSynthesis?.cancel(); } catch { /* browser speech is optional */ }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerResolve?.(); this.timerResolve = null;
    this.current?.resolve(); this.current = null;
    this.update({ ...this.state, isSpeaking: false });
  }
  stop() { this.cancelCurrent(); this.queue.forEach(item => item.resolve()); this.queue = []; this.clearPrefetch(); }
  suspend() { this.suspended=true;this.stop(); }
  /** Only permits subsequent requests. Cancelled/withheld speech is never replayed. */
  resume() { this.suspended=false; }
  replaceAtPriority(priority: SpeechPriority) {
    let removed = false;
    this.queue = this.queue.filter(item => { if (priorityRank[item.priority] <= priorityRank[priority]) { item.resolve(); removed = true; return false; } return true; });
    if (removed) this.cancellations++;
    if (this.current && priorityRank[this.current.priority] <= priorityRank[priority]) this.cancelCurrent();
  }
  clearPrefetch() { this.prepared.forEach(item => item.abort.abort()); this.prepared.clear(); }
  prefetch(key: string, input: SpeechRequest) {
    if (this.suspended || !this.premium.isAvailable() || this.muted() || this.prepared.has(key)) return;
    if (this.prepared.size >= 3) {
      const first = this.prepared.keys().next().value;
      if (first) { this.prepared.get(first)?.abort.abort(); this.prepared.delete(first); }
    }
    const abort = new AbortController();
    const startedAt = performance.now();
    const promise = this.premium.synthesize(input, abort.signal);
    const entry = { input, promise, abort, startedAt, readyAt: null as number | null };
    promise.then(() => { entry.readyAt = performance.now(); }).catch(() => {});
    promise.catch(() => { if (this.prepared.get(key)?.promise === promise) this.prepared.delete(key); });
    this.prepared.set(key, entry);
  }
  private async next() {
    if (this.suspended || this.current || !this.queue.length) return;
    const item = this.queue.shift()!; this.current = item;
    const expired=()=>item.expiresAt!==undefined&&(!Number.isFinite(item.expiresAt)||performance.now()>=item.expiresAt);
    const muted=()=>this.suspended||(this.muted()&&!item.manualTest);
    if(expired()){this.current=null;item.resolve();void this.next();return;}
    const generation = ++this.generation;
    const abort = new AbortController(); this.abort = abort;
    const start = performance.now(); this.metrics.requests++;
    const expiryTimer=item.expiresAt===undefined?undefined:setTimeout(()=>abort.abort(),Math.max(0,item.expiresAt-performance.now()));
    try {
      if (item.localOnly || !this.premium.isAvailable()) throw new Error('local_speech');
      const prepared = item.key ? this.prepared.get(item.key) : undefined;
      const usedPrepared = Boolean(prepared && JSON.stringify(prepared.input) === JSON.stringify(item.input));
      const blob = usedPrepared ? await prepared!.promise : await this.premium.synthesize(item.input, abort.signal);
      if (generation !== this.generation) return;
      if(expired()||abort.signal.aborted||muted())throw new Error('speech_expired');
      if (item.key) { if (!usedPrepared) prepared?.abort.abort(); this.prepared.delete(item.key); }
      const synthesizedAt = usedPrepared ? prepared!.readyAt ?? performance.now() : performance.now();
      const requestStart = usedPrepared ? prepared!.startedAt : start;
      this.record(this.metrics.firstAudioMs, synthesizedAt - requestStart);
      this.record(this.metrics.synthesisMs, synthesizedAt - requestStart);
      const url = URL.createObjectURL(blob);
      try {
        const audio = new Audio(url); this.audio = audio;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve(); audio.onerror = () => reject(new Error('audio_playback_failed'));
          abort.signal.addEventListener('abort', () => resolve(), { once: true });
          audio.play().then(() => {
            if (generation !== this.generation) return;
            if(expired()||abort.signal.aborted||muted()){audio.pause();resolve();return;}
            if(expiryTimer!==undefined)clearTimeout(expiryTimer);
            this.record(this.metrics.playbackStartMs, performance.now() - start);
            this.update({ mode: 'PREMIUM', isSpeaking: true });
          }).catch(reject);
        });
      } finally { URL.revokeObjectURL(url); this.audio = null; }
    } catch {
      if (generation !== this.generation) return;
      if(!expired()&&!abort.signal.aborted&&!muted()){
        if(expiryTimer!==undefined)clearTimeout(expiryTimer);
        if(!item.localOnly)this.metrics.fallbacks++;
        await this.browserFallback(item.input, generation, abort.signal, item.expiresAt,item.localOnly,item.onStarted);
      }
    } finally {
      if(expiryTimer!==undefined)clearTimeout(expiryTimer);
    }
    if (generation !== this.generation) return;
    this.current = null; this.abort = null; item.resolve();
    this.update({ ...this.state, isSpeaking: false });
    if (item.pauseAfterMs) await new Promise<void>(resolve => { this.timerResolve = resolve; this.timer = setTimeout(() => { this.timer = null; this.timerResolve = null; resolve(); }, item.pauseAfterMs); });
    if (generation === this.generation) void this.next();
  }
  private browserFallback(input: SpeechRequest, generation: number, signal: AbortSignal, expiresAt?:number,localOnly=false,onStarted?:()=>void) {
    return new Promise<void>(resolve => {
      if(this.suspended||signal.aborted||generation!==this.generation){resolve();return;}
      if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') { this.update({mode:'LOCAL',isSpeaking:false,error:'NO_VOICE'});resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(input.text);
      utterance.lang = input.language === 'ar' ? (input.arabicStyle === 'SAUDI' ? 'ar-SA' : 'ar') : input.language === 'en' ? 'en-US' : 'zh-CN';
      utterance.rate = input.rate;
      const voices = window.speechSynthesis.getVoices().filter(v=>!localOnly||v.localService===true);
      utterance.voice = voices.find(v => v.lang.toLowerCase() === utterance.lang.toLowerCase()) ?? voices.find(v => v.lang.toLowerCase().startsWith(input.language.slice(0, 2))) ?? null;
      if(localOnly&&!utterance.voice){this.update({mode:'LOCAL',isSpeaking:false,error:'NO_VOICE'});resolve();return;}
      let started=false,finished=false;
      const expired=()=>expiresAt!==undefined&&performance.now()>=expiresAt;
      const expiry=expiresAt===undefined?undefined:setTimeout(()=>{
        if(!started&&generation===this.generation){this.update({mode:'LOCAL',isSpeaking:false,error:'PLAYBACK_BLOCKED'});window.speechSynthesis.cancel();finish();}
      },Math.max(0,expiresAt-performance.now()));
      const timer=setTimeout(()=>{if(!started&&generation===this.generation){this.update({mode:'LOCAL',isSpeaking:false,error:'PLAYBACK_BLOCKED'});window.speechSynthesis.cancel();}finish();},8000);
      const finish=()=>{finished=true;clearTimeout(timer);if(expiry!==undefined)clearTimeout(expiry);signal.removeEventListener('abort',finish);resolve();};
      utterance.onstart = () => {
        if(finished)return;
        if(this.suspended||expired()||signal.aborted||generation!==this.generation){window.speechSynthesis.cancel();finish();return;}
        started=true;clearTimeout(timer);if(expiry!==undefined)clearTimeout(expiry);
        this.update({ mode: 'LOCAL', isSpeaking: true,error:undefined });
        onStarted?.();
      };
      utterance.onend = finish;
      utterance.onerror = () => {if(!finished&&generation===this.generation)this.update({mode:'LOCAL',isSpeaking:false,error:'PLAYBACK_BLOCKED'});finish();};
      signal.addEventListener('abort',finish,{ once: true });
      try { window.speechSynthesis.resume?.();window.speechSynthesis.speak(utterance); } catch {this.update({mode:'LOCAL',isSpeaking:false,error:'PLAYBACK_BLOCKED'});finish();}
    });
  }
  private record(series: number[], value: number) { series.push(value); if (series.length > 100) series.shift(); }
}

export const speechEngine = new AudioPlaybackManager();
/** A deliberate tap may preview audio even while automatic speech is muted for VoiceOver. */
export function testSpeech(text: string, language: SpeechLanguage) {
  speechEngine.replaceAtPriority('INFORMATION');
  return speechEngine.enqueue(speechInput(text, language, 'GENERAL'), 'INFORMATION', 0, undefined, true);
}
export function speechInput(text: string, language: SpeechLanguage, context: SpeechContext = 'GENERAL', rate = 1): SpeechRequest {
  const preferences = getSpeechPreferences();
  const arabicStyle = preferences.arabicStyle;
  const voices = voicesFor(language, arabicStyle);
  const voiceId = voices.some(voice => voice.id === preferences.voiceId) ? preferences.voiceId : voices.find(voice => voice.gender === preferences.gender)?.id ?? voices[0].id;
  const profile = context === 'NAVIGATION' ? 1.05 : context === 'EXAM' || context === 'QUESTION' || context === 'ANSWER_OPTION' ? .92 : context === 'SAFETY' ? 1 : 1;
  return { text, language, arabicStyle, voiceId, context, rate: Math.max(.7, Math.min(1.3, rate * profile * preferences.rate)) };
}
export function voicePreview() {
  const p = getSpeechPreferences();
  const text = p.language === 'ar' ? previewText[p.arabicStyle] : previewText[p.language];
  speechEngine.replaceAtPriority('INFORMATION');
  return speechEngine.enqueue(speechInput(text, p.language, 'GENERAL'), 'INFORMATION', 0, undefined, true);
}
