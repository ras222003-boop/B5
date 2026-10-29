/* External learning-platform integration is not implemented in this build. */
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Globe, Link2, Volume2, ExternalLink, AlertTriangle, Monitor, BookOpen, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { useMessages } from "@/i18n";
import { onlineExamsMessages } from "@/i18n/locales/onlineExams";
import { useTextToSpeech } from "@/hooks/useSpeech";

const PLATFORM_ICONS = ["📋", "📚", "📝", "📊", "🎨", "🌐"] as const;
const STEP_ICONS = [Link2, BookOpen, ClipboardList] as const;

export default function OnlineExams() {
  const t = useMessages(onlineExamsMessages);
  const { speakQuestion } = useTextToSpeech();
  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container max-w-4xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-center mb-12">
            <div className="w-20 h-20 rounded-3xl bg-blue-100 flex items-center justify-center mx-auto mb-6"><Monitor className="w-10 h-10 text-blue-600" /></div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">{t.hero.title}</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t.hero.description}</p>
          </motion.div>

          <section className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 mb-8" aria-labelledby="external-exam-title">
            <h2 id="external-exam-title" className="text-xl font-bold mb-4 flex items-center gap-2"><Link2 className="w-5 h-5 text-amber-600" />{t.exam.enterUrl}</h2>
            <p role="note" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">{t.exam.unavailable}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Globe className="absolute end-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input type="url" disabled placeholder={t.exam.urlPlaceholder} className="w-full h-12 pe-10 ps-4 rounded-xl border-2 border-border bg-background text-foreground text-sm" dir="ltr" aria-label={t.exam.urlLabel} />
              </div>
              <Button disabled className="rounded-xl h-12 px-6">{t.exam.load}</Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/exam-demo" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 font-bold text-white"><ExternalLink className="w-4 h-4" />{t.exam.localDemo}</Link>
              <Button variant="outline" onClick={() => speakQuestion(t.exam.instructions, [])} className="rounded-xl min-h-12"><Volume2 className="w-4 h-4 me-2" />{t.exam.listenInstructions}</Button>
            </div>
          </section>

          <SectionHeading badge={t.platforms.badge} title={t.platforms.title} description={t.platforms.description} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {t.platforms.items.map((platform, i) => (
              <div key={platform.name} className="p-5 rounded-2xl bg-card border border-border/50">
                <div className="flex items-center gap-3 mb-2"><span className="text-2xl" aria-hidden="true">{PLATFORM_ICONS[i]}</span><h3 className="font-bold">{platform.name}</h3></div>
                <p className="text-sm text-muted-foreground">{platform.description}</p>
                <span className="inline-flex items-center gap-1 mt-3 text-xs text-amber-900 bg-amber-50 px-2 py-1 rounded-full"><AlertTriangle className="w-3 h-3" />{t.platforms.supported}</span>
              </div>
            ))}
          </div>

          <section className="mt-16">
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
          </section>
        </div>
      </section>
    </Layout>
  );
}
