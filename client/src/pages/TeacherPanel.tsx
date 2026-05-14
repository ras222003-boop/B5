/*
 * TeacherPanel - Teacher control panel for managing exam settings
 * Includes browser lock, exam monitoring, and student management
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield, Lock, Unlock, Eye, Clock, Users,
  Settings, AlertTriangle, CheckCircle, Monitor,
  Volume2, Bell, FileText, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { useTextToSpeech } from "@/hooks/useSpeech";

type ExamSetting = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  icon: any;
};

export default function TeacherPanel() {
  const { speak } = useTextToSpeech();

  const [settings, setSettings] = useState<ExamSetting[]>([
    { id: "browser-lock", label: "قفل المتصفح", description: "منع الطالب من الخروج إلى متصفحات أو تطبيقات خارجية أثناء الاختبار", enabled: true, icon: Lock },
    { id: "time-limit", label: "تحديد الوقت", description: "تعيين مدة زمنية محددة للاختبار مع تنبيهات صوتية", enabled: true, icon: Clock },
    { id: "auto-submit", label: "تسليم تلقائي", description: "تسليم الاختبار تلقائياً عند انتهاء الوقت", enabled: true, icon: CheckCircle },
    { id: "voice-assist", label: "المساعد الصوتي", description: "السماح للطالب باستخدام المساعد الصوتي أثناء الاختبار", enabled: true, icon: Volume2 },
    { id: "ai-grading", label: "التصحيح التلقائي", description: "تفعيل التصحيح التلقائي بالذكاء الاصطناعي بعد التسليم", enabled: true, icon: BarChart3 },
    { id: "notifications", label: "إشعارات المعلم", description: "إرسال إشعار للمعلم عند بدء أو تسليم الاختبار", enabled: false, icon: Bell },
    { id: "camera-monitor", label: "مراقبة بالكاميرا", description: "تفعيل الكاميرا لمراقبة الطالب أثناء الاختبار (اختياري)", enabled: false, icon: Eye },
    { id: "pdf-export", label: "تصدير النتائج", description: "السماح بتصدير الإجابات والنتائج كملف PDF", enabled: true, icon: FileText },
  ]);

  const [examDuration, setExamDuration] = useState(60);
  const [maxStudents, setMaxStudents] = useState(30);

  const toggleSetting = (id: string) => {
    setSettings(prev => prev.map(s => {
      if (s.id === id) {
        const newState = !s.enabled;
        speak(`تم ${newState ? "تفعيل" : "إلغاء"} ${s.label}`, 0.9, "ar");
        return { ...s, enabled: newState };
      }
      return s;
    }));
  };

  const browserLockEnabled = settings.find(s => s.id === "browser-lock")?.enabled;

  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container max-w-4xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <div className="w-20 h-20 rounded-3xl bg-purple-100 flex items-center justify-center mx-auto mb-6">
              <Settings className="w-10 h-10 text-purple-600" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">لوحة تحكم المعلم</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              تحكم في إعدادات الاختبار وراقب تقدم الطلاب. يمكنك تفعيل قفل المتصفح لمنع الطالب من الخروج أثناء الاختبار.
            </p>
          </motion.div>

          {/* Browser Lock Alert */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={`p-6 rounded-2xl border-2 mb-8 ${
              browserLockEnabled
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                browserLockEnabled ? "bg-green-100" : "bg-red-100"
              }`}>
                {browserLockEnabled ? (
                  <Lock className="w-7 h-7 text-green-600" />
                ) : (
                  <Unlock className="w-7 h-7 text-red-600" />
                )}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold mb-1">
                  {browserLockEnabled ? "قفل المتصفح مفعّل" : "قفل المتصفح معطّل"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {browserLockEnabled
                    ? "الطالب لن يتمكن من الخروج إلى متصفحات أو تطبيقات خارجية أثناء الاختبار. هذا يضمن نزاهة الاختبار."
                    : "تحذير: الطالب يمكنه الخروج من المنصة والوصول إلى مصادر خارجية. فعّل القفل لضمان نزاهة الاختبار."}
                </p>
              </div>
              <Button
                onClick={() => toggleSetting("browser-lock")}
                className={`rounded-xl ${
                  browserLockEnabled
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-green-600 hover:bg-green-700 text-white"
                }`}
              >
                {browserLockEnabled ? (
                  <><Unlock className="w-4 h-4 ml-2" />إلغاء القفل</>
                ) : (
                  <><Lock className="w-4 h-4 ml-2" />تفعيل القفل</>
                )}
              </Button>
            </div>
            {!browserLockEnabled && (
              <div className="mt-4 p-3 bg-red-100 rounded-xl text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>تنبيه: بدون قفل المتصفح، يمكن للطالب الوصول إلى الإنترنت والبحث عن الإجابات أثناء الاختبار.</span>
              </div>
            )}
          </motion.div>

          {/* Exam Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 mb-8"
          >
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Monitor className="w-5 h-5 text-purple-600" />
              إعدادات الاختبار
            </h2>

            <div className="grid sm:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">مدة الاختبار (بالدقائق)</label>
                <input
                  type="number"
                  value={examDuration}
                  onChange={(e) => setExamDuration(Number(e.target.value))}
                  min={5}
                  max={300}
                  className="w-full h-12 px-4 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">الحد الأقصى للطلاب</label>
                <input
                  type="number"
                  value={maxStudents}
                  onChange={(e) => setMaxStudents(Number(e.target.value))}
                  min={1}
                  max={500}
                  className="w-full h-12 px-4 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
            </div>

            <div className="p-4 bg-purple-50 rounded-xl text-sm text-purple-800">
              <p className="font-medium mb-1">ملخص الإعدادات:</p>
              <p>مدة الاختبار: {examDuration} دقيقة | الحد الأقصى: {maxStudents} طالب | قفل المتصفح: {browserLockEnabled ? "مفعّل" : "معطّل"}</p>
            </div>
          </motion.div>

          {/* Settings Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <SectionHeading
              badge="الإعدادات"
              title="تحكم في كل جانب من الاختبار"
            />
            <div className="grid sm:grid-cols-2 gap-4">
              {settings.map((setting, i) => (
                <motion.div
                  key={setting.id}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className={`p-5 rounded-2xl border-2 transition-all ${
                    setting.enabled
                      ? "border-purple-200 bg-purple-50/30"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        setting.enabled ? "bg-purple-100 text-purple-600" : "bg-muted text-muted-foreground"
                      }`}>
                        <setting.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm mb-1">{setting.label}</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">{setting.description}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleSetting(setting.id)}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 mt-1 ${
                        setting.enabled ? "bg-purple-600" : "bg-gray-300"
                      }`}
                      role="switch"
                      aria-checked={setting.enabled}
                      aria-label={`${setting.enabled ? "إلغاء" : "تفعيل"} ${setting.label}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        setting.enabled ? "right-0.5" : "right-[calc(100%-22px)]"
                      }`} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Stats Preview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mt-12 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl p-8 text-white text-center"
          >
            <h2 className="text-2xl font-bold mb-6">إحصائيات سريعة</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { icon: Users, value: "0", label: "طلاب نشطون" },
                { icon: FileText, value: "0", label: "اختبارات مكتملة" },
                { icon: BarChart3, value: "0%", label: "متوسط الدرجات" },
                { icon: Clock, value: `${examDuration}د`, label: "مدة الاختبار" },
              ].map((stat) => (
                <div key={stat.label}>
                  <stat.icon className="w-6 h-6 mx-auto mb-2 text-purple-200" />
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <div className="text-xs text-purple-200">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
