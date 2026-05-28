import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Detect if text is primarily Arabic or English
 */
export function detectLanguage(text: string): "ar" | "en" {
  const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  return arabicChars >= latinChars ? "ar" : "en";
}

/**
 * Hook for Text-to-Speech using Web Speech API
 * Supports Arabic and English with explicit language control for clarity
 */
export function useTextToSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speak = useCallback((text: string, rate: number = 0.9, forceLang?: "ar" | "en") => {
    if (!window.speechSynthesis) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const lang = forceLang || detectLanguage(text);
    utterance.lang = lang === "ar" ? "ar-SA" : "en-US";
    
    // Optimize for clarity: slower rate for Arabic, normal for English
    if (lang === "ar") {
      utterance.rate = rate * 0.95; // Slightly slower for Arabic clarity
      utterance.pitch = 1.05; // Slightly higher pitch for better clarity
    } else {
      utterance.rate = rate;
      utterance.pitch = 1;
    }
    utterance.volume = 1;

    // Try to find a high-quality matching voice
    const voices = window.speechSynthesis.getVoices();
    const langPrefix = lang === "ar" ? "ar" : "en";
    
    // Prefer local service voices for better quality
    let matchingVoice = voices.find((v) => v.lang.startsWith(langPrefix) && v.localService);
    
    // If no local voice, try to find the best available voice
    if (!matchingVoice) {
      matchingVoice = voices.find((v) => v.lang.startsWith(langPrefix) && !v.lang.includes("-"));
    }
    
    // Last resort: any matching voice
    if (!matchingVoice) {
      matchingVoice = voices.find((v) => v.lang.startsWith(langPrefix));
    }
    
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  return { speak, stop, isSpeaking };
}

/**
 * Hook for Text-to-Speech with explicit language selection UI
 * Allows users to choose between Arabic and English for maximum clarity
 */
export function useTextToSpeechWithLanguage() {
  const [selectedLang, setSelectedLang] = useState<"ar" | "en" | "auto">("auto");
  const { speak: baseSpeech, stop, isSpeaking } = useTextToSpeech();

  const speak = useCallback((text: string, rate?: number, forceLang?: "ar" | "en") => {
    const lang = forceLang || (selectedLang === "auto" ? detectLanguage(text) : selectedLang);
    baseSpeech(text, rate, lang);
  }, [baseSpeech, selectedLang]);

  return { speak, stop, isSpeaking, selectedLang, setSelectedLang };
}

/**
 * Hook for Speech-to-Text using Web Speech API
 * Supports Arabic and English
 */
export function useSpeechToText(defaultLang: "ar" | "en" = "ar") {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"ar" | "en">(defaultLang);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback((overrideLang?: "ar" | "en") => {
    setError(null);
    setTranscript("");

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      const errorMsg = defaultLang === "ar" 
        ? "المتصفح لا يدعم التعرف على الصوت. جرب Chrome أو Edge."
        : "Browser doesn't support speech recognition. Try Chrome or Edge.";
      setError(errorMsg);
      return;
    }

    const recognition = new SpeechRecognition();
    const activeLang = overrideLang || lang;
    recognition.lang = activeLang === "ar" ? "ar-SA" : "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      setTranscript(finalTranscript || interimTranscript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      const activeLang = overrideLang || lang;
      let errorMsg = "حدث خطأ في التعرف على الصوت";
      
      if (activeLang === "ar") {
        if (event.error === "not-allowed") {
          errorMsg = "يرجى السماح بالوصول إلى الميكروفون";
        } else if (event.error === "no-speech") {
          errorMsg = "لم يتم اكتشاف كلام. حاول مرة أخرى";
        } else if (event.error === "audio-capture") {
          errorMsg = "لم يتم العثور على ميكروفون. تأكد من توصيله";
        }
      } else {
        if (event.error === "not-allowed") {
          errorMsg = "Please allow access to the microphone";
        } else if (event.error === "no-speech") {
          errorMsg = "No speech detected. Try again.";
        } else if (event.error === "audio-capture") {
          errorMsg = "Microphone not found. Please check your connection.";
        } else {
          errorMsg = "Speech recognition error occurred";
        }
      }
      setError(errorMsg);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [lang]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  return { startListening, stopListening, isListening, transcript, error, setTranscript, lang, setLang };
}
