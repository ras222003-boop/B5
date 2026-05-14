/*
 * Design: Warm Contemporary
 * Robotic Arm page - Shows arm features with DISCONNECTED status
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Wifi,
  WifiOff,
  Settings,
  Pen,
  Gauge,
  Ruler,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const roboticArmImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/robotic-arm-btZRLCutmPSqx3AVedUpMr.webp";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export default function RoboticArm() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  const handleConnect = () => {
    setStatus("connecting");
    // Simulate connection attempt then fail (arm not connected)
    setTimeout(() => {
      setStatus("disconnected");
      toast.error("الذراع الروبوتية غير موصلة", {
        description: "تأكد من توصيل الذراع الروبوتية بالجهاز وتشغيلها، ثم حاول مرة أخرى.",
      });
    }, 3000);
  };

  const statusConfig = {
    disconnected: {
      icon: WifiOff,
      label: "غير متصل بالذراع الروبوتية",
      color: "text-red-500",
      bg: "bg-red-50",
      border: "border-red-200",
      dot: "bg-red-500",
    },
    connecting: {
      icon: Loader2,
      label: "جاري الاتصال بالذراع...",
      color: "text-amber-500",
      bg: "bg-amber-50",
      border: "border-amber-200",
      dot: "bg-amber-500",
    },
    connected: {
      icon: Wifi,
      label: "تم الاتصال بالذراع بنجاح",
      color: "text-green-500",
      bg: "bg-green-50",
      border: "border-green-200",
      dot: "bg-green-500",
    },
  };

  const currentStatus = statusConfig[status];
  const StatusIcon = currentStatus.icon;

  return (
    <Layout>
      {/* Hero */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-amber-50/50 to-background">
        <div className="container">
          <SectionHeading
            badge="الذراع الروبوتية"
            title="الكتابة الآلية على الورق"
            description="تكامل ذكي مع ذراع روبوتية تكتب إجاباتك فعلياً على ورقة الاختبار بخط واضح ومنظم."
          />
        </div>
      </section>

      {/* Connection Status Panel */}
      <section className="py-8">
        <div className="container max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className={`p-6 md:p-8 rounded-2xl border-2 ${currentStatus.border} ${currentStatus.bg}`}
          >
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <StatusIcon className={`w-8 h-8 ${currentStatus.color} ${status === "connecting" ? "animate-spin" : ""}`} />
                  <div className={`absolute -top-1 -left-1 w-3 h-3 rounded-full ${currentStatus.dot} ${status === "disconnected" ? "" : "animate-pulse"}`} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">{currentStatus.label}</h3>
                  <p className="text-sm text-muted-foreground">
                    {status === "disconnected" && "الذراع الروبوتية غير موصلة حالياً"}
                    {status === "connecting" && "يتم البحث عن الذراع الروبوتية..."}
                    {status === "connected" && "الذراع جاهزة للكتابة"}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleConnect}
                disabled={status === "connecting"}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl active:scale-[0.97] transition-all"
              >
                {status === "connecting" ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري الاتصال
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4 ml-2" />
                    محاولة الاتصال
                  </>
                )}
              </Button>
            </div>

            {status === "disconnected" && (
              <div className="mt-4 p-4 rounded-xl bg-white/60 border border-red-100 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">تعليمات التوصيل:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>تأكد من تشغيل الذراع الروبوتية</li>
                    <li>قم بتوصيلها عبر البلوتوث أو USB</li>
                    <li>اضغط على "محاولة الاتصال"</li>
                  </ol>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </section>

      {/* Arm Image & Description */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <img
                src={roboticArmImage}
                alt="الذراع الروبوتية الذكية تكتب على ورقة الاختبار"
                className="rounded-2xl shadow-xl w-full"
                loading="lazy"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <h3 className="text-2xl md:text-3xl font-bold mb-6">كيف تعمل الذراع الروبوتية؟</h3>
              <div className="space-y-6">
                {[
                  { step: "1", title: "إدخال الإجابة", desc: "يتحدث الكفيف أو يكتب إجابته داخل التطبيق." },
                  { step: "2", title: "تحليل وتنظيم", desc: "يقوم الذكاء الاصطناعي بتحليل الإجابة وتنظيمها." },
                  { step: "3", title: "إرسال الأوامر", desc: "يتم إرسال أوامر دقيقة إلى الذراع الروبوتية." },
                  { step: "4", title: "الكتابة على الورق", desc: "تبدأ الذراع بكتابة الإجابات بخط واضح ومنظم." },
                ].map((item, i) => (
                  <div key={item.step} className="flex gap-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <span className="text-amber-700 font-bold">{item.step}</span>
                    </div>
                    <div>
                      <h4 className="font-bold mb-1">{item.title}</h4>
                      <p className="text-muted-foreground text-sm">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Arm Controls */}
      <section className="py-16 md:py-24 bg-amber-50/30">
        <div className="container">
          <SectionHeading
            badge="التحكم"
            title="إعدادات الذراع الروبوتية"
            description="تحكم كامل في إعدادات الكتابة لتناسب احتياجاتك."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { icon: Gauge, title: "سرعة الكتابة", desc: "تحكم بسرعة الكتابة حسب الحاجة" },
              { icon: Pen, title: "حجم الخط", desc: "اختر حجم الخط المناسب" },
              { icon: MapPin, title: "مكان الكتابة", desc: "تحديد تلقائي لمكان الإجابة" },
              { icon: Settings, title: "إعدادات متقدمة", desc: "تخصيص كامل لتجربة الكتابة" },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="text-center p-6 rounded-2xl bg-card border border-border/50"
              >
                <div className="w-14 h-14 rounded-xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-7 h-7 text-amber-600" />
                </div>
                <h4 className="font-bold mb-1">{item.title}</h4>
                <p className="text-muted-foreground text-xs">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
