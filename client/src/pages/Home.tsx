/*
 * Design: Warm Contemporary - Amber/Cream
 * Home page with hero, features overview, how it works, and CTA
 */
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
} from "lucide-react";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import FeatureCard from "@/components/FeatureCard";
import { Button } from "@/components/ui/button";

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
    description: "يتم قراءة الأسئلة بصوت عربي واضح وطبيعي، مع إمكانية التحكم بسرعة القراءة.",
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
    title: "تصدير PDF",
    description: "بعد الانتهاء، يتم تجميع إجاباتك في ملف PDF جاهز للطباعة أو الإرسال للمعلم.",
  },
  {
    icon: Accessibility,
    title: "واجهة سهلة الوصول",
    description: "واجهة مصممة خصيصاً للمكفوفين مع دعم كامل للأوامر الصوتية والتنقل الذكي.",
  },
];

const stats = [
  { value: "100%", label: "استقلالية تامة" },
  { value: "OCR", label: "تعرف ضوئي متقدم" },
  { value: "AI", label: "ذكاء اصطناعي" },
  { value: "PDF", label: "تصدير فوري" },
];

export default function Home() {
  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 md:py-28 lg:py-32">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-amber-100/40 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-amber-50/60 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
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
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-100 text-amber-700 text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4" />
                منصة ذكية لذوي الإعاقة البصرية
              </span>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
                اختبر <span className="text-amber-600">باستقلالية</span>
                <br />
                دون الحاجة لمرافق
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8 max-w-lg">
                منصة بصيرة تُمكّن الطلاب من ذوي الإعاقة البصرية من أداء اختباراتهم بشكل مستقل عبر الذكاء الاصطناعي والتقنيات المساعدة.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/exam-demo">
                  <Button size="lg" className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 h-12 text-base font-medium shadow-lg shadow-amber-200/50 hover:shadow-amber-300/50 transition-all duration-200 active:scale-[0.97]">
                    جرّب الآن
                    <ArrowLeft className="w-5 h-5 mr-2" />
                  </Button>
                </Link>
                <Link href="/how-it-works">
                  <Button size="lg" variant="outline" className="rounded-xl px-8 h-12 text-base font-medium border-2 hover:bg-amber-50 transition-all duration-200 active:scale-[0.97]">
                    كيف تعمل؟
                  </Button>
                </Link>
              </div>
            </motion.div>

            {/* Hero Image */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="order-1 lg:order-2"
            >
              <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-amber-200/30">
                <img
                  src={heroImage}
                  alt="طالب كفيف يستخدم منصة بصيرة لأداء اختبار عبر الجهاز اللوحي"
                  className="w-full h-auto object-cover"
                  loading="eager"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 bg-amber-50/50 border-y border-amber-100/50">
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
                <div className="text-3xl md:text-4xl font-bold text-amber-600 mb-1">{stat.value}</div>
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
        </div>
      </section>

      {/* Goals Section */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-amber-50/30 to-background">
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
            className="relative rounded-3xl bg-gradient-to-br from-amber-600 to-amber-700 p-12 md:p-16 text-center overflow-hidden"
          >
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIi8+PC9zdmc+')] opacity-50" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                ابدأ تجربتك الآن
              </h2>
              <p className="text-amber-100 text-lg mb-8 max-w-xl mx-auto">
                جرّب منصة بصيرة واكتشف كيف يمكن للتقنية أن تُمكّن ذوي الإعاقة البصرية من أداء اختباراتهم باستقلالية.
              </p>
              <Link href="/exam-demo">
                <Button size="lg" className="bg-white text-amber-700 hover:bg-amber-50 rounded-xl px-10 h-12 text-base font-bold shadow-lg hover:shadow-xl transition-all duration-200 active:scale-[0.97]">
                  تجربة الاختبار
                  <ArrowLeft className="w-5 h-5 mr-2" />
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
