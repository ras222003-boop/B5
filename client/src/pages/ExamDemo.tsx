/*
 * Design: Warm Contemporary
 * Exam Demo page - Interactive exam simulation for visually impaired
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  FileDown,
  RotateCcw,
  Eye,
  Bot,
  Loader2,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Question {
  id: number;
  text: string;
  type: "multiple" | "text";
  options?: string[];
  answer?: string;
}

const sampleQuestions: Question[] = [
  {
    id: 1,
    text: "ما هي عاصمة المملكة العربية السعودية؟",
    type: "multiple",
    options: ["الرياض", "جدة", "مكة المكرمة", "الدمام"],
  },
  {
    id: 2,
    text: "كم عدد أركان الإسلام؟",
    type: "multiple",
    options: ["ثلاثة", "أربعة", "خمسة", "ستة"],
  },
  {
    id: 3,
    text: "اكتب جملة مفيدة تتضمن كلمة (العلم).",
    type: "text",
  },
  {
    id: 4,
    text: "ما هو أطول نهر في العالم؟",
    type: "multiple",
    options: ["نهر النيل", "نهر الأمازون", "نهر المسيسيبي", "نهر اليانغتسي"],
  },
  {
    id: 5,
    text: "اشرح أهمية القراءة في حياة الإنسان.",
    type: "text",
  },
];

type ExamStage = "scan" | "exam" | "review" | "export";

export default function ExamDemo() {
  const [stage, setStage] = useState<ExamStage>("scan");
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [textInput, setTextInput] = useState("");

  const question = sampleQuestions[currentQ];
  const totalQuestions = sampleQuestions.length;
  const answeredCount = Object.keys(answers).length;

  const handleScan = () => {
    setIsScanning(true);
    toast.info("جاري مسح ورقة الاختبار...", { description: "يتم التعرف على الأسئلة بتقنية OCR" });
    setTimeout(() => {
      setIsScanning(false);
      setStage("exam");
      toast.success("تم التعرف على الاختبار بنجاح!", { description: `تم اكتشاف ${totalQuestions} أسئلة` });
    }, 3000);
  };

  const handleAnswer = (answer: string) => {
    setAnswers((prev) => ({ ...prev, [question.id]: answer }));
    toast.success(`تم تسجيل إجابة السؤال ${question.id}`);
  };

  const handleTextAnswer = () => {
    if (textInput.trim()) {
      handleAnswer(textInput);
      setTextInput("");
    }
  };

  const handleVoiceInput = () => {
    if (isListening) {
      setIsListening(false);
      // Simulate voice recognition
      const sampleAnswers = [
        "العلم نور يهدي الإنسان إلى الطريق الصحيح",
        "القراءة تنمي العقل وتوسع المدارك وتزيد من المعرفة",
      ];
      const randomAnswer = sampleAnswers[Math.floor(Math.random() * sampleAnswers.length)];
      setTextInput(randomAnswer);
      toast.info("تم تحويل الصوت إلى نص");
    } else {
      setIsListening(true);
      toast.info("جاري الاستماع... تحدث الآن");
      setTimeout(() => {
        setIsListening(false);
        const sampleAnswers = [
          "العلم نور يهدي الإنسان إلى الطريق الصحيح",
          "القراءة تنمي العقل وتوسع المدارك وتزيد من المعرفة",
        ];
        const randomAnswer = sampleAnswers[Math.floor(Math.random() * sampleAnswers.length)];
        setTextInput(randomAnswer);
        toast.info("تم تحويل الصوت إلى نص");
      }, 3000);
    }
  };

  const speakQuestion = () => {
    setIsSpeaking(true);
    toast.info("جاري قراءة السؤال...", { description: question.text });
    setTimeout(() => setIsSpeaking(false), 2000);
  };

  const handleExport = () => {
    toast.success("تم تصدير الاختبار بنجاح!", {
      description: "تم إنشاء ملف PDF جاهز للطباعة",
    });
  };

  const resetExam = () => {
    setStage("scan");
    setCurrentQ(0);
    setAnswers({});
    setTextInput("");
  };

  return (
    <Layout>
      <section className="py-12 md:py-16">
        <div className="container max-w-3xl">
          {/* Stage: Scan */}
          <AnimatePresence mode="wait">
            {stage === "scan" && (
              <motion.div
                key="scan"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="text-center py-16"
              >
                <div className="w-24 h-24 rounded-3xl bg-amber-100 flex items-center justify-center mx-auto mb-8">
                  <Camera className="w-12 h-12 text-amber-600" />
                </div>
                <h1 className="text-3xl md:text-4xl font-bold mb-4">تجربة الاختبار</h1>
                <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
                  هذه تجربة تفاعلية لمحاكاة عملية أداء الاختبار عبر منصة بصيرة. اضغط على الزر لبدء مسح ورقة الاختبار.
                </p>
                <Button
                  size="lg"
                  onClick={handleScan}
                  disabled={isScanning}
                  className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-10 h-14 text-lg font-medium shadow-lg shadow-amber-200/50 active:scale-[0.97] transition-all"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-5 h-5 ml-2 animate-spin" />
                      جاري المسح...
                    </>
                  ) : (
                    <>
                      <Camera className="w-5 h-5 ml-2" />
                      مسح ورقة الاختبار
                    </>
                  )}
                </Button>
                {isScanning && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-8"
                  >
                    <div className="w-full max-w-xs mx-auto h-2 bg-amber-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 3, ease: "linear" }}
                        className="h-full bg-amber-500 rounded-full"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">جاري التعرف على الأسئلة...</p>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* Stage: Exam */}
            {stage === "exam" && (
              <motion.div
                key="exam"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
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
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={speakQuestion}
                        className={`rounded-lg ${isSpeaking ? "bg-amber-100 border-amber-300" : ""}`}
                        aria-label="قراءة السؤال بالصوت"
                      >
                        {isSpeaking ? (
                          <Volume2 className="w-4 h-4 text-amber-600 animate-pulse" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                        <span className="mr-1 text-xs">اقرأ</span>
                      </Button>
                    </div>
                  </div>

                  {/* Question Body */}
                  <div className="p-6 md:p-8">
                    <h2 className="text-xl md:text-2xl font-bold mb-6 leading-relaxed">{question.text}</h2>

                    {/* Multiple Choice */}
                    {question.type === "multiple" && question.options && (
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
                    {question.type === "text" && (
                      <div className="space-y-4">
                        <div className="relative">
                          <textarea
                            value={answers[question.id] || textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            placeholder="اكتب إجابتك هنا أو استخدم الميكروفون..."
                            className="w-full h-32 p-4 rounded-xl border border-border bg-background text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            aria-label="حقل الإجابة المقالية"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="outline"
                            onClick={handleVoiceInput}
                            className={`rounded-xl ${isListening ? "bg-red-50 border-red-300 text-red-500" : ""}`}
                            aria-label={isListening ? "إيقاف الاستماع" : "إدخال صوتي"}
                          >
                            {isListening ? (
                              <>
                                <MicOff className="w-4 h-4 ml-2" />
                                إيقاف
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
                      </div>
                    )}
                  </div>

                  {/* Navigation */}
                  <div className="p-5 border-t border-border/30 flex items-center justify-between">
                    <Button
                      variant="outline"
                      onClick={() => setCurrentQ(Math.max(0, currentQ - 1))}
                      disabled={currentQ === 0}
                      className="rounded-xl active:scale-[0.97]"
                    >
                      <ChevronRight className="w-4 h-4 ml-1" />
                      السابق
                    </Button>

                    {/* Question dots */}
                    <div className="hidden md:flex items-center gap-1.5">
                      {sampleQuestions.map((q, i) => (
                        <button
                          key={q.id}
                          onClick={() => setCurrentQ(i)}
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
                        onClick={() => setCurrentQ(currentQ + 1)}
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

            {/* Stage: Review */}
            {stage === "review" && (
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
                  {sampleQuestions.map((q) => (
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
                        <div className="flex-1">
                          <p className="font-medium mb-2">{q.text}</p>
                          {answers[q.id] ? (
                            <p className="text-green-700 text-sm flex items-center gap-2">
                              <CheckCircle className="w-4 h-4" />
                              الإجابة: {answers[q.id]}
                            </p>
                          ) : (
                            <p className="text-red-500 text-sm">لم يتم الإجابة</p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setCurrentQ(q.id - 1); setStage("exam"); }}
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
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]"
                  >
                    <FileDown className="w-4 h-4 ml-2" />
                    تصدير PDF
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Stage: Export */}
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
                    onClick={() => toast.info("هذه نسخة تجريبية - في النسخة الكاملة سيتم تحميل ملف PDF")}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-8 active:scale-[0.97]"
                  >
                    <FileDown className="w-4 h-4 ml-2" />
                    تحميل PDF
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
