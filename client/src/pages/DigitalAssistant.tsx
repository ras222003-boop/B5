/*
 * Digital Assistant - Real AI chat with TTS and STT
 * Uses real LLM backend, Web Speech API for voice
 */
import { useState, useRef, useEffect, useCallback } from "react";
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
  Loader2,
  AlertCircle,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";

const voiceAssistantImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/voice-assistant-75gfzSUhMJ42H6udJomG6i.webp";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const quickActions = [
  { icon: BookOpen, label: "اقرأ لي السؤال", action: "اقرأ لي السؤال الحالي بصوت واضح" },
  { icon: HelpCircle, label: "ساعدني في الإجابة", action: "ساعدني في فهم السؤال الحالي وأعطني تلميحات" },
  { icon: FileText, label: "راجع إجاباتي", action: "راجع جميع إجاباتي وأخبرني إذا فاتني شيء" },
  { icon: Settings, label: "كيف أستخدم المنصة؟", action: "اشرح لي كيف أستخدم منصة بصيرة خطوة بخطوة" },
];

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
  const [isLoading, setIsLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript, error: speechError, setTranscript } = useSpeechToText();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update input when speech transcript changes
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoadingRef.current) return;

    stopSpeaking();

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...messagesRef.current, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setTranscript("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages
            .filter((m) => m.id !== "welcome")
            .map((m) => ({ role: m.role, content: m.content })),
          examContext: null,
        }),
      });

      if (!response.ok) {
        throw new Error("فشل في الاتصال بالمساعد");
      }

      const data = await response.json();
      const assistantContent = data.content || "عذراً، لم أتمكن من معالجة طلبك. حاول مرة أخرى.";

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: assistantContent,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Auto-speak the response
      if (autoSpeak) {
        setTimeout(() => speak(assistantContent), 300);
      }
    } catch (err: any) {
      console.error("Assistant error:", err);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "عذراً، حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      toast.error("فشل في الاتصال بالمساعد");
    } finally {
      setIsLoading(false);
    }
  }, [autoSpeak, speak, stopSpeaking, setTranscript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      // Auto-send after stopping if there's text
      setTimeout(() => {
        const currentInput = document.querySelector<HTMLInputElement>("[data-voice-input]")?.value;
        if (currentInput?.trim()) {
          sendMessage(currentInput);
        }
      }, 500);
    } else {
      stopSpeaking();
      setInput("");
      startListening();
      toast.info("تحدث الآن...", { description: "سيتم تحويل كلامك إلى نص" });
    }
  }, [isListening, stopListening, startListening, stopSpeaking, sendMessage]);

  const toggleAutoSpeak = () => {
    setAutoSpeak(!autoSpeak);
    if (autoSpeak) {
      stopSpeaking();
    }
    toast.info(autoSpeak ? "تم إيقاف القراءة التلقائية" : "تم تفعيل القراءة التلقائية");
  };

  const speakMessage = (content: string) => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      speak(content);
    }
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="py-10 md:py-14 bg-gradient-to-b from-amber-50/50 to-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-100 text-amber-700 text-sm font-medium mb-4">
                <Sparkles className="w-4 h-4" />
                مساعد ذكي بالذكاء الاصطناعي
              </span>
              <h1 className="text-3xl md:text-4xl font-bold mb-4">
                مساعدك الذكي في كل خطوة
              </h1>
              <p className="text-muted-foreground text-lg leading-relaxed">
                مساعد رقمي يعمل بالذكاء الاصطناعي الحقيقي، يساعدك في قراءة الأسئلة، فهم المطلوب، والتنقل بين أجزاء الاختبار بسهولة تامة. تحدث معه بالصوت أو اكتب له.
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
                  <p className="text-xs text-muted-foreground">يعمل بالذكاء الاصطناعي</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleAutoSpeak}
                className={`rounded-lg ${autoSpeak ? "bg-amber-100 border-amber-300" : ""}`}
                aria-label={autoSpeak ? "إيقاف القراءة التلقائية" : "تفعيل القراءة التلقائية"}
              >
                {autoSpeak ? <Volume2 className="w-4 h-4 text-amber-600" /> : <VolumeX className="w-4 h-4" />}
                <span className="mr-1 text-xs">{autoSpeak ? "صوت مفعّل" : "صوت متوقف"}</span>
              </Button>
            </div>

            {/* Quick Actions */}
            <div className="p-3 border-b border-border/30 flex gap-2 overflow-x-auto">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => sendMessage(action.action)}
                  disabled={isLoading}
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium transition-colors active:scale-[0.97] disabled:opacity-50"
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
                    <div
                      className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed ${
                        msg.role === "assistant"
                          ? "bg-card border border-border/50 text-foreground rounded-tr-none"
                          : "bg-amber-600 text-white rounded-tl-none"
                      }`}
                    >
                      {msg.content}
                      {msg.role === "assistant" && msg.id !== "welcome" && (
                        <button
                          onClick={() => speakMessage(msg.content)}
                          className="mt-2 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                          aria-label="قراءة الرسالة بالصوت"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          {isSpeaking ? "إيقاف" : "استمع"}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Loading indicator */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-100">
                    <Bot className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="bg-card border border-border/50 rounded-2xl rounded-tr-none p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري التفكير...
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-border/50 bg-card">
              {speechError && (
                <div className="mb-3 p-2 rounded-lg bg-red-50 text-red-600 text-xs flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {speechError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={toggleListening}
                  disabled={isLoading}
                  className={`rounded-xl shrink-0 w-11 h-11 ${
                    isListening ? "bg-red-50 border-red-300 text-red-500" : ""
                  }`}
                  aria-label={isListening ? "إيقاف الاستماع" : "بدء الاستماع"}
                >
                  {isListening ? <MicOff className="w-5 h-5 animate-pulse" /> : <Mic className="w-5 h-5" />}
                </Button>
                <div className="flex-1 relative">
                  <input
                    type="text"
                    data-voice-input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        sendMessage(input);
                      }
                    }}
                    placeholder={isListening ? "جاري الاستماع..." : "اكتب رسالتك هنا أو استخدم الميكروفون..."}
                    disabled={isLoading}
                    className="w-full h-11 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50"
                    aria-label="حقل إدخال الرسالة"
                  />
                </div>
                <Button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isLoading}
                  className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl shrink-0 w-11 h-11 active:scale-[0.97] transition-all"
                  aria-label="إرسال الرسالة"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
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
              { icon: Volume2, title: "قراءة الأسئلة بالصوت", desc: "يقرأ لك جميع الأسئلة بصوت عربي واضح مع إمكانية التحكم بالسرعة والتكرار." },
              { icon: Mic, title: "تدوين الإجابات صوتياً", desc: "يستمع لإجابتك الصوتية ويحولها إلى نص مكتوب بدقة عالية باللغة العربية." },
              { icon: HelpCircle, title: "شرح وتوضيح الأسئلة", desc: "يساعدك في فهم الأسئلة الصعبة ويقدم تلميحات دون إعطاء الإجابة مباشرة." },
              { icon: BookOpen, title: "مراجعة شاملة", desc: "يراجع إجاباتك ويخبرك بالأسئلة التي لم تجب عليها بعد." },
              { icon: FileText, title: "دعم كامل بالعربية", desc: "يفهم ويتحدث العربية بطلاقة ويتعامل مع جميع أنواع الأسئلة." },
              { icon: Settings, title: "إرشادات الاستخدام", desc: "يشرح لك كيفية استخدام المنصة خطوة بخطوة بأسلوب بسيط وواضح." },
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
