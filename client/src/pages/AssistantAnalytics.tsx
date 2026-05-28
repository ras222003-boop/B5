/*
 * Assistant Analytics Dashboard
 * Displays statistics about questions, responses, and user interactions
 */
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import {
  TrendingUp,
  MessageSquare,
  Users,
  ThumbsUp,
  AlertCircle,
  Globe,
  Zap,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface AnalyticsData {
  totalQuestions: number;
  totalUsers: number;
  averageRating: number;
  topCategories: Array<{ category: string; count: number }>;
  questionTrends: Array<{ date: string; count: number }>;
  languageDistribution: Array<{ name: string; value: number }>;
  responseQuality: Array<{ category: string; quality: number }>;
  frequentQuestions: Array<{ question: string; frequency: number; category: string }>;
}

const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

export default function AssistantAnalytics() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [language, setLanguage] = useState<"ar" | "en">("ar");

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/assistant-analytics");
      if (!response.ok) throw new Error("Failed to fetch analytics");
      const data = await response.json();
      setAnalytics(data);
    } catch (error) {
      console.error("Analytics error:", error);
      toast.error(language === "ar" ? "فشل تحميل الإحصائيات" : "Failed to load analytics");
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading || !analytics) {
    return (
      <Layout>
        <div className="container py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-4 text-muted-foreground">{language === "ar" ? "جاري تحميل الإحصائيات..." : "Loading analytics..."}</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Hero */}
      <section className="py-10 md:py-14 bg-gradient-to-b from-blue-50/50 to-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-4">
              <TrendingUp className="w-4 h-4" />
              {language === "ar" ? "لوحة الإحصائيات" : "Analytics Dashboard"}
            </span>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              {language === "ar" ? "تحليل أداء المساعد الذكي" : "Smart Assistant Performance"}
            </h1>
            <p className="text-muted-foreground text-lg">
              {language === "ar"
                ? "إحصائيات شاملة عن الأسئلة والإجابات وتفاعل المستخدمين"
                : "Comprehensive statistics about questions, answers, and user interactions"}
            </p>
            <Button
              onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
              variant="outline"
              className="mt-6"
            >
              <Globe className="w-4 h-4 mr-2" />
              {language === "ar" ? "English" : "العربية"}
            </Button>
          </div>
        </div>
      </section>

      {/* Key Metrics */}
      <section className="py-8 md:py-12">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
            {[
              {
                icon: MessageSquare,
                label: language === "ar" ? "إجمالي الأسئلة" : "Total Questions",
                value: analytics.totalQuestions,
                color: "blue",
              },
              {
                icon: Users,
                label: language === "ar" ? "المستخدمين النشطين" : "Active Users",
                value: analytics.totalUsers,
                color: "green",
              },
              {
                icon: ThumbsUp,
                label: language === "ar" ? "متوسط التقييم" : "Avg Rating",
                value: analytics.averageRating.toFixed(1),
                color: "amber",
              },
              {
                icon: Zap,
                label: language === "ar" ? "معدل الاستجابة" : "Response Rate",
                value: "98%",
                color: "purple",
              },
            ].map((metric, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={`p-6 rounded-2xl border border-border/50 bg-card hover:shadow-lg transition-shadow`}
              >
                <div className={`w-12 h-12 rounded-xl bg-${metric.color}-100 flex items-center justify-center mb-4`}>
                  <metric.icon className={`w-6 h-6 text-${metric.color}-600`} />
                </div>
                <p className="text-muted-foreground text-sm mb-2">{metric.label}</p>
                <p className="text-3xl font-bold">{metric.value}</p>
              </motion.div>
            ))}
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            {/* Top Categories */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-6 rounded-2xl border border-border/50 bg-card"
            >
              <h3 className="text-lg font-bold mb-6">
                {language === "ar" ? "أكثر الفئات طلباً" : "Top Categories"}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.topCategories}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Language Distribution */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="p-6 rounded-2xl border border-border/50 bg-card"
            >
              <h3 className="text-lg font-bold mb-6">
                {language === "ar" ? "توزيع اللغات" : "Language Distribution"}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={analytics.languageDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {analytics.languageDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Question Trends */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="p-6 rounded-2xl border border-border/50 bg-card lg:col-span-2"
            >
              <h3 className="text-lg font-bold mb-6">
                {language === "ar" ? "اتجاهات الأسئلة" : "Question Trends"}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={analytics.questionTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#3b82f6"
                    name={language === "ar" ? "عدد الأسئلة" : "Questions"}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          {/* Frequent Questions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="p-6 rounded-2xl border border-border/50 bg-card"
          >
            <h3 className="text-lg font-bold mb-6">
              {language === "ar" ? "الأسئلة الأكثر تكراراً" : "Most Frequent Questions"}
            </h3>
            <div className="space-y-4">
              {analytics.frequentQuestions.map((q, idx) => (
                <div key={idx} className="p-4 rounded-lg bg-background border border-border/30 hover:border-border/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="font-medium text-sm mb-1">{q.question}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">{q.category}</span>
                        <span>{language === "ar" ? "مرات:" : "Times:"} {q.frequency}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                        <MessageSquare className="w-6 h-6 text-blue-600" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
