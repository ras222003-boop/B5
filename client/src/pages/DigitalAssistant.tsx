/*
 * Design: Warm Contemporary
 * Digital Assistant page - AI assistant for visually impaired users
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Send,
  Bot,
  User,
  Sparkles,
  HelpCircle,
  BookOpen,
  FileText,
  Settings,
  MessageSquare,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const voiceAssistantImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/voice-assistant-75gfzSUhMJ42H6udJomG6i.webp";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const quickActions = [
  { icon: BookOpen, label: "اقرأ لي السؤال", action: "اقرأ لي السؤال الحالي" },
  { icon: HelpCircle, label: "ساعدني في الإجابة", action: "ساعدني في فهم السؤال" },
  { icon: FileText, label: "راجع إجاباتي", action: "راجع جميع إجاباتي" },
  { icon: Settings, label: "إعدادات الصوت", action: "غيّر إعدادات الصوت" },
];

const assistantResponses: Record<string, string> = {
  "اقرأ لي السؤال الحالي": "السؤال الأول: ما هي عاصمة المملكة العربية السعودية؟ الخيارات هي: أ) الرياض، ب) جدة، ج) مكة المكرمة، د) الدمام. هل تريدني أن أعيد قراءة السؤال؟",
  "ساعدني في فهم السؤال": "بالتأكيد! السؤال يسألك عن العاصمة الرسمية للمملكة العربية السعودية. العاصمة هي المدينة التي يوجد فيها مقر الحكومة الرسمي. هل تريد أن أقرأ لك الخيارات مرة أخرى؟",
  "راجع جميع إجاباتي": "لم يتم تسجيل أي إجابات بعد. يمكنك البدء بالإجابة على السؤال الأول. هل تريدني أن أقرأ لك السؤال؟",
  "غيّر إعدادات الصوت": "إعدادات الصوت الحالية: السرعة: متوسطة، مستوى الصوت: مرتفع، اللغة: العربية. يمكنك قول 'أسرع' أو 'أبطأ' لتغيير سرعة القراءة.",
};

export default function DigitalAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "مرحباً بك في المساعد الرقمي لمنصة بصيرة! أنا هنا لمساعدتك في أداء اختبارك. يمكنك التحدث معي بالصوت أو الكتابة. كيف يمكنني مساعدتك؟",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Simulate assistant response
    setTimeout(() => {
      const response = assistantResponses[text] ||
        `فهمت طلبك: "${text}". سأقوم بمعالجة ذلك الآن. هل تحتاج مساعدة في شيء آخر؟`;

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }, 1000);
  };

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      toast.info("تم إيقاف الاستماع");
    } else {
      setIsListening(true);
      toast.info("جاري الاستماع... تحدث الآن", {
        description: "سيتم تحويل كلامك إلى نص تلقائياً",
      });
      // Simulate voice input
      setTimeout(() => {
        setIsListening(false);
        sendMessage("اقرأ لي السؤال الحالي");
      }, 3000);
    }
  };

  const toggleSpeaking = () => {
    setIsSpeaking(!isSpeaking);
    toast.info(isSpeaking ? "تم إيقاف القراءة الصوتية" : "تم تفعيل القراءة الصوتية");
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="py-12 md:py-16 bg-gradient-to-b from-amber-50/50 to-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-100 text-amber-700 text-sm font-medium mb-4">
                <Sparkles className="w-4 h-4" />
                المساعد الرقمي
              </span>
              <h1 className="text-3xl md:text-4xl font-bold mb-4">
                مساعدك الذكي في كل خطوة
              </h1>
              <p className="text-muted-foreground text-lg leading-relaxed">
                مساعد رقمي ذكي يعمل بالذكاء الاصطناعي، يساعدك في قراءة الأسئلة، تدوين الإجابات، والتنقل بين أجزاء الاختبار بسهولة تامة.
              </p>
            </div>
            <div className="hidden lg:block">
              <img
                src={voiceAssistantImage}
                alt="المساعد الصوتي الرقمي"
                className="rounded-2xl shadow-lg w-full"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Chat Interface */}
      <section className="py-8 md:py-12">
        <div className="container max-w-3xl">
          <div className="rounded-2xl border border-border/50 bg-card shadow-lg overflow-hidden">
            {/* Chat Header */}
            <div className="p-4 md:p-5 border-b border-border/50 bg-amber-50/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">مساعد بصيرة</h3>
                  <p className="text-xs text-muted-foreground">متصل ومستعد للمساعدة</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleSpeaking}
                  className={`rounded-lg ${isSpeaking ? "bg-amber-100 border-amber-300" : ""}`}
                  aria-label={isSpeaking ? "إيقاف القراءة الصوتية" : "تفعيل القراءة الصوتية"}
                >
                  {isSpeaking ? <Volume2 className="w-4 h-4 text-amber-600" /> : <VolumeX className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="p-3 border-b border-border/30 flex gap-2 overflow-x-auto">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => sendMessage(action.action)}
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium transition-colors active:scale-[0.97]"
                >
                  <action.icon className="w-3.5 h-3.5" />
                  {action.label}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div className="h-[400px] md:h-[450px] overflow-y-auto p-4 md:p-6 space-y-4 bg-gradient-to-b from-background to-amber-50/20">
              <AnimatePresence mode="popLayout">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      msg.role === "assistant" ? "bg-amber-100" : "bg-slate-200"
                    }`}>
                      {msg.role === "assistant" ? (
                        <Bot className="w-4 h-4 text-amber-600" />
                      ) : (
                        <User className="w-4 h-4 text-slate-600" />
                      )}
                    </div>
                    <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed ${
                      msg.role === "assistant"
                        ? "bg-card border border-border/50 text-foreground rounded-tr-none"
                        : "bg-amber-600 text-white rounded-tl-none"
                    }`}>
                      {msg.content}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-border/50 bg-card">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={toggleListening}
                  className={`rounded-xl shrink-0 w-11 h-11 ${
                    isListening ? "bg-red-50 border-red-300 text-red-500 animate-pulse-glow" : ""
                  }`}
                  aria-label={isListening ? "إيقاف الاستماع" : "بدء الاستماع"}
                >
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </Button>
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                    placeholder="اكتب رسالتك هنا أو استخدم الميكروفون..."
                    className="w-full h-11 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    aria-label="حقل إدخال الرسالة"
                  />
                </div>
                <Button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl shrink-0 w-11 h-11 active:scale-[0.97] transition-all"
                  aria-label="إرسال الرسالة"
                >
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Assistant Features */}
      <section className="py-16 md:py-24 bg-amber-50/30">
        <div className="container">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">ما يمكن للمساعد الرقمي فعله</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              { icon: Volume2, title: "قراءة الأسئلة", desc: "يقرأ لك جميع الأسئلة بصوت عربي واضح وطبيعي مع إمكانية التحكم بالسرعة." },
              { icon: Mic, title: "تدوين الإجابات", desc: "يستمع لإجابتك الصوتية ويحولها إلى نص مكتوب بدقة عالية." },
              { icon: MessageSquare, title: "الدردشة النصية", desc: "يمكنك الكتابة مباشرة كما في تطبيقات المحادثة مثل واتساب." },
              { icon: HelpCircle, title: "شرح الأسئلة", desc: "يساعدك في فهم الأسئلة وتوضيح المطلوب منك." },
              { icon: BookOpen, title: "مراجعة الإجابات", desc: "يقرأ لك إجاباتك السابقة ويساعدك في مراجعتها." },
              { icon: Settings, title: "تخصيص التجربة", desc: "تحكم في سرعة القراءة ومستوى الصوت وإعدادات أخرى." },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="p-6 rounded-2xl bg-card border border-border/50"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mb-4">
                  <item.icon className="w-6 h-6 text-amber-600" />
                </div>
                <h3 className="font-bold mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
