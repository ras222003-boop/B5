/*
 * Design: Warm Contemporary
 * How It Works page - Step-by-step process explanation
 */
import { motion } from "framer-motion";
import { Camera, Volume2, Mic, FileText, Printer, CheckCircle } from "lucide-react";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { useMessages } from "@/i18n";
import { howItWorksMessages } from "@/i18n/locales/howItWorks";

const ocrImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/ocr-scan-EW9QxMAEGU7nsonca7BhsL.webp";
const pdfImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/pdf-export-AXFDvZpdMxxG7gWk9yzYqg.webp";

const stepVisuals = [
  { icon: Camera, color: "bg-blue-50 text-blue-600", borderColor: "border-blue-200" },
  { icon: Volume2, color: "bg-amber-50 text-amber-600", borderColor: "border-amber-200" },
  { icon: Mic, color: "bg-green-50 text-green-600", borderColor: "border-green-200" },
  { icon: FileText, color: "bg-purple-50 text-purple-600", borderColor: "border-purple-200" },
  { icon: Printer, color: "bg-rose-50 text-rose-600", borderColor: "border-rose-200" },
];

export default function HowItWorks() {
  const t = useMessages(howItWorksMessages);
  const steps = t.steps.map((step, i) => ({ ...step, ...stepVisuals[i] }));

  return (
    <Layout>
      {/* Hero */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-amber-50/50 to-background">
        <div className="container">
          <SectionHeading badge={t.hero.badge} title={t.hero.title} description={t.hero.description} />
        </div>
      </section>

      {/* Steps */}
      <section className="py-16 md:py-24">
        <div className="container max-w-4xl">
          <div className="relative">
            {/* Vertical Line */}
            <div className="absolute end-8 md:end-12 top-0 bottom-0 w-0.5 bg-amber-200 hidden md:block" />

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
                      <span className="text-sm font-bold text-amber-500">{t.stepLabel} {step.number}</span>
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
              <h3 className="text-2xl md:text-3xl font-bold mb-4">{t.cameraShowcase.title}</h3>
              <p className="text-muted-foreground leading-relaxed mb-6">{t.cameraShowcase.description}</p>
              <ul className="space-y-3">
                {t.cameraShowcase.bullets.map((item) => (
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
              <img src={ocrImage} alt={t.cameraShowcase.imageAlt} className="rounded-2xl shadow-xl w-full" loading="lazy" />
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
              <img src={pdfImage} alt={t.pdfShowcase.imageAlt} className="rounded-2xl shadow-xl w-full" loading="lazy" />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="order-1 md:order-2"
            >
              <h3 className="text-2xl md:text-3xl font-bold mb-4">{t.pdfShowcase.title}</h3>
              <p className="text-muted-foreground leading-relaxed mb-6">{t.pdfShowcase.description}</p>
              <ul className="space-y-3">
                {t.pdfShowcase.bullets.map((item) => (
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
