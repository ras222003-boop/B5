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
import { useI18n, useMessages } from "@/i18n";
import { homeMessages } from "@/i18n/locales/home";
import { navigationMessages } from "@/i18n/locales/navigation";

const heroImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/hero-basira-M6wXJFm4GuseyVsrmXf5Tu.webp";

const featureIcons = [
  Camera,
  Volume2,
  Mic,
  Bot,
  FileText,
  Accessibility,
  Headphones,
] as const;

const accessibilityToolPresentation = [
  { icon: Volume2, color: "bg-blue-50 text-blue-700 border-blue-200", iconColor: "text-blue-600" },
  { icon: Keyboard, color: "bg-purple-50 text-purple-700 border-purple-200", iconColor: "text-purple-600" },
  { icon: Mic, color: "bg-amber-50 text-amber-700 border-amber-200", iconColor: "text-amber-600" },
  { icon: Smartphone, color: "bg-green-50 text-green-700 border-green-200", iconColor: "text-green-600" },
  { icon: Globe, color: "bg-teal-50 text-teal-700 border-teal-200", iconColor: "text-teal-600" },
  { icon: Eye, color: "bg-orange-50 text-orange-700 border-orange-200", iconColor: "text-orange-600" },
  { icon: Hand, color: "bg-rose-50 text-rose-700 border-rose-200", iconColor: "text-rose-600" },
  { icon: Monitor, color: "bg-slate-50 text-slate-700 border-slate-200", iconColor: "text-slate-600" },
] as const;

const goalIcons = [Accessibility, Shield, GraduationCap] as const;

export default function Home() {
  const t = useMessages(homeMessages);
  const navigation = useMessages(navigationMessages);
  const { lang, dir } = useI18n();
  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const [readingSection, setReadingSection] = useState<string | null>(null);
  const heroEntranceX = dir === "rtl" ? 30 : -30;
  const forwardArrowClass = dir === "rtl" ? "" : "rotate-180";
  const startDecorationOffset = dir === "rtl" ? "translate-x-1/2" : "-translate-x-1/2";
  const endDecorationOffset = dir === "rtl" ? "-translate-x-1/3" : "translate-x-1/3";

  const readAloud = (text: string, section: string) => {
    if (isSpeaking && readingSection === section) {
      stopSpeaking();
      setReadingSection(null);
    } else {
      setReadingSection(section);
      speak(text, 0.9, lang);
    }
  };

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-amber-200/10 bg-[#0a0a08] py-20 md:py-28 lg:py-32">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className={`absolute top-0 start-0 h-96 w-96 ${startDecorationOffset} -translate-y-1/2 rounded-full bg-amber-300/15 blur-3xl`} />
          <div className={`absolute bottom-0 end-0 h-96 w-96 ${endDecorationOffset} translate-y-1/3 rounded-full bg-amber-700/15 blur-3xl`} />
        </div>

        <div className="container">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Text Content */}
            <motion.div
              initial={{ opacity: 0, x: heroEntranceX }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
              className="order-2 lg:order-1"
            >
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-1.5 text-sm font-bold text-amber-200">
                <Sparkles className="h-4 w-4" />
                {t.hero.eyebrow}
              </span>
              <h1 className="mb-6 text-4xl font-black leading-tight text-foreground md:text-5xl lg:text-6xl">
                {t.hero.titleBefore}<span className="text-amber-300">{t.hero.titleHighlight}</span>
                <br />
                {t.hero.titleAfter}
              </h1>
              <p className="mb-8 max-w-lg text-lg leading-relaxed text-stone-300 md:text-xl">
                {t.hero.description}
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/exam-demo">
                  <Button size="lg" className="h-12 rounded-xl bg-amber-300 px-8 text-base font-extrabold text-[#16130d] shadow-[0_14px_30px_rgba(245,190,80,0.2)] transition-all duration-200 hover:bg-amber-200 active:scale-[0.97]">
                    {t.hero.tryNow}
                    <ArrowLeft className={`ms-2 h-5 w-5 ${forwardArrowClass}`} />
                  </Button>
                </Link>
                <Link href="/how-it-works">
                  <Button size="lg" variant="outline" className="h-12 rounded-xl border-amber-300/45 px-8 text-base font-bold text-amber-100 transition-all duration-200 hover:bg-amber-300/10 hover:text-amber-50 active:scale-[0.97]">
                    {t.hero.howItWorks}
                  </Button>
                </Link>
                <Link href="/about" className="inline-flex min-h-12 items-center px-3 font-bold text-amber-200 underline underline-offset-4 hover:text-amber-100">
                  {t.hero.aboutUs}
                </Link>
                <button
                  onClick={() => readAloud(t.hero.readAloud, "hero")}
                  className={`flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-medium transition-all duration-200 ${
                    isSpeaking && readingSection === "hero"
                      ? "border-red-300 bg-red-50 text-red-700"
                      : "border-amber-300/50 text-amber-200 hover:bg-amber-300/10"
                  }`}
                  aria-label={t.hero.listenAriaLabel}
                >
                  <Volume2 className="h-4 w-4" />
                  {isSpeaking && readingSection === "hero" ? t.hero.stop : t.hero.listen}
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
                  alt={t.hero.imageAlt}
                  className="h-auto w-full object-cover"
                  loading="eager"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="absolute bottom-5 start-5 flex items-center gap-2 rounded-xl border border-amber-200/30 bg-black/70 px-3 py-2 text-xs font-bold tracking-[0.14em] text-amber-100 backdrop-blur">
                  <BrandLogo alt="" className="h-6 w-6 rounded-md" />
                  {t.hero.brandLabel}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section aria-labelledby="navigation-card-title" className="border-y border-amber-200/20 bg-[#17140d] py-10">
        <div className="container flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
          <div><h2 id="navigation-card-title" className="text-2xl font-black text-amber-100">{navigation.homeTitle}</h2><p className="mt-2 text-lg text-stone-300">{navigation.where}</p></div>
          <Link href="/navigation" className="inline-flex min-h-12 items-center rounded-xl bg-amber-300 px-6 font-bold text-stone-950 hover:bg-amber-200">{navigation.open}</Link>
        </div>
      </section>

      {/* Voice Guide Banner - Prominent on Home */}
      <section className="border-y border-amber-200/15 bg-gradient-to-r from-[#14120b] via-[#3d2b0d] to-[#14120b] py-8">
        <div className="container">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-4 text-white">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20">
                <MessageCircle className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t.voiceGuide.title}</h2>
                <p className="mt-1 text-sm text-amber-100">{t.voiceGuide.description}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 text-sm text-white">
                <Mic className="h-4 w-4" />
                <span>{t.voiceGuide.examCommand}</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 text-sm text-white">
                <Volume2 className="h-4 w-4" />
                <span>{t.voiceGuide.helpCommand}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-y border-amber-200/10 bg-black/20 py-12">
        <div className="container">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {t.stats.map((stat, i) => (
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
            badge={t.featuresSection.badge}
            title={t.featuresSection.title}
            description={t.featuresSection.description}
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.features.map((feature, i) => (
              <FeatureCard key={feature.title} {...feature} icon={featureIcons[i] ?? Camera} index={i} />
            ))}
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-6">
            <span className="text-lg font-bold text-white">{t.featuresSection.supportPrompt}</span>
            <Link href="/support" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-300 px-5 py-2 font-bold text-[#17130d] hover:bg-amber-200">
              {t.featuresSection.supportLink}
              <ArrowLeft aria-hidden="true" className={`h-4 w-4 ${forwardArrowClass}`} />
            </Link>
          </div>
        </div>
      </section>

      {/* Accessibility Tools Section */}
      <section className="bg-gradient-to-b from-black/25 to-background py-20 md:py-28">
        <div className="container">
          <SectionHeading
            badge={t.accessibilitySection.badge}
            title={t.accessibilitySection.title}
            description={t.accessibilitySection.description}
          />

          {/* Accessibility tools grid */}
          <div className="mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.accessibilityTools.map((tool, i) => {
              const presentation = accessibilityToolPresentation[i] ?? accessibilityToolPresentation[0];
              const ToolIcon = presentation.icon;

              return (
                <motion.div
                  key={tool.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className={`rounded-2xl border-2 p-5 ${presentation.color}`}
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/60">
                    <ToolIcon className={`h-5 w-5 ${presentation.iconColor}`} />
                  </div>
                  <h3 className="mb-0.5 text-sm font-bold">{tool.name}</h3>
                  <p className="mb-2 text-xs opacity-70">{tool.subtitle}</p>
                  <p className="text-xs leading-relaxed opacity-80">{tool.description}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Screen readers compatibility */}
          <div className="rounded-2xl border border-border/50 bg-card p-6 md:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                <Headphones className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold">{t.screenReaders.title}</h3>
                <p className="text-sm text-muted-foreground">{t.screenReaders.description}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {t.screenReaders.items.map((screenReader) => (
                <div key={screenReader.name} className="rounded-xl border border-border/30 bg-muted/50 p-4 text-center">
                  <div className="mb-1 text-base font-bold">{screenReader.name}</div>
                  <div className="text-xs text-muted-foreground">{screenReader.platform}</div>
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
            className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 md:flex-row"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <h4 className="mb-1 font-bold text-amber-800">{t.wcag.title}</h4>
              <p className="text-sm leading-relaxed text-amber-700">{t.wcag.description}</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Goals Section */}
      <section className="bg-gradient-to-b from-amber-300/5 to-background py-20 md:py-28">
        <div className="container">
          <SectionHeading badge={t.goalsSection.badge} title={t.goalsSection.title} />
          <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-3">
            {t.goals.map((goal, i) => {
              const GoalIcon = goalIcons[i] ?? Accessibility;

              return (
                <motion.div
                  key={goal.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="rounded-2xl border border-border/50 bg-card p-8 text-center"
                >
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100">
                    <GoalIcon className="h-8 w-8 text-amber-600" />
                  </div>
                  <h3 className="mb-3 text-lg font-bold">{goal.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{goal.description}</p>
                </motion.div>
              );
            })}
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
              <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">{t.cta.title}</h2>
              <p className="mx-auto mb-8 max-w-xl text-lg text-amber-100">{t.cta.description}</p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link href="/exam-demo">
                  <Button size="lg" className="h-12 rounded-xl bg-amber-300 px-10 text-base font-extrabold text-[#16130d] shadow-lg transition-all duration-200 hover:bg-amber-200 hover:shadow-xl active:scale-[0.97]">
                    {t.cta.examDemo}
                    <ArrowLeft className={`ms-2 h-5 w-5 ${forwardArrowClass}`} />
                  </Button>
                </Link>
                <Link href="/online-exams">
                  <Button size="lg" variant="outline" className="h-12 rounded-xl border-white/50 px-8 text-base font-medium text-white transition-all duration-200 hover:bg-white/10 active:scale-[0.97]">
                    {t.cta.onlineExams}
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
