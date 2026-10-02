import { motion } from "framer-motion";
import { Camera, CheckCircle, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ForwardArrow } from "@/components/DirectionalIcon";
import { useI18n, useMessages } from "@/i18n";
import { photoRequirementsMessages } from "@/i18n/locales/photoRequirements";

const requirementIcons = ["🎨", "👤", "📏", "💡", "😐", "👁️", "📷", "🚫", "🧢", "💄", "👔", "📅"] as const;

type Status = "required" | "prohibited" | "recommended";

export default function PhotoRequirements() {
  const t = useMessages(photoRequirementsMessages);
  const { lang, isRTL, setLang } = useI18n();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "required": return "bg-red-50 border-red-200";
      case "prohibited": return "bg-orange-50 border-orange-200";
      case "recommended": return "bg-green-50 border-green-200";
      default: return "bg-gray-50 border-gray-200";
    }
  };

  const getStatusBadge = (status: string) => {
    const label = t.status[status as Status];
    if (!label) return null;
    const Icon = status === "prohibited" ? AlertCircle : CheckCircle;
    const colors = status === "prohibited" ? "bg-orange-100 text-orange-700" : status === "recommended" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 ${colors} rounded-full text-xs font-semibold`}>
        <Icon size={14} />
        {label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Camera size={32} />
              <h1 className={`text-3xl font-bold ${isRTL ? "text-end" : "text-start"}`}>{t.title}</h1>
            </div>
            <div className="flex gap-2" aria-label={t.languages.ar}>
              {(["ar", "en", "zh-CN"] as const).map(language => (
                <Button
                  key={language}
                  variant={lang === language ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLang(language)}
                  className={lang === language ? "bg-white text-orange-600" : "text-white border-white"}
                >
                  {t.languages[language === "zh-CN" ? "zhCN" : language]}
                </Button>
              ))}
            </div>
          </div>
          <p className={`text-orange-100 ${isRTL ? "text-end" : "text-start"}`}>{t.subtitle}</p>
          <p className={`text-orange-100 mt-2 text-sm ${isRTL ? "text-end" : "text-start"}`}>{t.supportedLanguages}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-12">
        <Tabs defaultValue="requirements" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="requirements">{t.tabs.requirements}</TabsTrigger>
            <TabsTrigger value="specifications">{t.tabs.specifications}</TabsTrigger>
            <TabsTrigger value="tips">{t.tabs.tips}</TabsTrigger>
          </TabsList>

          <TabsContent value="requirements" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {t.requirements.map((req, index) => (
                <motion.div key={req.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  <Card className={`border-2 ${getStatusColor(req.status)} h-full`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <CardTitle className={`text-lg ${isRTL ? "text-end" : "text-start"}`}>{req.title}</CardTitle>
                          <CardDescription className={`mt-2 ${isRTL ? "text-end" : "text-start"}`}>{req.description}</CardDescription>
                        </div>
                        <div className="text-3xl" aria-hidden="true">{requirementIcons[index]}</div>
                      </div>
                      <div className="mt-3">{getStatusBadge(req.status)}</div>
                    </CardHeader>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="specifications">
            <Card>
              <CardHeader><CardTitle>{t.specifications.title}</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {t.specifications.rows.map((req, index) => (
                    <motion.div key={index} initial={{ opacity: 0, x: isRTL ? 20 : -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.1 }} className="flex items-center justify-between gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                      <div className={isRTL ? "text-end" : "text-start"}>
                        <p className="font-semibold text-gray-900">{req.label}</p>
                        <p className="text-gray-600 text-sm mt-1" dir="ltr">{req.value}</p>
                      </div>
                      <CheckCircle className="text-green-500 shrink-0" size={24} />
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tips">
            <div className="space-y-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader><CardTitle className="text-blue-900">{t.tips.title}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {t.tips.items.map((tip, index) => (
                    <div className="flex gap-3" key={index}><div className="text-2xl" aria-hidden="true">✓</div><p className={isRTL ? "text-end" : "text-start"}>{tip}</p></div>
                  ))}
                </CardContent>
              </Card>
              <Card className="bg-amber-50 border-amber-200">
                <CardHeader><CardTitle className="text-amber-900">{t.tips.mistakesTitle}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {t.tips.mistakes.map((mistake, index) => (
                    <div className="flex gap-3" key={index}><div className="text-2xl" aria-hidden="true">✗</div><p className={isRTL ? "text-end" : "text-start"}>{mistake}</p></div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white gap-2"><Download size={20} />{t.actions.download}</Button>
          <Button size="lg" variant="outline" className="gap-2"><ForwardArrow size={20} />{t.actions.back}</Button>
        </div>
      </div>
    </div>
  );
}
