import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import BrandLogo from "./BrandLogo";

interface WelcomeScreenProps {
  onDismiss: () => void;
}

export default function WelcomeScreen({ onDismiss }: WelcomeScreenProps) {
  const shouldReduceMotion = useReducedMotion();
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  const dismiss = () => {
    if (isLeaving) return;

    setIsLeaving(true);
    window.setTimeout(onDismiss, shouldReduceMotion ? 0 : 260);
  };

  useEffect(() => {
    const focusTimer = window.setTimeout(() => continueButtonRef.current?.focus(), 120);
    const dismissTimer = window.setTimeout(dismiss, 5200);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(dismissTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <motion.section
      aria-describedby="welcome-message"
      aria-labelledby="welcome-title"
      aria-modal="true"
      className="aurum-welcome fixed inset-0 z-[100] flex items-center justify-center px-5 py-8 text-center"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: isLeaving ? 0 : 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.26 }}
      role="dialog"
    >
      <div className="aurum-welcome__halo aurum-welcome__halo--one" aria-hidden="true" />
      <div className="aurum-welcome__halo aurum-welcome__halo--two" aria-hidden="true" />

      <motion.div
        className="aurum-welcome__panel relative w-full max-w-lg overflow-hidden rounded-[2rem] border border-amber-300/35 px-7 py-9 shadow-2xl sm:px-12 sm:py-12"
        initial={shouldReduceMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
        animate={isLeaving ? { opacity: 0, y: -8, scale: 0.99 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-200 to-transparent" aria-hidden="true" />
        <div className="relative mx-auto mb-7 w-36 sm:w-40">
          <div className="absolute -inset-5 rounded-full bg-amber-300/20 blur-2xl" aria-hidden="true" />
          <BrandLogo
            alt="شعار Aurum Nexus"
            className="relative aspect-square w-full rounded-3xl ring-1 ring-amber-200/70 shadow-[0_0_40px_rgba(245,190,80,0.28)]"
            fetchPriority="high"
          />
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-1.5 text-xs font-bold tracking-[0.17em] text-amber-200">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          AURUM NEXUS
        </div>
        <p className="mt-6 text-sm font-medium text-amber-100/75">مرحبًا بك في</p>
        <h1 id="welcome-title" className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
          بصيرة
        </h1>
        <p id="welcome-message" className="mx-auto mt-4 max-w-sm text-base leading-8 text-stone-300">
          منصة الاختبارات الذكية التي تمنحك تجربة مستقلة وواضحة ومدعومة بالتقنيات المساعدة.
        </p>

        <button
          ref={continueButtonRef}
          type="button"
          onClick={dismiss}
          className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-6 py-3 text-sm font-extrabold text-[#16130d] shadow-[0_10px_30px_rgba(245,190,80,0.25)] transition hover:bg-amber-200 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-amber-100"
        >
          الدخول إلى المنصة
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="mt-4 text-xs text-stone-400">سيتم الانتقال تلقائيًا خلال لحظات. اضغط Esc للتخطي.</p>
      </motion.div>
    </motion.section>
  );
}
