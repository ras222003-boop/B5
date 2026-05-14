/*
 * Real Exam Experience - Camera OCR + TTS + STT
 * Uses real camera, real AI OCR, real speech synthesis and recognition
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Volume2,
  Mic,
  MicOff,
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  FileDown,
  RotateCcw,
  Eye,
  Loader2,
  Upload,
  ImageIcon,
  AlertCircle,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCamera } from "@/hooks/useCamera";
import { useTextToSpeech, useSpeechToText } from "@/hooks/useSpeech";

interface Question {
  id: number;
  text: string;
  type: "multiple" | "text";
  options: string[];
}

interface ExamData {
  examTitle: string;
  questions: Question[];
}

type ExamStage = "scan" | "processing" | "exam" | "review" | "export";

export default function ExamDemo() {
  const [stage, setStage] = useState<ExamStage>("scan");
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const { videoRef, canvasRef, isActive, error: cameraError, startCamera, stopCamera, captureImage } = useCamera();
  const { speak, stop: stopSpeaking, isSpeaking } = useTextToSpeech();
  const { startListening, stopListening, isListening, transcript, error: speechError, setTranscript } = useSpeechToText();

  const question = examData?.questions[currentQ];
  const totalQuestions = examData?.questions.length || 0;
  const answeredCount = Object.keys(answers).length;

  // Update text input when speech transcript changes
  useEffect(() => {
    if (transcript) {
      setTextInput(transcript);
    }
  }, [transcript]);

  // Speak question when navigating
  const speakQuestion = useCallback(() => {
    if (!question) return;
    let text = `السؤال ${question.id}: ${question.text}`;
    if (question.type === "multiple" && question.options.length > 0) {
      text += ". الخيارات هي: ";
      question.options.forEach((opt, i) => {
        text += `${String.fromCharCode(1571 + i)}) ${opt}. `;
      });
    }
    speak(text);
  }, [question, speak]);

  // Handle camera capture
  const handleCapture = useCallback(() => {
    const imageData = captureImage();
    if (imageData) {
      setCapturedImage(imageData);
      stopCamera();
      toast.success("تم التقاط الصورة بنجاح!");
    }
  }, [captureImage, stopCamera]);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("يرجى اختيار ملف صورة");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCapturedImage(reader.result as string);
      stopCamera();
      toast.success("تم تحميل الصورة بنجاح!");
    };
    reader.readAsDataURL(file);
  }, [stopCamera]);

  // Send image to OCR API
  const processImage = useCallback(async () => {
    if (!capturedImage) return;

    setIsProcessing(true);
    setOcrError(null);
    setStage("processing");

    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: capturedImage }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "فشل في معالجة الصورة");
      }

      const data: ExamData = await response.json();

      if (!data.questions || data.questions.length === 0) {
        throw new Error("لم يتم العثور على أسئلة في الصورة. تأكد من وضوح الصورة وحاول مرة أخرى.");
      }

      setExamData(data);
      setStage("exam");
      toast.success(`تم التعرف على ${data.questions.length} أسئلة بنجاح!`, {
        description: data.examTitle || "اختبار",
      });

      // Read the first question automatically
      setTimeout(() => {
        const q = data.questions[0];
        let text = `مرحباً! تم التعرف على ${data.questions.length} أسئلة. السؤال الأول: ${q.text}`;
        if (q.type === "multiple" && q.options.length > 0) {
          text += ". الخيارات هي: ";
          q.options.forEach((opt, i) => {
            text += `${String.fromCharCode(1571 + i)}) ${opt}. `;
          });
        }
        speak(text);
      }, 500);
    } catch (err: any) {
      console.error("OCR Error:", err);
      setOcrError(err.message);
      setStage("scan");
      toast.error("فشل في التعرف على الاختبار", { description: err.message });
    } finally {
      setIsProcessing(false);
    }
  }, [capturedImage, speak]);

  const handleAnswer = (answer: string) => {
    if (!question) return;
    setAnswers((prev) => ({ ...prev, [question.id]: answer }));
    speak(`تم تسجيل إجابتك: ${answer}`);
  };

  const handleTextAnswer = () => {
    if (textInput.trim()) {
      handleAnswer(textInput);
      setTextInput("");
      setTranscript("");
    }
  };

  const handleVoiceInput = () => {
    if (isListening) {
      stopListening();
    } else {
      speak("تحدث الآن بإجابتك");
      setTimeout(() => startListening(), 1500);
    }
  };

  const goToQuestion = (index: number) => {
    stopSpeaking();
    setCurrentQ(index);
    setTextInput(answers[examData!.questions[index].id] || "");
  };

  const [pdfReady, setPdfReady] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  const handleExport = async () => {
    if (!examData) return;
    setIsExporting(true);
    try {
      // Dynamically import jsPDF to avoid bundle bloat
      const { default: jsPDF } = await import("jspdf");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      // Load Arabic font from Google Fonts CDN as base64
      // We'll use the built-in Helvetica and write Arabic via addFont workaround
      // jsPDF doesn't natively support Arabic, so we use HTML rendering approach

      const title = examData.examTitle || "اختبار";
      const qs = examData.questions;

      // Build clean HTML for PDF
      const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Tajawal', 'Arial', sans-serif; direction: rtl; padding: 30px; color: #1a1a1a; line-height: 1.8; font-size: 14px; }
.header { text-align: center; margin-bottom: 30px; padding-bottom: 15px; border-bottom: 3px solid #d97706; }
.header h1 { font-size: 24px; color: #92400e; margin-bottom: 6px; }
.header .subtitle { font-size: 12px; color: #78716c; }
.header .logo { font-size: 14px; color: #d97706; font-weight: 700; margin-bottom: 8px; }
.stats { display: flex; justify-content: center; gap: 40px; margin-bottom: 25px; }
.stat { text-align: center; }
.stat-num { font-size: 22px; font-weight: 700; color: #d97706; }
.stat-label { font-size: 11px; color: #78716c; }
.question { margin-bottom: 20px; padding: 15px; border: 1px solid #e7e5e4; border-radius: 10px; background: #fafaf9; }
.q-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.q-num { background: #d97706; color: white; width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
.q-text { font-size: 15px; font-weight: 500; }
.options { margin-top: 6px; padding-right: 36px; font-size: 13px; color: #57534e; }
.answer { margin-top: 10px; padding: 10px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; }
.answer-label { font-size: 11px; color: #15803d; font-weight: 700; }
.answer-text { font-size: 14px; color: #166534; }
.no-answer { margin-top: 10px; padding: 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 13px; color: #dc2626; }
.footer { margin-top: 30px; padding-top: 15px; border-top: 2px solid #e7e5e4; text-align: center; color: #78716c; font-size: 11px; }
</style>
</head>
<body>
<div class="header">
  <div class="logo">بصيرة - منصة الاختبارات الذكية</div>
  <h1>${title}</h1>
  <div class="subtitle">تاريخ التصدير: ${new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" })}</div>
</div>
<div class="stats">
  <div class="stat"><div class="stat-num">${qs.length}</div><div class="stat-label">عدد الأسئلة</div></div>
  <div class="stat"><div class="stat-num">${Object.keys(answers).length}</div><div class="stat-label">تمت الإجابة</div></div>
</div>
${qs.map((q) => `
<div class="question">
  <div class="q-header">
    <span class="q-num">${q.id}</span>
    <span class="q-text">${q.text}</span>
  </div>
  ${q.type === "multiple" && q.options?.length ? `<div class="options">${q.options.map((o, i) => `<div>${String.fromCharCode(1571 + i)}) ${o}</div>`).join("")}</div>` : ""}
  ${answers[q.id] ? `<div class="answer"><div class="answer-label">الإجابة:</div><div class="answer-text">${answers[q.id]}</div></div>` : `<div class="no-answer">لم يتم الإجابة</div>`}
</div>`).join("")}
<div class="footer">تم إنشاء هذا الملف بواسطة منصة بصيرة - الاختبارات الذكية لذوي الإعاقة البصرية</div>
</body>
</html>`;

      // Use an iframe to render the HTML and trigger print-to-PDF
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);

      // Clean up old blob URL
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(blobUrl);
      setPdfReady(true);

      toast.success("تم تصدير الاختبار بنجاح!", { description: "اضغط تحميل PDF لحفظ الملف" });
      speak("تم تصدير الاختبار بنجاح. اضغط زر تحميل PDF لحفظ الملف.");
    } catch (err: any) {
      toast.error("فشل في تصدير الاختبار", { description: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const downloadPdf = () => {
    if (!pdfBlobUrl) return;
    // Open the HTML in a new window and trigger the browser's print-to-PDF
    const printWindow = window.open(pdfBlobUrl, "_blank");
    if (printWindow) {
      printWindow.addEventListener("load", () => {
        setTimeout(() => printWindow.print(), 300);
      });
    } else {
      // Fallback: direct download as HTML
      const a = document.createElement("a");
      a.href = pdfBlobUrl;
      a.download = `${examData?.examTitle || "اختبار"}_بصيرة.html`;
      a.click();
    }
  };

  const resetExam = () => {
    stopSpeaking();
    stopCamera();
    setStage("scan");
    setCurrentQ(0);
    setAnswers({});
    setTextInput("");
    setCapturedImage(null);
    setExamData(null);
    setOcrError(null);
  };

  return (
    <Layout>
      <section className="py-8 md:py-12">
        <div className="container max-w-3xl">
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
                <div className="text-center mb-8">
                  <div className="w-20 h-20 rounded-3xl bg-amber-100 flex items-center justify-center mx-auto mb-6">
                    <Camera className="w-10 h-10 text-amber-600" />
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold mb-3">مسح ورقة الاختبار</h1>
                  <p className="text-muted-foreground text-lg max-w-md mx-auto">
                    وجّه الكاميرا نحو ورقة الاختبار أو ارفع صورة من جهازك
                  </p>
                </div>

                {ocrError && (
                  <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-700 font-medium text-sm">فشل في التعرف على الاختبار</p>
                      <p className="text-red-600 text-sm mt-1">{ocrError}</p>
                    </div>
                  </div>
                )}

                {/* Camera Preview */}
                {isActive && !capturedImage && (
                  <div className="mb-6 rounded-2xl overflow-hidden border-2 border-amber-300 shadow-lg relative">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-auto max-h-[400px] object-cover bg-black"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    {/* Camera overlay guide */}
                    <div className="absolute inset-4 border-2 border-white/40 rounded-xl pointer-events-none" />
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
                      <Button
                        onClick={handleCapture}
                        className="bg-white text-amber-700 hover:bg-amber-50 rounded-full w-16 h-16 shadow-xl active:scale-[0.93] transition-all"
                        aria-label="التقاط صورة"
                      >
                        <Camera className="w-7 h-7" />
                      </Button>
                      <Button
                        variant="outline"
                        onClick={stopCamera}
                        className="bg-white/80 rounded-full w-12 h-12 shadow-lg"
                        aria-label="إغلاق الكاميرا"
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                )}

                {/* Captured Image Preview */}
                {capturedImage && (
                  <div className="mb-6">
                    <div className="rounded-2xl overflow-hidden border-2 border-green-300 shadow-lg relative">
                      <img
                        src={capturedImage}
                        alt="صورة ورقة الاختبار الملتقطة"
                        className="w-full h-auto max-h-[400px] object-contain bg-gray-50"
                      />
                      <div className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-green-500 text-white text-xs font-medium flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        تم الالتقاط
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-4 justify-center">
                      <Button
                        variant="outline"
                        onClick={() => { setCapturedImage(null); startCamera(); }}
                        className="rounded-xl"
                      >
                        <RotateCcw className="w-4 h-4 ml-2" />
                        إعادة التصوير
                      </Button>
                      <Button
                        onClick={processImage}
                        disabled={isProcessing}
                        className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 h-12 text-base font-medium shadow-lg shadow-amber-200/50 active:scale-[0.97] transition-all"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 ml-2 animate-spin" />
                            جاري التحليل...
                          </>
                        ) : (
                          <>
                            <Eye className="w-5 h-5 ml-2" />
                            تحليل الاختبار بالذكاء الاصطناعي
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                {!isActive && !capturedImage && (
                  <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
                    <Button
                      size="lg"
                      onClick={startCamera}
                      className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 h-14 text-lg font-medium shadow-lg shadow-amber-200/50 active:scale-[0.97] transition-all w-full sm:w-auto"
                    >
                      <Camera className="w-5 h-5 ml-2" />
                      فتح الكاميرا
                    </Button>

                    <div className="relative w-full sm:w-auto">
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        aria-label="رفع صورة من الجهاز"
                      />
                      <Button
                        size="lg"
                        variant="outline"
                        className="rounded-xl px-8 h-14 text-lg font-medium border-2 w-full sm:w-auto pointer-events-none"
                      >
                        <Upload className="w-5 h-5 ml-2" />
                        رفع صورة
                      </Button>
                    </div>
                  </div>
                )}

                {cameraError && (
                  <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-200 text-center">
                    <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" />
                    <p className="text-red-700 text-sm">{cameraError}</p>
                  </div>
                )}

                {/* Instructions */}
                <div className="mt-10 p-6 rounded-2xl bg-amber-50/50 border border-amber-100">
                  <h3 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    نصائح لأفضل نتيجة
                  </h3>
                  <ul className="space-y-2 text-amber-700 text-sm">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>تأكد من إضاءة جيدة وعدم وجود ظلال على الورقة</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>ضع الورقة على سطح مستوٍ وصوّرها من الأعلى</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>تأكد من ظهور جميع الأسئلة في الصورة بوضوح</span>
                    </li>
                  </ul>
                </div>
              </motion.div>
            )}

            {/* ========== Stage: PROCESSING ========== */}
            {stage === "processing" && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="text-center py-16"
              >
                <Loader2 className="w-16 h-16 text-amber-600 animate-spin mx-auto mb-6" />
                <h2 className="text-2xl font-bold mb-3">جاري تحليل ورقة الاختبار...</h2>
                <p className="text-muted-foreground mb-6">
                  الذكاء الاصطناعي يقرأ الأسئلة ويستخرجها من الصورة
                </p>
                <div className="w-full max-w-xs mx-auto h-2 bg-amber-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: "0%" }}
                    animate={{ width: "90%" }}
                    transition={{ duration: 15, ease: "linear" }}
                    className="h-full bg-amber-500 rounded-full"
                  />
                </div>
              </motion.div>
            )}

            {/* ========== Stage: EXAM ========== */}
            {stage === "exam" && question && (
              <motion.div
                key="exam"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                {/* Exam Title */}
                {examData?.examTitle && (
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-bold text-amber-700">{examData.examTitle}</h2>
                  </div>
                )}

                {/* Progress */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">
                      السؤال {currentQ + 1} من {totalQuestions}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {answeredCount} إجابة من {totalQuestions}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-amber-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-300"
                      style={{ width: `${((currentQ + 1) / totalQuestions) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Question Card */}
                <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
                  {/* Question Header */}
                  <div className="p-5 border-b border-border/30 bg-amber-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center text-white font-bold">
                        {question.id}
                      </div>
                      <span className="font-medium text-sm">
                        {question.type === "multiple" ? "اختيار من متعدد" : "إجابة مقالية"}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={isSpeaking ? stopSpeaking : speakQuestion}
                      className={`rounded-lg ${isSpeaking ? "bg-amber-100 border-amber-300" : ""}`}
                      aria-label={isSpeaking ? "إيقاف القراءة" : "قراءة السؤال بالصوت"}
                    >
                      <Volume2 className={`w-4 h-4 ${isSpeaking ? "text-amber-600 animate-pulse" : ""}`} />
                      <span className="mr-1 text-xs">{isSpeaking ? "إيقاف" : "اقرأ"}</span>
                    </Button>
                  </div>

                  {/* Question Body */}
                  <div className="p-6 md:p-8">
                    <h2 className="text-xl md:text-2xl font-bold mb-6 leading-relaxed">{question.text}</h2>

                    {/* Multiple Choice */}
                    {question.type === "multiple" && question.options.length > 0 && (
                      <div className="space-y-3">
                        {question.options.map((option, i) => {
                          const isSelected = answers[question.id] === option;
                          return (
                            <button
                              key={option}
                              onClick={() => handleAnswer(option)}
                              className={`w-full text-right p-4 rounded-xl border-2 transition-all duration-200 active:scale-[0.98] ${
                                isSelected
                                  ? "border-amber-500 bg-amber-50 text-amber-800"
                                  : "border-border hover:border-amber-200 hover:bg-amber-50/30"
                              }`}
                              aria-label={`الخيار ${String.fromCharCode(1571 + i)}: ${option}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                                  isSelected ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-600"
                                }`}>
                                  {String.fromCharCode(1571 + i)}
                                </div>
                                <span className="font-medium">{option}</span>
                                {isSelected && <CheckCircle className="w-5 h-5 text-amber-600 mr-auto" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Text Answer */}
                    {(question.type === "text" || (question.type === "multiple" && question.options.length === 0)) && (
                      <div className="space-y-4">
                        <div className="relative">
                          <textarea
                            value={textInput || answers[question.id] || ""}
                            onChange={(e) => setTextInput(e.target.value)}
                            placeholder="اكتب إجابتك هنا أو استخدم الميكروفون..."
                            className="w-full h-32 p-4 rounded-xl border border-border bg-background text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            aria-label="حقل الإجابة"
                          />
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Button
                            variant="outline"
                            onClick={handleVoiceInput}
                            className={`rounded-xl ${isListening ? "bg-red-50 border-red-300 text-red-500" : ""}`}
                            aria-label={isListening ? "إيقاف الاستماع" : "إدخال صوتي"}
                          >
                            {isListening ? (
                              <>
                                <MicOff className="w-4 h-4 ml-2" />
                                <span className="animate-pulse">جاري الاستماع...</span>
                              </>
                            ) : (
                              <>
                                <Mic className="w-4 h-4 ml-2" />
                                إدخال صوتي
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={handleTextAnswer}
                            disabled={!textInput.trim()}
                            className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl active:scale-[0.97]"
                          >
                            <CheckCircle className="w-4 h-4 ml-2" />
                            تأكيد الإجابة
                          </Button>
                        </div>
                        {speechError && (
                          <p className="text-red-500 text-sm flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {speechError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Navigation */}
                  <div className="p-5 border-t border-border/30 flex items-center justify-between">
                    <Button
                      variant="outline"
                      onClick={() => goToQuestion(Math.max(0, currentQ - 1))}
                      disabled={currentQ === 0}
                      className="rounded-xl active:scale-[0.97]"
                    >
                      <ChevronRight className="w-4 h-4 ml-1" />
                      السابق
                    </Button>

                    {/* Question dots */}
                    <div className="hidden md:flex items-center gap-1.5">
                      {examData?.questions.map((q, i) => (
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
                          aria-label={`الانتقال للسؤال ${q.id}`}
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
                        التالي
                        <ChevronLeft className="w-4 h-4 mr-1" />
                      </Button>
                    ) : (
                      <Button
                        onClick={() => setStage("review")}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-xl active:scale-[0.97]"
                      >
                        <Eye className="w-4 h-4 ml-2" />
                        مراجعة
                      </Button>
                    )}
                  </div>
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
                  <h1 className="text-3xl font-bold mb-2">مراجعة الإجابات</h1>
                  <p className="text-muted-foreground">
                    راجع إجاباتك قبل التصدير. أجبت على {answeredCount} من {totalQuestions} أسئلة.
                  </p>
                </div>

                <div className="space-y-4 mb-8">
                  {examData.questions.map((q) => (
                    <div
                      key={q.id}
                      className={`p-5 rounded-2xl border ${
                        answers[q.id] ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"
                      }`}
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
                              <span>الإجابة: {answers[q.id]}</span>
                            </p>
                          ) : (
                            <p className="text-red-500 text-sm">لم يتم الإجابة</p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { goToQuestion(examData.questions.findIndex(qq => qq.id === q.id)); setStage("exam"); }}
                          className="rounded-lg text-xs shrink-0"
                        >
                          تعديل
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-4 justify-center">
                  <Button
                    variant="outline"
                    onClick={() => setStage("exam")}
                    className="rounded-xl"
                  >
                    <ChevronRight className="w-4 h-4 ml-1" />
                    العودة للاختبار
                  </Button>
                  <Button
                    onClick={() => { setStage("export"); handleExport(); }}
                    disabled={isExporting}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]"
                  >
                    {isExporting ? (
                      <><Loader2 className="w-4 h-4 ml-2 animate-spin" />جاري التصدير...</>
                    ) : (
                      <><FileDown className="w-4 h-4 ml-2" />تصدير PDF</>
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
                <h1 className="text-3xl font-bold mb-4">تم تصدير الاختبار بنجاح!</h1>
                <p className="text-muted-foreground text-lg mb-4 max-w-md mx-auto">
                  تم إنشاء ملف PDF يحتوي على جميع إجاباتك بشكل منظم ومطابق لنموذج الاختبار.
                </p>
                <p className="text-sm text-muted-foreground mb-8">
                  يمكن للمعلم طباعة الملف مباشرة أو مراجعته إلكترونياً.
                </p>
                <div className="flex items-center gap-4 justify-center">
                  <Button
                    variant="outline"
                    onClick={resetExam}
                    className="rounded-xl"
                  >
                    <RotateCcw className="w-4 h-4 ml-2" />
                    تجربة جديدة
                  </Button>
                  <Button
                    onClick={downloadPdf}
                    disabled={!pdfReady}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]"
                  >
                    <FileDown className="w-4 h-4 ml-2" />
                    تحميل وطباعة PDF
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
