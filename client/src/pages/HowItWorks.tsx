/*
 * Design: Warm Contemporary
 * How It Works page - Step-by-step process explanation
 */
import { motion } from "framer-motion";
import { Camera, Volume2, Mic, FileText, Printer, CheckCircle } from "lucide-react";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";

const ocrImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/ocr-scan-EW9QxMAEGU7nsonca7BhsL.webp";
const pdfImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/pdf-export-AXFDvZpdMxxG7gWk9yzYqg.webp";

const steps = [
  {
    number: "01",
    icon: Camera,
    title: "تصوير ورقة الاختبار",
    description: "يفتح المستخدم التطبيق ويوجّه كاميرا الجوال نحو ورقة الاختبار. تقوم تقنية OCR المتقدمة بالتعرف على جميع الأسئلة والنصوص الموجودة في الورقة.",
    color: "bg-blue-50 text-blue-600",
    borderColor: "border-blue-200",
  },
  {
    number: "02",
    icon: Volume2,
    title: "قراءة الأسئلة بالصوت",
    description: "يتم تحويل الأسئلة المكتشفة إلى صوت عربي واضح وطبيعي يُقرأ للمستخدم. يمكن التحكم بسرعة القراءة والتنقل بين الأسئلة بالأوامر الصوتية أو اللمسية.",
    color: "bg-amber-50 text-amber-600",
    borderColor: "border-amber-200",
  },
  {
    number: "03",
    icon: Mic,
    title: "تدوين الإجابات",
    description: "يجيب المستخدم بإحدى الطرق: الإدخال الصوتي (تحويل الكلام إلى نص)، أو الكتابة المباشرة داخل التطبيق بطريقة سهلة مشابهة لتطبيقات المحادثة.",
    color: "bg-green-50 text-green-600",
    borderColor: "border-green-200",
  },
  {
    number: "04",
    icon: FileText,
    title: "تجميع الإجابات",
    description: "بعد الانتهاء، تقوم المنصة بتجميع جميع الإجابات تلقائياً داخل نموذج منظم مطابق لورقة الاختبار الأصلية.",
    color: "bg-purple-50 text-purple-600",
    borderColor: "border-purple-200",
  },
  {
    number: "05",
    icon: Printer,
    title: "حفظ وتصدير PDF",
    description: "يتم حفظ الاختبار النهائي بصيغة PDF جاهزة للطباعة أو الإرسال للمعلم. يستطيع المعلم طباعة الملف مباشرة وكأن الطالب كتب الاختبار بنفسه.",
    color: "bg-rose-50 text-rose-600",
    borderColor: "border-rose-200",
  },
];

export default function HowItWorks() {
  return (
    <Layout>
      {/* Hero */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-amber-50/50 to-background">
        <div className="container">
          <SectionHeading
            badge="آلية العمل"
            title="كيف تعمل منصة بصيرة؟"
            description="خمس خطوات بسيطة تُمكّن الطالب الكفيف من أداء اختباره بشكل مستقل بالكامل."
          />
        </div>
      </section>

      {/* Steps */}
      <section className="py-16 md:py-24">
        <div className="container max-w-4xl">
          <div className="relative">
            {/* Vertical Line */}
            <div className="absolute right-8 md:right-12 top-0 bottom-0 w-0.5 bg-amber-200 hidden md:block" />

            <div className="space-y-12">
              {steps.map((step, i) => (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, x: 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: i * 0.1, ease: [0.23, 1, 0.32, 1] }}
                  className="relative flex gap-6 md:gap-10"
                >
                  {/* Step Number Circle */}
                  <div className="shrink-0 relative z-10">
                    <div className={`w-16 h-16 md:w-24 md:h-24 rounded-2xl ${step.color} flex items-center justify-center border-2 ${step.borderColor} bg-white shadow-sm`}>
                      <step.icon className="w-7 h-7 md:w-10 md:h-10" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-8">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-bold text-amber-500">الخطوة {step.number}</span>
                    </div>
                    <h3 className="text-xl md:text-2xl font-bold text-foreground mb-3">{step.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Visual Showcase */}
      <section className="py-16 md:py-24 bg-amber-50/30">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h3 className="text-2xl md:text-3xl font-bold mb-4">مسح الاختبار بالكاميرا</h3>
              <p className="text-muted-foreground leading-relaxed mb-6">
                ما عليك سوى توجيه كاميرا جوالك نحو ورقة الاختبار. تقوم تقنية التعرف الضوئي على الحروف (OCR) بقراءة جميع الأسئلة وتحويلها إلى نص رقمي بدقة عالية.
              </p>
              <ul className="space-y-3">
                {["دعم اللغة العربية بالكامل", "تعرف على الخطوط المطبوعة واليدوية", "معالجة فورية وسريعة"].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <img
                src={ocrImage}
                alt="مسح ورقة الاختبار بالكاميرا وتحويلها إلى نص رقمي"
                className="rounded-2xl shadow-xl w-full"
                loading="lazy"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* PDF Export Showcase */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="order-2 md:order-1"
            >
              <img
                src={pdfImage}
                alt="تصدير الاختبار كملف PDF جاهز للطباعة"
                className="rounded-2xl shadow-xl w-full"
                loading="lazy"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="order-1 md:order-2"
            >
              <h3 className="text-2xl md:text-3xl font-bold mb-4">تصدير PDF احترافي</h3>
              <p className="text-muted-foreground leading-relaxed mb-6">
                بعد الانتهاء من الاختبار، تقوم المنصة بتجميع جميع الإجابات في ملف PDF منظم ومطابق لنموذج الاختبار الأصلي، جاهز للطباعة أو الإرسال مباشرة.
              </p>
              <ul className="space-y-3">
                {["نموذج مطابق لورقة الاختبار", "جاهز للطباعة المباشرة", "إمكانية الإرسال للمعلم إلكترونياً"].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
