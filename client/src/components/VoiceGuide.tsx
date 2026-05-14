/**
 * VoiceGuide - Floating voice navigation assistant
 * Supports Arabic and English, accessible keyboard navigation
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, X, Volume2, VolumeX,
  Home, ScanLine, MessageCircle, BookOpen, Settings, HelpCircle,
  ChevronRight, Navigation2, Languages,
} from "lucide-react";
import { useLocation } from "wouter";
import { useTextToSpeech } from "@/hooks/useSpeech";

type Lang = "ar" | "en";

const NAVIGATION_COMMANDS: Record<string, { path: string; labelAr: string; labelEn: string }> = {
  "الرئيسية": { path: "/", labelAr: "الصفحة الرئيسية", labelEn: "Home" },
  "الصفحة الرئيسية": { path: "/", labelAr: "الصفحة الرئيسية", labelEn: "Home" },
  "رئيسية": { path: "/", labelAr: "الصفحة الرئيسية", labelEn: "Home" },
  "home": { path: "/", labelAr: "الصفحة الرئيسية", labelEn: "Home" },
  "الاختبار": { path: "/exam-demo", labelAr: "تجربة الاختبار", labelEn: "Exam" },
  "اختبار": { path: "/exam-demo", labelAr: "تجربة الاختبار", labelEn: "Exam" },
  "مسح": { path: "/exam-demo", labelAr: "تجربة الاختبار", labelEn: "Exam" },
  "ابدأ الاختبار": { path: "/exam-demo", labelAr: "تجربة الاختبار", labelEn: "Exam" },
  "exam": { path: "/exam-demo", labelAr: "تجربة الاختبار", labelEn: "Exam" },
  "start exam": { path: "/exam-demo", labelAr: "تجربة الاختبار", labelEn: "Exam" },
  "المساعد": { path: "/assistant", labelAr: "المساعد الرقمي", labelEn: "Assistant" },
  "مساعد": { path: "/assistant", labelAr: "المساعد الرقمي", labelEn: "Assistant" },
  "المساعد الرقمي": { path: "/assistant", labelAr: "المساعد الرقمي", labelEn: "Assistant" },
  "assistant": { path: "/assistant", labelAr: "المساعد الرقمي", labelEn: "Assistant" },
  "digital assistant": { path: "/assistant", labelAr: "المساعد الرقمي", labelEn: "Assistant" },
  "المميزات": { path: "/features", labelAr: "المميزات", labelEn: "Features" },
  "مميزات": { path: "/features", labelAr: "المميزات", labelEn: "Features" },
  "features": { path: "/features", labelAr: "المميزات", labelEn: "Features" },
  "كيف تعمل": { path: "/how-it-works", labelAr: "آلية العمل", labelEn: "How It Works" },
  "آلية العمل": { path: "/how-it-works", labelAr: "آلية العمل", labelEn: "How It Works" },
  "how it works": { path: "/how-it-works", labelAr: "آلية العمل", labelEn: "How It Works" },
  "الذراع": { path: "/robotic-arm", labelAr: "الذراع الروبوتية", labelEn: "Robotic Arm" },
  "ذراع": { path: "/robotic-arm", labelAr: "الذراع الروبوتية", labelEn: "Robotic Arm" },
  "robotic arm": { path: "/robotic-arm", labelAr: "الذراع الروبوتية", labelEn: "Robotic Arm" },
  "الاختبارات الإلكترونية": { path: "/online-exams", labelAr: "الاختبارات الإلكترونية", labelEn: "Online Exams" },
  "اختبارات إلكترونية": { path: "/online-exams", labelAr: "الاختبارات الإلكترونية", labelEn: "Online Exams" },
  "اختبارات": { path: "/online-exams", labelAr: "الاختبارات الإلكترونية", labelEn: "Online Exams" },
  "online exams": { path: "/online-exams", labelAr: "الاختبارات الإلكترونية", labelEn: "Online Exams" },
  "لوحة المعلم": { path: "/teacher", labelAr: "لوحة تحكم المعلم", labelEn: "Teacher Panel" },
  "المعلم": { path: "/teacher", labelAr: "لوحة تحكم المعلم", labelEn: "Teacher Panel" },
  "معلم": { path: "/teacher", labelAr: "لوحة تحكم المعلم", labelEn: "Teacher Panel" },
  "teacher": { path: "/teacher", labelAr: "لوحة تحكم المعلم", labelEn: "Teacher Panel" },
  "teacher panel": { path: "/teacher", labelAr: "لوحة تحكم المعلم", labelEn: "Teacher Panel" },
};

const PAGE_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  "/": {
    ar: "أنت في الصفحة الرئيسية لمنصة بصيرة. يمكنك الذهاب إلى: تجربة الاختبار، المساعد الرقمي، الاختبارات الإلكترونية، أو لوحة المعلم. قل اسم الصفحة للانتقال.",
    en: "You are on the Basira home page. You can go to: exam, assistant, online exams, or teacher panel. Say the page name to navigate.",
  },
  "/exam-demo": {
    ar: "أنت في صفحة تجربة الاختبار. يمكنك فتح الكاميرا لمسح ورقة الاختبار أو رفع صورة. بعد المسح ستُقرأ لك الأسئلة بالصوت. اضغط على أي سؤال لسماعه.",
    en: "You are on the exam page. Open the camera to scan your exam paper or upload an image. After scanning, questions will be read aloud. Tap any question to hear it.",
  },
  "/assistant": {
    ar: "أنت في صفحة المساعد الرقمي. اكتب أو تحدث لطرح أسئلتك. المساعد يرد بالعربية والإنجليزية.",
    en: "You are on the digital assistant page. Type or speak to ask questions. The assistant responds in Arabic and English.",
  },
  "/features": {
    ar: "أنت في صفحة المميزات. هنا تجد جميع ميزات منصة بصيرة.",
    en: "You are on the features page. Here you find all Basira platform features.",
  },
  "/how-it-works": {
    ar: "أنت في صفحة آلية العمل. هنا شرح خطوات استخدام المنصة خطوة بخطوة.",
    en: "You are on the how it works page. Here is a step-by-step explanation of how to use the platform.",
  },
  "/robotic-arm": {
    ar: "أنت في صفحة الذراع الروبوتية. الذراع غير موصلة حالياً.",
    en: "You are on the robotic arm page. The arm is currently disconnected.",
  },
  "/online-exams": {
    ar: "أنت في صفحة الاختبارات الإلكترونية. يمكنك إدخال رابط اختبارك من بلاك بورد أو غيره للحصول على المساعدة.",
    en: "You are on the online exams page. Enter your exam link from Blackboard or other platforms to get assistance.",
  },
  "/teacher": {
    ar: "أنت في لوحة تحكم المعلم. يمكن للمعلم التحكم في إعدادات الاختبار ومنع الخروج من المتصفح.",
    en: "You are on the teacher control panel. Teachers can manage exam settings and prevent browser exit.",
  },
};

const QUICK_LINKS = [
  { path: "/", icon: Home, labelAr: "الرئيسية", labelEn: "Home" },
  { path: "/exam-demo", icon: ScanLine, labelAr: "الاختبار", labelEn: "Exam" },
  { path: "/assistant", icon: MessageCircle, labelAr: "المساعد", labelEn: "Assistant" },
  { path: "/online-exams", icon: BookOpen, labelAr: "إلكتروني", labelEn: "Online" },
  { path: "/teacher", icon: Settings, labelAr: "المعلم", labelEn: "Teacher" },
];

export default function VoiceGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState("");
  const [lang, setLang] = useState<Lang>("ar");
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const recognitionRef = useRef<any>(null);

  const handleVoiceCommand = useCallback((text: string) => {
    const lower = text.trim().toLowerCase();
    setLastCommand(text);

    // Language switch
    if (lower.includes("english") || lower.includes("إنجليزي") || lower.includes("انجليزي")) {
      setLang("en");
      speak("Switched to English mode.", 0.9, "en");
      return;
    }
    if (lower.includes("arabic") || lower.includes("عربي") || lower.includes("عربية")) {
      setLang("ar");
      speak("تم التبديل إلى العربية.", 0.9, "ar");
      return;
    }

    // Navigation commands
    for (const [keyword, target] of Object.entries(NAVIGATION_COMMANDS)) {
      if (lower.includes(keyword.toLowerCase())) {
        const msg = lang === "ar"
          ? `جاري الانتقال إلى ${target.labelAr}`
          : `Navigating to ${target.labelEn}`;
        speak(msg, 0.9, lang);
        setTimeout(() => setLocation(target.path), 800);
        return;
      }
    }

    // Where am I / describe page
    if (lower.includes("أين أنا") || lower.includes("where am i") || lower.includes("صف") || lower.includes("describe")) {
      const desc = PAGE_DESCRIPTIONS[location];
      if (desc) speak(lang === "ar" ? desc.ar : desc.en, 0.9, lang);
      return;
    }

    // Help
    if (lower.includes("مساعدة") || lower.includes("help")) {
      const helpMsg = lang === "ar"
        ? "الأوامر المتاحة: الرئيسية، اختبار، مساعد، اختبارات إلكترونية، لوحة المعلم، أين أنا. يمكنك أيضاً قول إنجليزي للتبديل للإنجليزية."
        : "Available commands: home, exam, assistant, online exams, teacher panel, where am I. You can also say Arabic to switch to Arabic.";
      speak(helpMsg, 0.9, lang);
      return;
    }

    // Unknown
    const unknownMsg = lang === "ar"
      ? "لم أفهم الأمر. قل مساعدة لمعرفة الخيارات المتاحة."
      : "I didn't understand. Say help to hear available commands.";
    speak(unknownMsg, 0.9, lang);
  }, [speak, setLocation, location, lang]);

  const startVoiceListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speak(
        lang === "ar"
          ? "المتصفح لا يدعم التعرف على الصوت. جرب متصفح كروم."
          : "Browser doesn't support speech recognition. Try Chrome.",
        0.9, lang
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang === "ar" ? "ar-SA" : "en-US";
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
  }, [handleVoiceCommand, speak, lang]);

  const stopVoiceListening = useCallback(() => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  }, []);

  // Announce page on open/navigation
  useEffect(() => {
    if (isOpen) {
      const desc = PAGE_DESCRIPTIONS[location];
      if (desc) {
        const t = setTimeout(() => speak(lang === "ar" ? desc.ar : desc.en, 0.85, lang), 500);
        return () => clearTimeout(t);
      }
    }
  }, [location, isOpen, speak, lang]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, []);

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 left-6 z-50">
        {/* Pulse ring */}
        {!isOpen && (
          <div className="absolute inset-0 rounded-full bg-amber-400/40 animate-ping pointer-events-none" />
        )}
        <motion.button
          onClick={() => {
            const opening = !isOpen;
            setIsOpen(opening);
            if (opening) {
              const desc = PAGE_DESCRIPTIONS[location];
              const msg = desc
                ? (lang === "ar" ? desc.ar : desc.en)
                : (lang === "ar" ? "مرحباً بك في منصة بصيرة. قل مساعدة لمعرفة الخيارات." : "Welcome to Basira. Say help to hear available commands.");
              setTimeout(() => speak(msg, 0.85, lang), 300);
            } else {
              stopSpeaking();
            }
          }}
          className={`relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-colors focus:outline-none focus:ring-4 focus:ring-amber-400 ${
            isOpen ? "bg-slate-700 text-white hover:bg-slate-800" : "bg-amber-600 text-white hover:bg-amber-700"
          }`}
          whileTap={{ scale: 0.92 }}
          aria-label={isOpen ? "إغلاق المساعد الصوتي" : "فتح المساعد الصوتي"}
          aria-expanded={isOpen}
        >
          {isOpen ? <X className="w-6 h-6" /> : <Navigation2 className="w-6 h-6" />}
        </motion.button>
      </div>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-24 left-4 z-50 w-80 bg-card border border-border/60 rounded-2xl shadow-2xl overflow-hidden"
            role="dialog"
            aria-label={lang === "ar" ? "المساعد الصوتي للتنقل" : "Voice Navigation Assistant"}
          >
            {/* Header */}
            <div className="bg-amber-600 p-4 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                    <Navigation2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">
                      {lang === "ar" ? "المرشد الصوتي" : "Voice Guide"}
                    </h3>
                    <p className="text-amber-100 text-xs">
                      {lang === "ar" ? "قل أمراً أو اضغط للتنقل" : "Say a command or tap to navigate"}
                    </p>
                  </div>
                </div>
                {/* Language toggle */}
                <button
                  onClick={() => {
                    const newLang: Lang = lang === "ar" ? "en" : "ar";
                    setLang(newLang);
                    speak(
                      newLang === "ar" ? "تم التبديل إلى العربية" : "Switched to English",
                      0.9, newLang
                    );
                  }}
                  className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  aria-label="تبديل اللغة"
                >
                  <Languages className="w-3 h-3" />
                  {lang === "ar" ? "EN" : "عر"}
                </button>
              </div>
            </div>

            {/* Quick nav */}
            <div className="p-3 border-b border-border/30">
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                {lang === "ar" ? "تنقل سريع:" : "Quick navigation:"}
              </p>
              <div className="grid grid-cols-5 gap-1">
                {QUICK_LINKS.map(({ path, icon: Icon, labelAr, labelEn }) => (
                  <button
                    key={path}
                    onClick={() => {
                      const msg = lang === "ar" ? `الانتقال إلى ${labelAr}` : `Going to ${labelEn}`;
                      speak(msg, 0.9, lang);
                      setTimeout(() => setLocation(path), 500);
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors text-xs ${
                      location === path
                        ? "bg-amber-100 text-amber-700"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                    aria-label={lang === "ar" ? labelAr : labelEn}
                    aria-current={location === path ? "page" : undefined}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[10px] leading-tight text-center">
                      {lang === "ar" ? labelAr : labelEn}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Full page list */}
            <div className="max-h-48 overflow-y-auto">
              {[
                { path: "/exam-demo", emoji: "📝", labelAr: "تجربة الاختبار", labelEn: "Exam Experience" },
                { path: "/assistant", emoji: "🤖", labelAr: "المساعد الرقمي", labelEn: "Digital Assistant" },
                { path: "/online-exams", emoji: "💻", labelAr: "الاختبارات الإلكترونية", labelEn: "Online Exams" },
                { path: "/features", emoji: "⭐", labelAr: "المميزات", labelEn: "Features" },
                { path: "/how-it-works", emoji: "📖", labelAr: "آلية العمل", labelEn: "How It Works" },
                { path: "/robotic-arm", emoji: "🦾", labelAr: "الذراع الروبوتية", labelEn: "Robotic Arm" },
                { path: "/teacher", emoji: "👨‍🏫", labelAr: "لوحة المعلم", labelEn: "Teacher Panel" },
              ].map((item) => (
                <button
                  key={item.path}
                  onClick={() => {
                    const msg = lang === "ar"
                      ? `جاري الانتقال إلى ${item.labelAr}`
                      : `Navigating to ${item.labelEn}`;
                    speak(msg, 0.9, lang);
                    setTimeout(() => setLocation(item.path), 500);
                  }}
                  className={`w-full text-start px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${
                    location === item.path
                      ? "bg-amber-50 text-amber-800 font-medium"
                      : "hover:bg-muted/50 text-foreground"
                  }`}
                  aria-label={lang === "ar" ? `الانتقال إلى ${item.labelAr}` : `Go to ${item.labelEn}`}
                >
                  <span className="text-base">{item.emoji}</span>
                  <span className="flex-1">{lang === "ar" ? item.labelAr : item.labelEn}</span>
                  {location === item.path && <ChevronRight className="w-4 h-4 text-amber-600" />}
                </button>
              ))}
            </div>

            {/* Voice controls */}
            <div className="border-t border-border/30 p-3 space-y-2">
              {lastCommand && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-1.5">
                  <ChevronRight className="w-3 h-3 shrink-0" />
                  <span className="truncate">{lastCommand}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={isListening ? stopVoiceListening : startVoiceListening}
                  className={`flex-1 h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-colors active:scale-[0.97] ${
                    isListening
                      ? "bg-red-500 text-white"
                      : "bg-amber-600 text-white hover:bg-amber-700"
                  }`}
                  aria-label={isListening
                    ? (lang === "ar" ? "إيقاف الاستماع" : "Stop listening")
                    : (lang === "ar" ? "بدء الاستماع" : "Start listening")
                  }
                >
                  {isListening ? (
                    <>
                      <MicOff className="w-4 h-4" />
                      <span className="animate-pulse">
                        {lang === "ar" ? "جاري الاستماع..." : "Listening..."}
                      </span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4" />
                      {lang === "ar" ? "تحدث للتنقل" : "Speak to navigate"}
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    const desc = PAGE_DESCRIPTIONS[location];
                    if (isSpeaking) {
                      stopSpeaking();
                    } else if (desc) {
                      speak(lang === "ar" ? desc.ar : desc.en, 0.85, lang);
                    }
                  }}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    isSpeaking ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                  aria-label={isSpeaking
                    ? (lang === "ar" ? "إيقاف القراءة" : "Stop reading")
                    : (lang === "ar" ? "قراءة وصف الصفحة" : "Read page description")
                  }
                >
                  {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => {
                    const helpMsg = lang === "ar"
                      ? "الأوامر: الرئيسية، اختبار، مساعد، اختبارات إلكترونية، لوحة المعلم، أين أنا، مساعدة."
                      : "Commands: home, exam, assistant, online exams, teacher panel, where am I, help.";
                    speak(helpMsg, 0.9, lang);
                  }}
                  className="w-10 h-10 rounded-xl flex items-center justify-center bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                  aria-label={lang === "ar" ? "الأوامر المتاحة" : "Available commands"}
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
