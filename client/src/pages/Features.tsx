/*
 * Design: Warm Contemporary
 * Features page - Detailed features and technologies
 */
import { motion } from "framer-motion";
import {
  Camera,
  Mic,
  Volume2,
  FileText,
  Bot,
  Accessibility,
  Smartphone,
  Tablet,
  Cloud,
  Brain,
  Eye,
  Languages,
  Keyboard,
  Hand,
  Shield,
  Zap,
} from "lucide-react";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";

const mainFeatures = [
  {
    icon: Camera,
    title: "التعرف الضوئي على النصوص (OCR)",
    description: "تقنية متقدمة تقرأ ورقة الاختبار عبر الكاميرا وتحوّل النصوص المطبوعة واليدوية إلى نص رقمي بدقة عالية، مع دعم كامل للغة العربية.",
    tag: "تقنية أساسية",
  },
  {
    icon: Volume2,
    title: "تحويل النص إلى صوت (TTS)",
    description: "محرك صوتي عربي طبيعي يقرأ الأسئلة بوضوح تام. يمكن التحكم بسرعة القراءة، وإعادة قراءة أي سؤال، والتنقل بين الأسئلة بسهولة.",
    tag: "صوت طبيعي",
  },
  {
    icon: Mic,
    title: "تحويل الصوت إلى نص (STT)",
    description: "تقنية التعرف على الكلام تحوّل إجابات المستخدم الصوتية إلى نص مكتوب بدقة عالية، مع دعم اللهجات العربية المختلفة.",
    tag: "دقة عالية",
  },
  {
    icon: Brain,
    title: "الذكاء الاصطناعي",
    description: "يقوم الذكاء الاصطناعي بتحليل الإجابات وتنظيمها، والتأكد من وضعها في المكان الصحيح المقابل لكل سؤال في نموذج الاختبار.",
    tag: "AI متقدم",
  },
  {
    icon: Bot,
    title: "الذراع الروبوتية الذكية",
    description: "تكامل مع ذراع روبوتية تكتب الإجابات فعلياً على الورق بخط واضح ومنظم. يمكن التحكم بسرعة الكتابة وحجم الخط ومكان الكتابة.",
    tag: "كتابة آلية",
  },
  {
    icon: FileText,
    title: "تصدير PDF احترافي",
    description: "إنشاء ملف PDF مطابق لنموذج الاختبار الأصلي، جاهز للطباعة المباشرة أو الإرسال الإلكتروني للمعلم.",
    tag: "جاهز للطباعة",
  },
];

const accessibilityFeatures = [
  { icon: Hand, title: "الأوامر الصوتية", desc: "تنقل كامل بالأوامر الصوتية" },
  { icon: Keyboard, title: "دعم لوحة المفاتيح", desc: "تنقل كامل بلوحة المفاتيح" },
  { icon: Eye, title: "تباين عالٍ", desc: "ألوان واضحة وتباين مريح" },
  { icon: Languages, title: "دعم العربية", desc: "واجهة عربية بالكامل RTL" },
  { icon: Smartphone, title: "متوافق مع الجوال", desc: "يعمل على جميع الأجهزة" },
  { icon: Tablet, title: "دعم التابلت", desc: "تجربة مثالية على الأجهزة اللوحية" },
  { icon: Shield, title: "خصوصية وأمان", desc: "حماية بيانات الطالب" },
  { icon: Zap, title: "أداء سريع", desc: "استجابة فورية وسلسة" },
];

const technologies = [
  { name: "OCR", desc: "التعرف الضوئي على النصوص" },
  { name: "Text-to-Speech", desc: "تحويل النص إلى صوت" },
  { name: "Speech-to-Text", desc: "تحويل الصوت إلى نص" },
  { name: "AI / ML", desc: "الذكاء الاصطناعي والتعلم الآلي" },
  { name: "Computer Vision", desc: "الرؤية الحاسوبية" },
  { name: "IoT", desc: "إنترنت الأشياء للذراع الروبوتية" },
  { name: "Cloud Storage", desc: "التخزين السحابي" },
  { name: "PDF Generation", desc: "إنشاء ملفات PDF" },
];

export default function Features() {
  return (
    <Layout>
      {/* Hero */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-amber-50/50 to-background">
        <div className="container">
          <SectionHeading
            badge="المميزات"
            title="تقنيات متقدمة في خدمة التعليم"
            description="مجموعة شاملة من التقنيات والأدوات المصممة لتمكين ذوي الإعاقة البصرية من أداء اختباراتهم بكل سهولة واستقلالية."
          />
        </div>
      </section>

      {/* Main Features */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {mainFeatures.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="group p-8 rounded-2xl bg-card border border-border/50 hover:border-amber-200 hover:shadow-lg hover:shadow-amber-100/50 transition-all duration-300"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                    <feature.icon className="w-6 h-6 text-amber-600" />
                  </div>
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-amber-100 text-amber-700">
                    {feature.tag}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-3">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Accessibility Features */}
      <section className="py-16 md:py-24 bg-amber-50/30">
        <div className="container">
          <SectionHeading
            badge="إمكانية الوصول"
            title="مصممة للجميع"
            description="واجهة مصممة وفق أعلى معايير إمكانية الوصول لضمان تجربة سلسة لجميع المستخدمين."
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {accessibilityFeatures.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className="text-center p-6 rounded-2xl bg-card border border-border/50"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mx-auto mb-3">
                  <feature.icon className="w-6 h-6 text-amber-600" />
                </div>
                <h4 className="font-bold text-sm mb-1">{feature.title}</h4>
                <p className="text-muted-foreground text-xs">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Technologies */}
      <section className="py-16 md:py-24">
        <div className="container">
          <SectionHeading
            badge="التقنيات"
            title="التقنيات المستخدمة"
            description="نستخدم أحدث التقنيات لتوفير تجربة اختبار متكاملة وموثوقة."
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {technologies.map((tech, i) => (
              <motion.div
                key={tech.name}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="p-4 rounded-xl bg-slate-900 text-center"
              >
                <div className="text-amber-400 font-bold text-sm mb-1">{tech.name}</div>
                <div className="text-slate-400 text-xs">{tech.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Target Audience */}
      <section className="py-16 md:py-24 bg-amber-50/30">
        <div className="container">
          <SectionHeading
            badge="الفئة المستهدفة"
            title="لمن صُممت بصيرة؟"
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              { icon: "🎓", title: "الطلاب", desc: "الطلاب من ذوي الإعاقة البصرية في جميع المراحل الدراسية" },
              { icon: "🏫", title: "المدارس والجامعات", desc: "المؤسسات التعليمية الراغبة في توفير بيئة اختبار شاملة" },
              { icon: "📋", title: "مراكز الاختبارات", desc: "مراكز الاختبارات المركزية والمتخصصة" },
              { icon: "🌐", title: "التعليم الشامل", desc: "مؤسسات التعليم الشامل والدمج التعليمي" },
              { icon: "🤝", title: "الجهات الداعمة", desc: "الجهات الداعمة لتمكين الأشخاص ذوي الإعاقة" },
              { icon: "👨‍🏫", title: "المعلمون", desc: "المعلمون الراغبون في تسهيل عملية الاختبار لطلابهم" },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex items-start gap-4 p-6 rounded-2xl bg-card border border-border/50"
              >
                <span className="text-3xl shrink-0">{item.icon}</span>
                <div>
                  <h4 className="font-bold mb-1">{item.title}</h4>
                  <p className="text-muted-foreground text-sm">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
