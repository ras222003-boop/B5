import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import HowItWorks from "./pages/HowItWorks";
import Features from "./pages/Features";
import RoboticArm from "./pages/RoboticArm";
import DigitalAssistant from "./pages/DigitalAssistant";
import AIGuide from "./pages/AIGuide";
import ExamDemo from "./pages/ExamDemo";
import OnlineExams from "./pages/OnlineExams";
import TeacherPanel from "./pages/TeacherPanel";
import VoiceGuide from "./components/VoiceGuide";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/features" component={Features} />
      <Route path="/robotic-arm" component={RoboticArm} />
      <Route path="/assistant" component={DigitalAssistant} />
      <Route path="/ai-guide" component={AIGuide} />
      <Route path="/exam-demo" component={ExamDemo} />
      <Route path="/online-exams" component={OnlineExams} />
      <Route path="/teacher" component={TeacherPanel} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
          <VoiceGuide />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
