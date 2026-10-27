import "./boot";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { I18nProvider } from "../../client/src/i18n";
import { ThemeProvider } from "../../client/src/contexts/ThemeContext";
import Vision from "../../client/src/pages/Vision";
import VoiceSettings from "../../client/src/pages/VoiceSettings";
import VoiceValidation from "../../client/src/pages/VoiceValidation";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import { Toaster } from "../../client/src/components/ui/sonner";
import "../../client/src/index.css";
function Preview() {
  const [mic, setMic] = useState("لم يُختبر الميكروفون");
  const testMic = async () => {
    setMic("بانتظار إذن الميكروفون…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      const tracks = stream.getTracks();
      tracks.forEach(t => t.stop());
      setMic(
        tracks.length && tracks.every(t => t.readyState === "ended")
          ? "وصل مسار ميكروفون وأُغلق؛ لم يُسجّل أو يُرسل صوت، ولم تُختبر جودته"
          : "لم يُتحقق من مسار الميكروفون"
      );
    } catch {
      setMic("تعذر إذن الميكروفون أو الوصول إليه");
    }
  };
  return (
    <Router hook={useHashLocation}>
      <I18nProvider>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <Toaster />
            <aside
              dir="rtl"
              aria-label="حالة المعاينة المستقلة"
              className="bg-amber-100 text-stone-950 p-4 text-lg"
            >
              <strong>بصيرة — معاينة بحثية مستقلة للرؤية</strong>
              <p>
                التعرف محلي. الألوان غير مثبتة، وهذه ليست أداة للمشي أو منع
                السقوط. الحسابات والامتحانات وخدمات الخادم غير متاحة في هذه
                المعاينة. الموقع الأصلي لم يتغير.
              </p>
              <p>
                هذه معاينة متصفح لا تصل إلى LiDAR الأصلي في iPhone. لا يدعم Safari
                الاهتزازات الأصلية، لذلك اختبر الاهتزازات وعمق LiDAR في التطبيق
                التجريبي على جهاز حقيقي. يمكن فحص واجهة التنبيه والصوت هنا دون
                اعتبارها دليلًا على سلامة التنقل.
              </p>
              <button
                type="button"
                onClick={() => void testMic()}
                className="min-h-12 border border-stone-800 rounded px-4"
              >
                اختبار إذن الميكروفون دون تسجيل
              </button>
              <p role="status" aria-live="polite">
                {mic}
              </p>
            </aside>
            <Switch>
              <Route path="/settings/voice" component={VoiceSettings} />
              <Route
                path="/settings/voice-validation"
                component={VoiceValidation}
              />
              <Route>
                <Vision />
              </Route>
            </Switch>
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </Router>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
