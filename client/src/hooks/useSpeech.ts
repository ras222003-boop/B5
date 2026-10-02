import { useCallback, useEffect, useRef, useState } from "react";
import { LANG_META, useI18n, type Lang } from "@/i18n";

export type SpeechLanguage = Lang;

/* -------------------------------------------------------------------------- */
/* Language detection                                                          */
/* -------------------------------------------------------------------------- */

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const LATIN_RE = /[A-Za-z]/g;

/** Detects whether a text is mainly Arabic, English or Simplified Chinese. */
export function detectLanguage(text: string, fallback: SpeechLanguage = "ar"): SpeechLanguage {
  const arabic = (text.match(ARABIC_RE) || []).length;
  const cjk = (text.match(CJK_RE) || []).length;
  // A Chinese character carries roughly a word; weight it so short CJK runs win over stray Latin letters.
  const cjkWeight = cjk * 2;
  const latin = (text.match(LATIN_RE) || []).length;
  if (!arabic && !cjk && !latin) return fallback;
  if (cjkWeight >= arabic && cjkWeight >= latin && cjk > 0) return "zh-CN";
  return arabic >= latin ? "ar" : "en";
}

/* -------------------------------------------------------------------------- */
/* Voice selection                                                             */
/* -------------------------------------------------------------------------- */

interface VoiceProfile {
  rate: number;
  pitch: number;
  volume: number;
  /** Pause after the question before reading options (ms). */
  questionPauseMs: number;
  /** Pause between options (ms). */
  optionPauseMs: number;
}

/** Tuned for intelligibility: Arabic slightly slower for diacritics, Chinese slower for tones. */
export const VOICE_PROFILES: Record<SpeechLanguage, VoiceProfile> = {
  ar: { rate: 0.86, pitch: 1.0, volume: 1, questionPauseMs: 850, optionPauseMs: 520 },
  en: { rate: 0.94, pitch: 1.0, volume: 1, questionPauseMs: 700, optionPauseMs: 420 },
  "zh-CN": { rate: 0.88, pitch: 1.0, volume: 1, questionPauseMs: 800, optionPauseMs: 480 },
};

const QUALITY_HINTS = /(natural|neural|online|premium|enhanced|wavenet|studio)/i;
const KNOWN_GOOD: Record<SpeechLanguage, RegExp> = {
  ar: /(hamed|zariyah|maged|laila|tarik|naayf|google\s+العربية|arabic)/i,
  en: /(aria|jenny|guy|samantha|alex|google us english|ava|allison)/i,
  "zh-CN": /(xiaoxiao|yunxi|xiaoyi|tingting|google\s+普通话|huihui|yaoyao|kangkang|lili)/i,
};
const LOW_QUALITY = /(espeak|compact|robot|whisper|novelty|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|zarvox)/i;

function normalizedTag(tag: string) {
  return tag.replace("_", "-").toLowerCase();
}

/** Scores one voice for a target language; higher is better, negative means unusable. */
export function scoreVoice(voice: Pick<SpeechSynthesisVoice, "lang" | "name" | "localService" | "default">, lang: SpeechLanguage): number {
  const tag = normalizedTag(voice.lang || "");
  const target = normalizedTag(LANG_META[lang].speechLang);
  let score = 0;

  if (lang === "zh-CN") {
    if (tag === "zh-cn" || tag === "cmn-hans-cn" || tag === "zh-hans-cn" || tag === "zh-hans") score += 60;
    else if (tag.startsWith("cmn") || tag === "zh") score += 45;
    else if (tag.startsWith("zh-tw") || tag.startsWith("zh-hk") || tag.startsWith("yue")) score += 8;
    else if (tag.startsWith("zh")) score += 30;
    else return -1;
  } else {
    const prefix = target.split("-")[0];
    if (tag === target) score += 60;
    else if (tag.startsWith(prefix)) score += lang === "en" && /^en-(gb|au|ca|ie|nz)/.test(tag) ? 40 : 35;
    else return -1;
  }

  if (QUALITY_HINTS.test(voice.name)) score += 25;
  if (KNOWN_GOOD[lang].test(voice.name)) score += 12;
  if (LOW_QUALITY.test(voice.name)) score -= 40;
  if (voice.localService) score += 4;
  if (voice.default) score += 2;
  return score;
}

export function pickBestVoice(voices: readonly SpeechSynthesisVoice[], lang: SpeechLanguage): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = scoreVoice(voice, lang);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

function getSynth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
function loadVoices(): SpeechSynthesisVoice[] {
  const synth = getSynth();
  if (!synth) return [];
  try {
    const voices = synth.getVoices();
    if (voices.length) cachedVoices = voices;
  } catch {
    /* some browsers throw while voices are loading */
  }
  return cachedVoices;
}

/* -------------------------------------------------------------------------- */
/* Text chunking                                                               */
/* -------------------------------------------------------------------------- */

const MAX_CHUNK = 180;

/** Splits long text at sentence boundaries (Arabic, Latin and Chinese punctuation) to avoid engine cut-offs. */
export function splitForSpeech(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?؟。！？;؛\n]+[.!?؟。！？;؛]*/g) || [clean];
  const chunks: string[] = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if ((current + " " + sentence).trim().length <= MAX_CHUNK) {
      current = (current + " " + sentence).trim();
      continue;
    }
    if (current) chunks.push(current);
    if (sentence.length <= MAX_CHUNK) {
      current = sentence;
    } else {
      const parts = sentence.split(/(?<=[,،，、:：])\s*/);
      current = "";
      for (const part of parts) {
        if ((current + " " + part).trim().length > MAX_CHUNK && current) {
          chunks.push(current);
          current = part;
        } else current = (current + " " + part).trim();
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/* -------------------------------------------------------------------------- */
/* Text-to-speech                                                              */
/* -------------------------------------------------------------------------- */

export interface SpeechSegment {
  text: string;
  lang?: SpeechLanguage;
  /** Silence after this segment, in ms. */
  pauseAfterMs?: number;
}

/**
 * Text-to-speech bound to the platform language.
 * `speak(text, rate?, forceLang?)` keeps the previous signature; when no language is forced the
 * text is auto-detected and falls back to the platform language. Failures never throw.
 */
export function useTextToSpeech() {
  const { lang: platformLang } = useI18n();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported] = useState(() => getSynth() !== null);
  const runIdRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const synth = getSynth();
    if (!synth) return;
    loadVoices();
    const onVoices = () => loadVoices();
    try {
      synth.addEventListener?.("voiceschanged", onVoices);
    } catch {
      /* older engines */
    }
    return () => {
      try {
        synth.removeEventListener?.("voiceschanged", onVoices);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach(id => window.clearTimeout(id));
    timersRef.current = [];
  };

  const stop = useCallback(() => {
    runIdRef.current += 1;
    clearTimers();
    try {
      getSynth()?.cancel();
    } catch {
      /* ignore */
    }
    setIsSpeaking(false);
  }, []);

  const speakSequence = useCallback((segments: SpeechSegment[], rateMultiplier = 1): boolean => {
    const synth = getSynth();
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;
    stop();
    const runId = runIdRef.current;
    const queue = segments.flatMap(segment => {
      const lang = segment.lang ?? detectLanguage(segment.text, platformLang);
      const chunks = splitForSpeech(segment.text);
      return chunks.map((chunk, index) => ({ text: chunk, lang, pauseAfterMs: index === chunks.length - 1 ? segment.pauseAfterMs ?? 0 : 120 }));
    });
    if (!queue.length) return false;

    const voices = loadVoices();
    const speakAt = (index: number) => {
      if (runIdRef.current !== runId) return;
      if (index >= queue.length) {
        setIsSpeaking(false);
        return;
      }
      const item = queue[index];
      const profile = VOICE_PROFILES[item.lang];
      try {
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.lang = LANG_META[item.lang].speechLang;
        const voice = pickBestVoice(voices, item.lang);
        if (voice) utterance.voice = voice;
        utterance.rate = Math.min(1.6, Math.max(0.5, profile.rate * rateMultiplier));
        utterance.pitch = profile.pitch;
        utterance.volume = profile.volume;
        utterance.onstart = () => {
          if (runIdRef.current === runId) setIsSpeaking(true);
        };
        const next = () => {
          if (runIdRef.current !== runId) return;
          if (item.pauseAfterMs > 0) timersRef.current.push(window.setTimeout(() => speakAt(index + 1), item.pauseAfterMs));
          else speakAt(index + 1);
        };
        utterance.onend = next;
        utterance.onerror = event => {
          // "interrupted"/"canceled" come from stop(); other errors skip to the next chunk.
          if (event.error === "interrupted" || event.error === "canceled") return;
          next();
        };
        synth.speak(utterance);
        if (synth.paused) synth.resume();
      } catch {
        setIsSpeaking(false);
      }
    };
    setIsSpeaking(true);
    speakAt(0);
    return true;
  }, [platformLang, stop]);

  /** Backwards-compatible: `rate` is a multiplier around the tuned per-language rate (0.9 ≈ default). */
  const speak = useCallback((text: string, rate: number = 0.9, forceLang?: SpeechLanguage) => {
    return speakSequence([{ text, lang: forceLang }], rate / 0.9);
  }, [speakSequence]);

  /** Reads a question, pauses, then reads each option with its label and a shorter pause. */
  const speakQuestion = useCallback((question: string, options: readonly string[] = [], forceLang?: SpeechLanguage, rate = 0.9) => {
    const lang = forceLang ?? detectLanguage([question, ...options].join(" "), platformLang);
    const profile = VOICE_PROFILES[lang];
    const segments: SpeechSegment[] = [{ text: question, lang, pauseAfterMs: options.length ? profile.questionPauseMs : 0 }];
    options.forEach((option, index) => segments.push({ text: option, lang, pauseAfterMs: index === options.length - 1 ? 0 : profile.optionPauseMs }));
    return speakSequence(segments, rate / 0.9);
  }, [platformLang, speakSequence]);

  useEffect(() => () => {
    runIdRef.current += 1;
    clearTimers();
    try {
      getSynth()?.cancel();
    } catch {
      /* ignore */
    }
  }, []);

  return { speak, speakQuestion, speakSequence, stop, isSpeaking, isSupported };
}

/** Text-to-speech with an explicit language override control ("auto" follows the text/platform). */
export function useTextToSpeechWithLanguage() {
  const [selectedLang, setSelectedLang] = useState<SpeechLanguage | "auto">("auto");
  const { speak: baseSpeak, stop, isSpeaking, speakQuestion } = useTextToSpeech();
  const speak = useCallback((text: string, rate?: number, forceLang?: SpeechLanguage) => {
    const lang = forceLang ?? (selectedLang === "auto" ? undefined : selectedLang);
    return baseSpeak(text, rate, lang);
  }, [baseSpeak, selectedLang]);
  return { speak, speakQuestion, stop, isSpeaking, selectedLang, setSelectedLang };
}

/* -------------------------------------------------------------------------- */
/* Speech-to-text                                                              */
/* -------------------------------------------------------------------------- */

const STT_ERRORS: Record<SpeechLanguage, Record<"unsupported" | "notAllowed" | "noSpeech" | "audioCapture" | "network" | "generic", string>> = {
  ar: {
    unsupported: "المتصفح لا يدعم التعرف على الصوت. جرّب Chrome أو Edge.",
    notAllowed: "يرجى السماح بالوصول إلى الميكروفون",
    noSpeech: "لم يتم اكتشاف كلام. حاول مرة أخرى",
    audioCapture: "لم يتم العثور على ميكروفون. تأكد من توصيله",
    network: "تعذّر الاتصال بخدمة التعرف على الصوت. تحقق من الإنترنت",
    generic: "حدث خطأ في التعرف على الصوت",
  },
  en: {
    unsupported: "Your browser doesn't support speech recognition. Try Chrome or Edge.",
    notAllowed: "Please allow access to the microphone",
    noSpeech: "No speech detected. Please try again.",
    audioCapture: "No microphone found. Please check it is connected.",
    network: "Couldn't reach the speech recognition service. Check your connection.",
    generic: "A speech recognition error occurred",
  },
  "zh-CN": {
    unsupported: "你的浏览器不支持语音识别。请尝试 Chrome 或 Edge。",
    notAllowed: "请允许访问麦克风",
    noSpeech: "未检测到语音，请重试。",
    audioCapture: "未找到麦克风，请检查是否已连接。",
    network: "无法连接语音识别服务，请检查网络。",
    generic: "语音识别出错",
  },
};

/**
 * Speech-to-text bound to the platform language (ar-SA / en-US / zh-CN).
 * Pass `fixedLang` (e.g. the exam language) to override; `setLang` changes it at runtime.
 */
export function useSpeechToText(fixedLang?: SpeechLanguage) {
  const { lang: platformLang } = useI18n();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<SpeechLanguage>(fixedLang ?? platformLang);
  const recognitionRef = useRef<any>(null);

  // Follow the platform/exam language automatically.
  useEffect(() => {
    setLang(fixedLang ?? platformLang);
  }, [fixedLang, platformLang]);

  const startListening = useCallback((overrideLang?: SpeechLanguage) => {
    setError(null);
    setTranscript("");
    const activeLang = overrideLang ?? lang;
    const messages = STT_ERRORS[activeLang];
    const Recognition = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
    if (!Recognition) {
      setError(messages.unsupported);
      return;
    }
    try {
      recognitionRef.current?.abort?.();
      const recognition = new Recognition();
      recognition.lang = LANG_META[activeLang].speechLang;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          // Pick the most confident alternative.
          let best = result[0];
          for (let a = 1; a < result.length; a++) if ((result[a]?.confidence ?? 0) > (best?.confidence ?? 0)) best = result[a];
          if (result.isFinal) finalText += best.transcript;
          else interimText += best.transcript;
        }
        setTranscript((finalText || interimText).trim());
      };
      recognition.onerror = (event: any) => {
        const map: Record<string, keyof typeof messages> = {
          "not-allowed": "notAllowed",
          "service-not-allowed": "notAllowed",
          "no-speech": "noSpeech",
          "audio-capture": "audioCapture",
          network: "network",
        };
        if (event.error !== "aborted") setError(messages[map[event.error] ?? "generic"]);
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setError(messages.generic);
      setIsListening(false);
    }
  }, [lang]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop?.();
    } catch {
      /* ignore */
    }
    setIsListening(false);
  }, []);

  useEffect(() => () => {
    try {
      recognitionRef.current?.abort?.();
    } catch {
      /* ignore */
    }
  }, []);

  return { startListening, stopListening, isListening, transcript, error, setTranscript, lang, setLang };
}
