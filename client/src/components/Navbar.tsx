import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, UserRound } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import BrandLogo from "./BrandLogo";

const links = [
  { href: "/", label: "الرئيسية" },
  { href: "/about", label: "من نحن" },
  { href: "/features", label: "خدماتنا" },
  { href: "/exam-demo", label: "تجربة الاختبار" },
  { href: "/assistant", label: "المساعد الرقمي" },
  { href: "/support", label: "الدعم الفني" },
];
const mobileExtra = [
  { href: "/online-exams", label: "اختبارات إلكترونية" },
  { href: "/how-it-works", label: "آلية العمل" },
  { href: "/robotic-arm", label: "الذراع الروبوتية" },
  { href: "/teacher", label: "لوحة المعلم" },
  { href: "/contact", label: "تواصل معنا" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const linkClass = (href: string) => `rounded-lg px-3 py-2 text-sm font-bold transition-colors ${location === href ? "bg-amber-300 text-[#17130d]" : "text-stone-300 hover:bg-amber-200/10 hover:text-amber-100"}`;
  return (
    <nav role="navigation" aria-label="التنقل الرئيسي" className="fixed inset-x-0 top-0 z-50 border-b border-amber-200/15 bg-[#070706]/95 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="بصيرة - الصفحة الرئيسية" className="group flex shrink-0 items-center gap-3">
          <BrandLogo alt="" className="h-10 w-10 rounded-xl border border-amber-200/50" />
          <span className="flex flex-col leading-none"><span className="text-xl font-black text-amber-50">بصيرة</span><span className="mt-1 text-[0.58rem] font-bold tracking-[0.16em] text-amber-300">AURUM NEXUS</span></span>
        </Link>
        <div className="hidden items-center gap-0.5 xl:flex">
          {links.map(link => <Link key={link.href} href={link.href} className={linkClass(link.href)} aria-current={location === link.href ? "page" : undefined}>{link.label}</Link>)}
          <Link href="/account" className="mr-2 inline-flex items-center gap-2 rounded-xl border border-amber-300/45 px-3 py-2 text-sm font-bold text-amber-200 hover:bg-amber-300/10"><UserRound aria-hidden="true" className="h-4 w-4" /> حسابي</Link>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "إغلاق القائمة" : "فتح القائمة"} className="rounded-lg p-2 text-amber-100 hover:bg-amber-200/10 xl:hidden">{open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
      </div>
      <AnimatePresence>
        {open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-amber-200/10 bg-[#0c0c0a] xl:hidden">
          <div className="container grid max-h-[75vh] gap-1 overflow-y-auto py-3 sm:grid-cols-2">
            {[...links, ...mobileExtra, { href: "/account", label: "إنشاء حساب / تسجيل دخول" }].map(link => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} aria-current={location === link.href ? "page" : undefined} className={`${linkClass(link.href)} px-4 py-3`}>{link.label}</Link>)}
          </div>
        </motion.div>}
      </AnimatePresence>
    </nav>
  );
}
