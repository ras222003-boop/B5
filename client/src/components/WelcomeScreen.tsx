import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Sparkles, Volume2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import BrandLogo from "./BrandLogo";

interface WelcomeScreenProps {
  onDismiss: () => void;
}

export default function WelcomeScreen({ onDismiss }: WelcomeScreenProps) {
  const reduceMotion = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const leaveRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    if (leaveRef.current) return;
    leaveRef.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      onDismiss();
      document.querySelector<HTMLElement>("main")?.focus();
    }, reduceMotion ? 0 : 460);
  }, [onDismiss, reduceMotion]);

  useEffect(() => {
    buttonRef.current?.focus();
    const timer = window.setTimeout(close, reduceMotion ? 2600 : 7600);
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

  const reveal = (delay: number) => reduceMotion
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const } };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-description"
      className="aurum-welcome fixed inset-0 z-[100] isolate grid place-items-center overflow-hidden px-5 py-8 text-center"
      initial={false}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.46 }}
    >
      <div aria-hidden="true" className="aurum-stage pointer-events-none absolute inset-0">
        <div className="aurum-stage__orbit aurum-stage__orbit--outer" />
        <div className="aurum-stage__orbit aurum-stage__orbit--inner" />
        <div className="aurum-stage__ray aurum-stage__ray--one" />
        <div className="aurum-stage__ray aurum-stage__ray--two" />
        <div className="aurum-stage__glow" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center">
        <motion.div {...reveal(0.15)} className="mb-8 flex items-center gap-3 text-[0.65rem] font-bold uppercase tracking-[0.4em] text-amber-200 sm:text-xs">
          <span className="h-px w-7 bg-amber-300/50 sm:w-14" />
          AURUM NEXUS
          <span className="h-px w-7 bg-amber-300/50 sm:w-14" />
        </motion.div>
        <motion.div {...reveal(0.35)} className="aurum-stage__mark relative mb-9 aspect-square w-40 rounded-full sm:w-56">
          <span className="absolute -inset-5 rounded-full border border-amber-300/30" aria-hidden="true" />
          <BrandLogo alt="شعار شركة Aurum Nexus" className="relative h-full w-full rounded-full border border-amber-100/30 shadow-[0_0_85px_rgba(226,164,48,0.25)]" fetchPriority="high" />
        </motion.div>
        <motion.p {...reveal(0.7)} className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200">
          <Sparkles aria-hidden="true" className="h-4 w-4" /> تجربة تعليمية أكثر استقلالًا
        </motion.p>
        <motion.h1 {...reveal(0.9)} id="welcome-title" className="text-5xl font-black leading-tight text-white sm:text-7xl">
          أهلًا بك في <span className="aurum-stage__gold">بصيرة</span>
        </motion.h1>
        <motion.p {...reveal(1.12)} id="welcome-description" className="mt-5 max-w-xl text-base leading-8 text-stone-300 sm:text-lg">
          اقرأ أسئلتك، استمع إليها، وأجب بطريقتك. أدوات مساعدة صُممت لتجعل الاختبار أوضح وأسهل وصولًا.
        </motion.p>
        <motion.div {...reveal(1.4)} className="mt-9 flex flex-col items-center gap-4">
          <button ref={buttonRef} type="button" onClick={close} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-amber-300 px-9 py-3 font-extrabold text-[#15120d] shadow-[0_15px_55px_rgba(226,164,48,0.2)] transition-colors hover:bg-amber-200 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-amber-100">
            ادخل المنصة <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          </button>
          <p className="flex items-center gap-2 text-xs text-stone-400"><Volume2 aria-hidden="true" className="h-4 w-4" /> اضغط الزر أو Esc للتخطي؛ يبدأ الموقع تلقائيًا بعد لحظات.</p>
        </motion.div>
        <div aria-hidden="true" className="aurum-stage__progress mt-9 h-0.5 w-48 overflow-hidden rounded-full bg-amber-200/20 sm:w-60">
          <div className="h-full w-full origin-right bg-amber-300" style={{ animationDuration: reduceMotion ? "2.6s" : "7.6s" }} />
        </div>
      </div>
    </motion.div>
  );
}
