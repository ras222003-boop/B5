/*
 * AI Guide - Advanced ChatGPT-like assistant for platform guidance
 * Provides comprehensive instructions, step-by-step guidance, and real-time help
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
  Loader2,
  AlertCircle,
  Globe,
  Copy,
  Check,
  MessageSquare,
  Lightbulb,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const suggestedTopics = [
  { icon: MessageSquare, label: "كيف أبدأ الاختبار؟", action: "شرح لي خطوات البدء بالاختبار بالتفصيل" },
  { icon: Lightbulb, label: "شرح المميزات", action: "اشرح لي جميع مميزات منصة بصيرة بشكل مفصل" },
  { icon: Sparkles, label: "نصائح للنجاح", action: "أعطني نصائح عملية لتحقيق أفضل أداء في الاختبارات" },
  { icon: Volume2, label: "مساعدة تقنية", action: "ساعدني في حل المشاكل التقنية والأخطاء" },
];

export default function AIGuide() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `مرحباً بك في مساعد بصيرة الذكي! 👋

أنا هنا لمساعدتك في كل شيء يتعلق بمنصة بصيرة. يمكنني:

✅ شرح كيفية استخدام المنصة خطوة بخطوة
✅ تقديم نصائح عملية لتحسين أدائك
✅ حل المشاكل التقنية والأسئلة
✅ إرشادك خلال عملية الاختبار بالكامل

اسأل عن أي شيء تريده، وسأقدم لك إجابة مفصلة وواضحة!`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [currentLang, setCurrentLang] = useState<"ar" | "en">("ar");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript, error: speechError, setTranscript, setLang: setSttLang } = useSpeechToText("ar");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setSttLang(currentLang);
  }, [currentLang, setSttLang]);

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
      const response = await fetch("/api/ai-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages
            .filter((m) => m.id !== "welcome")
            .map((m) => ({ role: m.role, content: m.content })),
          language: currentLang,
        }),
      });

      if (!response.ok) {
        throw new Error(currentLang === "ar" ? "فشل في الاتصال" : "Connection failed");
      }

      const data = await response.json();
      const assistantContent = data.content || (currentLang === "ar" ? "عذراً، لم أتمكن من معالجة طلبك" : "Sorry, I couldn't process your request");

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: assistantContent,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (autoSpeak) {
        setTimeout(() => speak(assistantContent, 0.9, currentLang), 300);
      }
    } catch (err: any) {
      console.error("AI Guide error:", err);
      const errorContent = currentLang === "ar" ? "عذراً، حدث خطأ في الاتصال" : "Sorry, connection error";
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: errorContent,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      toast.error(currentLang === "ar" ? "فشل في الاتصال" : "Connection failed");
    } finally {
      setIsLoading(false);
    }
  }, [autoSpeak, speak, stopSpeaking, setTranscript, currentLang]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
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
      toast.info(currentLang === "ar" ? "تحدث الآن..." : "Start speaking...");
    }
  }, [isListening, stopListening, startListening, stopSpeaking, sendMessage, currentLang]);

  const toggleAutoSpeak = () => {
    setAutoSpeak(!autoSpeak);
    if (autoSpeak) {
      stopSpeaking();
    }
    const msg = autoSpeak 
      ? (currentLang === "ar" ? "تم إيقاف القراءة التلقائية" : "Auto-speak disabled")
      : (currentLang === "ar" ? "تم تفعيل القراءة التلقائية" : "Auto-speak enabled");
    toast.info(msg);
  };

  const toggleLanguage = () => {
    const newLang = currentLang === "ar" ? "en" : "ar";
    setCurrentLang(newLang);
    const msg = newLang === "ar" ? "تم التبديل إلى العربية" : "Switched to English";
    toast.info(msg);
    setTimeout(() => speak(msg, 0.9, newLang), 200);
  };

  const speakMessage = (content: string) => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      speak(content, 0.9, currentLang);
    }
  };

  const copyToClipboard = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(currentLang === "ar" ? "تم النسخ" : "Copied!");
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="py-10 md:py-14 bg-gradient-to-b from-blue-50/50 to-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-4">
              <Sparkles className="w-4 h-4" />
              {currentLang === "ar" ? "مساعد ذكي متقدم" : "Advanced AI Assistant"}
            </span>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              {currentLang === "ar" ? "مساعدك الشامل في بصيرة" : "Your Complete Basira Guide"}
            </h1>
            <p className="text-muted-foreground text-lg leading-relaxed">
              {currentLang === "ar" 
                ? "نظام ذكي يعمل مثل ChatGPT، يرشدك خطوة بخطوة ويجيب على جميع أسئلتك حول المنصة والاختبارات."
                : "An intelligent system like ChatGPT that guides you step-by-step and answers all your questions about the platform."}
            </p>
          </div>
        </div>
      </section>

      {/* Chat Interface */}
      <section className="py-8 md:py-12">
        <div className="container max-w-4xl">
          <div className="rounded-2xl border border-border/50 bg-card shadow-lg overflow-hidden">
            {/* Chat Header */}
            <div className="p-4 md:p-5 border-b border-border/50 bg-blue-50/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">{currentLang === "ar" ? "مساعد بصيرة الذكي" : "Basira AI Assistant"}</h3>
                  <p className="text-xs text-muted-foreground">{currentLang === "ar" ? "يعمل بالذكاء الاصطناعي المتقدم" : "Advanced AI-powered"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleLanguage}
                  className={`rounded-lg ${currentLang === "ar" ? "bg-blue-100 border-blue-300" : "bg-green-100 border-green-300"}`}
                >
                  <Globe className="w-4 h-4" />
                  <span className="mr-1 text-xs">{currentLang === "ar" ? "العربية" : "English"}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAutoSpeak}
                  className={`rounded-lg ${autoSpeak ? "bg-blue-100 border-blue-300" : ""}`}
                >
                  {autoSpeak ? <Volume2 className="w-4 h-4 text-blue-600" /> : <VolumeX className="w-4 h-4" />}
                  <span className="mr-1 text-xs">{autoSpeak ? (currentLang === "ar" ? "صوت مفعّل" : "Sound on") : (currentLang === "ar" ? "صوت متوقف" : "Sound off")}</span>
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="h-[500px] md:h-[600px] overflow-y-auto p-4 md:p-6 space-y-4 bg-gradient-to-b from-background to-blue-50/20">
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
                      msg.role === "assistant" ? "bg-blue-100" : "bg-slate-200"
                    }`}>
                      {msg.role === "assistant" ? (
                        <Bot className="w-4 h-4 text-blue-600" />
                      ) : (
                        <User className="w-4 h-4 text-slate-600" />
                      )}
                    </div>
                    <div
                      className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${
                        msg.role === "assistant"
                          ? "bg-card border border-border/50 text-foreground rounded-tr-none"
                          : "bg-blue-600 text-white rounded-tl-none"
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      {msg.role === "assistant" && msg.id !== "welcome" && (
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => speakMessage(msg.content)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                            aria-label={currentLang === "ar" ? "قراءة الرسالة" : "Read message"}
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                            {isSpeaking ? (currentLang === "ar" ? "إيقاف" : "Stop") : (currentLang === "ar" ? "استمع" : "Listen")}
                          </button>
                          <button
                            onClick={() => copyToClipboard(msg.id, msg.content)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                            aria-label={currentLang === "ar" ? "نسخ الرسالة" : "Copy message"}
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                {currentLang === "ar" ? "تم النسخ" : "Copied"}
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                {currentLang === "ar" ? "نسخ" : "Copy"}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-100">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="bg-card border border-border/50 rounded-2xl rounded-tr-none p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {currentLang === "ar" ? "جاري التفكير..." : "Thinking..."}
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggested Topics */}
            {messages.length === 1 && (
              <div className="p-4 border-t border-border/30 bg-blue-50/30">
                <p className="text-xs text-muted-foreground mb-3 font-medium">
                  {currentLang === "ar" ? "مواضيع مقترحة:" : "Suggested topics:"}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {suggestedTopics.map((topic) => {
                    let label = topic.label;
                    let action = topic.action;
                    if (currentLang === "en") {
                      const translations: Record<string, { label: string; action: string }> = {
                        "كيف أبدأ الاختبار؟": { label: "How to start exam?", action: "Explain the steps to start an exam in detail" },
                        "شرح المميزات": { label: "Explain features", action: "Explain all features of Basira platform in detail" },
                        "نصائح للنجاح": { label: "Success tips", action: "Give me practical tips to achieve the best performance in exams" },
                        "مساعدة تقنية": { label: "Technical help", action: "Help me solve technical issues and errors" },
                      };
                      const trans = translations[topic.label];
                      if (trans) {
                        label = trans.label;
                        action = trans.action;
                      }
                    }
                    return (
                      <button
                        key={topic.label}
                        onClick={() => sendMessage(action)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-blue-50 border border-border/50 text-blue-700 text-xs font-medium transition-colors active:scale-[0.97]"
                      >
                        <topic.icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                  aria-label={isListening ? (currentLang === "ar" ? "إيقاف الاستماع" : "Stop listening") : (currentLang === "ar" ? "بدء الاستماع" : "Start listening")}
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
                    placeholder={isListening ? (currentLang === "ar" ? "جاري الاستماع..." : "Listening...") : (currentLang === "ar" ? "اسأل عن أي شيء..." : "Ask anything...")}
                    disabled={isLoading}
                    className="w-full h-11 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                    aria-label={currentLang === "ar" ? "حقل إدخال السؤال" : "Question input field"}
                  />
                </div>
                <Button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isLoading}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shrink-0 w-11 h-11 active:scale-[0.97] transition-all"
                  aria-label={currentLang === "ar" ? "إرسال السؤال" : "Send question"}
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
