/** Floating voice navigation assistant bound to the platform language. */
import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, X, Volume2, VolumeX,
  Home, ScanLine, MessageCircle, BookOpen, Settings, HelpCircle,
  ChevronRight, Navigation2, Languages,
} from "lucide-react";
import { useLocation } from "wouter";
import { useTextToSpeech } from "@/hooks/useSpeech";
import { LANG_META, LANGS, useI18n, useMessages, type Lang } from "@/i18n";
import { voiceGuideMessages } from "@/i18n/locales/voiceGuide";

const PAGE_PATHS = {
  home: "/",
  exam: "/exam-demo",
  assistant: "/assistant",
  features: "/features",
  howItWorks: "/how-it-works",
  roboticArm: "/robotic-arm",
  onlineExams: "/online-exams",
  teacher: "/teacher",
} as const;

type PageId = keyof typeof PAGE_PATHS;

const PAGE_BY_PATH: Partial<Record<string, PageId>> = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([pageId, path]) => [path, pageId]),
) as Partial<Record<string, PageId>>;

// Keep the original command targets; longer keywords are checked first so phrases
// such as "online exams" are not mistaken for the generic "exam" command.
const NAVIGATION_ORDER = [
  "home",
  "exam",
  "assistant",
  "features",
  "howItWorks",
  "roboticArm",
  "onlineExams",
  "teacher",
] as const satisfies readonly PageId[];

const QUICK_LINKS = [
  { pageId: "home", icon: Home },
  { pageId: "exam", icon: ScanLine },
  { pageId: "assistant", icon: MessageCircle },
  { pageId: "onlineExams", icon: BookOpen },
  { pageId: "teacher", icon: Settings },
] as const satisfies readonly { pageId: PageId; icon: typeof Home }[];

const FULL_PAGE_LINKS = [
  { pageId: "exam", emoji: "📝" },
  { pageId: "assistant", emoji: "🤖" },
  { pageId: "onlineExams", emoji: "💻" },
  { pageId: "features", emoji: "⭐" },
  { pageId: "howItWorks", emoji: "📖" },
  { pageId: "roboticArm", emoji: "🦾" },
  { pageId: "teacher", emoji: "👨‍🏫" },
] as const satisfies readonly { pageId: PageId; emoji: string }[];

export default function VoiceGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState("");
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const { lang, setLang } = useI18n();
  const t = useMessages(voiceGuideMessages);
  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const recognitionRef = useRef<any>(null);
  const activePageId = PAGE_BY_PATH[location];
  const activePage = activePageId ? t.pages[activePageId] : undefined;
  const activeDescription = activePage?.description;
  const nextLang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]!;

  /** Always explicitly use the active platform language for voice output. */
  const speakForPlatform = useCallback((text: string, rate = 0.9) => {
    speak(text, rate, lang);
  }, [lang, speak]);

  const changeLanguage = useCallback((next: Lang) => {
    setLang(next);
    const nextMessages = voiceGuideMessages[next];
    speak(nextMessages.spoken.languageChanged(LANG_META[next].nativeName), 0.9, next);
  }, [setLang, speak]);

  const navigateToPage = useCallback((pageId: PageId, delay: number, shortMessage = false) => {
    const label = t.pages[pageId].label;
    speakForPlatform(shortMessage ? t.spoken.goingTo(label) : t.spoken.navigatingTo(label));
    window.setTimeout(() => setLocation(PAGE_PATHS[pageId]), delay);
  }, [setLocation, speakForPlatform, t]);

  const handleVoiceCommand = useCallback((text: string) => {
    const normalized = text.trim().toLowerCase();
    setLastCommand(text);

    const languageCommand = LANGS.find(candidate => (
      t.commands.language[candidate].some(keyword => normalized.includes(keyword.toLowerCase()))
    ));
    if (languageCommand) {
      changeLanguage(languageCommand);
      return;
    }

    const navigationCommand = NAVIGATION_ORDER
      .flatMap(pageId => t.pages[pageId].keywords.map(keyword => ({ pageId, keyword })))
      .sort((first, second) => second.keyword.length - first.keyword.length)
      .find(({ keyword }) => normalized.includes(keyword.toLowerCase()));
    if (navigationCommand) {
      navigateToPage(navigationCommand.pageId, 800);
      return;
    }

    if (t.commands.describe.some(keyword => normalized.includes(keyword.toLowerCase()))) {
      if (activeDescription) speakForPlatform(activeDescription);
      return;
    }

    if (t.commands.help.some(keyword => normalized.includes(keyword.toLowerCase()))) {
      speakForPlatform(t.spoken.help);
      return;
    }

    speakForPlatform(t.spoken.unknown);
  }, [activeDescription, changeLanguage, navigateToPage, speakForPlatform, t]);

  const startVoiceListening = useCallback(() => {
    const SpeechRecognition = typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
    if (!SpeechRecognition) {
      speakForPlatform(t.spoken.speechRecognitionUnsupported);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = LANG_META[lang].speechLang;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      handleVoiceCommand(text);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  }, [handleVoiceCommand, lang, speakForPlatform, t.spoken.speechRecognitionUnsupported]);

  const stopVoiceListening = useCallback(() => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  }, []);

  // Announce the current page whenever an open guide follows navigation or a language change.
  useEffect(() => {
    if (isOpen && activeDescription) {
      const timer = window.setTimeout(() => speakForPlatform(activeDescription, 0.85), 500);
      return () => window.clearTimeout(timer);
    }
  }, [activeDescription, isOpen, speakForPlatform]);

  useEffect(() => () => {
    if (recognitionRef.current) recognitionRef.current.abort();
  }, []);

  return (
    <>
      <div className="fixed bottom-6 start-6 z-50">
        {!isOpen && (
          <div className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-amber-400/40" />
        )}
        <motion.button
          type="button"
          onClick={() => {
            const opening = !isOpen;
            setIsOpen(opening);
            if (opening) {
              window.setTimeout(() => speakForPlatform(activeDescription ?? t.spoken.welcome, 0.85), 300);
            } else {
              stopSpeaking();
            }
          }}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-colors focus:outline-none focus:ring-4 focus:ring-amber-400 ${
            isOpen ? "bg-slate-700 text-white hover:bg-slate-800" : "bg-amber-600 text-white hover:bg-amber-700"
          }`}
          whileTap={{ scale: 0.92 }}
          aria-label={isOpen ? t.launcher.close : t.launcher.open}
          aria-expanded={isOpen}
        >
          {isOpen ? <X className="h-6 w-6" /> : <Navigation2 className="h-6 w-6" />}
        </motion.button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-24 start-4 z-50 w-80 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
            role="dialog"
            aria-label={t.dialog.ariaLabel}
          >
            <div className="bg-amber-600 p-4 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
                    <Navigation2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">{t.dialog.title}</h3>
                    <p className="text-xs text-amber-100">{t.dialog.subtitle}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => changeLanguage(nextLang)}
                  className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/30"
                  aria-label={t.aria.switchLanguage(LANG_META[nextLang].nativeName)}
                >
                  <Languages className="h-3 w-3" />
                  <span lang={LANG_META[nextLang].htmlLang} dir={LANG_META[nextLang].dir}>{LANG_META[nextLang].shortLabel}</span>
                </button>
              </div>
            </div>

            <div className="border-b border-border/30 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t.dialog.quickNavigation}</p>
              <div className="grid grid-cols-5 gap-1">
                {QUICK_LINKS.map(({ pageId, icon: Icon }) => {
                  const page = t.pages[pageId];
                  const isCurrent = location === PAGE_PATHS[pageId];
                  return (
                    <button
                      key={pageId}
                      type="button"
                      onClick={() => navigateToPage(pageId, 500, true)}
                      className={`flex flex-col items-center gap-1 rounded-xl p-2 text-xs transition-colors ${
                        isCurrent
                          ? "bg-amber-100 text-amber-700"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      aria-label={page.label}
                      aria-current={isCurrent ? "page" : undefined}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-center text-[10px] leading-tight">{page.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto">
              {FULL_PAGE_LINKS.map(({ pageId, emoji }) => {
                const page = t.pages[pageId];
                const isCurrent = location === PAGE_PATHS[pageId];
                return (
                  <button
                    key={pageId}
                    type="button"
                    onClick={() => navigateToPage(pageId, 500)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm transition-colors ${
                      isCurrent
                        ? "bg-amber-50 font-medium text-amber-800"
                        : "text-foreground hover:bg-muted/50"
                    }`}
                    aria-label={t.aria.goTo(page.label)}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    <span className="text-base" aria-hidden="true">{emoji}</span>
                    <span className="flex-1">{page.listLabel}</span>
                    {isCurrent && <ChevronRight className="h-4 w-4 text-amber-600 rtl:rotate-180" />}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 border-t border-border/30 p-3">
              {lastCommand && (
                <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                  <ChevronRight className="h-3 w-3 shrink-0 rtl:rotate-180" aria-hidden="true" />
                  <span className="sr-only">{t.aria.lastCommand}: </span>
                  <span className="truncate">{lastCommand}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={isListening ? stopVoiceListening : startVoiceListening}
                  className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors active:scale-[0.97] ${
                    isListening
                      ? "bg-red-500 text-white"
                      : "bg-amber-600 text-white hover:bg-amber-700"
                  }`}
                  aria-label={isListening ? t.controls.stopListening : t.controls.startListening}
                >
                  {isListening ? (
                    <>
                      <MicOff className="h-4 w-4" />
                      <span className="animate-pulse">{t.controls.listening}</span>
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4" />
                      {t.controls.startListening}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isSpeaking) {
                      stopSpeaking();
                    } else if (activeDescription) {
                      speakForPlatform(activeDescription, 0.85);
                    }
                  }}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                    isSpeaking ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  aria-label={isSpeaking ? t.controls.stopReading : t.controls.readPage}
                >
                  {isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => speakForPlatform(t.spoken.shortHelp)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
                  aria-label={t.controls.availableCommands}
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
