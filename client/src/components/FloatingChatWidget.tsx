/*
 * Floating Chat Widget - Smart Assistant
 * Floating chat interface that appears on all pages
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
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
import { type Lang, useI18n, useMessages } from "@/i18n";
import { floatingChatMessages } from "@/i18n/locales/floatingChat";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function FloatingChatWidget() {
  const { lang, dir, isRTL, languages, setLang } = useI18n();
  const t = useMessages(floatingChatMessages);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      content: t.welcome.greeting,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { speak, stop: stopSpeaking } = useTextToSpeech();
  // No fixed language: the speech hook follows the platform language.
  const {
    startListening,
    stopListening,
    isListening,
    transcript,
    error: speechError,
    setTranscript,
  } = useSpeechToText();

  const languageName = (language: Lang, translations = t) => {
    if (language === "ar") return translations.languages.ar;
    if (language === "en") return translations.languages.en;
    return translations.languages.zhCN;
  };
  const nextLang =
    languages[(languages.indexOf(lang) + 1) % languages.length] ?? lang;
  const nextLanguageName = languageName(nextLang);
  const conversationStarted = messages.some(
    message => message.id !== "welcome"
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // The welcome message follows the platform language only until the visitor starts chatting.
  useEffect(() => {
    setMessages(previous => {
      if (previous.some(message => message.id !== "welcome")) return previous;
      const welcome = previous.find(message => message.id === "welcome");
      if (!welcome || welcome.content === t.welcome.greeting) return previous;
      return previous.map(message =>
        message.id === "welcome"
          ? { ...message, content: t.welcome.greeting }
          : message
      );
    });
  }, [t.welcome.greeting]);

  useEffect(() => {
    if (transcript) setInput(transcript);
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
              .filter(message => message.id !== "welcome")
              .map(message => ({
                role: message.role,
                content: message.content,
              })),
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

        if (autoSpeak)
          setTimeout(() => speak(assistantContent, 0.9, lang), 300);
      } catch (error) {
        console.error("Chat error:", error);
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
    },
    [autoSpeak, lang, speak, stopSpeaking, setTranscript, t.errors]
  );

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      setTimeout(() => {
        const currentInput =
          document.querySelector<HTMLInputElement>("[data-chat-input]")?.value;
        if (currentInput?.trim()) sendMessage(currentInput);
      }, 500);
    } else {
      stopSpeaking();
      setInput("");
      startListening(lang);
      toast.info(t.toasts.startSpeaking, {
        description: t.toasts.startSpeakingDescription,
      });
    }
  }, [
    isListening,
    lang,
    sendMessage,
    startListening,
    stopListening,
    stopSpeaking,
    t.toasts,
  ]);

  const toggleAutoSpeak = () => {
    const nextAutoSpeak = !autoSpeak;
    setAutoSpeak(nextAutoSpeak);
    if (!nextAutoSpeak) stopSpeaking();
    toast.info(
      nextAutoSpeak ? t.toasts.autoSpeakEnabled : t.toasts.autoSpeakDisabled
    );
  };

  const toggleLanguage = () => {
    const nextMessages = floatingChatMessages[nextLang];
    const confirmation = nextMessages.toasts.languageChanged(
      languageName(nextLang, nextMessages)
    );
    setLang(nextLang);
    toast.info(confirmation);
  };

  if (!isOpen) {
    return (
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 end-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-amber-300 text-[#17130d] shadow-[0_12px_30px_rgba(245,190,80,0.28)] transition-all hover:bg-amber-200"
        aria-label={t.aria.openAssistant}
        title={t.aria.openAssistant}
      >
        <MessageCircle className="h-6 w-6" aria-hidden="true" />
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      dir={dir}
      className={`fixed bottom-6 end-6 z-50 flex ${isMinimized ? "w-80" : "w-96"} flex-col overflow-hidden rounded-2xl border border-amber-200/20 bg-card shadow-2xl`}
      style={{ maxHeight: isMinimized ? "auto" : "600px" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-[#16130b] via-[#4a340d] to-[#16130b] p-4 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-bold">{t.chat.title}</h3>
            <p className="text-xs opacity-90">{t.chat.online}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLanguage}
            className="h-8 w-8 text-white hover:bg-white/20"
            aria-label={t.aria.changeLanguage(nextLanguageName)}
            title={t.aria.changeLanguage(nextLanguageName)}
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(previous => !previous)}
            className="h-8 w-8 text-white hover:bg-white/20"
            aria-label={
              isMinimized ? t.aria.maximizeAssistant : t.aria.minimizeAssistant
            }
            title={
              isMinimized ? t.aria.maximizeAssistant : t.aria.minimizeAssistant
            }
          >
            {isMinimized ? (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(false)}
            className="h-8 w-8 text-white hover:bg-white/20"
            aria-label={t.aria.closeAssistant}
            title={t.aria.closeAssistant}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-background to-amber-300/5 p-4">
            {messages.map(message => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-2 ${message.role === "user" ? "flex-row-reverse" : ""}`}
                aria-label={
                  message.role === "assistant"
                    ? t.aria.assistantMessage
                    : t.aria.userMessage
                }
              >
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    message.role === "assistant"
                      ? "bg-amber-300/15 text-amber-300"
                      : "bg-stone-700 text-stone-200"
                  }`}
                  aria-hidden="true"
                >
                  {message.role === "assistant"
                    ? t.chat.assistantBadge
                    : t.chat.userBadge}
                </div>
                <div
                  className={`max-w-[70%] rounded-xl p-3 text-sm leading-relaxed ${
                    message.role === "assistant"
                      ? "rounded-ss-none border border-border/50 bg-card text-foreground"
                      : "rounded-se-none bg-amber-300 text-[#17130d]"
                  }`}
                >
                  {message.content}
                </div>
              </motion.div>
            ))}

            {!conversationStarted && !isLoading && (
              <div
                className="flex flex-wrap items-center gap-2 pt-1"
                role="group"
                aria-label={t.suggestions.label}
              >
                <p className="w-full text-xs font-medium text-muted-foreground">
                  {t.suggestions.label}
                </p>
                {t.suggestions.items.map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs text-amber-700 transition-colors hover:bg-amber-300/20 dark:text-amber-200"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-2"
                role="status"
                aria-live="polite"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-300/15">
                  <Loader2
                    className="h-3 w-3 animate-spin text-amber-300"
                    aria-hidden="true"
                  />
                </div>
                <div className="rounded-xl rounded-ss-none border border-border/50 bg-card p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex gap-1" aria-hidden="true">
                      <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </div>
                    {t.chat.loading}
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="space-y-3 border-t border-border/50 bg-card p-4">
            {speechError && (
              <p
                className="rounded-lg bg-red-50 p-2 text-xs text-red-600"
                role="alert"
              >
                {speechError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={toggleListening}
                disabled={isLoading}
                className={`h-10 w-10 shrink-0 rounded-lg ${isListening ? "border-red-300 bg-red-50 text-red-500" : ""}`}
                aria-label={
                  isListening ? t.aria.stopVoiceInput : t.aria.startVoiceInput
                }
                title={
                  isListening ? t.aria.stopVoiceInput : t.aria.startVoiceInput
                }
              >
                {isListening ? (
                  <MicOff
                    className="h-4 w-4 animate-pulse"
                    aria-hidden="true"
                  />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
              <input
                type="text"
                data-chat-input
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={
                  isListening
                    ? t.chat.listeningPlaceholder
                    : t.chat.inputPlaceholder
                }
                disabled={isLoading}
                lang={lang}
                aria-label={t.aria.inputLabel}
                className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-start text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-50"
              />
              <Button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="h-10 w-10 shrink-0 rounded-lg bg-amber-300 text-[#17130d] hover:bg-amber-200"
                aria-label={t.aria.sendMessage}
                title={t.aria.sendMessage}
              >
                {isLoading ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Send
                    className={`h-4 w-4 ${isRTL ? "-scale-x-100" : ""}`}
                    aria-hidden="true"
                  />
                )}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleAutoSpeak}
                className={`text-xs ${autoSpeak ? "border-amber-300/40 bg-amber-300/15" : ""}`}
                aria-label={
                  autoSpeak ? t.aria.disableAutoSpeak : t.aria.enableAutoSpeak
                }
              >
                {autoSpeak ? (
                  <Volume2
                    className="me-1 h-3 w-3 text-amber-300"
                    aria-hidden="true"
                  />
                ) : (
                  <VolumeX className="me-1 h-3 w-3" aria-hidden="true" />
                )}
                {autoSpeak ? t.chat.soundOn : t.chat.soundOff}
              </Button>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
