import { useEffect } from "react";
import { Link } from "wouter";
import { BookOpen, HeartHandshake, LockKeyhole, Mail, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import Layout from "@/components/Layout";
import BrandLogo from "@/components/BrandLogo";
import { ForwardArrow } from "@/components/DirectionalIcon";
import { useI18n, useMessages } from "@/i18n";
import { informationMessages } from "@/i18n/locales/information";

const email = "aurum.nexus.r1@gmail.com";

function PageShell({ title, eyebrow, intro, children }: { title: string; eyebrow: string; intro: string; children: React.ReactNode }) {
  const { dir } = useI18n();
  useEffect(() => { document.title = `${title} | Basira · Aurum Nexus`; }, [title]);
  return (
    <Layout>
      <section dir={dir} className="relative overflow-hidden border-b border-amber-200/15 bg-[#0b0a08] py-16 sm:py-24 text-start">
        <div className="absolute -start-24 top-0 h-80 w-80 rounded-full border border-amber-200/15" aria-hidden="true" />
        <div className="container relative z-10 max-w-5xl">
          <div className="mb-7 flex items-center gap-3 text-xs font-bold tracking-[0.18em] text-amber-300"><BrandLogo alt="" className="h-9 w-9 rounded-full" /> AURUM NEXUS <span className="h-px w-16 bg-amber-300/40" /></div>
          <p className="mb-3 text-sm font-semibold text-amber-200">{eyebrow}</p>
          <h1 className="text-4xl font-black leading-tight text-white sm:text-6xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-9 text-stone-300">{intro}</p>
        </div>
      </section>
      <div dir={dir} className="container max-w-5xl py-12 text-start sm:py-20">{children}</div>
    </Layout>
  );
}

function Detail({ icon: Icon, title, children }: { icon: typeof ShieldCheck; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-amber-200/15 bg-card/80 p-6 text-start sm:p-8">
      <div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-amber-300/10 p-2.5 text-amber-300"><Icon aria-hidden="true" className="h-5 w-5" /></span><h2 className="text-xl font-bold text-white">{title}</h2></div>
      <div className="space-y-3 text-base leading-8 text-stone-300">{children}</div>
    </section>
  );
}

function EmailLink({ className = "" }: { className?: string }) {
  return <a className={`text-amber-300 underline ${className}`} href={`mailto:${email}`} dir="ltr">{email}</a>;
}

export function About() {
  const t = useMessages(informationMessages).about;
  return (
    <PageShell title={t.title} eyebrow={t.eyebrow} intro={t.intro}>
      <div className="grid gap-5 md:grid-cols-2">
        <Detail icon={Sparkles} title={t.why.title}><p>{t.why.body}</p></Detail>
        <Detail icon={HeartHandshake} title={t.offer.title}><p>{t.offer.body}</p></Detail>
        <Detail icon={ShieldCheck} title={t.approach.title}><p>{t.approach.body}</p></Detail>
        <Detail icon={BookOpen} title={t.contact.title}><p>{t.contact.body} <EmailLink />.</p></Detail>
      </div>
      <Link href="/features" className="mt-8 inline-flex items-center gap-2 font-bold text-amber-200 hover:text-amber-100">{t.features} <ForwardArrow aria-hidden="true" className="h-4 w-4" /></Link>
    </PageShell>
  );
}

export function Terms() {
  const t = useMessages(informationMessages).terms;
  return (
    <PageShell title={t.title} eyebrow={t.eyebrow} intro={t.intro}>
      <div className="space-y-5">
        <Detail icon={BookOpen} title={t.use.title}><p>{t.use.body}</p></Detail>
        <Detail icon={ShieldCheck} title={t.accuracy.title}><p>{t.accuracy.body}</p></Detail>
        <Detail icon={LockKeyhole} title={t.account.title}><p>{t.account.body}</p></Detail>
        <Detail icon={Mail} title={t.updates.title}><p>{t.updates.body} <EmailLink />.</p></Detail>
      </div>
    </PageShell>
  );
}

export function Privacy() {
  const t = useMessages(informationMessages).privacy;
  return (
    <PageShell title={t.title} eyebrow={t.eyebrow} intro={t.intro}>
      <div className="space-y-5">
        <Detail icon={LockKeyhole} title={t.collected.title}><p>{t.collected.body}</p></Detail>
        <Detail icon={Sparkles} title={t.ai.title}><p>{t.ai.body}</p></Detail>
        <Detail icon={ShieldCheck} title={t.storage.title}><p>{t.storage.body}</p></Detail>
        <Detail icon={RefreshCcw} title={t.requests.title}><p>{t.requests.body} <EmailLink />{t.requests.note}</p></Detail>
      </div>
    </PageShell>
  );
}

export function RefundPolicy() {
  const t = useMessages(informationMessages).refund;
  return (
    <PageShell title={t.title} eyebrow={t.eyebrow} intro={t.intro}>
      <div className="space-y-5">
        <Detail icon={RefreshCcw} title={t.current.title}><p>{t.current.body}</p></Detail>
        <Detail icon={ShieldCheck} title={t.future.title}><p>{t.future.body}</p></Detail>
        <Detail icon={Mail} title={t.help.title}><p>{t.help.body} <EmailLink />{t.help.note}</p></Detail>
      </div>
    </PageShell>
  );
}

export function Contact() {
  const t = useMessages(informationMessages).contact;
  return (
    <PageShell title={t.title} eyebrow={t.eyebrow} intro={t.intro}>
      <div className="grid gap-5 md:grid-cols-2">
        <Detail icon={HeartHandshake} title={t.smart.title}><p>{t.smart.body}</p><Link href="/support" className="inline-flex items-center gap-2 font-bold text-amber-300 hover:text-amber-100">{t.smart.link} <ForwardArrow aria-hidden="true" className="h-4 w-4" /></Link></Detail>
        <Detail icon={Mail} title={t.email.title}><p>{t.email.body}</p><EmailLink className="break-all text-lg font-bold" /><p>{t.email.warning}</p></Detail>
      </div>
    </PageShell>
  );
}
