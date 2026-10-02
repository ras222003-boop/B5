/*
 * OnlineExams - Page for integrating with external online exam platforms
 * (Blackboard, Moodle, Google Forms, etc.)
 */
import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Globe, Link2, Loader2, Volume2, Mic, MicOff,
  ExternalLink, Shield, CheckCircle, AlertTriangle,
  Monitor, BookOpen, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { useMessages, useI18n } from "@/i18n";
import { onlineExamsMessages } from "@/i18n/locales/onlineExams";
import { useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";

const PLATFORM_ICONS = ["📋", "📚", "📝", "📊", "🎨", "🌐"] as const;
const STEP_ICONS = [Link2, BookOpen, ClipboardList] as const;

export default function OnlineExams() {
  const t = useMessages(onlineExamsMessages);
  useI18n();
  const [examUrl, setExamUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [teacherLock, setTeacherLock] = useState(false);
  const [assistMode, setAssistMode] = useState(false);
  const { speak, stop: stopSpeaking, speakQuestion, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript } = useSpeechToText();

  const handleLoadExam = useCallback(() => {
    if (!examUrl.trim()) {
      speak(t.exam.invalidUrl);
      return;
    }

    setIsLoading(true);
    speak(t.exam.loadingMessage);

    setTimeout(() => {
      setIsLoading(false);
      setAssistMode(true);
      speak(t.exam.loadedMessage);
    }, 2000);
  }, [examUrl, speak, t.exam.invalidUrl, t.exam.loadingMessage, t.exam.loadedMessage]);

  const readInstructions = () => {
    speakQuestion(t.exam.instructions, []);
  };

  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <div className="w-20 h-20 rounded-3xl bg-blue-100 flex items-center justify-center mx-auto mb-6">
              <Monitor className="w-10 h-10 text-blue-600" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">{t.hero.title}</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t.hero.description}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 mb-8"
          >
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-amber-600" />
              {t.exam.enterUrl}
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Globe className="absolute end-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="url"
                  value={examUrl}
                  onChange={(e) => setExamUrl(e.target.value)}
                  placeholder={t.exam.urlPlaceholder}
                  className="w-full h-12 pe-10 ps-4 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:border-amber-500 transition-colors text-sm"
                  dir="ltr"
                  aria-label={t.exam.urlLabel}
                />
              </div>
              <Button
                onClick={handleLoadExam}
                disabled={isLoading || !examUrl.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-12 px-6 active:scale-[0.97]"
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 me-2 animate-spin" />{t.exam.loading}</>
                ) : (
                  <><ExternalLink className="w-4 h-4 me-2" />{t.exam.load}</>
                )}
              </Button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => {
                  if (isListening) {
                    stopListening();
                    if (transcript) setExamUrl(transcript);
                  } else {
                    startListening();
                  }
                }}
                className={`text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                  isListening ? "bg-red-100 text-red-600" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                aria-label={isListening ? t.exam.stop : t.exam.voiceInput}
              >
                {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                {isListening ? t.exam.stop : t.exam.voiceInput}
              </button>
              <button
                onClick={readInstructions}
                className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80"
                aria-label={t.exam.listenInstructions}
              >
                <Volume2 className="w-3 h-3" />
                {t.exam.listenInstructions}
              </button>
              {isSpeaking && (
                <button onClick={stopSpeaking} className="sr-only">{t.exam.stop}</button>
              )}
            </div>

            <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="font-medium text-sm">{t.teacherLock.title}</p>
                    <p className="text-xs text-muted-foreground">{t.teacherLock.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setTeacherLock(!teacherLock);
                    speak(teacherLock ? t.teacherLock.disabled : t.teacherLock.enabled);
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative ${teacherLock ? "bg-amber-600" : "bg-gray-300"}`}
                  role="switch"
                  aria-checked={teacherLock}
                  aria-label={t.teacherLock.enableLabel}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${teacherLock ? "end-0.5" : "end-[calc(100%-22px)]"}`} />
                </button>
              </div>
              {teacherLock && (
                <div className="mt-3 p-3 bg-amber-100 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t.teacherLock.warning}</span>
                </div>
              )}
            </div>
          </motion.div>

          {assistMode && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border-2 border-green-200 rounded-2xl p-6 md:p-8 mb-8"
            >
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h2 className="text-xl font-bold text-green-800">{t.assist.title}</h2>
              </div>
              <p className="text-green-700 mb-4">{t.assist.description}</p>
              <ul className="space-y-2 text-green-700 text-sm">
                {t.assist.features.map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 shrink-0" />{item}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-3">
                <Button onClick={() => speakQuestion(t.assist.instruction, [])} className="bg-green-600 hover:bg-green-700 text-white rounded-xl">
                  <Volume2 className="w-4 h-4 me-2" />{t.exam.listenInstructions}
                </Button>
                <Button variant="outline" onClick={() => { setAssistMode(false); setExamUrl(""); }} className="rounded-xl">
                  {t.assist.end}
                </Button>
              </div>
            </motion.div>
          )}

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
            <SectionHeading badge={t.platforms.badge} title={t.platforms.title} description={t.platforms.description} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {t.platforms.items.map((platform, i) => (
                <motion.div
                  key={platform.name}
                  initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.08 }}
                  className="p-5 rounded-2xl bg-card border border-border/50 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => speakQuestion(`${platform.name}: ${platform.description}`, [])}
                >
                  <div className="flex items-center gap-3 mb-2"><span className="text-2xl">{PLATFORM_ICONS[i]}</span><h3 className="font-bold">{platform.name}</h3></div>
                  <p className="text-sm text-muted-foreground">{platform.description}</p>
                  <span className="inline-flex items-center gap-1 mt-3 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full"><CheckCircle className="w-3 h-3" />{t.platforms.supported}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="mt-16">
            <SectionHeading badge={t.howItWorks.badge} title={t.howItWorks.title} />
            <div className="grid md:grid-cols-3 gap-6">
              {t.howItWorks.steps.map((step, i) => {
                const Icon = STEP_ICONS[i];
                return <div key={step.title} className="text-center p-6 rounded-2xl bg-card border border-border/50">
                  <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4"><Icon className="w-7 h-7 text-blue-600" /></div>
                  <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center mx-auto mb-3 text-sm font-bold">{i + 1}</div>
                  <h3 className="font-bold mb-2">{step.title}</h3><p className="text-sm text-muted-foreground">{step.description}</p>
                </div>;
              })}
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
