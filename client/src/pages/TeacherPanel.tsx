import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Unlock, Eye, Clock, Users, Settings, AlertTriangle, CheckCircle, Monitor, Volume2, Bell, FileText, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { useTextToSpeech } from "@/hooks/useSpeech";
import { useMessages } from "@/i18n";
import { teacherMessages } from "@/i18n/locales/teacher";

type ExamSetting = { id: string; label: string; description: string; enabled: boolean; icon: any };

export default function TeacherPanel() {
  const t = useMessages(teacherMessages);
  const { speak } = useTextToSpeech();
  const [settings, setSettings] = useState<ExamSetting[]>([
    { id: "browser-lock", label: t.settings.browserLock.label, description: t.settings.browserLock.description, enabled: true, icon: Lock },
    { id: "time-limit", label: t.settings.timeLimit.label, description: t.settings.timeLimit.description, enabled: true, icon: Clock },
    { id: "auto-submit", label: t.settings.autoSubmit.label, description: t.settings.autoSubmit.description, enabled: true, icon: CheckCircle },
    { id: "voice-assist", label: t.settings.voiceAssist.label, description: t.settings.voiceAssist.description, enabled: true, icon: Volume2 },
    { id: "ai-grading", label: t.settings.aiGrading.label, description: t.settings.aiGrading.description, enabled: true, icon: BarChart3 },
    { id: "notifications", label: t.settings.notifications.label, description: t.settings.notifications.description, enabled: false, icon: Bell },
    { id: "camera-monitor", label: t.settings.cameraMonitor.label, description: t.settings.cameraMonitor.description, enabled: false, icon: Eye },
    { id: "pdf-export", label: t.settings.pdfExport.label, description: t.settings.pdfExport.description, enabled: true, icon: FileText },
  ]);
  const [examDuration, setExamDuration] = useState(60);
  const [maxStudents, setMaxStudents] = useState(30);
  const toggleSetting = (id: string) => setSettings(prev => prev.map(s => {
    if (s.id !== id) return s;
    const enabled = !s.enabled;
    speak(`${enabled ? t.settings.statusEnabled : t.settings.statusDisabled} ${s.label}`, 0.9);
    return { ...s, enabled };
  }));
  const browserLockEnabled = settings.find(s => s.id === "browser-lock")?.enabled;
  return <Layout><section className="py-16 md:py-24"><div className="container max-w-4xl">
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-center mb-12">
      <div className="w-20 h-20 rounded-3xl bg-purple-100 flex items-center justify-center mx-auto mb-6"><Settings className="w-10 h-10 text-purple-600" /></div>
      <h1 className="text-3xl md:text-4xl font-bold mb-4">{t.header.title}</h1><p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t.header.description}</p>
    </motion.div>
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className={`p-6 rounded-2xl border-2 mb-8 ${browserLockEnabled ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
      <div className="flex items-center gap-4"><div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${browserLockEnabled ? "bg-green-100" : "bg-red-100"}`}>{browserLockEnabled ? <Lock className="w-7 h-7 text-green-600" /> : <Unlock className="w-7 h-7 text-red-600" />}</div>
        <div className="flex-1"><h2 className="text-lg font-bold mb-1">{browserLockEnabled ? t.browserLock.enabledTitle : t.browserLock.disabledTitle}</h2><p className="text-sm text-muted-foreground">{browserLockEnabled ? t.browserLock.enabledDescription : t.browserLock.disabledDescription}</p></div>
        <Button onClick={() => toggleSetting("browser-lock")} className={`rounded-xl ${browserLockEnabled ? "bg-red-500 hover:bg-red-600 text-white" : "bg-green-600 hover:bg-green-700 text-white"}`}>{browserLockEnabled ? <><Unlock className="w-4 h-4 me-2" />{t.browserLock.unlock}</> : <><Lock className="w-4 h-4 me-2" />{t.browserLock.enable}</>}</Button>
      </div>{!browserLockEnabled && <div className="mt-4 p-3 bg-red-100 rounded-xl text-xs text-red-700 flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{t.browserLock.warning}</span></div>}
    </motion.div>
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }} className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 mb-8">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Monitor className="w-5 h-5 text-purple-600" />{t.exam.title}</h2><div className="grid sm:grid-cols-2 gap-6 mb-6">
        <div><label className="block text-sm font-medium mb-2">{t.exam.duration}</label><input type="number" value={examDuration} onChange={e => setExamDuration(Number(e.target.value))} min={5} max={300} className="w-full h-12 px-4 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:border-purple-500 transition-colors" /></div>
        <div><label className="block text-sm font-medium mb-2">{t.exam.maxStudents}</label><input type="number" value={maxStudents} onChange={e => setMaxStudents(Number(e.target.value))} min={1} max={500} className="w-full h-12 px-4 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:border-purple-500 transition-colors" /></div>
      </div><div className="p-4 bg-purple-50 rounded-xl text-sm text-purple-800"><p className="font-medium mb-1">{t.exam.summary}</p><p>{t.exam.summaryDetails(String(examDuration), String(maxStudents), browserLockEnabled ? t.exam.enabled : t.exam.disabled)}</p></div>
    </motion.div>
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}><SectionHeading badge={t.settings.badge} title={t.settings.title} /><div className="grid sm:grid-cols-2 gap-4">{settings.map((setting, i) => <motion.div key={setting.id} initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.05 }} className={`p-5 rounded-2xl border-2 transition-all ${setting.enabled ? "border-purple-200 bg-purple-50/30" : "border-border bg-card"}`}>
      <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3 flex-1"><div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${setting.enabled ? "bg-purple-100 text-purple-600" : "bg-muted text-muted-foreground"}`}><setting.icon className="w-5 h-5" /></div><div><h3 className="font-bold text-sm mb-1">{setting.label}</h3><p className="text-xs text-muted-foreground leading-relaxed">{setting.description}</p></div></div>
      <button onClick={() => toggleSetting(setting.id)} className={`w-11 h-6 rounded-full transition-colors relative shrink-0 mt-1 ${setting.enabled ? "bg-purple-600" : "bg-gray-300"}`} role="switch" aria-checked={setting.enabled} aria-label={`${setting.enabled ? t.settings.deactivate : t.settings.activate} ${setting.label}`}><span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${setting.enabled ? "end-0.5" : "start-0.5"}`} /></button></div>
    </motion.div>)}</div></motion.div>
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="mt-12 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl p-8 text-white text-center"><h2 className="text-2xl font-bold mb-6">{t.stats.title}</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-6">{[{ icon: Users, value: "0", label: t.stats.activeStudents }, { icon: FileText, value: "0", label: t.stats.completedExams }, { icon: BarChart3, value: "0%", label: t.stats.averageScore }, { icon: Clock, value: t.stats.duration(String(examDuration)), label: t.exam.duration }].map(stat => <div key={stat.label}><stat.icon className="w-6 h-6 mx-auto mb-2 text-purple-200" /><div className="text-2xl font-bold">{stat.value}</div><div className="text-xs text-purple-200">{stat.label}</div></div>)}</div></motion.div>
  </div></section></Layout>;
}
