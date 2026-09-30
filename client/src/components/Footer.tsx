/* Aurum Nexus identity: high-contrast black footer with gold details. */
import { Link } from "wouter";
import { Mail, Phone, MapPin } from "lucide-react";
import BrandLogo from "./BrandLogo";

export default function Footer() {
  return (
    <footer className="border-t border-amber-200/15 bg-[#070706] text-stone-300" role="contentinfo">
      <div className="container py-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <BrandLogo className="h-12 w-12 rounded-xl ring-1 ring-amber-200/70" />
              <span className="flex flex-col leading-none">
                <span className="text-xl font-black text-amber-50">بصيرة</span>
                <span className="mt-1 text-[0.6rem] font-bold tracking-[0.17em] text-amber-300/80">AURUM NEXUS</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed text-stone-400">
              منصة ذكية مخصصة لذوي الإعاقة البصرية، تُمكّن الكفيف من أداء الاختبارات التعليمية بشكل مستقل بالكامل.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-bold text-amber-50">روابط سريعة</h3>
            <ul className="space-y-2">
              {[
                { href: "/", label: "الرئيسية" },
                { href: "/how-it-works", label: "آلية العمل" },
                { href: "/features", label: "المميزات" },
                { href: "/robotic-arm", label: "الذراع الروبوتية" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-stone-400 transition-colors hover:text-amber-200">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-bold text-amber-50">خدماتنا</h3>
            <ul className="space-y-2">
              {["قراءة الاختبارات بالكاميرا", "تحويل النص إلى صوت", "المساعد الرقمي", "تصدير PDF"].map((item) => (
                <li key={item} className="text-sm text-stone-400">{item}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-bold text-amber-50">تواصل معنا</h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-sm text-stone-400">
                <Mail className="h-4 w-4 shrink-0 text-amber-400" />
                <span>rat56373@gmail.com</span>
              </li>
              <li className="flex items-center gap-3 text-sm text-stone-400">
                <Phone className="h-4 w-4 shrink-0 text-amber-400" />
                <span dir="ltr">+966 57 062 5294</span>
              </li>
              <li className="flex items-center gap-3 text-sm text-stone-400">
                <MapPin className="h-4 w-4 shrink-0 text-amber-400" />
                <span>المملكة العربية السعودية</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-amber-200/10 pt-8 md:flex-row">
          <p className="text-sm text-stone-500">جميع الحقوق محفوظة &copy; {new Date().getFullYear()} بصيرة</p>
          <p className="text-sm text-stone-500">صُنع بعناية لخدمة ذوي الإعاقة البصرية</p>
        </div>
      </div>
    </footer>
  );
}
