/*
 * Design: Warm Contemporary - Footer with amber accents
 */
import { Link } from "wouter";
import { Eye, Mail, Phone, MapPin } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300" role="contentinfo">
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center">
                <Eye className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white">بصيرة</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              منصة ذكية مخصصة لذوي الإعاقة البصرية، تُمكّن الكفيف من أداء الاختبارات التعليمية بشكل مستقل بالكامل.
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg">روابط سريعة</h3>
            <ul className="space-y-2">
              {[
                { href: "/", label: "الرئيسية" },
                { href: "/how-it-works", label: "آلية العمل" },
                { href: "/features", label: "المميزات" },
                { href: "/robotic-arm", label: "الذراع الروبوتية" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-slate-400 hover:text-amber-400 transition-colors text-sm">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg">خدماتنا</h3>
            <ul className="space-y-2">
              {[
                "قراءة الاختبارات بالكاميرا",
                "تحويل النص إلى صوت",
                "المساعد الرقمي",
                "تصدير PDF",
              ].map((item) => (
                <li key={item} className="text-slate-400 text-sm">{item}</li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg">تواصل معنا</h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-slate-400 text-sm">
                <Mail className="w-4 h-4 text-amber-500 shrink-0" />
                <span>info@basira.sa</span>
              </li>
              <li className="flex items-center gap-3 text-slate-400 text-sm">
                <Phone className="w-4 h-4 text-amber-500 shrink-0" />
                <span dir="ltr">+966 57 062 5294</span>
              </li>
              <li className="flex items-center gap-3 text-slate-400 text-sm">
                <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
                <span>المملكة العربية السعودية</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">
            جميع الحقوق محفوظة &copy; {new Date().getFullYear()} بصيرة
          </p>
          <p className="text-slate-500 text-sm">
            صُنع بعناية لخدمة ذوي الإعاقة البصرية
          </p>
        </div>
      </div>
    </footer>
  );
}
