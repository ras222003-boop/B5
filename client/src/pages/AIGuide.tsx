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
import { type Lang, useI18n, useMessages } from "@/i18n";
import { aiGuideMessages } from "@/i18n/locales/aiGuide";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const SUGGESTION_ICONS = [MessageSquare, Lightbulb, Sparkles, Volume2] as const;

export default function AIGuide() {
  const { lang, dir, isRTL, languages, setLang } = useI18n();
  const t = useMessages(aiGuideMessages);
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript, error: speechError, setTranscript } = useSpeechToText(lang);

  const languageName = useCallback((language: Lang, locale = t) => {
    if (language === "ar") return locale.languages.ar;
    if (language === "en") return locale.languages.en;
    return locale.languages.zhCN;
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
      const response = await fetch("/api/ai-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages
            .filter(message => message.id !== "welcome")
            .map(message => ({ role: message.role, content: message.content })),
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

      if (autoSpeak) setTimeout(() => speak(assistantContent, 0.9, lang), 300);
    } catch (error) {
      console.error("AI Guide error:", error);
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
      setTimeout(() => {
        const currentInput = document.querySelector<HTMLInputElement>("[data-voice-input]")?.value;
        if (currentInput?.trim()) sendMessage(currentInput);
      }, 500);
    } else {
      stopSpeaking();
      setInput("");
      startListening(lang);
      toast.info(t.toasts.startSpeaking);
    }
  }, [isListening, lang, sendMessage, startListening, stopListening, stopSpeaking, t.toasts.startSpeaking]);

  const toggleAutoSpeak = () => {
    setAutoSpeak(previous => !previous);
    if (autoSpeak) stopSpeaking();
    toast.info(autoSpeak ? t.toasts.autoSpeakDisabled : t.toasts.autoSpeakEnabled);
  };

  const toggleLanguage = () => {
    const nextMessages = aiGuideMessages[nextLang];
    const confirmation = nextMessages.toasts.languageSwitched(languageName(nextLang, nextMessages));
    setLang(nextLang);
    toast.info(confirmation);
    setTimeout(() => speak(confirmation, 0.9, nextLang), 200);
  };

  const speakMessage = (content: string) => {
    if (isSpeaking) stopSpeaking();
    else speak(content, 0.9, lang);
  };

  const copyToClipboard = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(t.toasts.copied);
  };

  return (
    <Layout>
      <div dir={dir}>
        {/* Hero */}
        <section className="py-10 md:py-14 bg-gradient-to-b from-blue-50/50 to-background">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-4">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                {t.hero.badge}
              </span>
              <h1 className="text-3xl md:text-4xl font-bold mb-4">{t.hero.title}</h1>
              <p className="text-muted-foreground text-lg leading-relaxed">{t.hero.description}</p>
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
                    className={`rounded-lg ${autoSpeak ? "bg-blue-100 border-blue-300" : ""}`}
                    aria-label={autoSpeak ? t.chat.disableAutoSpeak : t.chat.enableAutoSpeak}
                  >
                    {autoSpeak ? <Volume2 className="w-4 h-4 text-blue-600" aria-hidden="true" /> : <VolumeX className="w-4 h-4" aria-hidden="true" />}
                    <span className="ms-1 text-xs">{autoSpeak ? t.chat.autoSpeakOn : t.chat.autoSpeakOff}</span>
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div className="h-[500px] md:h-[600px] overflow-y-auto p-4 md:p-6 space-y-4 bg-gradient-to-b from-background to-blue-50/20">
                <AnimatePresence mode="popLayout">
                  {messages.map(message => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        message.role === "assistant" ? "bg-blue-100" : "bg-slate-200"
                      }`}>
                        {message.role === "assistant" ? (
                          <Bot className="w-4 h-4 text-blue-600" aria-hidden="true" />
                        ) : (
                          <User className="w-4 h-4 text-slate-600" aria-hidden="true" />
                        )}
                      </div>
                      <div
                        className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${
                          message.role === "assistant"
                            ? "bg-card border border-border/50 text-foreground rounded-ss-none"
                            : "bg-blue-600 text-white rounded-se-none"
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{message.content}</div>
                        {message.role === "assistant" && message.id !== "welcome" && (
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => speakMessage(message.content)}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                              aria-label={t.chat.readMessage}
                            >
                              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                              {isSpeaking ? t.chat.stopReadingAction : t.chat.readMessageAction}
                            </button>
                            <button
                              onClick={() => copyToClipboard(message.id, message.content)}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                              aria-label={t.chat.copyMessage}
                            >
                              {copiedId === message.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                  {t.chat.copiedAction}
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                  {t.chat.copyAction}
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
                    role="status"
                    aria-live="polite"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-100">
                      <Bot className="w-4 h-4 text-blue-600" aria-hidden="true" />
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

              {/* Suggested Topics */}
              {messages.length === 1 && (
                <div className="p-4 border-t border-border/30 bg-blue-50/30">
                  <p className="text-xs text-muted-foreground mb-3 font-medium">{t.chat.suggestedTopics}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {t.suggestions.map((topic, index) => {
                      const Icon = SUGGESTION_ICONS[index] ?? MessageSquare;
                      return (
                        <button
                          key={topic.label}
                          onClick={() => sendMessage(topic.action)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-blue-50 border border-border/50 text-blue-700 text-xs font-medium transition-colors active:scale-[0.97]"
                        >
                          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                          {topic.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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
                      onChange={event => setInput(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          sendMessage(input);
                        }
                      }}
                      placeholder={isListening ? t.chat.listeningPlaceholder : t.chat.messagePlaceholder}
                      disabled={isLoading}
                      className="w-full h-11 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                      aria-label={t.chat.messageInputLabel}
                    />
                  </div>
                  <Button
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || isLoading}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shrink-0 w-11 h-11 active:scale-[0.97] transition-all"
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
      </div>
    </Layout>
  );
}
