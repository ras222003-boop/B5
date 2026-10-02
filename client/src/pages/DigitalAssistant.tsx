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
  Globe,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";
import { type Lang, useI18n, useMessages } from "@/i18n";
import { assistantMessages } from "@/i18n/locales/assistant";

const voiceAssistantImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/voice-assistant-75gfzSUhMJ42H6udJomG6i.webp";
const QUICK_ACTION_ICONS = [BookOpen, HelpCircle, FileText, Settings] as const;
const FEATURE_ICONS = [Volume2, Mic, HelpCircle, BookOpen, FileText, Settings] as const;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function DigitalAssistant() {
  const { lang, dir, isRTL, languages, setLang } = useI18n();
  const t = useMessages(assistantMessages);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      content: t.welcome.message,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript, error: speechError, setTranscript } = useSpeechToText(lang);

  const languageName = useCallback((language: Lang, messages = t) => {
    if (language === "ar") return messages.languages.ar;
    if (language === "en") return messages.languages.en;
    return messages.languages.zhCN;
  }, [t]);
  const nextLang = languages[(languages.indexOf(lang) + 1) % languages.length] ?? lang;
  const nextLanguageName = languageName(nextLang);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keep the initial greeting in sync with the platform language without changing chat history.
  useEffect(() => {
    setMessages(previous => previous.map(message => (
      message.id === "welcome" ? { ...message, content: t.welcome.message } : message
    )));
  }, [t.welcome.message]);

  // Update input when speech transcript changes.
  useEffect(() => {
    if (transcript) setInput(transcript);
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
            .filter((message) => message.id !== "welcome")
            .map((message) => ({ role: message.role, content: message.content })),
          examContext: null,
          language: lang,
        }),
      });

      if (!response.ok) throw new Error(t.errors.connectionFailed);

      const data = await response.json();
      const assistantContent = data.content || t.errors.unableToProcess;
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: assistantContent,
        timestamp: new Date(),
      };
      setMessages(previous => [...previous, assistantMsg]);

      // Explicitly use the active platform language for the assistant's reply.
      if (autoSpeak) setTimeout(() => speak(assistantContent, 0.9, lang), 300);
    } catch (error) {
      console.error("Assistant error:", error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: t.errors.connectionError,
        timestamp: new Date(),
      };
      setMessages(previous => [...previous, errorMsg]);
      toast.error(t.errors.connectionFailed);
    } finally {
      setIsLoading(false);
    }
  }, [autoSpeak, lang, speak, stopSpeaking, setTranscript, t.errors]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      // Auto-send after stopping if there is text.
      setTimeout(() => {
        const currentInput = document.querySelector<HTMLInputElement>("[data-voice-input]")?.value;
        if (currentInput?.trim()) sendMessage(currentInput);
      }, 500);
    } else {
      stopSpeaking();
      setInput("");
      startListening(lang);
      toast.info(t.toasts.startSpeaking, { description: t.toasts.startSpeakingDescription });
    }
  }, [isListening, lang, sendMessage, startListening, stopListening, stopSpeaking, t.toasts]);

  const toggleAutoSpeak = () => {
    setAutoSpeak(previous => !previous);
    if (autoSpeak) stopSpeaking();
    toast.info(autoSpeak ? t.toasts.autoSpeakDisabled : t.toasts.autoSpeakEnabled);
  };

  const toggleLanguage = () => {
    const nextMessages = assistantMessages[nextLang];
    const confirmation = nextMessages.toasts.languageSwitched(languageName(nextLang, nextMessages));
    setLang(nextLang);
    toast.info(confirmation);
    // The confirmation is spoken with the newly selected platform language.
    setTimeout(() => speak(confirmation, 0.9, nextLang), 200);
  };

  const speakMessage = (content: string) => {
    if (isSpeaking) stopSpeaking();
    else speak(content, 0.9, lang);
  };

  return (
    <Layout>
      <div dir={dir}>
        {/* Hero */}
        <section className="py-10 md:py-14 bg-gradient-to-b from-amber-50/50 to-background">
          <div className="container">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-100 text-amber-700 text-sm font-medium mb-4">
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  {t.hero.badge}
                </span>
                <h1 className="text-3xl md:text-4xl font-bold mb-4">{t.hero.title}</h1>
                <p className="text-muted-foreground text-lg leading-relaxed">{t.hero.description}</p>
              </div>
              <div className="hidden lg:block">
                <img
                  src={voiceAssistantImage}
                  alt={t.hero.imageAlt}
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
                    <Bot className="w-5 h-5 text-white" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">{t.chat.title}</h3>
                    <p className="text-xs text-muted-foreground">{t.chat.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleLanguage}
                    className={`rounded-lg ${lang === "ar" ? "bg-blue-100 border-blue-300" : lang === "en" ? "bg-green-100 border-green-300" : "bg-red-100 border-red-300"}`}
                    aria-label={`${t.chat.languageSelectorLabel}: ${nextLanguageName}`}
                    title={t.chat.languageSelectorTitle(nextLanguageName)}
                  >
                    <Globe className="w-4 h-4" aria-hidden="true" />
                    <span className="ms-1 text-xs">{languageName(lang)}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleAutoSpeak}
                    className={`rounded-lg ${autoSpeak ? "bg-amber-100 border-amber-300" : ""}`}
                    aria-label={autoSpeak ? t.chat.disableAutoSpeak : t.chat.enableAutoSpeak}
                  >
                    {autoSpeak ? <Volume2 className="w-4 h-4 text-amber-600" aria-hidden="true" /> : <VolumeX className="w-4 h-4" aria-hidden="true" />}
                    <span className="ms-1 text-xs">{autoSpeak ? t.chat.autoSpeakOn : t.chat.autoSpeakOff}</span>
                  </Button>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="p-3 border-b border-border/30 flex gap-2 overflow-x-auto">
                {t.quickActions.map((action, index) => {
                  const Icon = QUICK_ACTION_ICONS[index] ?? HelpCircle;
                  return (
                    <button
                      key={action.label}
                      onClick={() => sendMessage(action.action)}
                      disabled={isLoading}
                      className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium transition-colors active:scale-[0.97] disabled:opacity-50"
                    >
                      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                      {action.label}
                    </button>
                  );
                })}
              </div>

              {/* Messages */}
              <div className="h-[400px] md:h-[450px] overflow-y-auto p-4 md:p-6 space-y-4 bg-gradient-to-b from-background to-amber-50/20">
                <AnimatePresence mode="popLayout">
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        message.role === "assistant" ? "bg-amber-100" : "bg-slate-200"
                      }`}>
                        {message.role === "assistant" ? (
                          <Bot className="w-4 h-4 text-amber-600" aria-hidden="true" />
                        ) : (
                          <User className="w-4 h-4 text-slate-600" aria-hidden="true" />
                        )}
                      </div>
                      <div
                        className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed ${
                          message.role === "assistant"
                            ? "bg-card border border-border/50 text-foreground rounded-ss-none"
                            : "bg-amber-600 text-white rounded-se-none"
                        }`}
                      >
                        {message.content}
                        {message.role === "assistant" && message.id !== "welcome" && (
                          <button
                            onClick={() => speakMessage(message.content)}
                            className="mt-2 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                            aria-label={t.chat.readMessage}
                          >
                            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                            {isSpeaking ? t.chat.stopReadingAction : t.chat.readMessageAction}
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
                    role="status"
                    aria-live="polite"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-100">
                      <Bot className="w-4 h-4 text-amber-600" aria-hidden="true" />
                    </div>
                    <div className="bg-card border border-border/50 rounded-2xl rounded-ss-none p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        {t.chat.thinking}
                      </div>
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 border-t border-border/50 bg-card">
                {speechError && (
                  <div className="mb-3 p-2 rounded-lg bg-red-50 text-red-600 text-xs flex items-center gap-1" role="alert">
                    <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
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
                    aria-label={isListening ? t.chat.stopListening : t.chat.startListening}
                  >
                    {isListening ? <MicOff className="w-5 h-5 animate-pulse" aria-hidden="true" /> : <Mic className="w-5 h-5" aria-hidden="true" />}
                  </Button>
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      data-voice-input
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          sendMessage(input);
                        }
                      }}
                      placeholder={isListening ? t.chat.listeningPlaceholder : t.chat.messagePlaceholder}
                      disabled={isLoading}
                      className="w-full h-11 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50"
                      aria-label={t.chat.messageInputLabel}
                    />
                  </div>
                  <Button
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || isLoading}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl shrink-0 w-11 h-11 active:scale-[0.97] transition-all"
                    aria-label={t.chat.sendMessage}
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className={`w-5 h-5 ${isRTL ? "-scale-x-100" : ""}`} aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Assistant Features */}
        <section className="py-16 md:py-24 bg-amber-50/30">
          <div className="container">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">{t.features.title}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {t.features.items.map((item, index) => {
                const Icon = FEATURE_ICONS[index] ?? Sparkles;
                return (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: index * 0.08 }}
                    className="p-6 rounded-2xl bg-card border border-border/50"
                  >
                    <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-amber-600" aria-hidden="true" />
                    </div>
                    <h3 className="font-bold mb-2">{item.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
