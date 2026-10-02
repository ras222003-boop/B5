import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import BrandLogo from "./BrandLogo";

interface WelcomeScreenProps {
  onDismiss: () => void;
}

const WELCOME_AUDIO_SRC = "/audio/aurum-welcome-bell.mp3";
const AUTO_CLOSE_MS = 12000;

export default function WelcomeScreen({ onDismiss }: WelcomeScreenProps) {
  const reduceMotion = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const leaveRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const stopSound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  const close = useCallback(() => {
    if (leaveRef.current) return;
    leaveRef.current = true;
    stopSound();
    setLeaving(true);
    window.setTimeout(() => {
      onDismiss();
      document.querySelector<HTMLElement>("main")?.focus();
    }, reduceMotion ? 0 : 520);
  }, [onDismiss, reduceMotion, stopSound]);

  useEffect(() => {
    buttonRef.current?.focus();
    const audio = audioRef.current;
    if (audio) {
      audio.volume = 0.16;
      void audio.play().catch(() => undefined);
    }

    const timer = window.setTimeout(close, AUTO_CLOSE_MS);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
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

  useEffect(() => () => stopSound(), [stopSound]);

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
      <audio ref={audioRef} autoPlay preload="auto" src={WELCOME_AUDIO_SRC} />
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
            alt="شعار شركة Aurum Nexus"
            className="relative z-10 h-[78%] w-[78%] rounded-full border border-amber-100/40 shadow-[0_0_90px_rgba(226,164,48,0.3)]"
            fetchPriority="high"
          />
        </motion.div>

        <motion.p {...reveal(0.58, 16)} className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200">
          <Sparkles aria-hidden="true" className="h-4 w-4" /> تجربة تعليمية أكثر استقلالًا
        </motion.p>
        <motion.h1 {...reveal(0.74, 22)} id="welcome-title" className="text-5xl font-black leading-[1.15] text-white sm:text-7xl">
          أهلًا بك في <span className="aurum-stage__gold">بصيرة</span>
        </motion.h1>
        <motion.p {...reveal(0.98, 18)} id="welcome-description" className="mt-5 max-w-xl text-base leading-8 text-stone-300 sm:text-lg">
          اقرأ أسئلتك، استمع إليها، وأجب بطريقتك. مساحة هادئة صُممت لتجعل الاختبار أوضح وأسهل وصولًا.
        </motion.p>

        <motion.div {...reveal(1.22, 14)} className="mt-9 flex flex-col items-center gap-3">
          <button
            ref={buttonRef}
            type="button"
            onClick={close}
            className="aurum-stage__enter inline-flex min-h-12 items-center justify-center gap-3 rounded-2xl px-10 py-3 font-extrabold text-[#15120d] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-amber-100"
          >
            ادخل المنصة <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          </button>
          <p className="text-xs text-stone-400">يبدأ الجرس تلقائيًا عند فتح المنصة؛ اضغط دخول أو Esc للتخطي.</p>
        </motion.div>

        <div aria-hidden="true" className="aurum-stage__progress mt-8 h-px w-52 overflow-hidden bg-amber-200/20 sm:w-64">
          <div className="h-full w-full origin-right bg-gradient-to-l from-transparent via-amber-200 to-transparent" style={{ animationDuration: `${AUTO_CLOSE_MS}ms` }} />
        </div>
      </div>
    </motion.div>
  );
}
