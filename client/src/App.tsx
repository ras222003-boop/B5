import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useState } from "react";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import WelcomeScreen from "./components/WelcomeScreen";
import { ThemeProvider } from "./contexts/ThemeContext";
import { I18nProvider, useI18n } from "./i18n";
import Home from "./pages/Home";
import HowItWorks from "./pages/HowItWorks";
import Features from "./pages/Features";
import RoboticArm from "./pages/RoboticArm";
import DigitalAssistant from "./pages/DigitalAssistant";
import AIGuide from "./pages/AIGuide";
import ExamDemo from "./pages/ExamDemo";
import OnlineExams from "./pages/OnlineExams";
import TeacherPanel from "./pages/TeacherPanel";
import AssistantAnalytics from "./pages/AssistantAnalytics";
import PhotoRequirements from "./pages/PhotoRequirements";
import VoiceGuide from "./components/VoiceGuide";
import FloatingChatWidget from "./components/FloatingChatWidget";
import { About, Terms, Privacy, RefundPolicy, Contact } from "./pages/Information";
import Support from "./pages/Support";
import Account from "./pages/Account";
const Navigation=lazy(()=>import('./pages/Navigation'));
const BuildingPage=lazy(()=>import('./pages/Navigation').then(page=>({default:page.BuildingPage})));
const MyPlaces=lazy(()=>import('./pages/Navigation').then(page=>({default:page.MyPlaces})));
const NavigationAdmin=lazy(()=>import('./pages/NavigationAdmin'));
const NavigationPermissions=lazy(()=>import('./pages/NavigationPermissions'));
const Vision=lazy(()=>import('./pages/Vision'));
const Mapping=lazy(()=>import('./pages/Mapping'));
const Guidance=lazy(()=>import('./pages/Guidance'));
const SharedMap=lazy(()=>import('./pages/SharedMap'));
const IndoorManager=lazy(()=>import('./pages/IndoorManager'));
const NavigationCapabilities=lazy(()=>import('./pages/NavigationCapabilities'));

function Router() {
  const {lang}=useI18n();
  return (
    <Suspense fallback={<div role="status" aria-live="polite" className="p-8">{lang==='ar'?'جارٍ تحميل الصفحة':lang==='zh-CN'?'正在加载页面':'Loading page'}</div>}>
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/refund-policy" component={RefundPolicy} />
      <Route path="/contact" component={Contact} />
      <Route path="/support" component={Support} />
      <Route path="/account" component={Account} />
      <Route path="/navigation" component={Navigation} />
      <Route path="/navigation/places" component={MyPlaces} />
      <Route path="/navigation/permissions" component={NavigationPermissions} />
      <Route path="/navigation/vision" component={Vision} />
      <Route path="/navigation/mapping" component={Mapping} />
      <Route path="/navigation/guidance" component={Guidance} />
      <Route path="/navigation/shared-map" component={SharedMap} />
      <Route path="/navigation/indoor-manager" component={IndoorManager} />
      <Route path="/navigation/capabilities" component={NavigationCapabilities} />
      <Route path="/settings/privacy-permissions" component={NavigationPermissions} />
      <Route path="/navigation/admin" component={NavigationAdmin} />
      <Route path="/navigation/buildings/:id" component={BuildingPage} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/features" component={Features} />
      <Route path="/robotic-arm" component={RoboticArm} />
      <Route path="/assistant" component={DigitalAssistant} />
      <Route path="/ai-guide" component={AIGuide} />
      <Route path="/exam-demo" component={ExamDemo} />
      <Route path="/online-exams" component={OnlineExams} />
      <Route path="/teacher" component={TeacherPanel} />
      <Route path="/teacher-panel" component={TeacherPanel} />
      <Route path="/assistant-analytics" component={AssistantAnalytics} />
      <Route path="/photo-requirements" component={PhotoRequirements} />
      <Route path="*" component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function LocalizedToaster() {
  const { dir } = useI18n();
  return <Toaster dir={dir} position={dir === "rtl" ? "top-left" : "top-right"} />;
}

function App() {
  const [isWelcomeVisible, setIsWelcomeVisible] = useState(true);

  return (
    <I18nProvider>
      <ErrorBoundary>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <LocalizedToaster />
            <Router />
            <VoiceGuide />
            <FloatingChatWidget />
          </TooltipProvider>
        </ThemeProvider>
      </ErrorBoundary>
      {isWelcomeVisible && <WelcomeScreen onDismiss={() => setIsWelcomeVisible(false)} />}
    </I18nProvider>
  );
}

export default App;
