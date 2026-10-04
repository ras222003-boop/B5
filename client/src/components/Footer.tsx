import { Link } from "wouter";
import { Mail, MessageCircle } from "lucide-react";
import BrandLogo from "./BrandLogo";
import { ForwardArrow } from "./DirectionalIcon";
import { useCommonMessages } from "@/i18n";

const email = "aurum.nexus.r1@gmail.com";

export default function Footer() {
  const t = useCommonMessages();
  const groups = [
    { title: t.footer.discover, links: [{ href: "/about", label: t.footer.aboutUs }, { href: "/features", label: t.footer.servicesFeatures }, { href: "/how-it-works", label: t.footer.howItWorks }, { href: "/exam-demo", label: t.footer.examDemo }] },
    { title: t.footer.important, links: [{ href: "/terms", label: t.footer.terms }, { href: "/privacy", label: t.footer.privacy }, { href: "/refund-policy", label: t.footer.refund }, { href: "/contact", label: t.footer.contact }] },
  ];

  return (
    <footer role="contentinfo" className="border-t border-amber-200/15 bg-[#070706] text-stone-300">
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <Link href="/" className="mb-5 flex items-center gap-3" aria-label={t.brand.homeLabel}><BrandLogo alt="" className="h-12 w-12 rounded-xl border border-amber-200/50" /><span className="flex flex-col leading-tight"><strong className="text-xl text-amber-50">{t.brand.name}</strong><span className="text-[0.6rem] font-bold tracking-[0.17em] text-amber-300">AURUM NEXUS</span></span></Link>
            <p className="max-w-xs text-sm leading-8 text-stone-400">{t.footer.tagline}</p>
          </div>
          {groups.map(group => <div key={group.title}>
            <h2 className="mb-4 font-bold text-amber-50">{group.title}</h2>
            <ul className="space-y-3">{group.links.map(link => <li key={link.href}><Link href={link.href} className="text-sm text-stone-400 transition-colors hover:text-amber-200">{link.label}</Link></li>)}</ul>
          </div>)}
          <div>
            <h2 className="mb-4 font-bold text-amber-50">{t.footer.customerSupport}</h2>
            <Link href="/support" className="mb-5 inline-flex items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-bold text-amber-200 hover:bg-amber-300/20"><MessageCircle aria-hidden="true" className="h-4 w-4" /> {t.footer.supportChat} <ForwardArrow aria-hidden="true" className="h-4 w-4" /></Link>
            <a href={`mailto:${email}`} className="flex items-center gap-2 break-all text-sm text-stone-300 transition-colors hover:text-amber-200"><Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-300" /><span dir="ltr">{email}</span></a>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-amber-200/10 pt-6 text-xs text-stone-400"><span>{t.footer.rights(new Date().getFullYear())}</span><span>{t.footer.mission}</span></div>
      </div>
    </footer>
  );
}
