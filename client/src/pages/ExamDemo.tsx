/*
 * ExamDemo - Real exam experience with camera, OCR, TTS, STT, AI grading
 * Supports Arabic & English, sequential option labels, click-to-read
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
import { useTextToSpeech, useSpeechToText, detectLanguage } from "@/hooks/useSpeech";

type Question = {
  id: number;
  text: string;
  type: "multiple" | "text";
  options: string[];
};

type ExamData = {
  examTitle: string;
  language: "ar" | "en";
  questions: Question[];
};

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

const AR_LABELS = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
const EN_LABELS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export default function ExamDemo() {
  const [stage, setStage] = useState<Stage>("scan");
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingData, setGradingData] = useState<GradingData | null>(null);
  const [pdfHtml, setPdfHtml] = useState<string>("");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { videoRef, canvasRef, isActive: cameraActive, isStarting: cameraStarting, error: cameraError, startCamera, stopCamera, captureImage } = useCamera();
  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript, setTranscript, lang: sttLang, setLang: setSttLang } = useSpeechToText("ar");

  const examLang = examData?.language || "ar";
  const isArabic = examLang === "ar";
  const labels = isArabic ? AR_LABELS : EN_LABELS;
  const totalQuestions = examData?.questions.length || 0;
  const answeredCount = Object.keys(answers).length;
  const currentQuestion = examData?.questions[currentQ];

  // Update STT language when exam language changes
  useEffect(() => {
    if (examData?.language) {
      setSttLang(examData.language);
    }
  }, [examData?.language, setSttLang]);

  // Auto-fill answer from speech transcript
  useEffect(() => {
    if (transcript && currentQuestion && !isListening) {
      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: transcript }));
    }
  }, [transcript, isListening, currentQuestion]);

  // Read question aloud when navigating
  const readQuestion = useCallback((q: Question) => {
    if (!q) return;
    const prefix = isArabic ? `السؤال ${q.id}:` : `Question ${q.id}:`;
    let fullText = `${prefix} ${q.text}`;
    if (q.type === "multiple" && q.options.length > 0) {
      const optLabels = isArabic ? AR_LABELS : EN_LABELS;
      q.options.forEach((opt, i) => {
        fullText += `. ${optLabels[i]}: ${opt}`;
      });
    }
    speak(fullText, 0.9, examLang);
  }, [speak, isArabic, examLang]);

  const goToQuestion = useCallback((index: number) => {
    if (index >= 0 && index < totalQuestions) {
      setCurrentQ(index);
    }
  }, [totalQuestions]);

  // Process image with OCR
  const processImage = useCallback(async (imageData: string) => {
    setIsProcessing(true);
    setStatusMsg(isArabic ? "جاري تحليل ورقة الاختبار..." : "Analyzing exam paper...");

    try {
      const resp = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imageData }),
      });

      if (!resp.ok) throw new Error("OCR failed");

      const data = await resp.json();
      if (!data.questions || data.questions.length === 0) {
        setStatusMsg("لم يتم العثور على أسئلة في الصورة. حاول مرة أخرى بصورة أوضح.");
        setIsProcessing(false);
        return;
      }

      setExamData(data);
      setAnswers({});
      setCurrentQ(0);
      setGradingData(null);
      setStage("exam");

      // Announce exam loaded
      const lang = data.language || "ar";
      const msg = lang === "ar"
        ? `تم تحميل الاختبار: ${data.examTitle || "اختبار"}. يحتوي على ${data.questions.length} أسئلة. اضغط على أي سؤال لسماعه.`
        : `Exam loaded: ${data.examTitle || "Exam"}. Contains ${data.questions.length} questions. Tap any question to hear it.`;
      speak(msg, 0.9, lang);
    } catch (err: any) {
      console.error("OCR error:", err);
      setStatusMsg("حدث خطأ في تحليل الصورة. حاول مرة أخرى.");
    } finally {
      setIsProcessing(false);
    }
  }, [speak, isArabic]);

  // Capture from camera
  const handleCapture = useCallback(() => {
    const img = captureImage();
    if (img) {
      setCapturedImage(img);
      stopCamera();
      processImage(img);
    }
  }, [captureImage, stopCamera, processImage]);

  // Upload from file
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setCapturedImage(result);
      processImage(result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [processImage]);

  // AI Auto-grade
  const handleGrade = useCallback(async () => {
    if (!examData) return;
    setIsGrading(true);
    setStatusMsg(isArabic ? "جاري التصحيح التلقائي بالذكاء الاصطناعي..." : "AI auto-grading in progress...");

    try {
      const resp = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examTitle: examData.examTitle,
          questions: examData.questions,
          answers,
          language: examLang,
        }),
      });

      if (!resp.ok) throw new Error("Grading failed");

      const data: GradingData = await resp.json();
      setGradingData(data);
      setStage("grading");

      const msg = isArabic
        ? `تم التصحيح. النتيجة: ${data.totalScore} بالمئة. ${data.totalCorrect} إجابة صحيحة من ${data.totalQuestions}.`
        : `Grading complete. Score: ${data.totalScore}%. ${data.totalCorrect} correct out of ${data.totalQuestions}.`;
      speak(msg, 0.9, examLang);
    } catch (err: any) {
      console.error("Grading error:", err);
      setStatusMsg(isArabic ? "حدث خطأ في التصحيح. حاول مرة أخرى." : "Grading error. Try again.");
    } finally {
      setIsGrading(false);
    }
  }, [examData, answers, examLang, isArabic, speak]);

  // Export PDF with grading
  const handleExport = useCallback(async () => {
    if (!examData) return;
    setIsExporting(true);

    try {
      const resp = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examTitle: examData.examTitle,
          questions: examData.questions,
          answers,
          grading: gradingData,
          language: examLang,
        }),
      });

      if (!resp.ok) throw new Error("PDF generation failed");

      const data = await resp.json();
      setPdfHtml(data.html);
      setStage("export");
    } catch (err: any) {
      console.error("Export error:", err);
    } finally {
      setIsExporting(false);
    }
  }, [examData, answers, gradingData, examLang]);

  const downloadPdf = useCallback(() => {
    if (!pdfHtml) return;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(pdfHtml);
      w.document.close();
      setTimeout(() => w.print(), 500);
    }
  }, [pdfHtml]);

  const resetExam = useCallback(() => {
    setStage("scan");
    setExamData(null);
    setAnswers({});
    setCurrentQ(0);
    setGradingData(null);
    setPdfHtml("");
    setCapturedImage(null);
    setStatusMsg("");
    stopSpeaking();
  }, [stopSpeaking]);

  return (
    <Layout>
      <section className="py-12 md:py-20 min-h-[80vh]">
        <div className="container max-w-4xl">
          <AnimatePresence mode="wait">
            {/* ========== Stage: SCAN ========== */}
            {stage === "scan" && (
              <motion.div
                key="scan"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                <div className="text-center mb-10">
                  <div className="w-20 h-20 rounded-3xl bg-amber-100 flex items-center justify-center mx-auto mb-6">
                    <ScanLine className="w-10 h-10 text-amber-600" />
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold mb-3">مسح ورقة الاختبار</h1>
                  <p className="text-muted-foreground text-lg max-w-lg mx-auto">
                    وجّه الكاميرا نحو ورقة الاختبار أو ارفع صورة لها. يدعم العربية والإنجليزية.
                  </p>
                </div>

                {/* Camera View */}
                <div className="relative rounded-2xl overflow-hidden bg-slate-900 mb-6 aspect-[4/3] max-w-2xl mx-auto">
                  {cameraActive ? (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                      {/* Scan overlay */}
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute inset-8 border-2 border-white/40 rounded-xl" />
                        <div className="absolute top-8 left-8 w-8 h-8 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
                        <div className="absolute top-8 right-8 w-8 h-8 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
                        <div className="absolute bottom-8 left-8 w-8 h-8 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
                        <div className="absolute bottom-8 right-8 w-8 h-8 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />
                      </div>
                    </>
                  ) : capturedImage ? (
                    <img src={capturedImage} alt="صورة الاختبار" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-white/60 gap-4 p-8">
                      <Camera className="w-16 h-16" />
                      <p className="text-center text-lg">اضغط على "فتح الكاميرا" أو "رفع صورة"</p>
                      {cameraError && (
                        <div className="bg-red-500/20 text-red-300 px-4 py-2 rounded-xl text-sm text-center max-w-sm">
                          {cameraError}
                        </div>
                      )}
                    </div>
                  )}
                  <canvas ref={canvasRef} className="hidden" />
                </div>

                {/* Processing status */}
                {isProcessing && (
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-3 bg-amber-50 text-amber-700 px-6 py-3 rounded-xl">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="font-medium">{statusMsg || "جاري التحليل..."}</span>
                    </div>
                  </div>
                )}

                {statusMsg && !isProcessing && (
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-3 bg-red-50 text-red-700 px-6 py-3 rounded-xl">
                      <AlertCircle className="w-5 h-5" />
                      <span>{statusMsg}</span>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap items-center justify-center gap-4">
                  {!cameraActive ? (
                    <Button
                      onClick={startCamera}
                      disabled={isProcessing || cameraStarting}
                      className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 h-12 text-base active:scale-[0.97]"
                      aria-label="فتح الكاميرا لمسح ورقة الاختبار"
                    >
                      {cameraStarting ? (
                        <><Loader2 className="w-5 h-5 ml-2 animate-spin" />جاري فتح الكاميرا...</>
                      ) : (
                        <><Camera className="w-5 h-5 ml-2" />فتح الكاميرا</>
                      )}
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={handleCapture}
                        disabled={isProcessing}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-xl px-8 h-12 text-base active:scale-[0.97]"
                        aria-label="التقاط صورة ورقة الاختبار"
                      >
                        {isProcessing ? (
                          <><Loader2 className="w-5 h-5 ml-2 animate-spin" />جاري التحليل...</>
                        ) : (
                          <><Camera className="w-5 h-5 ml-2" />التقاط الصورة</>
                        )}
                      </Button>
                      <Button
                        onClick={stopCamera}
                        variant="outline"
                        className="rounded-xl h-12"
                      >
                        إلغاء
                      </Button>
                    </>
                  )}

                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    variant="outline"
                    className="rounded-xl px-8 h-12 text-base border-2 active:scale-[0.97]"
                    aria-label="رفع صورة ورقة الاختبار من الجهاز"
                  >
                    <Upload className="w-5 h-5 ml-2" />
                    رفع صورة
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileUpload}
                    className="hidden"
                    aria-hidden="true"
                  />
                </div>
              </motion.div>
            )}

            {/* ========== Stage: EXAM ========== */}
            {stage === "exam" && examData && currentQuestion && (
              <motion.div
                key="exam"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                {/* Exam header */}
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <div>
                    <h1 className="text-2xl font-bold">{examData.examTitle || (isArabic ? "اختبار" : "Exam")}</h1>
                    <p className="text-muted-foreground text-sm">
                      {isArabic ? `السؤال ${currentQ + 1} من ${totalQuestions}` : `Question ${currentQ + 1} of ${totalQuestions}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-medium flex items-center gap-1">
                      <Languages className="w-3 h-3" />
                      {isArabic ? "عربي" : "English"}
                    </span>
                    <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium">
                      {answeredCount}/{totalQuestions}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 bg-muted rounded-full mb-8 overflow-hidden">
                  <motion.div
                    className="h-full bg-amber-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentQ + 1) / totalQuestions) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>

                {/* Question card - click to read */}
                <div
                  className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 mb-6 cursor-pointer hover:border-amber-300 transition-colors"
                  onClick={() => readQuestion(currentQuestion)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") readQuestion(currentQuestion); }}
                  aria-label={isArabic ? "اضغط لسماع السؤال" : "Click to hear the question"}
                >
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
                      {currentQuestion.id}
                    </div>
                    <div className="flex-1">
                      <p className="text-lg md:text-xl font-medium leading-relaxed">{currentQuestion.text}</p>
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Volume2 className="w-3 h-3" />
                        {isArabic ? "اضغط لسماع السؤال" : "Tap to hear the question"}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); isSpeaking ? stopSpeaking() : readQuestion(currentQuestion); }}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
                        isSpeaking ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600 hover:bg-amber-200"
                      }`}
                      aria-label={isSpeaking ? (isArabic ? "إيقاف القراءة" : "Stop reading") : (isArabic ? "قراءة السؤال" : "Read question")}
                    >
                      {isSpeaking ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                  </div>

                  {/* Multiple choice options with labels */}
                  {currentQuestion.type === "multiple" && currentQuestion.options.length > 0 && (
                    <div className="space-y-3 mt-6">
                      {currentQuestion.options.map((option, i) => (
                        <button
                          key={i}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }));
                            speak(`${labels[i]}: ${option}`, 0.9, examLang);
                          }}
                          className={`w-full text-start p-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 active:scale-[0.98] ${
                            answers[currentQuestion.id] === option
                              ? "border-amber-500 bg-amber-50 text-amber-900"
                              : "border-border hover:border-amber-200 hover:bg-amber-50/30"
                          }`}
                          aria-label={`${isArabic ? "الخيار" : "Option"} ${labels[i]}: ${option}`}
                        >
                          <span className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
                            answers[currentQuestion.id] === option
                              ? "bg-amber-600 text-white"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {labels[i]}
                          </span>
                          <span className="flex-1">{option}</span>
                          {answers[currentQuestion.id] === option && (
                            <CheckCircle className="w-5 h-5 text-amber-600 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Text answer input */}
                  {currentQuestion.type === "text" && (
                    <div className="mt-6 space-y-3">
                      <textarea
                        value={answers[currentQuestion.id] || ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                        placeholder={isArabic ? "اكتب إجابتك هنا أو استخدم الميكروفون..." : "Type your answer here or use the microphone..."}
                        className="w-full min-h-[120px] p-4 rounded-xl border-2 border-border bg-background text-foreground resize-none focus:outline-none focus:border-amber-500 transition-colors"
                        dir="auto"
                        aria-label={isArabic ? "حقل الإجابة" : "Answer field"}
                      />
                      <div className="flex items-center gap-3">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isListening) {
                              stopListening();
                            } else {
                              setTranscript("");
                              startListening(examLang);
                            }
                          }}
                          variant={isListening ? "destructive" : "outline"}
                          className="rounded-xl"
                          aria-label={isListening ? (isArabic ? "إيقاف التسجيل" : "Stop recording") : (isArabic ? "تسجيل صوتي" : "Voice input")}
                        >
                          {isListening ? <MicOff className="w-4 h-4 ml-2" /> : <Mic className="w-4 h-4 ml-2" />}
                          {isListening ? (isArabic ? "إيقاف" : "Stop") : (isArabic ? "إجابة صوتية" : "Voice answer")}
                        </Button>
                        {isListening && (
                          <span className="text-sm text-red-500 animate-pulse flex items-center gap-1">
                            <span className="w-2 h-2 bg-red-500 rounded-full" />
                            {isArabic ? "جاري التسجيل..." : "Recording..."}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between gap-4">
                  <Button
                    onClick={() => goToQuestion(currentQ - 1)}
                    disabled={currentQ === 0}
                    variant="outline"
                    className="rounded-xl active:scale-[0.97]"
                  >
                    <ChevronRight className="w-4 h-4 ml-1" />
                    {isArabic ? "السابق" : "Previous"}
                  </Button>

                  {/* Question dots */}
                  <div className="hidden md:flex items-center gap-1.5 flex-wrap justify-center">
                    {examData.questions.map((q, i) => (
                      <button
                        key={q.id}
                        onClick={() => goToQuestion(i)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                          i === currentQ
                            ? "bg-amber-600 text-white"
                            : answers[q.id]
                            ? "bg-amber-100 text-amber-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                        aria-label={`${isArabic ? "السؤال" : "Question"} ${q.id}`}
                      >
                        {q.id}
                      </button>
                    ))}
                  </div>

                  {currentQ < totalQuestions - 1 ? (
                    <Button
                      onClick={() => goToQuestion(currentQ + 1)}
                      className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl active:scale-[0.97]"
                    >
                      {isArabic ? "التالي" : "Next"}
                      <ChevronLeft className="w-4 h-4 mr-1" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setStage("review")}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-xl active:scale-[0.97]"
                    >
                      <Eye className="w-4 h-4 ml-2" />
                      {isArabic ? "مراجعة" : "Review"}
                    </Button>
                  )}
                </div>
              </motion.div>
            )}

            {/* ========== Stage: REVIEW ========== */}
            {stage === "review" && examData && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold mb-2">{isArabic ? "مراجعة الإجابات" : "Review Answers"}</h1>
                  <p className="text-muted-foreground">
                    {isArabic
                      ? `راجع إجاباتك قبل التصحيح. أجبت على ${answeredCount} من ${totalQuestions} أسئلة.`
                      : `Review your answers before grading. Answered ${answeredCount} of ${totalQuestions} questions.`}
                  </p>
                </div>

                <div className="space-y-4 mb-8">
                  {examData.questions.map((q) => (
                    <div
                      key={q.id}
                      className={`p-5 rounded-2xl border cursor-pointer hover:shadow-md transition-shadow ${
                        answers[q.id] ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"
                      }`}
                      onClick={() => {
                        const prefix = isArabic ? `السؤال ${q.id}` : `Question ${q.id}`;
                        const answerText = answers[q.id]
                          ? (isArabic ? `الإجابة: ${answers[q.id]}` : `Answer: ${answers[q.id]}`)
                          : (isArabic ? "لم يتم الإجابة" : "Not answered");
                        speak(`${prefix}: ${q.text}. ${answerText}`, 0.9, examLang);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold ${
                          answers[q.id] ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                          {q.id}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium mb-2">{q.text}</p>
                          {answers[q.id] ? (
                            <p className="text-green-700 text-sm flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 shrink-0" />
                              <span>{isArabic ? "الإجابة" : "Answer"}: {answers[q.id]}</span>
                            </p>
                          ) : (
                            <p className="text-red-500 text-sm">{isArabic ? "لم يتم الإجابة" : "Not answered"}</p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); goToQuestion(examData.questions.findIndex(qq => qq.id === q.id)); setStage("exam"); }}
                          className="rounded-lg text-xs shrink-0"
                        >
                          {isArabic ? "تعديل" : "Edit"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-4 justify-center flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => setStage("exam")}
                    className="rounded-xl"
                  >
                    <ChevronRight className="w-4 h-4 ml-1" />
                    {isArabic ? "العودة للاختبار" : "Back to Exam"}
                  </Button>
                  <Button
                    onClick={handleGrade}
                    disabled={isGrading}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-8 active:scale-[0.97]"
                  >
                    {isGrading ? (
                      <><Loader2 className="w-4 h-4 ml-2 animate-spin" />{isArabic ? "جاري التصحيح..." : "Grading..."}</>
                    ) : (
                      <><GraduationCap className="w-4 h-4 ml-2" />{isArabic ? "تصحيح تلقائي بالذكاء الاصطناعي" : "AI Auto-Grade"}</>
                    )}
                  </Button>
                  <Button
                    onClick={() => { setStage("export"); handleExport(); }}
                    disabled={isExporting}
                    variant="outline"
                    className="rounded-xl"
                  >
                    {isExporting ? (
                      <><Loader2 className="w-4 h-4 ml-2 animate-spin" />{isArabic ? "جاري التصدير..." : "Exporting..."}</>
                    ) : (
                      <><FileDown className="w-4 h-4 ml-2" />{isArabic ? "تصدير بدون تصحيح" : "Export without grading"}</>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ========== Stage: GRADING ========== */}
            {stage === "grading" && examData && gradingData && (
              <motion.div
                key="grading"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                {/* Score header */}
                <div className="text-center mb-8">
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.5, type: "spring" }}
                    className={`w-28 h-28 rounded-full flex items-center justify-center mx-auto mb-4 ${
                      gradingData.totalScore >= 50 ? "bg-green-100" : "bg-red-100"
                    }`}
                  >
                    <span className={`text-4xl font-bold ${
                      gradingData.totalScore >= 50 ? "text-green-600" : "text-red-600"
                    }`}>
                      {gradingData.totalScore}%
                    </span>
                  </motion.div>
                  <h1 className="text-3xl font-bold mb-2">{isArabic ? "نتيجة التصحيح" : "Grading Results"}</h1>
                  <p className="text-muted-foreground">
                    {isArabic
                      ? `${gradingData.totalCorrect} إجابة صحيحة من ${gradingData.totalQuestions}`
                      : `${gradingData.totalCorrect} correct out of ${gradingData.totalQuestions}`}
                  </p>
                  {gradingData.overallFeedback && (
                    <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm max-w-lg mx-auto">
                      {gradingData.overallFeedback}
                    </div>
                  )}
                </div>

                {/* Graded questions */}
                <div className="space-y-4 mb-8">
                  {examData.questions.map((q) => {
                    const result = gradingData.results.find(r => r.questionId === q.id);
                    if (!result) return null;

                    const statusColors = {
                      correct: "border-green-300 bg-green-50/50",
                      incorrect: "border-red-300 bg-red-50/50",
                      partial: "border-yellow-300 bg-yellow-50/50",
                      unanswered: "border-gray-300 bg-gray-50/50",
                    };

                    const statusIcons = {
                      correct: <CheckCircle className="w-5 h-5 text-green-600" />,
                      incorrect: <XCircle className="w-5 h-5 text-red-600" />,
                      partial: <AlertCircle className="w-5 h-5 text-yellow-600" />,
                      unanswered: <AlertCircle className="w-5 h-5 text-gray-400" />,
                    };

                    const statusLabels = {
                      correct: isArabic ? "صحيح" : "Correct",
                      incorrect: isArabic ? "خاطئ" : "Incorrect",
                      partial: isArabic ? "جزئي" : "Partial",
                      unanswered: isArabic ? "لم يُجب" : "Unanswered",
                    };

                    return (
                      <div
                        key={q.id}
                        className={`p-5 rounded-2xl border-2 cursor-pointer hover:shadow-md transition-shadow ${statusColors[result.isCorrect]}`}
                        onClick={() => {
                          const status = statusLabels[result.isCorrect];
                          const msg = isArabic
                            ? `السؤال ${q.id}: ${q.text}. النتيجة: ${status}. ${result.feedback}. الإجابة الصحيحة: ${result.correctAnswer}`
                            : `Question ${q.id}: ${q.text}. Result: ${status}. ${result.feedback}. Correct answer: ${result.correctAnswer}`;
                          speak(msg, 0.85, examLang);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0 text-sm font-bold">
                            {q.id}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium mb-2">{q.text}</p>

                            {/* Student answer */}
                            {answers[q.id] && (
                              <div className={`text-sm mb-2 flex items-center gap-2 ${
                                result.isCorrect === "correct" ? "text-green-700" : "text-red-600"
                              }`}>
                                {statusIcons[result.isCorrect]}
                                <span>{isArabic ? "إجابتك" : "Your answer"}: {answers[q.id]}</span>
                              </div>
                            )}

                            {/* Correct answer (if wrong) */}
                            {result.isCorrect !== "correct" && result.correctAnswer && (
                              <div className="text-sm text-green-700 flex items-center gap-2 mb-2">
                                <CheckCircle className="w-4 h-4 shrink-0" />
                                <span>{isArabic ? "الإجابة الصحيحة" : "Correct answer"}: {result.correctAnswer}</span>
                              </div>
                            )}

                            {/* Feedback */}
                            {result.feedback && (
                              <p className="text-xs text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg mt-1">
                                {result.feedback}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            {statusIcons[result.isCorrect]}
                            <span className="text-xs font-medium">{statusLabels[result.isCorrect]}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-4 justify-center flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => setStage("review")}
                    className="rounded-xl"
                  >
                    <ChevronRight className="w-4 h-4 ml-1" />
                    {isArabic ? "العودة للمراجعة" : "Back to Review"}
                  </Button>
                  <Button
                    onClick={() => { handleExport(); }}
                    disabled={isExporting}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]"
                  >
                    {isExporting ? (
                      <><Loader2 className="w-4 h-4 ml-2 animate-spin" />{isArabic ? "جاري التصدير..." : "Exporting..."}</>
                    ) : (
                      <><FileDown className="w-4 h-4 ml-2" />{isArabic ? "تصدير PDF مع التصحيح" : "Export PDF with Grading"}</>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ========== Stage: EXPORT ========== */}
            {stage === "export" && (
              <motion.div
                key="export"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="text-center py-16"
              >
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.5, type: "spring" }}
                  className="w-24 h-24 rounded-3xl bg-green-100 flex items-center justify-center mx-auto mb-8"
                >
                  <CheckCircle className="w-12 h-12 text-green-600" />
                </motion.div>
                <h1 className="text-3xl font-bold mb-4">
                  {isArabic ? "تم تصدير الاختبار بنجاح!" : "Exam exported successfully!"}
                </h1>
                <p className="text-muted-foreground text-lg mb-4 max-w-md mx-auto">
                  {gradingData
                    ? (isArabic
                      ? `تم إنشاء ملف PDF يحتوي على إجاباتك مع نتائج التصحيح التلقائي (${gradingData.totalScore}%).`
                      : `PDF created with your answers and AI grading results (${gradingData.totalScore}%).`)
                    : (isArabic
                      ? "تم إنشاء ملف PDF يحتوي على جميع إجاباتك بشكل منظم."
                      : "PDF created with all your answers organized.")}
                </p>
                <div className="flex items-center gap-4 justify-center flex-wrap">
                  <Button
                    variant="outline"
                    onClick={resetExam}
                    className="rounded-xl"
                  >
                    <RotateCcw className="w-4 h-4 ml-2" />
                    {isArabic ? "تجربة جديدة" : "New Exam"}
                  </Button>
                  <Button
                    onClick={downloadPdf}
                    disabled={!pdfHtml}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]"
                  >
                    <FileDown className="w-4 h-4 ml-2" />
                    {isArabic ? "تحميل وطباعة PDF" : "Download & Print PDF"}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </Layout>
  );
}
