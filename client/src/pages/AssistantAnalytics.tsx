import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { TrendingUp, MessageSquare, Users, ThumbsUp, Zap } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useI18n, useMessages } from "@/i18n";
import { analyticsMessages } from "@/i18n/locales/analytics";

interface AnalyticsData {
  totalQuestions: number; totalUsers: number; averageRating: number;
  topCategories: Array<{ category: string; count: number }>;
  questionTrends: Array<{ date: string; count: number }>;
  languageDistribution: Array<{ name: string; value: number }>;
  responseQuality: Array<{ category: string; quality: number }>;
  frequentQuestions: Array<{ question: string; frequency: number; category: string }>;
}
const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

export default function AssistantAnalytics() {
  const t = useMessages(analyticsMessages);
  const { lang, setLang, formatNumber, formatDate } = useI18n();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const categoryLabel = (value: string) => {
    const key = value.trim().toLowerCase();
    const known: Record<string, string> = {
      general: t.categories.general, education: t.categories.education, technology: t.categories.technology,
      accessibility: t.categories.accessibility, exams: t.categories.exams, support: t.categories.support,
      "\u0639\u0627\u0645": t.categories.general, "\u0627\u0644\u062a\u0639\u0644\u064a\u0645": t.categories.education,
      "\u0627\u0644\u062a\u0642\u0646\u064a\u0629": t.categories.technology, "\u0625\u062a\u0627\u062d\u0629 \u0627\u0644\u0648\u0635\u0648\u0644": t.categories.accessibility,
      "\u0627\u0644\u0627\u062e\u062a\u0628\u0627\u0631\u0627\u062a": t.categories.exams, "\u0627\u0644\u062f\u0639\u0645": t.categories.support,
    };
    return known[key] ?? known[value] ?? value;
  };
  const languageLabel = (value: string) => {
    const key = value.trim().toLowerCase();
    const known: Record<string, string> = {
      ar: t.languages.ar, arabic: t.languages.ar, "\u0627\u0644\u0639\u0631\u0628\u064a\u0629": t.languages.ar,
      en: t.languages.en, english: t.languages.en, "\u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629": t.languages.en,
      zh: t.languages.zh, "zh-cn": t.languages.zh, chinese: t.languages.zh,
    };
    return known[key] ?? known[value] ?? value;
  };
  const fetchAnalytics = async () => {
    try {
      setIsLoading(true); setHasError(false);
      const response = await fetch("/api/assistant-analytics");
      if (!response.ok) throw new Error("Analytics request failed");
      setAnalytics(await response.json());
    } catch (error) {
      console.error("Analytics error:", error); setHasError(true); toast.error(t.error);
    } finally { setIsLoading(false); }
  };
  useEffect(() => { void fetchAnalytics(); }, []);

  if (isLoading) return <Layout><div className="container py-12"><div className="text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" /><p className="mt-4 text-muted-foreground">{t.loading}</p></div></div></Layout>;
  if (hasError || !analytics) return <Layout><div className="container py-12"><div className="text-center"><p className="text-muted-foreground mb-4">{t.empty}</p><Button onClick={() => void fetchAnalytics()} variant="outline">{t.retry}</Button></div></div></Layout>;

  const topCategories = analytics.topCategories.map(item => ({ ...item, category: categoryLabel(item.category), count: formatNumber(item.count) }));
  const questionTrends = analytics.questionTrends.map(item => ({ ...item, date: formatDate(item.date), count: formatNumber(item.count) }));
  const languageDistribution = analytics.languageDistribution.map(item => ({ ...item, name: languageLabel(item.name), value: formatNumber(item.value) }));
  const metrics = [
    { icon: MessageSquare, label: t.totalQuestions, value: formatNumber(analytics.totalQuestions), color: "blue" },
    { icon: Users, label: t.activeUsers, value: formatNumber(analytics.totalUsers), color: "green" },
    { icon: ThumbsUp, label: t.averageRating, value: formatNumber(analytics.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), color: "amber" },
    { icon: Zap, label: t.responseRate, value: t.responseRateValue, color: "purple" },
  ];
  return <Layout>
    <section className="py-10 md:py-14 bg-gradient-to-b from-blue-50/50 to-background"><div className="container"><div className="max-w-3xl mx-auto text-center">
      <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-4"><TrendingUp className="w-4 h-4" />{t.badge}</span><h1 className="text-3xl md:text-4xl font-bold mb-4">{t.title}</h1><p className="text-muted-foreground text-lg">{t.description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2" aria-label={t.languageLabel}>{[{ code: "ar" as const, label: t.languages.ar }, { code: "en" as const, label: t.languages.en }, { code: "zh-CN" as const, label: t.languages.zh }].map(item => <Button key={item.code} onClick={() => setLang(item.code)} variant={lang === item.code ? "default" : "outline"}>{item.label}</Button>)}</div>
    </div></div></section>
    <section className="py-8 md:py-12"><div className="container">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">{metrics.map((metric, idx) => <motion.div key={idx} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }} className="p-6 rounded-2xl border border-border/50 bg-card hover:shadow-lg transition-shadow"><div className={`w-12 h-12 rounded-xl bg-${metric.color}-100 flex items-center justify-center mb-4`}><metric.icon className={`w-6 h-6 text-${metric.color}-600`} /></div><p className="text-muted-foreground text-sm mb-2">{metric.label}</p><p className="text-3xl font-bold">{metric.value}</p></motion.div>)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-2xl border border-border/50 bg-card"><h3 className="text-lg font-bold mb-6">{t.topCategories}</h3><ResponsiveContainer width="100%" height={300}><BarChart data={topCategories}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="category" angle={-45} textAnchor="end" height={100} /><YAxis /><Tooltip /><Bar dataKey="count" name={t.questions} fill="#3b82f6" /></BarChart></ResponsiveContainer></motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="p-6 rounded-2xl border border-border/50 bg-card"><h3 className="text-lg font-bold mb-6">{t.languageDistribution}</h3><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={languageDistribution} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${value}%`} outerRadius={100} fill="#8884d8" dataKey="value">{languageDistribution.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="p-6 rounded-2xl border border-border/50 bg-card lg:col-span-2"><h3 className="text-lg font-bold mb-6">{t.questionTrends}</h3><ResponsiveContainer width="100%" height={300}><LineChart data={questionTrends}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Legend /><Line type="monotone" dataKey="count" stroke="#3b82f6" name={t.questions} strokeWidth={2} /></LineChart></ResponsiveContainer></motion.div>
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="p-6 rounded-2xl border border-border/50 bg-card"><h3 className="text-lg font-bold mb-6">{t.frequentQuestions}</h3><div className="space-y-4">{analytics.frequentQuestions.map((q, idx) => <div key={idx} className="p-4 rounded-lg bg-background border border-border/30 hover:border-border/50 transition-colors"><div className="flex items-start justify-between gap-4"><div className="flex-1"><p className="font-medium text-sm mb-1">{q.question}</p><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">{categoryLabel(q.category)}</span><span>{t.times} {formatNumber(q.frequency)}</span></div></div><div><div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center"><MessageSquare className="w-6 h-6 text-blue-600" /></div></div></div></div>)}</div></motion.div>
    </div></section>
  </Layout>;
}
