import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import BrandLogo from "./BrandLogo";
import { ForwardArrow } from "./DirectionalIcon";
import { useCommonMessages, useI18n, type Lang } from "@/i18n";

interface WelcomeScreenProps {
  onDismiss: () => void;
}

/** Exact on-screen duration of the welcome sequence. */
export const WELCOME_DURATION_MS = 10_000;

/**
 * One pre-mixed 10-second track per language (welcome music + bell at 0.12 s +
 * spoken welcome at 1.6 s). A single media element keeps every layer in sync
 * and makes overlapping or duplicated playback impossible.
 */
export const WELCOME_AUDIO_SRC: Record<Lang, string> = {
  ar: "/audio/welcome-ar.mp3",
  en: "/audio/welcome-en.mp3",
  "zh-CN": "/audio/welcome-zh-CN.mp3",
};

const WELCOME_VOLUME = 0.85;
const FADE_OUT_MS = 380;
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/** Only one welcome track may exist in the page at any time. */
let activeWelcomeAudio: HTMLAudioElement | null = null;

function releaseAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (activeWelcomeAudio === audio) activeWelcomeAudio = null;
}

export default function WelcomeScreen({ onDismiss }: WelcomeScreenProps) {
  const reduceMotion = useReducedMotion();
  const { lang } = useI18n();
  const t = useCommonMessages();
  const [leaving, setLeaving] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const leaveRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);
  const playRequestedRef = useRef(false);
  const removeUnlockRef = useRef<() => void>(() => undefined);
  const fadeTimerRef = useRef<number | null>(null);

  const stopSound = useCallback((fade: boolean) => {
    removeUnlockRef.current();
    const audio = audioRef.current;
    if (!audio) return;
    audioRef.current = null;
    if (!fade || audio.paused) {
      releaseAudio(audio);
      return;
    }
    const startVolume = audio.volume;
    const startedAt = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / FADE_OUT_MS);
      audio.volume = Math.max(0, startVolume * (1 - progress));
      if (progress < 1) fadeTimerRef.current = window.requestAnimationFrame(step);
      else releaseAudio(audio);
    };
    fadeTimerRef.current = window.requestAnimationFrame(step);
  }, []);

  const close = useCallback((skip = false) => {
    if (leaveRef.current) return;
    leaveRef.current = true;
    // A skipped welcome stops immediately. For the timed close, the mixed
    // track fades within its own 10-second timeline and is stopped at 10 s.
    if (skip) stopSound(false);
    setLeaving(true);
    window.setTimeout(() => {
      if (!skip) stopSound(false);
      onDismiss();
      document.querySelector<HTMLElement>("main")?.focus();
    }, reduceMotion ? 0 : 520);
  }, [onDismiss, reduceMotion, stopSound]);

  // Audio: try unmuted autoplay immediately; fall back to the first gesture only when the browser forbids it.
  useEffect(() => {
    releaseAudio(activeWelcomeAudio);
    const audio = new Audio(WELCOME_AUDIO_SRC[lang]);
    audio.preload = "auto";
    audio.volume = WELCOME_VOLUME;
    audio.loop = false;
    audioRef.current = audio;
    activeWelcomeAudio = audio;
    startedAtRef.current = performance.now();
    playRequestedRef.current = false;

    const attemptPlay = (fromGesture: boolean) => {
      if (leaveRef.current || audioRef.current !== audio || playRequestedRef.current) return;
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      // Keep the sound aligned with the visual timeline when it starts late.
      if (elapsed >= WELCOME_DURATION_MS / 1000 - 0.8) return;
      if (fromGesture && elapsed > 0.25) {
        try { audio.currentTime = elapsed; } catch { /* metadata not loaded yet */ }
      }
      playRequestedRef.current = true;
      audio.play().then(() => {
        setSoundBlocked(false);
        removeUnlockRef.current();
      }).catch((error: unknown) => {
        playRequestedRef.current = false;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError") setSoundBlocked(true);
        // AbortError / NotSupportedError: never break the welcome experience.
      });
    };

    const onGesture = () => attemptPlay(true);
    UNLOCK_EVENTS.forEach(type => window.addEventListener(type, onGesture, { capture: true, passive: true }));
    removeUnlockRef.current = () => {
      UNLOCK_EVENTS.forEach(type => window.removeEventListener(type, onGesture, { capture: true }));
      removeUnlockRef.current = () => undefined;
    };

    attemptPlay(false);

    return () => {
      removeUnlockRef.current();
      if (fadeTimerRef.current !== null) window.cancelAnimationFrame(fadeTimerRef.current);
      releaseAudio(audio);
      if (audioRef.current === audio) audioRef.current = null;
    };
    // The track language is fixed for the lifetime of the welcome screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    buttonRef.current?.focus();
    // Start the 520 ms exit transition *inside* the 10-second window.
    const timer = window.setTimeout(() => close(false), WELCOME_DURATION_MS - (reduceMotion ? 0 : 520));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
      if (event.key === "Tab") {
        event.preventDefault();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, reduceMotion]);

  const reveal = (delay: number, distance = 24) => reduceMotion
    ? { initial: false as const, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: distance, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-description"
      className="aurum-welcome fixed inset-0 z-[100] isolate grid place-items-center overflow-hidden px-5 py-8 text-center"
      initial={false}
      animate={{ opacity: leaving ? 0 : 1, scale: leaving ? 1.018 : 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.52, ease: "easeOut" }}
    >
      <div aria-hidden="true" className="aurum-stage pointer-events-none absolute inset-0">
        <div className="aurum-stage__grain" />
        <div className="aurum-stage__veil" />
        <div className="aurum-stage__orbit aurum-stage__orbit--outer" />
        <div className="aurum-stage__orbit aurum-stage__orbit--middle" />
        <div className="aurum-stage__orbit aurum-stage__orbit--inner" />
        <div className="aurum-stage__ray aurum-stage__ray--one" />
        <div className="aurum-stage__ray aurum-stage__ray--two" />
        <div className="aurum-stage__ray aurum-stage__ray--three" />
        <div className="aurum-stage__glow" />
        <div className="aurum-stage__particle aurum-stage__particle--one" />
        <div className="aurum-stage__particle aurum-stage__particle--two" />
        <div className="aurum-stage__particle aurum-stage__particle--three" />
        <div className="aurum-stage__particle aurum-stage__particle--four" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center">
        <motion.div {...reveal(0.08, 12)} className="mb-7 flex items-center gap-3 text-[0.65rem] font-bold uppercase tracking-[0.42em] text-amber-200 sm:text-xs">
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-200/70 sm:w-16" />
          AURUM NEXUS
          <span className="h-px w-8 bg-gradient-to-l from-transparent to-amber-200/70 sm:w-16" />
        </motion.div>

        <motion.div {...reveal(0.22, 18)} className="aurum-stage__mark relative mb-8 grid aspect-square w-40 place-items-center sm:w-56">
          <span className="aurum-stage__halo absolute inset-0 rounded-full" aria-hidden="true" />
          <span className="aurum-stage__seal absolute inset-3 rounded-full" aria-hidden="true" />
          <span className="aurum-stage__spark aurum-stage__spark--north" aria-hidden="true" />
          <span className="aurum-stage__spark aurum-stage__spark--east" aria-hidden="true" />
          <BrandLogo
            alt={t.brand.logoAlt}
            className="relative z-10 h-[78%] w-[78%] rounded-full border border-amber-100/40 shadow-[0_0_90px_rgba(226,164,48,0.3)]"
            fetchPriority="high"
          />
        </motion.div>

        <motion.p {...reveal(0.58, 16)} className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200">
          <Sparkles aria-hidden="true" className="h-4 w-4" /> {t.welcome.eyebrow}
        </motion.p>
        <motion.h1 {...reveal(0.74, 22)} id="welcome-title" className="text-5xl font-black leading-[1.15] text-white sm:text-7xl">
          {t.welcome.titleBefore}<span className="aurum-stage__gold">{t.welcome.titleBrand}</span>{t.welcome.titleAfter}
        </motion.h1>
        <motion.p {...reveal(0.98, 18)} id="welcome-description" className="mt-5 max-w-xl text-base leading-8 text-stone-300 sm:text-lg">
          {t.welcome.description}
        </motion.p>

        <motion.div {...reveal(1.22, 14)} className="mt-9 flex flex-col items-center gap-3">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => close(true)}
            className="aurum-stage__enter inline-flex min-h-12 items-center justify-center gap-3 rounded-2xl px-10 py-3 font-extrabold text-[#15120d] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-amber-100"
          >
            {t.welcome.enter} <ForwardArrow aria-hidden="true" className="h-5 w-5" />
          </button>
          <p className="text-xs text-stone-400" aria-live="polite">{soundBlocked ? t.welcome.blockedHint : t.welcome.hint}</p>
        </motion.div>

        <div aria-hidden="true" className="aurum-stage__progress mt-8 h-px w-52 overflow-hidden bg-amber-200/20 sm:w-64">
          <div className="h-full w-full origin-right bg-gradient-to-l from-transparent via-amber-200 to-transparent ltr:origin-left ltr:bg-gradient-to-r" style={{ animationDuration: `${WELCOME_DURATION_MS}ms` }} />
        </div>
      </div>
    </motion.div>
  );
}
