/* Aurum Nexus identity: black and gold, accessible RTL navigation. */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import BrandLogo from "./BrandLogo";

const navLinks = [
  { href: "/", label: "الرئيسية" },
  { href: "/exam-demo", label: "مسح الاختبار" },
  { href: "/online-exams", label: "اختبارات إلكترونية" },
  { href: "/assistant", label: "المساعد الرقمي" },
  { href: "/features", label: "المميزات" },
  { href: "/how-it-works", label: "آلية العمل" },
  { href: "/robotic-arm", label: "الذراع الروبوتية" },
  { href: "/teacher", label: "لوحة المعلم" },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  return (
    <nav
      className="fixed top-0 right-0 left-0 z-50 border-b border-amber-200/15 bg-[#070706]/90 backdrop-blur-xl"
      role="navigation"
      aria-label="التنقل الرئيسي"
    >
      <div className="container flex items-center justify-between h-16 md:h-18">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group" aria-label="بصيرة - الصفحة الرئيسية">
          <BrandLogo
            alt=""
            className="h-11 w-11 rounded-xl ring-1 ring-amber-200/70 shadow-[0_0_20px_rgba(245,190,80,0.2)] transition-shadow duration-200 group-hover:shadow-[0_0_28px_rgba(245,190,80,0.35)]"
          />
          <span className="flex flex-col leading-none">
            <span className="text-xl font-black text-amber-50">بصيرة</span>
            <span className="mt-1 text-[0.6rem] font-bold tracking-[0.17em] text-amber-300/80">AURUM NEXUS</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                location === link.href
                  ? "bg-amber-300 text-[#17130d] shadow-[0_0_20px_rgba(245,190,80,0.2)]"
                  : "text-stone-300 hover:bg-amber-200/10 hover:text-amber-100"
              }`}
              aria-current={location === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile Menu Button */}
        <button
          className="lg:hidden rounded-lg p-2 text-amber-100 hover:bg-amber-200/10 transition-colors"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={isOpen ? "إغلاق القائمة" : "فتح القائمة"}
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="lg:hidden overflow-hidden border-b border-amber-200/15 bg-[#0c0c0a]/95 backdrop-blur-xl"
          >
            <div className="container py-4 flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-3 rounded-lg text-base font-medium transition-all duration-200 ${
                    location === link.href
                      ? "bg-amber-300 text-[#17130d]"
                      : "text-stone-300 hover:bg-amber-200/10 hover:text-amber-100"
                  }`}
                  onClick={() => setIsOpen(false)}
                  aria-current={location === link.href ? "page" : undefined}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
