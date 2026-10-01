/*
 * Design: Warm Contemporary - Amber/Cream
 * Home page with hero, features overview, how it works, accessibility tools, and CTA
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  Camera,
  Mic,
  Volume2,
  FileText,
  Bot,
  Accessibility,
  ArrowLeft,
  Sparkles,
  Shield,
  GraduationCap,
  MessageCircle,
  Headphones,
  Keyboard,
  Smartphone,
  Globe,
  Eye,
  Hand,
  Monitor,
  Zap,
} from "lucide-react";
import Layout from "@/components/Layout";
import BrandLogo from "@/components/BrandLogo";
import SectionHeading from "@/components/SectionHeading";
import FeatureCard from "@/components/FeatureCard";
import { Button } from "@/components/ui/button";
import { useTextToSpeech } from "@/hooks/useSpeech";

const heroImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/hero-basira-M6wXJFm4GuseyVsrmXf5Tu.webp";

const features = [
  {
    icon: Camera,
    title: "قراءة الاختبار بالكاميرا",
    description: "وجّه كاميرا جوالك نحو ورقة الاختبار وسيتم التعرف على الأسئلة تلقائياً عبر تقنية OCR المتقدمة.",
  },
  {
    icon: Volume2,
    title: "تحويل النص إلى صوت",
    description: "يتم قراءة الأسئلة بصوت عربي وإنجليزي واضح وطبيعي، مع إمكانية التحكم بسرعة القراءة.",
  },
  {
    icon: Mic,
    title: "الإجابة بالصوت",
    description: "أجب على الأسئلة بصوتك وسيتم تحويل كلامك إلى نص مكتوب بدقة عالية.",
  },
  {
    icon: Bot,
    title: "الذراع الروبوتية",
    description: "تكامل مع ذراع روبوتية ذكية تكتب إجاباتك على الورق بخط واضح ومنظم.",
  },
  {
    icon: FileText,
    title: "تصدير PDF مع التصحيح",
    description: "بعد الانتهاء، يتم تجميع إجاباتك مع نتائج التصحيح الذكي في ملف PDF جاهز للطباعة.",
  },
  {
    icon: Accessibility,
    title: "واجهة سهلة الوصول",
    description: "واجهة مصممة خصيصاً للمكفوفين مع دعم كامل للأوامر الصوتية والتنقل الذكي.",
  },
  {
    icon: Headphones,
    title: "دعم فني مع متابعة",
    description: "محادثة دعم ذكية تقترح خطوات عملية، وتذكرة متابعة إذا لم تُحل المشكلة.",
  },
];

const stats = [
  { value: "100%", label: "استقلالية تامة" },
  { value: "OCR", label: "تعرف ضوئي متقدم" },
  { value: "AI", label: "ذكاء اصطناعي" },
  { value: "PDF", label: "تصدير فوري" },
];

// Accessibility tools & assistive programs supported
const accessibilityTools = [
  {
    icon: Volume2,
    name: "قارئ الشاشة",
    nameEn: "Screen Reader",
    desc: "متوافق مع NVDA وJAWS وVoiceOver وTalkBack",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    iconColor: "text-blue-600",
  },
  {
    icon: Keyboard,
    name: "التنقل بلوحة المفاتيح",
    nameEn: "Keyboard Navigation",
    desc: "دعم كامل للتنقل بمفاتيح Tab والأسهم وEnter",
    color: "bg-purple-50 text-purple-700 border-purple-200",
    iconColor: "text-purple-600",
  },
  {
    icon: Mic,
    name: "التحكم الصوتي",
    nameEn: "Voice Control",
    desc: "أوامر صوتية بالعربية والإنجليزية للتنقل والإجابة",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    iconColor: "text-amber-600",
  },
  {
    icon: Smartphone,
    name: "دعم الجوال واللوحي",
    nameEn: "Mobile & Tablet",
    desc: "متوافق مع iOS وAndroid وجميع أحجام الشاشات",
    color: "bg-green-50 text-green-700 border-green-200",
    iconColor: "text-green-600",
  },
  {
    icon: Globe,
    name: "ثنائي اللغة",
    nameEn: "Bilingual",
    desc: "دعم كامل للعربية والإنجليزية مع كشف تلقائي للغة",
    color: "bg-teal-50 text-teal-700 border-teal-200",
    iconColor: "text-teal-600",
  },
  {
    icon: Eye,
    name: "تكبير النص",
    nameEn: "Text Zoom",
    desc: "متوافق مع تكبير المتصفح وإعدادات إمكانية الوصول",
    color: "bg-orange-50 text-orange-700 border-orange-200",
    iconColor: "text-orange-600",
  },
  {
    icon: Hand,
    name: "التنقل اللمسي",
    nameEn: "Touch Navigation",
    desc: "أزرار كبيرة ومساحات لمس واسعة مناسبة لضعاف البصر",
    color: "bg-rose-50 text-rose-700 border-rose-200",
    iconColor: "text-rose-600",
  },
  {
    icon: Monitor,
    name: "وضع التباين العالي",
    nameEn: "High Contrast",
    desc: "متوافق مع وضع التباين العالي في أنظمة التشغيل",
    color: "bg-slate-50 text-slate-700 border-slate-200",
    iconColor: "text-slate-600",
  },
];

// Screen readers compatibility
const screenReaders = [
  { name: "NVDA", platform: "Windows" },
  { name: "JAWS", platform: "Windows" },
  { name: "VoiceOver", platform: "iOS / macOS" },
  { name: "TalkBack", platform: "Android" },
  { name: "Narrator", platform: "Windows" },
  { name: "Orca", platform: "Linux" },
];

export default function Home() {
  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const [readingSection, setReadingSection] = useState<string | null>(null);

  const readAloud = (text: string, section: string) => {
    if (isSpeaking && readingSection === section) {
      stopSpeaking();
      setReadingSection(null);
    } else {
      setReadingSection(section);
      speak(text, 0.9, "ar");
    }
  };

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-amber-200/10 bg-[#0a0a08] py-20 md:py-28 lg:py-32">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/15 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-96 w-96 translate-x-1/3 translate-y-1/3 rounded-full bg-amber-700/15 blur-3xl" />
        </div>

        <div className="container">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Text Content */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
              className="order-2 lg:order-1"
            >
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-1.5 text-sm font-bold text-amber-200">
                <Sparkles className="w-4 h-4" />
                منصة بصيرة بهوية Aurum Nexus
              </span>
              <h1 className="mb-6 text-4xl font-black leading-tight text-foreground md:text-5xl lg:text-6xl">
                اختبر <span className="text-amber-300">باستقلالية</span>
                <br />
                دون الحاجة لمرافق
              </h1>
              <p className="mb-8 max-w-lg text-lg leading-relaxed text-stone-300 md:text-xl">
                منصة بصيرة تُمكّن الطلاب من ذوي الإعاقة البصرية من أداء اختباراتهم بشكل مستقل عبر الذكاء الاصطناعي والتقنيات المساعدة.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/exam-demo">
                  <Button size="lg" className="h-12 rounded-xl bg-amber-300 px-8 text-base font-extrabold text-[#16130d] shadow-[0_14px_30px_rgba(245,190,80,0.2)] transition-all duration-200 hover:bg-amber-200 active:scale-[0.97]">
                    جرّب الآن
                    <ArrowLeft className="w-5 h-5 mr-2" />
                  </Button>
                </Link>
                <Link href="/how-it-works">
                  <Button size="lg" variant="outline" className="h-12 rounded-xl border-amber-300/45 px-8 text-base font-bold text-amber-100 transition-all duration-200 hover:bg-amber-300/10 hover:text-amber-50 active:scale-[0.97]">
                    كيف تعمل؟
                  </Button>
                </Link>
                <Link href="/about" className="inline-flex min-h-12 items-center px-3 font-bold text-amber-200 underline underline-offset-4 hover:text-amber-100">من نحن</Link>
                <button
                  onClick={() => readAloud(
                    "مرحباً بك في منصة بصيرة. هذه المنصة تُمكّن الطلاب من ذوي الإعاقة البصرية من أداء اختباراتهم بشكل مستقل. يمكنك مسح ورقة الاختبار بالكاميرا، وسيتم قراءة الأسئلة لك بالصوت، ثم تجيب بصوتك أو بالكتابة. اضغط على جرّب الآن للبدء.",
                    "hero"
                  )}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 text-sm font-medium transition-all duration-200 ${
                    isSpeaking && readingSection === "hero"
                      ? "bg-red-50 border-red-300 text-red-700"
                      : "border-amber-300/50 text-amber-200 hover:bg-amber-300/10"
                  }`}
                  aria-label="استمع لوصف المنصة"
                >
                  <Volume2 className="w-4 h-4" />
                  {isSpeaking && readingSection === "hero" ? "إيقاف" : "استمع"}
                </button>
              </div>
            </motion.div>

            {/* Hero Image */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="order-1 lg:order-2"
            >
              <div className="relative overflow-hidden rounded-3xl border border-amber-200/25 shadow-[0_28px_70px_rgba(0,0,0,0.5)]">
                <img
                  src={heroImage}
                  alt="طالب كفيف يستخدم منصة بصيرة لأداء اختبار عبر الجهاز اللوحي"
                  className="w-full h-auto object-cover"
                  loading="eager"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-xl border border-amber-200/30 bg-black/70 px-3 py-2 text-xs font-bold tracking-[0.14em] text-amber-100 backdrop-blur">
                  <BrandLogo alt="" className="h-6 w-6 rounded-md" />
                  AURUM NEXUS
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Voice Guide Banner - Prominent on Home */}
      <section className="border-y border-amber-200/15 bg-gradient-to-r from-[#14120b] via-[#3d2b0d] to-[#14120b] py-8">
        <div className="container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4 text-white">
              <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <MessageCircle className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">المرشد الصوتي متاح دائماً</h2>
                <p className="text-amber-100 text-sm mt-1">
                  اضغط على زر المرشد الصوتي في أسفل الشاشة للتنقل بالصوت أو الاستماع لوصف الصفحة
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 bg-white/20 text-white px-4 py-2 rounded-xl text-sm">
                <Mic className="w-4 h-4" />
                <span>قل: "الاختبار" للانتقال</span>
              </div>
              <div className="flex items-center gap-2 bg-white/20 text-white px-4 py-2 rounded-xl text-sm">
                <Volume2 className="w-4 h-4" />
                <span>قل: "مساعدة" للإرشاد</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-y border-amber-200/10 bg-black/20 py-12">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="text-center"
              >
                <div className="mb-1 text-3xl font-bold text-amber-300 md:text-4xl">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 md:py-28">
        <div className="container">
          <SectionHeading
            badge="المميزات"
            title="كل ما يحتاجه الطالب الكفيف"
            description="مجموعة متكاملة من الأدوات والتقنيات المصممة خصيصاً لتمكين ذوي الإعاقة البصرية من أداء اختباراتهم باستقلالية."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <FeatureCard key={feature.title} {...feature} index={i} />
            ))}
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-6">
            <span className="text-lg font-bold text-white">هل تحتاج مساعدة لاستخدام أي خدمة؟</span>
            <Link href="/support" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-300 px-5 py-2 font-bold text-[#17130d] hover:bg-amber-200">اذهب إلى الدعم الفني <ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>

      {/* Accessibility Tools Section */}
      <section className="bg-gradient-to-b from-black/25 to-background py-20 md:py-28">
        <div className="container">
          <SectionHeading
            badge="إمكانية الوصول"
            title="برامج المساعدة والمساندة"
            description="منصة بصيرة مصممة لتكون متوافقة مع جميع برامج ومساعدات إمكانية الوصول المعتمدة عالمياً."
          />

          {/* Accessibility tools grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
            {accessibilityTools.map((tool, i) => (
              <motion.div
                key={tool.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className={`p-5 rounded-2xl border-2 ${tool.color}`}
              >
                <div className={`w-10 h-10 rounded-xl bg-white/60 flex items-center justify-center mb-3`}>
                  <tool.icon className={`w-5 h-5 ${tool.iconColor}`} />
                </div>
                <h3 className="font-bold text-sm mb-0.5">{tool.name}</h3>
                <p className="text-xs opacity-70 mb-2">{tool.nameEn}</p>
                <p className="text-xs leading-relaxed opacity-80">{tool.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Screen readers compatibility */}
          <div className="bg-card border border-border/50 rounded-2xl p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <Headphones className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg">قارئات الشاشة المدعومة</h3>
                <p className="text-muted-foreground text-sm">متوافق مع جميع قارئات الشاشة الرئيسية</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {screenReaders.map((sr) => (
                <div key={sr.name} className="text-center p-4 rounded-xl bg-muted/50 border border-border/30">
                  <div className="font-bold text-base mb-1">{sr.name}</div>
                  <div className="text-xs text-muted-foreground">{sr.platform}</div>
                </div>
              ))}
            </div>
          </div>

          {/* WCAG compliance note */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mt-6 flex flex-col md:flex-row items-center gap-4 p-5 rounded-2xl bg-amber-50 border border-amber-200"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-amber-800 mb-1">متوافق مع معايير WCAG 2.1</h4>
              <p className="text-amber-700 text-sm leading-relaxed">
                تلتزم المنصة بمعايير إمكانية الوصول العالمية (WCAG 2.1 Level AA)، مما يضمن تجربة شاملة لجميع المستخدمين بغض النظر عن قدراتهم.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Goals Section */}
      <section className="bg-gradient-to-b from-amber-300/5 to-background py-20 md:py-28">
        <div className="container">
          <SectionHeading
            badge="أهدافنا"
            title="نحو تعليم شامل ومتاح للجميع"
          />
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              {
                icon: Accessibility,
                title: "تمكين ذوي الإعاقة",
                desc: "تمكين ذوي الإعاقة البصرية من أداء الاختبارات باستقلالية تامة دون تدخل بشري.",
              },
              {
                icon: Shield,
                title: "بيئة عادلة وآمنة",
                desc: "توفير بيئة اختبار عادلة وشاملة تحفظ خصوصية الطالب وكرامته.",
              },
              {
                icon: GraduationCap,
                title: "دعم التحول الرقمي",
                desc: "دمج الذكاء الاصطناعي مع التقنيات المساعدة لخدمة التعليم الشامل.",
              },
            ].map((goal, i) => (
              <motion.div
                key={goal.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="text-center p-8 rounded-2xl bg-card border border-border/50"
              >
                <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-5">
                  <goal.icon className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold mb-3">{goal.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{goal.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-28">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative overflow-hidden rounded-3xl border border-amber-300/30 bg-gradient-to-br from-[#15130c] via-[#39280d] to-[#0b0a08] p-12 text-center shadow-[0_24px_60px_rgba(0,0,0,0.3)] md:p-16"
          >
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIi8+PC9zdmc+')] opacity-50" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                ابدأ تجربتك الآن
              </h2>
              <p className="text-amber-100 text-lg mb-8 max-w-xl mx-auto">
                جرّب منصة بصيرة واكتشف كيف يمكن للتقنية أن تُمكّن ذوي الإعاقة البصرية من أداء اختباراتهم باستقلالية.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link href="/exam-demo">
                  <Button size="lg" className="h-12 rounded-xl bg-amber-300 px-10 text-base font-extrabold text-[#16130d] shadow-lg transition-all duration-200 hover:bg-amber-200 hover:shadow-xl active:scale-[0.97]">
                    تجربة الاختبار
                    <ArrowLeft className="w-5 h-5 mr-2" />
                  </Button>
                </Link>
                <Link href="/online-exams">
                  <Button size="lg" variant="outline" className="border-white/50 text-white hover:bg-white/10 rounded-xl px-8 h-12 text-base font-medium transition-all duration-200 active:scale-[0.97]">
                    الاختبارات الإلكترونية
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
