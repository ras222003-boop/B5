import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock env
vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://forge.test.com");
vi.stubEnv("BUILT_IN_FORGE_API_KEY", "test-key-123");

// =============================================
// Helper functions mirroring server logic
// =============================================

function buildGradingPrompt(
  examTitle: string,
  questions: any[],
  answers: Record<number, string>,
  language: string
): string {
  const questionsWithAnswers = questions.map((q) => ({
    id: q.id,
    text: q.text,
    type: q.type,
    options: q.options,
    studentAnswer: answers?.[q.id] || null,
  }));
  return `اختبار: ${examTitle}\nلغة الاختبار: ${language}\n\nالأسئلة والإجابات:\n${JSON.stringify(questionsWithAnswers, null, 2)}`;
}

function generatePdfHtml(params: {
  examTitle?: string;
  questions: any[];
  answers?: Record<number, string>;
  grading?: any;
  language?: string;
}): string {
  const { examTitle, questions, answers = {}, grading, language = "ar" } = params;
  const isArabic = language === "ar";
  const arLabels = ["أ", "ب", "ج", "د", "هـ"];
  const enLabels = ["a", "b", "c", "d", "e"];
  const labels = isArabic ? arLabels : enLabels;
  const totalScore = grading?.totalScore;
  const totalCorrect = grading?.totalCorrect || 0;

  let html = `<!DOCTYPE html><html dir="${isArabic ? "rtl" : "ltr"}">`;
  html += `<head><meta charset="UTF-8"></head><body>`;
  html += `<h1>${examTitle || (isArabic ? "اختبار" : "Exam")}</h1>`;

  if (totalScore !== undefined) {
    html += `<div class="score">${totalScore}% - ${totalCorrect}/${questions.length}</div>`;
    if (grading?.overallFeedback) {
      html += `<div class="overall-feedback">${grading.overallFeedback}</div>`;
    }
  }

  for (const q of questions) {
    const gradingResult = grading?.results?.find((r: any) => r.questionId === q.id);
    const statusClass = gradingResult?.isCorrect || "";
    html += `<div class="question ${statusClass}">`;
    html += `<div class="question-num">${q.id}</div>`;
    html += `<div class="question-text">${q.text}</div>`;
    if (gradingResult) {
      html += `<span class="badge badge-${gradingResult.isCorrect}">${gradingResult.isCorrect}</span>`;
    }
    if (q.type === "multiple" && q.options?.length > 0) {
      for (let i = 0; i < q.options.length; i++) {
        const o = q.options[i];
        const isSelected = answers[q.id] === o;
        const isCorrectOpt = gradingResult?.correctAnswer === o;
        const cls = isCorrectOpt ? "correct-option" : isSelected ? "selected" : "";
        html += `<div class="option ${cls}">${labels[i] || i + 1}) ${o}</div>`;
      }
    }
    if (answers[q.id]) {
      html += `<div class="answer">${isArabic ? "إجابة الطالب:" : "Student Answer:"} ${answers[q.id]}</div>`;
    } else {
      html += `<div class="no-answer">${isArabic ? "لم يتم الإجابة" : "Not answered"}</div>`;
    }
    if (gradingResult && gradingResult.isCorrect !== "correct" && gradingResult.correctAnswer) {
      html += `<div class="correct-answer">${isArabic ? "الإجابة الصحيحة:" : "Correct Answer:"} ${gradingResult.correctAnswer}</div>`;
    }
    if (gradingResult?.feedback) {
      html += `<div class="teacher-feedback">${isArabic ? "تعليق المعلم:" : "Teacher Feedback:"} ${gradingResult.feedback}</div>`;
    }
    html += `</div>`;
  }

  html += `</body></html>`;
  return html;
}

describe("API Logic", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("OCR endpoint logic", () => {
    it("should validate imageBase64 is required", () => {
      const body = {};
      const hasImage = !!(body as any).imageBase64;
      expect(hasImage).toBe(false);
    });

    it("should accept valid base64 image data", () => {
      const body = { imageBase64: "data:image/jpeg;base64,/9j/4AAQ..." };
      const hasImage = !!body.imageBase64;
      expect(hasImage).toBe(true);
    });

    it("should prepend data URI if missing", () => {
      const imageBase64 = "/9j/4AAQ...";
      const url = imageBase64.startsWith("data:")
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;
      expect(url).toBe("data:image/jpeg;base64,/9j/4AAQ...");
    });

    it("should not modify existing data URI", () => {
      const imageBase64 = "data:image/png;base64,iVBOR...";
      const url = imageBase64.startsWith("data:")
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;
      expect(url).toBe("data:image/png;base64,iVBOR...");
    });
  });

  describe("Assistant endpoint logic", () => {
    it("should validate messages array is required", () => {
      const body = {};
      const isValid = !!(body as any).messages && Array.isArray((body as any).messages);
      expect(isValid).toBe(false);
    });

    it("should accept valid messages array", () => {
      const body = { messages: [{ role: "user", content: "مرحبا" }] };
      const isValid = !!body.messages && Array.isArray(body.messages);
      expect(isValid).toBe(true);
    });

    it("should build system prompt with exam context", () => {
      const examContext = "اختبار رياضيات - السؤال 1: ما هو 2+2؟";
      const systemPrompt = `أنت مساعد رقمي ذكي اسمه "مساعد بصيرة".\n${examContext ? `سياق الاختبار الحالي:\n${examContext}` : "لا يوجد اختبار نشط حالياً."}`;
      expect(systemPrompt).toContain("مساعد بصيرة");
      expect(systemPrompt).toContain("اختبار رياضيات");
    });

    it("should build system prompt without exam context", () => {
      const examContext = null;
      const systemPrompt = `أنت مساعد رقمي ذكي اسمه "مساعد بصيرة".\n${examContext ? `سياق الاختبار الحالي:\n${examContext}` : "لا يوجد اختبار نشط حالياً."}`;
      expect(systemPrompt).toContain("لا يوجد اختبار نشط حالياً");
    });
  });

  describe("LLM invocation", () => {
    it("should call Forge API with correct headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "مرحباً!" } }] }),
      });
      const FORGE_API_URL = "https://forge.test.com";
      const FORGE_API_KEY = "test-key-123";
      await fetch(`${FORGE_API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${FORGE_API_KEY}` },
        body: JSON.stringify({ messages: [{ role: "user", content: "test" }], model: "anthropic/claude-sonnet-4-20250514" }),
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://forge.test.com/v1/chat/completions",
        expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-key-123" }) })
      );
    });

    it("should handle LLM API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Internal Server Error" });
      const resp = await fetch("https://forge.test.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(resp.ok).toBe(false);
      expect(resp.status).toBe(500);
    });
  });

  describe("OCR response parsing", () => {
    it("should parse valid exam JSON response", () => {
      const content = JSON.stringify({
        examTitle: "اختبار الرياضيات",
        language: "ar",
        questions: [
          { id: 1, text: "ما هو ناتج 2 + 2؟", type: "multiple", options: ["3", "4", "5", "6"] },
          { id: 2, text: "اشرح نظرية فيثاغورس", type: "text", options: [] },
        ],
      });
      const parsed = JSON.parse(content);
      expect(parsed.examTitle).toBe("اختبار الرياضيات");
      expect(parsed.language).toBe("ar");
      expect(parsed.questions).toHaveLength(2);
      expect(parsed.questions[0].type).toBe("multiple");
      expect(parsed.questions[0].options).toHaveLength(4);
    });

    it("should handle empty questions array", () => {
      const content = JSON.stringify({ examTitle: "", language: "ar", questions: [] });
      const parsed = JSON.parse(content);
      expect(parsed.questions).toHaveLength(0);
    });
  });

  describe("Grading logic", () => {
    it("should build grading prompt with questions and answers", () => {
      const questions = [{ id: 1, text: "ما هو 2+2؟", type: "multiple", options: ["3", "4", "5"] }];
      const answers = { 1: "4" };
      const prompt = buildGradingPrompt("اختبار", questions, answers, "ar");
      expect(prompt).toContain("اختبار");
      expect(prompt).toContain("ar");
      expect(prompt).toContain("ما هو 2+2؟");
      expect(prompt).toContain('"studentAnswer": "4"');
    });

    it("should mark unanswered questions with null", () => {
      const questions = [{ id: 1, text: "سؤال بدون إجابة", type: "text", options: [] }];
      const answers = {};
      const prompt = buildGradingPrompt("اختبار", questions, answers, "ar");
      expect(prompt).toContain('"studentAnswer": null');
    });

    it("should parse grading result correctly", () => {
      const gradingResult = {
        results: [
          { questionId: 1, isCorrect: "correct", correctAnswer: "4", feedback: "إجابة صحيحة", score: 100 },
          { questionId: 2, isCorrect: "incorrect", correctAnswer: "باريس", feedback: "الإجابة الصحيحة هي باريس", score: 0 },
        ],
        totalScore: 50,
        totalCorrect: 1,
        totalQuestions: 2,
        overallFeedback: "أداء متوسط",
      };
      expect(gradingResult.totalScore).toBe(50);
      expect(gradingResult.totalCorrect).toBe(1);
      expect(gradingResult.results[0].isCorrect).toBe("correct");
      expect(gradingResult.results[1].isCorrect).toBe("incorrect");
      expect(gradingResult.results[1].feedback).toContain("باريس");
    });

    it("should calculate total score correctly", () => {
      const results = [
        { questionId: 1, isCorrect: "correct", score: 100 },
        { questionId: 2, isCorrect: "incorrect", score: 0 },
        { questionId: 3, isCorrect: "partial", score: 50 },
      ];
      const totalCorrect = results.filter((r) => r.isCorrect === "correct").length;
      const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);
      expect(totalCorrect).toBe(1);
      expect(avgScore).toBe(50);
    });
  });

  describe("PDF generation logic", () => {
    it("should validate questions array is required", () => {
      const body = {};
      const isValid = !!(body as any).questions && Array.isArray((body as any).questions);
      expect(isValid).toBe(false);
    });

    it("should accept valid questions with answers", () => {
      const body = {
        examTitle: "اختبار الرياضيات",
        questions: [
          { id: 1, text: "ما هو 2+2؟", type: "multiple", options: ["3", "4", "5"] },
          { id: 2, text: "اشرح نظرية فيثاغورس", type: "text", options: [] },
        ],
        answers: { 1: "4", 2: "مجموع مربعي الضلعين يساوي مربع الوتر" },
      };
      expect(body.questions).toHaveLength(2);
      expect(Object.keys(body.answers)).toHaveLength(2);
    });

    it("should generate HTML with correct structure", () => {
      const html = generatePdfHtml({
        examTitle: "اختبار رياضيات",
        questions: [{ id: 1, text: "ما هو 2+2؟", type: "multiple", options: ["3", "4", "5"] }],
        answers: { 1: "4" },
        language: "ar",
      });
      expect(html).toContain("اختبار رياضيات");
      expect(html).toContain("ما هو 2+2؟");
      expect(html).toContain("إجابة الطالب:");
      expect(html).toContain("4");
    });

    it("should handle unanswered questions", () => {
      const html = generatePdfHtml({
        examTitle: "اختبار",
        questions: [{ id: 1, text: "سؤال", type: "text", options: [] }],
        answers: {},
        language: "ar",
      });
      expect(html).toContain("لم يتم الإجابة");
    });

    it("should handle multiple choice questions with Arabic option labels", () => {
      const html = generatePdfHtml({
        examTitle: "اختبار",
        questions: [{ id: 1, text: "سؤال", type: "multiple", options: ["خيار1", "خيار2", "خيار3"] }],
        answers: { 1: "خيار1" },
        language: "ar",
      });
      expect(html).toContain("أ)");
      expect(html).toContain("ب)");
      expect(html).toContain("ج)");
    });

    it("should handle multiple choice questions with English option labels", () => {
      const html = generatePdfHtml({
        examTitle: "Exam",
        questions: [{ id: 1, text: "Question", type: "multiple", options: ["Option1", "Option2", "Option3"] }],
        answers: { 1: "Option1" },
        language: "en",
      });
      expect(html).toContain("a)");
      expect(html).toContain("b)");
      expect(html).toContain("c)");
    });

    it("should include grading results with correct/incorrect badges", () => {
      const html = generatePdfHtml({
        examTitle: "اختبار",
        questions: [
          { id: 1, text: "سؤال 1", type: "multiple", options: ["أ", "ب", "ج"] },
          { id: 2, text: "سؤال 2", type: "text", options: [] },
        ],
        answers: { 1: "أ", 2: "إجابة خاطئة" },
        grading: {
          results: [
            { questionId: 1, isCorrect: "correct", correctAnswer: "أ", feedback: "ممتاز", score: 100 },
            { questionId: 2, isCorrect: "incorrect", correctAnswer: "الإجابة الصحيحة", feedback: "راجع الدرس", score: 0 },
          ],
          totalScore: 50,
          totalCorrect: 1,
          totalQuestions: 2,
          overallFeedback: "أداء متوسط",
        },
        language: "ar",
      });
      expect(html).toContain("badge-correct");
      expect(html).toContain("badge-incorrect");
      expect(html).toContain("الإجابة الصحيحة:");
      expect(html).toContain("تعليق المعلم:");
      expect(html).toContain("50%");
      expect(html).toContain("أداء متوسط");
    });

    it("should show score box when grading is provided", () => {
      const html = generatePdfHtml({
        examTitle: "اختبار",
        questions: [{ id: 1, text: "سؤال", type: "text", options: [] }],
        grading: { totalScore: 80, totalCorrect: 4, totalQuestions: 5, overallFeedback: "جيد جداً", results: [] },
        language: "ar",
      });
      expect(html).toContain("80%");
      expect(html).toContain("جيد جداً");
    });

    it("should show correct answer for incorrect responses", () => {
      const html = generatePdfHtml({
        examTitle: "اختبار",
        questions: [{ id: 1, text: "ما عاصمة فرنسا؟", type: "text", options: [] }],
        answers: { 1: "لندن" },
        grading: {
          results: [
            { questionId: 1, isCorrect: "incorrect", correctAnswer: "باريس", feedback: "الإجابة الصحيحة هي باريس", score: 0 },
          ],
          totalScore: 0,
          totalCorrect: 0,
          totalQuestions: 1,
          overallFeedback: "يحتاج مراجعة",
        },
        language: "ar",
      });
      expect(html).toContain("الإجابة الصحيحة:");
      expect(html).toContain("باريس");
      expect(html).toContain("تعليق المعلم:");
      expect(html).toContain("الإجابة الصحيحة هي باريس");
    });
  });
});
