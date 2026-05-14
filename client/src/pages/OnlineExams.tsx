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
import { useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";

type ExamPlatform = {
  name: string;
  icon: string;
  description: string;
  supported: boolean;
};

const PLATFORMS: ExamPlatform[] = [
  { name: "Blackboard", icon: "📋", description: "نظام إدارة التعلم الأكثر استخداماً في الجامعات", supported: true },
  { name: "Moodle", icon: "📚", description: "منصة التعلم مفتوحة المصدر", supported: true },
  { name: "Google Forms", icon: "📝", description: "نماذج جوجل للاختبارات الإلكترونية", supported: true },
  { name: "Microsoft Forms", icon: "📊", description: "نماذج مايكروسوفت للاختبارات", supported: true },
  { name: "Canvas LMS", icon: "🎨", description: "نظام إدارة التعلم Canvas", supported: true },
  { name: "أخرى", icon: "🌐", description: "أي منصة اختبار إلكترونية أخرى", supported: true },
];

export default function OnlineExams() {
  const [examUrl, setExamUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [teacherLock, setTeacherLock] = useState(false);
  const [assistMode, setAssistMode] = useState(false);
  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript } = useSpeechToText("ar");

  const handleLoadExam = useCallback(() => {
    if (!examUrl.trim()) {
      speak("يرجى إدخال رابط الاختبار أولاً", 0.9, "ar");
      return;
    }

    setIsLoading(true);
    speak("جاري تحميل الاختبار الإلكتروني. يرجى الانتظار.", 0.9, "ar");

    // Simulate loading
    setTimeout(() => {
      setIsLoading(false);
      setAssistMode(true);
      speak("تم تحميل الاختبار بنجاح. وضع المساعدة مفعّل. سأقرأ لك الأسئلة وأساعدك في الإجابة.", 0.9, "ar");
    }, 2000);
  }, [examUrl, speak]);

  return (
    <Layout>
      {/* Hero */}
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
            <h1 className="text-3xl md:text-4xl font-bold mb-4">الاختبارات الإلكترونية</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              أضف رابط اختبارك الإلكتروني من أي منصة تعليمية (بلاك بورد، مودل، جوجل فورمز وغيرها)
              وسنساعدك في قراءة الأسئلة والإجابة عليها بسهولة.
            </p>
          </motion.div>

          {/* URL Input */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 mb-8"
          >
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-amber-600" />
              أدخل رابط الاختبار
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Globe className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="url"
                  value={examUrl}
                  onChange={(e) => setExamUrl(e.target.value)}
                  placeholder="https://blackboard.university.edu/exam/..."
                  className="w-full h-12 pr-10 pl-4 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:border-amber-500 transition-colors text-sm"
                  dir="ltr"
                  aria-label="رابط الاختبار الإلكتروني"
                />
              </div>
              <Button
                onClick={handleLoadExam}
                disabled={isLoading || !examUrl.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-12 px-6 active:scale-[0.97]"
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 ml-2 animate-spin" />جاري التحميل</>
                ) : (
                  <><ExternalLink className="w-4 h-4 ml-2" />تحميل الاختبار</>
                )}
              </Button>
            </div>

            {/* Voice URL input */}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => {
                  if (isListening) {
                    stopListening();
                    if (transcript) setExamUrl(transcript);
                  } else {
                    startListening("en");
                  }
                }}
                className={`text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                  isListening ? "bg-red-100 text-red-600" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                {isListening ? "إيقاف" : "إدخال صوتي"}
              </button>
              <button
                onClick={() => speak("أدخل رابط الاختبار الإلكتروني من منصة بلاك بورد أو مودل أو جوجل فورمز أو أي منصة أخرى", 0.9, "ar")}
                className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80"
              >
                <Volume2 className="w-3 h-3" />
                سماع التعليمات
              </button>
            </div>

            {/* Teacher lock toggle */}
            <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="font-medium text-sm">وضع قفل المعلم</p>
                    <p className="text-xs text-muted-foreground">يمنع الطالب من الخروج إلى متصفحات خارجية</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setTeacherLock(!teacherLock);
                    speak(teacherLock ? "تم إلغاء قفل المعلم" : "تم تفعيل قفل المعلم. لن يتمكن الطالب من الخروج.", 0.9, "ar");
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative ${
                    teacherLock ? "bg-amber-600" : "bg-gray-300"
                  }`}
                  role="switch"
                  aria-checked={teacherLock}
                  aria-label="تفعيل قفل المعلم"
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    teacherLock ? "right-0.5" : "right-[calc(100%-22px)]"
                  }`} />
                </button>
              </div>
              {teacherLock && (
                <div className="mt-3 p-3 bg-amber-100 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>وضع القفل مفعّل: سيتم تقييد التنقل خارج المنصة أثناء الاختبار. يمكن للمعلم فقط إلغاء القفل.</span>
                </div>
              )}
            </div>
          </motion.div>

          {/* Assist Mode Active */}
          {assistMode && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border-2 border-green-200 rounded-2xl p-6 md:p-8 mb-8"
            >
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h2 className="text-xl font-bold text-green-800">وضع المساعدة مفعّل</h2>
              </div>
              <p className="text-green-700 mb-4">
                تم تحميل الاختبار الإلكتروني بنجاح. المساعد الذكي جاهز لمساعدتك في:
              </p>
              <ul className="space-y-2 text-green-700 text-sm">
                {[
                  "قراءة الأسئلة بصوت واضح",
                  "شرح الأسئلة الغامضة",
                  "تسجيل الإجابات بالصوت",
                  "التنقل بين الأسئلة بالأوامر الصوتية",
                  "تنبيهك بالوقت المتبقي",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-3">
                <Button
                  onClick={() => speak("وضع المساعدة مفعّل. سأقرأ لك الأسئلة وأساعدك في الإجابة. قل التالي للانتقال للسؤال التالي، أو السابق للرجوع.", 0.85, "ar")}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-xl"
                >
                  <Volume2 className="w-4 h-4 ml-2" />
                  سماع التعليمات
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setAssistMode(false); setExamUrl(""); }}
                  className="rounded-xl"
                >
                  إنهاء الاختبار
                </Button>
              </div>
            </motion.div>
          )}

          {/* Supported Platforms */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <SectionHeading
              badge="المنصات المدعومة"
              title="نعمل مع جميع منصات الاختبارات"
              description="بصيرة تدعم الاختبارات الإلكترونية من مختلف المنصات التعليمية."
            />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PLATFORMS.map((platform, i) => (
                <motion.div
                  key={platform.name}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                  className="p-5 rounded-2xl bg-card border border-border/50 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => speak(`${platform.name}: ${platform.description}`, 0.9, "ar")}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{platform.icon}</span>
                    <h3 className="font-bold">{platform.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{platform.description}</p>
                  {platform.supported && (
                    <span className="inline-flex items-center gap-1 mt-3 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                      <CheckCircle className="w-3 h-3" />
                      مدعوم
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* How it works */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mt-16"
          >
            <SectionHeading
              badge="كيف تعمل"
              title="خطوات بسيطة لبدء اختبارك الإلكتروني"
            />
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: Link2, title: "أدخل الرابط", desc: "الصق رابط الاختبار الإلكتروني من أي منصة تعليمية" },
                { icon: BookOpen, title: "المساعد يقرأ", desc: "سيقرأ المساعد الأسئلة بصوت واضح ويساعدك في فهمها" },
                { icon: ClipboardList, title: "أجب بسهولة", desc: "أجب بالصوت أو الكتابة وسيتم تسجيل إجاباتك تلقائياً" },
              ].map((step, i) => (
                <div key={step.title} className="text-center p-6 rounded-2xl bg-card border border-border/50">
                  <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
                    <step.icon className="w-7 h-7 text-blue-600" />
                  </div>
                  <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center mx-auto mb-3 text-sm font-bold">
                    {i + 1}
                  </div>
                  <h3 className="font-bold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
