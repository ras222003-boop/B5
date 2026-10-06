/*
 * Camera-to-exam experience with OCR, TTS, STT, grading, and PDF export.
 * UI copy follows the platform language; OCR content follows the detected exam language.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Upload, Loader2, Volume2, VolumeX, Mic, MicOff,
  ChevronLeft, ChevronRight, Eye, FileDown, RotateCcw,
  CheckCircle, XCircle, AlertCircle, ScanLine, Languages,
  GraduationCap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import { useCamera } from "@/hooks/useCamera";
import { detectLanguage, useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";
import { ExamImagePreparationError, prepareExamUpload } from "@/lib/examImage";
import { beginVoiceAnswer, classifyOcrFailure, consumeVoiceAnswer, countAnswers, ScanAttemptTracker, updateAnswer, type OcrFailureKind, type VoiceAnswerSession } from "@/lib/examFlow";
import { useI18n, useMessages } from "@/i18n";
import { examDemoMessages } from "@/i18n/locales/examDemo";
import ExamDeliveryPanel, { RecentExamSubmissions } from "@/components/exam/ExamDeliveryPanel";
import type { ExamLanguage, OcrQuestion, OcrResult } from "@shared/ocr";

type Question = OcrQuestion;
type ExamData = OcrResult;

type GradingResult = {
  questionId: number;
  isCorrect: "correct" | "incorrect" | "partial" | "unanswered";
  correctAnswer: string;
  feedback: string;
  score: number;
};

type GradingData = {
  results: GradingResult[];
  totalScore: number;
  totalCorrect: number;
  totalQuestions: number;
  overallFeedback: string;
};

type Stage = "scan" | "exam" | "review" | "grading" | "export";
type Notice = { tone: "error" | "warning"; title?: string; message: string; detail?: string };

class OcrHttpError extends Error {
  constructor(public readonly status: number, public readonly code?: unknown) {
    super("OCR request failed");
  }
}

const OCR_REQUEST_TIMEOUT_MS = 135_000;

const examDirection = (language: ExamLanguage) => language === "ar" ? "rtl" : "ltr";
const languageKey = (language: ExamLanguage) => language === "zh-CN" ? "zhCN" : language;

export default function ExamDemo() {
  const { lang, dir, isRTL } = useI18n();
  const t = useMessages(examDemoMessages);
  const [stage, setStage] = useState<Stage>("scan");
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingData, setGradingData] = useState<GradingData | null>(null);
  const [pdfHtml, setPdfHtml] = useState<string>("");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [scanNotice, setScanNotice] = useState<Notice | null>(null);
  const [ocrReport, setOcrReport] = useState<Pick<OcrResult, "detectedLanguages" | "quality"> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceSessionRef = useRef<VoiceAnswerSession | null>(null);
  const answerRevisionsRef = useRef<Record<number, number>>({});
  const scanAttemptsRef = useRef(new ScanAttemptTracker());

  const { videoRef, canvasRef, isActive: cameraActive, isStarting: cameraStarting, error: cameraError, startCamera, stopCamera, captureImage } = useCamera(t.cameraErrors);
  const { speak, speakQuestion, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const examLang: ExamLanguage = examData?.language ?? lang;
  const { startListening, stopListening, isListening, transcript, setTranscript, error: speechError } = useSpeechToText(examLang);
  const examDir = examDirection(examLang);
  const examIsRTL = examDir === "rtl";
  const totalQuestions = examData?.questions.length || 0;
  const answeredCount = countAnswers(answers, examData?.questions.map(question => question.id) ?? []);
  const scanBusy = isPreparingImage || isProcessing;
  const currentQuestion = examData?.questions[currentQ];
  const PreviousIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;

  const questionNumber = useCallback((question: Question) => question.number || String(question.id), []);
  const optionLabel = useCallback((question: Question, index: number) => question.optionLabels[index] || String(index + 1), []);
  const languageName = useCallback((language: ExamLanguage) => t.languages[languageKey(language)], [t]);

  const saveAnswer = useCallback((questionId: number, value: string) => {
    answerRevisionsRef.current[questionId] = (answerRevisionsRef.current[questionId] ?? 0) + 1;
    setAnswers(previous => updateAnswer(previous, questionId, value));
  }, []);

  // Recognition may finish after navigation; preserve the question where recording began.
  useEffect(() => {
    const session = voiceSessionRef.current;
    const revision = session ? (answerRevisionsRef.current[session.questionId] ?? 0) : 0;
    const result = consumeVoiceAnswer(session, transcript, isListening, Boolean(speechError), revision);
    voiceSessionRef.current = result.session;
    if (result.answer) saveAnswer(result.answer.questionId, result.answer.text);
    if (session && !result.session) setTranscript("");
  }, [transcript, isListening, speechError, saveAnswer, setTranscript]);

  const readQuestion = useCallback((question: Question) => {
    const number = questionNumber(question);
    const text = `${t.content.questionPrefix[languageKey(examLang)](number)}: ${question.text}`;
    const options = question.type === "multiple"
      ? question.options.map((option, index) => `${optionLabel(question, index)}: ${option}`)
      : [];
    speakQuestion(text, options, examLang);
  }, [examLang, optionLabel, questionNumber, speakQuestion, t]);

  const goToQuestion = useCallback((index: number) => {
    if (index >= 0 && index < totalQuestions) setCurrentQ(index);
  }, [totalQuestions]);

  const beginScan = useCallback((): number | null => {
    return scanAttemptsRef.current.begin();
  }, []);

  const processImage = useCallback(async (imageData: string, generation: number) => {
    if (!scanAttemptsRef.current.isCurrent(generation)) return;
    setIsProcessing(true);
    setStatusMsg(t.status.analyzing);
    setScanNotice(null);
    setActionError(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), OCR_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imageData, language: lang }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { code?: unknown } | null;
        throw new OcrHttpError(response.status, payload?.code);
      }

      const data: OcrResult = await response.json();
      if (!data || !Array.isArray(data.questions) || !data.quality || !Array.isArray(data.quality.issues)) {
        throw new OcrHttpError(500, "internal");
      }
      if (!scanAttemptsRef.current.isCurrent(generation)) return;
      setOcrReport({ detectedLanguages: data.detectedLanguages, quality: data.quality });
      if (data.questions.length === 0) {
        const reason: OcrFailureKind = data.quality.issues.includes("no_document") ? "noDocument" : "noText";
        setScanNotice({
          tone: "error",
          title: t.quality.insufficientTitle,
          message: t.status.ocrErrors[reason],
        });
        return;
      }

      setExamData(data);
      setAnswers({});
      answerRevisionsRef.current = {};
      voiceSessionRef.current = null;
      setCurrentQ(0);
      setGradingData(null);
      setStage("exam");
      const title = data.examTitle || t.content.examTitle[languageKey(data.language)];
      speak(t.announcements.loaded(title, data.questions.length), 0.9, lang);
    } catch (error) {
      if (!scanAttemptsRef.current.isCurrent(generation)) return;
      const reason: OcrFailureKind = error instanceof OcrHttpError
        ? classifyOcrFailure(error.status, error.code)
        : controller.signal.aborted ? "timeout"
          : error instanceof TypeError ? "network" : "internal";
      setScanNotice({ tone: "error", message: t.status.ocrErrors[reason] });
    } finally {
      window.clearTimeout(timeoutId);
      if (scanAttemptsRef.current.finish(generation)) {
        setIsProcessing(false);
        setStatusMsg("");
      }
    }
  }, [lang, speak, t]);

  const handleCapture = useCallback(() => {
    const image = captureImage();
    if (!image) {
      setScanNotice({ tone: "warning", message: t.status.captureNotReady });
      return;
    }
    const generation = beginScan();
    if (generation === null) return;
    setCapturedImage(image);
    stopCamera();
    processImage(image, generation);
  }, [beginScan, captureImage, processImage, stopCamera, t.status.captureNotReady]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    const generation = beginScan();
    if (generation === null) return;
    setIsPreparingImage(true);
    setScanNotice(null);
    try {
      const image = await prepareExamUpload(file);
      if (!scanAttemptsRef.current.isCurrent(generation)) return;
      setCapturedImage(image);
      stopCamera();
      setIsPreparingImage(false);
      await processImage(image, generation);
    } catch (error) {
      if (!scanAttemptsRef.current.isCurrent(generation)) return;
      const kind = error instanceof ExamImagePreparationError ? error.kind : "unreadable";
      const message = kind === "unsupported" ? t.status.uploadUnsupported
        : kind === "tooLarge" ? t.status.uploadTooLarge : t.status.uploadUnreadable;
      setScanNotice({ tone: "error", message });
    }
    finally {
      if (scanAttemptsRef.current.finish(generation)) {
        setIsPreparingImage(false);
      }
    }
  }, [beginScan, processImage, stopCamera, t.status]);

  const handleGrade = useCallback(async () => {
    if (!examData) return;
    setIsGrading(true);
    setActionError(null);
    try {
      const response = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examTitle: examData.examTitle,
          questions: examData.questions,
          answers,
          language: examLang,
          uiLanguage: lang,
        }),
      });
      if (!response.ok) throw new Error("Grading failed");
      const data: GradingData = await response.json();
      setGradingData(data);
      setStage("grading");
      speak(t.announcements.graded(data.totalScore, data.totalCorrect, data.totalQuestions), 0.9, lang);
    } catch (error) {
      console.error("Grading error:", error);
      setActionError(t.status.gradingError);
    } finally {
      setIsGrading(false);
    }
  }, [answers, examData, examLang, lang, speak, t]);

  const handleExport = useCallback(async () => {
    if (!examData) return;
    setIsExporting(true);
    setActionError(null);
    try {
      const response = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examTitle: examData.examTitle,
          questions: examData.questions,
          answers,
          grading: gradingData,
          language: examLang,
          uiLanguage: lang,
        }),
      });
      if (!response.ok) throw new Error("PDF generation failed");
      const data: { html: string } = await response.json();
      setPdfHtml(data.html);
      setStage("export");
    } catch (error) {
      console.error("Export error:", error);
      setActionError(t.status.exportingError);
    } finally {
      setIsExporting(false);
    }
  }, [answers, examData, examLang, gradingData, lang, t]);

  const downloadPdf = useCallback(() => {
    if (!pdfHtml) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(pdfHtml);
    printWindow.document.close();
    window.setTimeout(() => printWindow.print(), 500);
  }, [pdfHtml]);

  const resetExam = useCallback(() => {
    stopCamera();
    stopListening();
    voiceSessionRef.current = null;
    answerRevisionsRef.current = {};
    scanAttemptsRef.current.cancel();
    setIsPreparingImage(false);
    setIsProcessing(false);
    setTranscript("");
    setStage("scan");
    setExamData(null);
    setAnswers({});
    setCurrentQ(0);
    setGradingData(null);
    setPdfHtml("");
    setCapturedImage(null);
    setStatusMsg("");
    setScanNotice(null);
    setOcrReport(null);
    setActionError(null);
    stopSpeaking();
  }, [setTranscript, stopCamera, stopListening, stopSpeaking]);

  const speakReview = useCallback((question: Question) => {
    const content = t.content;
    const key = languageKey(examLang);
    const answer = answers[question.id]
      ? `${content.answerPrefix[key]}: ${answers[question.id]}`
      : content.notAnswered[key];
    speak(`${content.questionPrefix[key](questionNumber(question))}: ${question.text}. ${answer}`, 0.9, examLang, 'EXAM');
  }, [answers, examLang, questionNumber, speak, t.content]);

  return (
    <Layout>
      <section className="py-12 md:py-20 min-h-[80vh]" dir={dir} lang={lang}>
        <div className="container max-w-4xl">
          <AnimatePresence mode="wait">
            {stage === "scan" && (
              <motion.div key="scan" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
                <div className="text-center mb-10">
                  <div className="w-20 h-20 rounded-3xl bg-amber-100 flex items-center justify-center mx-auto mb-6">
                    <ScanLine className="w-10 h-10 text-amber-600" />
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold mb-3">{t.scan.title}</h1>
                  <p className="text-muted-foreground text-lg max-w-lg mx-auto">{t.scan.description}</p>
                </div>

                <div className="relative rounded-2xl overflow-hidden bg-slate-900 mb-6 aspect-[3/4] sm:aspect-[4/3] max-w-2xl mx-auto">
                  {cameraActive ? (
                    <>
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute inset-8 border-2 border-white/40 rounded-xl" />
                        <div className="absolute top-8 start-8 w-8 h-8 border-t-4 border-s-4 border-amber-400 rounded-ss-lg" />
                        <div className="absolute top-8 end-8 w-8 h-8 border-t-4 border-e-4 border-amber-400 rounded-se-lg" />
                        <div className="absolute bottom-8 start-8 w-8 h-8 border-b-4 border-s-4 border-amber-400 rounded-es-lg" />
                        <div className="absolute bottom-8 end-8 w-8 h-8 border-b-4 border-e-4 border-amber-400 rounded-ee-lg" />
                      </div>
                    </>
                  ) : capturedImage ? (
                    <img src={capturedImage} alt={t.scan.imageAlt} className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-white/60 gap-4 p-8">
                      <Camera className="w-16 h-16" />
                      <p className="text-center text-lg">{t.scan.emptyState}</p>
                      {cameraError && (
                        <div className="bg-red-500/20 text-red-300 px-4 py-2 rounded-xl text-sm text-center max-w-sm" role="alert">
                          {cameraError}
                        </div>
                      )}
                    </div>
                  )}
                  <canvas ref={canvasRef} className="hidden" />
                </div>

                {scanBusy && (
                  <div className="text-center mb-6" role="status" aria-live="polite">
                    <div className="inline-flex items-center gap-3 bg-amber-50 text-amber-700 px-6 py-3 rounded-xl">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="font-medium">{statusMsg || t.status.preparingImage}</span>
                    </div>
                  </div>
                )}

                {scanNotice && !scanBusy && (
                  <div className={`mb-6 rounded-2xl border-2 p-5 text-start ${scanNotice.tone === "error" ? "bg-red-50 border-red-300 text-red-900" : "bg-amber-50 border-amber-300 text-amber-900"}`} role="alert">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
                      <div>
                        {scanNotice.title && <h2 className="font-bold text-lg mb-1">{scanNotice.title}</h2>}
                        <p>{scanNotice.message}</p>
                        {scanNotice.detail && <p className="font-medium mt-2">{scanNotice.detail}</p>}
                        {ocrReport && (
                          <div className="mt-3 text-sm">
                            <p className="font-medium">{t.quality.detectedLanguages}: {ocrReport.detectedLanguages.map(languageName).join(" · ")}</p>
                            {ocrReport.quality.issues.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {ocrReport.quality.issues.map((issue) => <span key={issue} className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium">{t.quality.issues[issue]}</span>)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-4">
                  {!cameraActive ? (
                    <Button onClick={startCamera} disabled={scanBusy || cameraStarting} className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 h-12 text-base active:scale-[0.97]" aria-label={t.scan.cameraAria}>
                      {cameraStarting ? <><Loader2 className="w-5 h-5 ms-2 animate-spin" />{t.scan.openingCamera}</> : <><Camera className="w-5 h-5 ms-2" />{t.scan.openCamera}</>}
                    </Button>
                  ) : (
                    <>
                      <Button onClick={handleCapture} disabled={scanBusy} className="bg-green-600 hover:bg-green-700 text-white rounded-xl px-8 h-12 text-base active:scale-[0.97]" aria-label={t.scan.captureAria}>
                        {scanBusy ? <><Loader2 className="w-5 h-5 ms-2 animate-spin" />{t.status.processing}</> : <><Camera className="w-5 h-5 ms-2" />{t.scan.capture}</>}
                      </Button>
                      <Button onClick={stopCamera} variant="outline" className="rounded-xl h-12">{t.scan.cancel}</Button>
                    </>
                  )}
                  <Button onClick={() => fileInputRef.current?.click()} disabled={scanBusy} variant="outline" className="rounded-xl px-8 h-12 text-base border-2 active:scale-[0.97]" aria-label={t.scan.uploadAria}>
                    <Upload className="w-5 h-5 ms-2" />{t.scan.upload}
                  </Button>
                  {capturedImage && scanNotice && !scanBusy && !cameraActive && (
                    <Button onClick={() => { const generation = beginScan(); if (generation !== null) processImage(capturedImage, generation); }} variant="outline" className="rounded-xl px-8 h-12 text-base border-2 active:scale-[0.97]">
                      <RotateCcw className="w-5 h-5 ms-2" />{t.scan.retry}
                    </Button>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/jpg" onChange={handleFileUpload} className="hidden" aria-hidden="true" />
                </div>
                <RecentExamSubmissions uiLanguage={lang} />
              </motion.div>
            )}

            {stage === "exam" && examData && currentQuestion && (
              <motion.div key="exam" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
                {examData.quality.status !== "good" && (
                  <div className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900" role="alert">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
                      <div>
                        <h2 className="font-bold text-lg">{t.quality.partialTitle}</h2>
                        <p className="mt-1">{t.quality.partialAdvice}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {examData.quality.issues.map((issue) => <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium">{t.quality.issues[issue]}</span>)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <div dir={examDir} lang={examLang} className={examIsRTL ? "text-right" : "text-left"}>
                    <h1 className="text-2xl font-bold">{examData.examTitle || t.content.examTitle[languageKey(examLang)]}</h1>
                    <p className="text-muted-foreground text-sm" dir={dir}>{t.exam.questionOf(currentQ + 1, totalQuestions)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-medium flex items-center gap-1">
                      <Languages className="w-3 h-3" />
                      {t.quality.detectedLanguages}: {examData.detectedLanguages.map(languageName).join(" · ")}
                    </span>
                    <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium">{answeredCount}/{totalQuestions}</span>
                  </div>
                </div>

                <div className="w-full h-2 bg-muted rounded-full mb-8 overflow-hidden" role="progressbar" aria-label={t.exam.progressAria} aria-valuenow={currentQ + 1} aria-valuemin={1} aria-valuemax={totalQuestions}>
                  <motion.div className="h-full bg-amber-500 rounded-full" initial={{ width: 0 }} animate={{ width: `${((currentQ + 1) / totalQuestions) * 100}%` }} transition={{ duration: 0.3 }} />
                </div>

                <div dir={examDir} lang={examLang} className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 mb-6 cursor-pointer hover:border-amber-300 transition-colors" onClick={() => readQuestion(currentQuestion)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); readQuestion(currentQuestion); } }} aria-label={t.exam.clickToHear}>
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center font-bold text-lg shrink-0">{questionNumber(currentQuestion)}</div>
                    <div className="flex-1">
                      <p className="text-lg md:text-xl font-medium leading-relaxed whitespace-pre-line" dir="auto">{currentQuestion.text}</p>
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1" dir={dir}>
                        <Volume2 className="w-3 h-3" />{t.exam.tapToHear}
                      </p>
                    </div>
                    <button onClick={(event) => { event.stopPropagation(); isSpeaking ? stopSpeaking() : readQuestion(currentQuestion); }} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 ${isSpeaking ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600 hover:bg-amber-200"}`} aria-label={isSpeaking ? t.exam.stopReading : t.exam.readQuestion}>
                      {isSpeaking ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                  </div>

                  {currentQuestion.confidence === "low" && (
                    <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800" dir={dir}>{t.quality.lowConfidence}</span>
                  )}
                  {currentQuestion.uncertainParts.length > 0 && (
                    <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3" dir={dir}>
                      <p className="text-xs font-semibold text-amber-900 mb-2">{t.quality.uncertainParts}</p>
                      <div className="flex flex-wrap gap-2" dir={examDir}>
                        {currentQuestion.uncertainParts.map((part, index) => <span key={`${part}-${index}`} className="rounded-md bg-white px-2 py-1 text-sm text-amber-900">{part}</span>)}
                      </div>
                    </div>
                  )}

                  {currentQuestion.type === "multiple" && currentQuestion.options.length > 0 && (
                    <div className="space-y-3 mt-6">
                      {currentQuestion.options.map((option, index) => {
                        const label = optionLabel(currentQuestion, index);
                        const selected = answers[currentQuestion.id] === option;
                        const readable = Boolean(option.trim());
                        return (
                          <button key={`${label}-${index}`} disabled={!readable} onClick={(event) => { event.stopPropagation(); saveAnswer(currentQuestion.id, option); speak(`${label}: ${option}`, 0.9, examLang, 'ANSWER_OPTION'); }} className={`w-full text-start p-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 ${readable ? "active:scale-[0.98]" : "cursor-not-allowed opacity-60"} ${selected && readable ? "border-amber-500 bg-amber-50 text-amber-900" : "border-border hover:border-amber-200 hover:bg-amber-50/30"}`} aria-label={t.exam.optionAria(label, readable ? option : t.exam.unreadableOption)}>
                            <span className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${selected ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground"}`}>{label}</span>
                            <span className="flex-1 whitespace-pre-line" dir="auto">{readable ? option : t.exam.unreadableOption}</span>
                            {selected && readable && <CheckCircle className="w-5 h-5 text-amber-600 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {currentQuestion.type === "text" && (
                    <div className="mt-6 space-y-3" dir={dir}>
                      <textarea value={answers[currentQuestion.id] || ""} onChange={(event) => saveAnswer(currentQuestion.id, event.target.value)} onClick={(event) => event.stopPropagation()} placeholder={t.exam.answerPlaceholder} className="w-full min-h-[120px] p-4 rounded-xl border-2 border-border bg-background text-foreground resize-none focus:outline-none focus:border-amber-500 transition-colors" dir="auto" lang={examLang} aria-label={t.exam.answerFieldAria} />
                      <div className="flex items-center gap-3">
                        <Button onClick={(event) => { event.stopPropagation(); if (isListening) stopListening(); else { voiceSessionRef.current = beginVoiceAnswer(currentQuestion.id, answerRevisionsRef.current[currentQuestion.id] ?? 0); setTranscript(""); startListening(detectLanguage(currentQuestion.text, examLang)); } }} variant={isListening ? "destructive" : "outline"} className="rounded-xl" aria-label={isListening ? t.exam.stopRecording : t.exam.voiceAnswer}>
                          {isListening ? <MicOff className="w-4 h-4 ms-2" /> : <Mic className="w-4 h-4 ms-2" />}
                          {isListening ? t.exam.stop : t.exam.voiceAnswer}
                        </Button>
                        {isListening && <span className="text-sm text-red-500 animate-pulse flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full" />{t.exam.recording}</span>}
                        {speechError && <span className="text-sm text-red-600" role="alert">{speechError}</span>}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Button onClick={() => goToQuestion(currentQ - 1)} disabled={currentQ === 0} variant="outline" className="rounded-xl active:scale-[0.97]">
                    <PreviousIcon className="w-4 h-4 me-1" />{t.exam.previous}
                  </Button>
                  <div className="hidden md:flex items-center gap-1.5 flex-wrap justify-center">
                    {examData.questions.map((question, index) => (
                      <button key={question.id} onClick={() => goToQuestion(index)} className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${index === currentQ ? "bg-amber-600 text-white" : answers[question.id] ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`} aria-label={t.exam.questionAria(questionNumber(question))}>{questionNumber(question)}</button>
                    ))}
                  </div>
                  {currentQ < totalQuestions - 1 ? (
                    <Button onClick={() => goToQuestion(currentQ + 1)} className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl active:scale-[0.97]">{t.exam.next}<NextIcon className="w-4 h-4 ms-1" /></Button>
                  ) : (
                    <Button onClick={() => setStage("review")} className="bg-green-600 hover:bg-green-700 text-white rounded-xl active:scale-[0.97]"><Eye className="w-4 h-4 ms-2" />{t.exam.review}</Button>
                  )}
                </div>
              </motion.div>
            )}

            {stage === "review" && examData && (
              <motion.div key="review" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold mb-2">{t.review.title}</h1>
                  <p className="text-muted-foreground">{t.review.description(answeredCount, totalQuestions)}</p>
                </div>
                {actionError && <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-red-700" role="alert">{actionError}</div>}
                <div className="space-y-4 mb-8">
                  {examData.questions.map((question) => {
                    const answered = Boolean(answers[question.id]);
                    return (
                      <div key={question.id} dir={examDir} lang={examLang} className={`p-5 rounded-2xl border cursor-pointer hover:shadow-md transition-shadow ${answered ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}`} onClick={() => speakReview(question)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); speakReview(question); } }} role="button" tabIndex={0} aria-label={t.review.cardAria(questionNumber(question))}>
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold ${answered ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{questionNumber(question)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium mb-2 whitespace-pre-line" dir="auto">{question.text}</p>
                            {answered ? <p className="text-green-700 text-sm flex items-center gap-2" dir={dir}><CheckCircle className="w-4 h-4 shrink-0" /><span>{t.review.answer}:</span><bdi className="whitespace-pre-line">{answers[question.id]}</bdi></p> : <p className="text-red-500 text-sm" dir={dir}>{t.review.notAnswered}</p>}
                          </div>
                          <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); goToQuestion(examData.questions.findIndex((candidate) => candidate.id === question.id)); setStage("exam"); }} className="rounded-lg text-xs shrink-0" dir={dir}>{t.review.edit}</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 justify-center flex-wrap">
                  <Button variant="outline" onClick={() => setStage("exam")} className="rounded-xl"><PreviousIcon className="w-4 h-4 me-1" />{t.review.backToExam}</Button>
                  <Button onClick={handleGrade} disabled={isGrading} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-8 active:scale-[0.97]">
                    {isGrading ? <><Loader2 className="w-4 h-4 ms-2 animate-spin" />{t.review.grading}</> : <><GraduationCap className="w-4 h-4 ms-2" />{t.review.autoGrade}</>}
                  </Button>
                  <Button onClick={handleExport} disabled={isExporting} variant="outline" className="rounded-xl">
                    {isExporting ? <><Loader2 className="w-4 h-4 ms-2 animate-spin" />{t.review.exporting}</> : <><FileDown className="w-4 h-4 ms-2" />{t.review.exportWithoutGrading}</>}
                  </Button>
                </div>
              </motion.div>
            )}

            {stage === "grading" && examData && gradingData && (
              <motion.div key="grading" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
                <div className="text-center mb-8">
                  <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ duration: 0.5, type: "spring" }} className={`w-28 h-28 rounded-full flex items-center justify-center mx-auto mb-4 ${gradingData.totalScore >= 50 ? "bg-green-100" : "bg-red-100"}`}>
                    <span className={`text-4xl font-bold ${gradingData.totalScore >= 50 ? "text-green-600" : "text-red-600"}`}>{gradingData.totalScore}%</span>
                  </motion.div>
                  <h1 className="text-3xl font-bold mb-2">{t.grading.title}</h1>
                  <p className="text-muted-foreground">{t.grading.scoreSummary(gradingData.totalCorrect, gradingData.totalQuestions)}</p>
                  {gradingData.overallFeedback && <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm max-w-lg mx-auto" dir={examDir} lang={examLang}>{gradingData.overallFeedback}</div>}
                </div>
                {actionError && <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-red-700" role="alert">{actionError}</div>}
                <div className="space-y-4 mb-8">
                  {examData.questions.map((question) => {
                    const result = gradingData.results.find((item) => item.questionId === question.id);
                    if (!result) return null;
                    const statusColors = { correct: "border-green-300 bg-green-50/50", incorrect: "border-red-300 bg-red-50/50", partial: "border-yellow-300 bg-yellow-50/50", unanswered: "border-gray-300 bg-gray-50/50" };
                    const statusIcons = { correct: <CheckCircle className="w-5 h-5 text-green-600" />, incorrect: <XCircle className="w-5 h-5 text-red-600" />, partial: <AlertCircle className="w-5 h-5 text-yellow-600" />, unanswered: <AlertCircle className="w-5 h-5 text-gray-400" /> };
                    const uiStatus = t.grading.statuses[result.isCorrect];
                    const examStatus = t.content.statuses[languageKey(examLang)][result.isCorrect];
                    const speakGrade = () => speak(`${t.content.questionPrefix[languageKey(examLang)](questionNumber(question))}: ${question.text}. ${t.content.resultPrefix[languageKey(examLang)]}: ${examStatus}. ${result.feedback}. ${t.content.correctAnswerPrefix[languageKey(examLang)]}: ${result.correctAnswer}`, 0.85, examLang, 'EXAM');
                    return (
                      <div key={question.id} dir={examDir} lang={examLang} className={`p-5 rounded-2xl border-2 cursor-pointer hover:shadow-md transition-shadow ${statusColors[result.isCorrect]}`} onClick={speakGrade} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); speakGrade(); } }} role="button" tabIndex={0} aria-label={t.grading.cardAria(questionNumber(question))}>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0 text-sm font-bold">{questionNumber(question)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium mb-2 whitespace-pre-line" dir="auto">{question.text}</p>
                            {answers[question.id] && <div className={`text-sm mb-2 flex items-center gap-2 ${result.isCorrect === "correct" ? "text-green-700" : "text-red-600"}`} dir={dir}>{statusIcons[result.isCorrect]}<span>{t.grading.yourAnswer}:</span><bdi className="whitespace-pre-line">{answers[question.id]}</bdi></div>}
                            {result.isCorrect !== "correct" && result.correctAnswer && <div className="text-sm text-green-700 flex items-center gap-2 mb-2" dir={dir}><CheckCircle className="w-4 h-4 shrink-0" /><span>{t.grading.correctAnswer}: {result.correctAnswer}</span></div>}
                            {result.feedback && <p className="text-xs text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg mt-1">{result.feedback}</p>}
                          </div>
                          <div className="flex flex-col items-center gap-1 shrink-0" dir={dir}>{statusIcons[result.isCorrect]}<span className="text-xs font-medium">{uiStatus}</span></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 justify-center flex-wrap">
                  <Button variant="outline" onClick={() => setStage("review")} className="rounded-xl"><PreviousIcon className="w-4 h-4 me-1" />{t.grading.backToReview}</Button>
                  <Button onClick={handleExport} disabled={isExporting} className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]">
                    {isExporting ? <><Loader2 className="w-4 h-4 ms-2 animate-spin" />{t.grading.exporting}</> : <><FileDown className="w-4 h-4 ms-2" />{t.grading.exportWithGrading}</>}
                  </Button>
                </div>
              </motion.div>
            )}

            {stage === "export" && (
              <motion.div key="export" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }} className="text-center py-16">
                <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ duration: 0.5, type: "spring" }} className="w-24 h-24 rounded-3xl bg-green-100 flex items-center justify-center mx-auto mb-8"><CheckCircle className="w-12 h-12 text-green-600" /></motion.div>
                <h1 className="text-3xl font-bold mb-4">{t.export.title}</h1>
                <p className="text-muted-foreground text-lg mb-4 max-w-md mx-auto">{gradingData ? t.export.withGrading(gradingData.totalScore) : t.export.withoutGrading}</p>
                {examData && <ExamDeliveryPanel exam={examData} answers={answers} grading={gradingData} language={examLang} uiLanguage={lang} />}
                <div className="flex items-center gap-4 justify-center flex-wrap">
                  <Button variant="outline" onClick={resetExam} className="rounded-xl"><RotateCcw className="w-4 h-4 ms-2" />{t.export.newExam}</Button>
                  <Button onClick={downloadPdf} disabled={!pdfHtml} className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]"><FileDown className="w-4 h-4 ms-2" />{t.export.downloadPrint}</Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </Layout>
  );
}
