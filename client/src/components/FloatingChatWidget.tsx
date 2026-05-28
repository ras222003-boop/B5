/*
 * Floating Chat Widget - Smart Assistant
 * Floating chat interface that appears on all pages
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  X,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Loader2,
  Globe,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function FloatingChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "مرحباً! 👋 أنا مساعد بصيرة الذكي. كيف يمكنني مساعدتك اليوم؟\n\nHello! 👋 I'm Basira's smart assistant. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [currentLang, setCurrentLang] = useState<"ar" | "en">("ar");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript, setTranscript, setLang: setSttLang } = useSpeechToText("ar");

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

  const sendMessage = useCallback(
    async (text: string) => {
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
        console.error("Chat error:", err);
        const errorContent = currentLang === "ar" ? "عذراً، حدث خطأ في الاتصال" : "Sorry, connection error";
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: errorContent,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [autoSpeak, speak, stopSpeaking, setTranscript, currentLang]
  );

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      setTimeout(() => {
        const currentInput = document.querySelector<HTMLInputElement>("[data-chat-input]")?.value;
        if (currentInput?.trim()) {
          sendMessage(currentInput);
        }
      }, 500);
    } else {
      stopSpeaking();
      setInput("");
      startListening();
    }
  }, [isListening, stopListening, startListening, stopSpeaking, sendMessage]);

  const toggleLanguage = () => {
    const newLang = currentLang === "ar" ? "en" : "ar";
    setCurrentLang(newLang);
    const msg = newLang === "ar" ? "تم التبديل إلى العربية" : "Switched to English";
    toast.info(msg);
  };

  if (!isOpen) {
    return (
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center z-50 transition-all"
        aria-label={currentLang === "ar" ? "فتح المساعد" : "Open assistant"}
      >
        <MessageCircle className="w-6 h-6" />
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      className={`fixed bottom-6 right-6 z-50 ${isMinimized ? "w-80" : "w-96"} bg-white rounded-2xl shadow-2xl border border-border/50 overflow-hidden flex flex-col`}
      style={{ maxHeight: isMinimized ? "auto" : "600px" }}
    >
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
            <MessageCircle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm">{currentLang === "ar" ? "مساعد بصيرة" : "Basira Assistant"}</h3>
            <p className="text-xs opacity-90">{currentLang === "ar" ? "متصل" : "Online"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLanguage}
            className="h-8 w-8 hover:bg-white/20 text-white"
          >
            <Globe className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-8 w-8 hover:bg-white/20 text-white"
          >
            {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(false)}
            className="h-8 w-8 hover:bg-white/20 text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      {!isMinimized && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-background to-blue-50/20">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                    msg.role === "assistant" ? "bg-blue-100 text-blue-600" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {msg.role === "assistant" ? "A" : "U"}
                </div>
                <div
                  className={`max-w-[70%] p-3 rounded-xl text-sm leading-relaxed ${
                    msg.role === "assistant"
                      ? "bg-card border border-border/50 text-foreground rounded-tl-none"
                      : "bg-blue-600 text-white rounded-tr-none"
                  }`}
                >
                  {msg.content}
                </div>
              </motion.div>
            ))}
            {isLoading && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 bg-blue-100">
                  <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                </div>
                <div className="bg-card border border-border/50 rounded-xl rounded-tl-none p-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
                    <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0.1s" }} />
                    <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0.2s" }} />
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-border/50 bg-card space-y-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={toggleListening}
                disabled={isLoading}
                className={`rounded-lg shrink-0 h-10 w-10 ${isListening ? "bg-red-50 border-red-300 text-red-500" : ""}`}
              >
                {isListening ? <MicOff className="w-4 h-4 animate-pulse" /> : <Mic className="w-4 h-4" />}
              </Button>
              <input
                type="text"
                data-chat-input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={currentLang === "ar" ? "اسأل عن أي شيء..." : "Ask anything..."}
                disabled={isLoading}
                className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <Button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg shrink-0 h-10 w-10"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAutoSpeak(!autoSpeak);
                  if (autoSpeak) stopSpeaking();
                }}
                className={`text-xs ${autoSpeak ? "bg-blue-100 border-blue-300" : ""}`}
              >
                {autoSpeak ? <Volume2 className="w-3 h-3 mr-1 text-blue-600" /> : <VolumeX className="w-3 h-3 mr-1" />}
                {autoSpeak ? (currentLang === "ar" ? "صوت مفعّل" : "Sound on") : currentLang === "ar" ? "صوت متوقف" : "Sound off"}
              </Button>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
