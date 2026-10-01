import { Link } from "wouter";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import BrandLogo from "./BrandLogo";

const email = "aurum.nexus.r1@gmail.com";
const groups = [
  { title: "اكتشف بصيرة", links: [{ href: "/about", label: "من نحن" }, { href: "/features", label: "الخدمات والمميزات" }, { href: "/how-it-works", label: "كيف تعمل؟" }, { href: "/exam-demo", label: "تجربة الاختبار" }] },
  { title: "معلومات مهمة", links: [{ href: "/terms", label: "الشروط والأحكام" }, { href: "/privacy", label: "سياسة الخصوصية" }, { href: "/refund-policy", label: "سياسة الإلغاء والاسترداد" }, { href: "/contact", label: "تواصل معنا" }] },
];

export default function Footer() {
  return (
    <footer role="contentinfo" className="border-t border-amber-200/15 bg-[#070706] text-stone-300">
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <Link href="/" className="mb-5 flex items-center gap-3" aria-label="بصيرة - الرئيسية"><BrandLogo alt="" className="h-12 w-12 rounded-xl border border-amber-200/50" /><span className="flex flex-col leading-tight"><strong className="text-xl text-amber-50">بصيرة</strong><span className="text-[0.6rem] font-bold tracking-[0.17em] text-amber-300">AURUM NEXUS</span></span></Link>
            <p className="max-w-xs text-sm leading-8 text-stone-400">تقنية مساعدة لقراءة الاختبارات والإجابة عليها ومتابعة الدعم بخطوات أكثر وضوحًا واستقلالية.</p>
          </div>
          {groups.map(group => <div key={group.title}>
            <h2 className="mb-4 font-bold text-amber-50">{group.title}</h2>
            <ul className="space-y-3">{group.links.map(link => <li key={link.href}><Link href={link.href} className="text-sm text-stone-400 transition-colors hover:text-amber-200">{link.label}</Link></li>)}</ul>
          </div>)}
          <div>
            <h2 className="mb-4 font-bold text-amber-50">دعم العملاء</h2>
            <Link href="/support" className="mb-5 inline-flex items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-bold text-amber-200 hover:bg-amber-300/20"><MessageCircle aria-hidden="true" className="h-4 w-4" /> محادثة الدعم الفني <ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>
            <a href={`mailto:${email}`} className="flex items-center gap-2 break-all text-sm text-stone-300 transition-colors hover:text-amber-200"><Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-300" /><span dir="ltr">{email}</span></a>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-amber-200/10 pt-6 text-xs text-stone-500"><span>© {new Date().getFullYear()} بصيرة · Aurum Nexus</span><span>نصمم تجربة رقمية أكثر قابلية للوصول.</span></div>
      </div>
    </footer>
  );
}
