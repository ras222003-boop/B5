/*
 * Design: Warm Contemporary
 * Features page - Detailed features and technologies
 */
import { motion } from "framer-motion";
import { Bot, Brain, Camera, Eye, FileText, Hand, Keyboard, Languages, Mic, Shield, Smartphone, Tablet, Volume2, Zap } from "lucide-react";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { useMessages } from "@/i18n";
import { featuresMessages } from "@/i18n/locales/features";

const mainFeatureIcons = [Camera, Volume2, Mic, Brain, Bot, FileText];
const accessibilityIcons = [Hand, Keyboard, Eye, Languages, Smartphone, Tablet, Shield, Zap];

export default function Features() {
  const t = useMessages(featuresMessages);

  return (
    <Layout>
      <section className="bg-gradient-to-b from-amber-50/50 to-background py-20 md:py-28">
        <div className="container">
          <SectionHeading badge={t.hero.badge} title={t.hero.title} description={t.hero.description} />
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="container">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {t.mainFeatures.map((feature, i) => {
              const Icon = mainFeatureIcons[i];

              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-30px" }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="group rounded-2xl border border-border/50 bg-card p-8 text-start transition-all duration-300 hover:border-amber-200 hover:shadow-lg hover:shadow-amber-100/50"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 transition-colors group-hover:bg-amber-100">
                      <Icon aria-hidden="true" className="h-6 w-6 text-amber-600" />
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">{feature.tag}</span>
                  </div>
                  <h3 className="mb-3 text-lg font-bold text-foreground">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-amber-50/30 py-16 md:py-24">
        <div className="container">
          <SectionHeading badge={t.accessibility.badge} title={t.accessibility.title} description={t.accessibility.description} />
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {t.accessibility.items.map((feature, i) => {
              const Icon = accessibilityIcons[i];

              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="rounded-2xl border border-border/50 bg-card p-6 text-center"
                >
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100">
                    <Icon aria-hidden="true" className="h-6 w-6 text-amber-600" />
                  </div>
                  <h4 className="mb-1 text-sm font-bold">{feature.title}</h4>
                  <p className="text-xs text-muted-foreground">{feature.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="container">
          <SectionHeading badge={t.technologies.badge} title={t.technologies.title} description={t.technologies.description} />
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-4">
            {t.technologies.items.map((tech, i) => (
              <motion.div
                key={tech.name}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="rounded-xl bg-slate-900 p-4 text-center"
              >
                <div className="mb-1 text-sm font-bold text-amber-400">{tech.name}</div>
                <div className="text-xs text-slate-400">{tech.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-amber-50/30 py-16 md:py-24">
        <div className="container">
          <SectionHeading badge={t.audience.badge} title={t.audience.title} />
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.audience.items.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex items-start gap-4 rounded-2xl border border-border/50 bg-card p-6 text-start"
              >
                <span aria-hidden="true" className="shrink-0 text-3xl">{item.icon}</span>
                <div>
                  <h4 className="mb-1 font-bold">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
