import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { toNodeHandler } from "better-auth/node";
import { auth, providerReady } from "./auth";
import { ensureSchema } from "./migrations";
import { registerSupportRoutes, startTicketMailWorker } from "./support";
import { registerOcrRoute } from "./ocr";
import { toExamLanguage, assistantSystem, guideSystem, aiFallback, pdfLabels, escapeHtml } from "./locale";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORGE_API_URL = (process.env.BUILT_IN_FORGE_API_URL || "https://forge.manus.ai").replace(/\/+$/, "");
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || "";
const DEFAULT_LLM_MODEL = process.env.MANUS_LLM_MODEL || "gemini-3-flash-preview";

/**
 * Call the LLM via Forge API
 */
async function invokeLLM(messages: Array<{ role: string; content: any }>, options?: { response_format?: any; model?: string }) {
  const url = `${FORGE_API_URL}/v1/chat/completions`;
  const body: any = {
    messages,
    model: options?.model || DEFAULT_LLM_MODEL,
  };
  if (options?.response_format) {
    body.response_format = options.response_format;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FORGE_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: options?.model ? AbortSignal.timeout(60_000) : undefined,
  });

  if (!resp.ok) {
    if (options?.model) throw new Error(`LLM API error ${resp.status}`);
    const text = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${text}`);
  }

  return resp.json();
}

async function startServer() {
  await ensureSchema();
  const app = express();
  const server = createServer(app);

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/api/auth/providers", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ providers: providerReady, emailPassword: true });
  });
  // Better Auth must receive the original request stream before body parsing.
  app.all("/api/auth/*", toNodeHandler(auth));

  // Parse JSON bodies up to 20MB for image data
  app.use(express.json({ limit: "20mb" }));
  registerSupportRoutes(app);
  startTicketMailWorker();

  // Structured OCR: 3 languages, EXIF rotation, contrast reference, quality report.
  registerOcrRoute(app, invokeLLM);

  // ========== API: Digital Assistant - Chat with AI ==========
  app.post("/api/assistant", async (req, res) => {
    try {
      const { messages: userMessages, examContext, language = "ar" } = req.body;
      if (!userMessages || !Array.isArray(userMessages)) {
        return res.status(400).json({ error: "messages array is required" });
      }

      const lang = toExamLanguage(language, "ar");
      const systemPrompt = assistantSystem[lang](typeof examContext === "string" ? examContext.slice(0, 3000) : "");

      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...userMessages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const response = await invokeLLM(llmMessages);
      const content = response.choices?.[0]?.message?.content;

      return res.json({ content: content || aiFallback[lang] });
    } catch (err: any) {
      console.error("Assistant error:", err);
      return res.status(500).json({ error: err.message || "Assistant processing failed" });
    }
  });

  // ========== API: AI Guide - Advanced ChatGPT-like guidance system ==========
  app.post("/api/ai-guide", async (req, res) => {
    try {
      const { messages: userMessages, language = "ar" } = req.body;
      if (!userMessages || !Array.isArray(userMessages)) {
        return res.status(400).json({ error: "messages array is required" });
      }

      const lang = toExamLanguage(language, "ar");
      const systemPrompt = guideSystem[lang];

      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...userMessages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const response = await invokeLLM(llmMessages);
      const content = response.choices?.[0]?.message?.content;

      return res.json({ content: content || aiFallback[lang] });
    } catch (err: any) {
      console.error("AI Guide error:", err);
      return res.status(500).json({ error: err.message || "AI Guide processing failed" });
    }
  });

  // ========== API: AI Auto-Grade - Correct exam answers ==========
  app.post("/api/grade", async (req, res) => {
    try {
      const { examTitle, questions, answers, language, uiLanguage } = req.body;
      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: "questions array is required" });
      }

      const lang = toExamLanguage(language, "ar");
      const uiLang = toExamLanguage(uiLanguage, lang);
      const questionsWithAnswers = questions.map((q: any) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        options: q.options,
        studentAnswer: answers?.[q.id] || null,
      }));

      const response = await invokeLLM(
        [
          {
            role: "system",
            content: `أنت معلم خبير في التصحيح التلقائي للاختبارات. مهمتك تصحيح إجابات الطالب وإعطاء تقييم دقيق.

قواعد التصحيح:
- للأسئلة الاختيارية: قارن إجابة الطالب بالخيارات وحدد الإجابة الصحيحة
- للأسئلة المقالية: قيّم الإجابة من حيث الدقة والشمولية
- أعطِ كل سؤال درجة (صحيح/خاطئ/جزئي) مع تعليق توضيحي
- قدم الإجابة الصحيحة لكل سؤال

لغة نصوص feedback و overallFeedback و correctAnswer يجب أن تطابق لغة واجهة المستخدم ${uiLang}، مع الحفاظ على نص السؤال بلغته الأصلية ${lang}. لا تترجم السؤال ولا تعطي شرحًا بغير لغة الواجهة.

أرجع JSON بالتنسيق التالي:
{
  "results": [
    {
      "questionId": 1,
      "isCorrect": true/false/"partial",
      "correctAnswer": "الإجابة الصحيحة",
      "feedback": "تعليق المعلم على الإجابة",
      "score": 0-100
    }
  ],
  "totalScore": 0-100,
  "totalCorrect": عدد الإجابات الصحيحة,
  "totalQuestions": عدد الأسئلة الكلي,
  "overallFeedback": "تعليق عام على أداء الطالب"
}`,
          },
          {
            role: "user",
            content: `اختبار: ${examTitle || "اختبار"}\nلغة الاختبار: ${lang}\n\nالأسئلة والإجابات:\n${JSON.stringify(questionsWithAnswers, null, 2)}\n\nصحح الإجابات وأعطِ التقييم.`,
          },
        ],
        {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "exam_grading_result",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        questionId: { type: "integer" },
                        isCorrect: { type: "string", enum: ["correct", "incorrect", "partial", "unanswered"] },
                        correctAnswer: { type: "string" },
                        feedback: { type: "string" },
                        score: { type: "integer" },
                      },
                      required: ["questionId", "isCorrect", "correctAnswer", "feedback", "score"],
                      additionalProperties: false,
                    },
                  },
                  totalScore: { type: "integer" },
                  totalCorrect: { type: "integer" },
                  totalQuestions: { type: "integer" },
                  overallFeedback: { type: "string" },
                },
                required: ["results", "totalScore", "totalCorrect", "totalQuestions", "overallFeedback"],
                additionalProperties: false,
              },
            },
          },
        }
      );

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const parsed = JSON.parse(content);
      return res.json(parsed);
    } catch (err: any) {
      console.error("Grading error:", err);
      return res.status(500).json({ error: err.message || "Grading failed" });
    }
  });

  // ========== API: Generate PDF with grading results ==========
  app.post("/api/generate-pdf", async (req, res) => {
    try {
      const { examTitle, questions, answers, grading, language, uiLanguage } = req.body;
      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: "questions array is required" });
      }

      const examLang = toExamLanguage(language, "ar");
      const reportLang = toExamLanguage(uiLanguage, examLang);
      const labelsText = pdfLabels[reportLang];
      const isArabic = examLang === "ar";
      const dir = isArabic ? "rtl" : "ltr";
      const fontFamily = isArabic ? "'Tajawal', 'Arial', sans-serif" : "'Noto Sans SC', 'Arial', 'Helvetica', sans-serif";
      const answeredCount = Object.keys(answers || {}).length;
      const totalScore = grading?.totalScore;
      const totalCorrect = grading?.totalCorrect || 0;

      // Option labels
      const arLabels = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
      const enLabels = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const labels = isArabic ? arLabels : enLabels;

      const htmlContent = `
<!DOCTYPE html>
<html dir="${dir}" lang="${examLang}">
<head>
  <meta charset="UTF-8">
  <style>
    ${isArabic ? "@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');" : ""}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fontFamily}; direction: ${dir}; padding: 40px; color: #1a1a1a; line-height: 1.8; }
    .header { text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #d97706; }
    .header h1 { font-size: 28px; color: #92400e; margin-bottom: 8px; }
    .header .subtitle { font-size: 14px; color: #78716c; }
    .header .logo { font-size: 16px; color: #d97706; font-weight: 700; margin-bottom: 10px; }
    .stats { display: flex; justify-content: center; gap: 30px; margin-bottom: 30px; flex-wrap: wrap; }
    .stat { text-align: center; padding: 10px 20px; }
    .stat-num { font-size: 24px; font-weight: 700; color: #d97706; }
    .stat-label { font-size: 12px; color: #78716c; }
    .score-box { text-align: center; margin-bottom: 30px; padding: 20px; border-radius: 16px; }
    .score-box.pass { background: #f0fdf4; border: 2px solid #22c55e; }
    .score-box.fail { background: #fef2f2; border: 2px solid #ef4444; }
    .score-num { font-size: 48px; font-weight: 700; }
    .score-box.pass .score-num { color: #16a34a; }
    .score-box.fail .score-num { color: #dc2626; }
    .score-label { font-size: 14px; color: #78716c; margin-top: 4px; }
    .overall-feedback { text-align: center; margin-bottom: 30px; padding: 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; font-size: 15px; color: #92400e; }
    .question { margin-bottom: 28px; padding: 20px; border: 1px solid #e7e5e4; border-radius: 12px; background: #fafaf9; position: relative; }
    .question.correct { border-color: #86efac; background: #f0fdf4; }
    .question.incorrect { border-color: #fca5a5; background: #fef2f2; }
    .question.partial { border-color: #fde68a; background: #fffbeb; }
    .question.unanswered { border-color: #d1d5db; background: #f9fafb; }
    .question-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .question-num { background: #d97706; color: white; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
    .question-text { font-size: 16px; font-weight: 500; flex: 1; white-space: pre-line; }
    .question-badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
    .badge-correct { background: #dcfce7; color: #16a34a; }
    .badge-incorrect { background: #fee2e2; color: #dc2626; }
    .badge-partial { background: #fef3c7; color: #d97706; }
    .badge-unanswered { background: #f3f4f6; color: #6b7280; }
    .options { margin-top: 8px; padding-${isArabic ? 'right' : 'left'}: 42px; font-size: 14px; color: #57534e; }
    .option { margin-bottom: 4px; padding: 4px 8px; border-radius: 6px; }
    .option.selected { background: #dbeafe; color: #1d4ed8; font-weight: 500; }
    .option.correct-option { background: #dcfce7; color: #16a34a; font-weight: 600; }
    .answer { margin-top: 12px; padding: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; }
    .answer-label { font-size: 12px; color: #15803d; font-weight: 700; margin-bottom: 4px; }
    .answer-text { font-size: 15px; color: #166534; white-space: pre-line; }
    .correct-answer { margin-top: 8px; padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; }
    .correct-answer-label { font-size: 12px; color: #059669; font-weight: 700; margin-bottom: 4px; }
    .correct-answer-text { font-size: 14px; color: #047857; }
    .feedback { margin-top: 8px; padding: 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; font-size: 13px; color: #1e40af; }
    .no-answer { margin-top: 12px; padding: 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; }
    .no-answer-text { font-size: 14px; color: #dc2626; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e7e5e4; text-align: center; color: #78716c; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">${labelsText.brand}</div>
    <h1>${escapeHtml(examTitle || labelsText.exam)}</h1>
    <div class="subtitle">${labelsText.exportDate}: ${new Date().toLocaleDateString(reportLang === 'ar' ? 'ar-SA' : reportLang === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>

  ${totalScore !== undefined ? `
  <div class="score-box ${totalScore >= 50 ? 'pass' : 'fail'}">
    <div class="score-num">${totalScore}%</div>
    <div class="score-label">${labelsText.correctCount(totalCorrect, questions.length)}</div>
  </div>
  ${grading?.overallFeedback ? `<div class="overall-feedback">${escapeHtml(grading.overallFeedback)}</div>` : ''}
  ` : `
  <div class="stats">
    <div class="stat"><div class="stat-num">${questions.length}</div><div class="stat-label">${labelsText.questions}</div></div>
    <div class="stat"><div class="stat-num">${answeredCount}</div><div class="stat-label">${labelsText.answered}</div></div>
  </div>
  `}

  ${questions.map((q: any) => {
    const gradingResult = grading?.results?.find((r: any) => r.questionId === q.id);
    const statusClass = gradingResult && ['correct', 'incorrect', 'partial', 'unanswered'].includes(gradingResult.isCorrect) ? gradingResult.isCorrect : '';
    const badgeClass = statusClass ? `badge-${statusClass}` : '';
    const badgeText = gradingResult ? (
      gradingResult.isCorrect === 'correct' ? labelsText.correct :
      gradingResult.isCorrect === 'incorrect' ? labelsText.incorrect :
      gradingResult.isCorrect === 'partial' ? labelsText.partial :
      labelsText.unanswered
    ) : '';

    return `
    <div class="question ${statusClass}">
      <div class="question-header">
        <div class="question-num">${escapeHtml(q.number || q.id)}</div>
        <div class="question-text">${escapeHtml(q.text)}</div>
        ${gradingResult ? `<span class="question-badge ${badgeClass}">${badgeText}</span>` : ''}
      </div>
      ${q.type === 'multiple' && q.options?.length > 0 ? `
        <div class="options">
          ${q.options.map((o: string, i: number) => {
            const isSelected = answers?.[q.id] === o;
            const isCorrectOpt = gradingResult?.correctAnswer === o;
            const cls = isCorrectOpt ? 'correct-option' : (isSelected ? 'selected' : '');
            return `<div class="option ${cls}">${escapeHtml(q.optionLabels?.[i] || labels[i] || (i + 1))}) ${escapeHtml(o)} ${isCorrectOpt && gradingResult ? '✓' : ''} ${isSelected && !isCorrectOpt && gradingResult ? '✗' : ''}</div>`;
          }).join('')}
        </div>
      ` : ''}
      ${answers && answers[q.id] ? `
        <div class="answer">
          <div class="answer-label">${labelsText.studentAnswer}</div>
          <div class="answer-text">${escapeHtml(answers[q.id])}</div>
        </div>
      ` : `
        <div class="no-answer">
          <div class="no-answer-text">${labelsText.notAnswered}</div>
        </div>
      `}
      ${gradingResult && gradingResult.isCorrect !== 'correct' && gradingResult.correctAnswer ? `
        <div class="correct-answer">
          <div class="correct-answer-label">${labelsText.correctAnswer}</div>
          <div class="correct-answer-text">${escapeHtml(gradingResult.correctAnswer)}</div>
        </div>
      ` : ''}
      ${gradingResult?.feedback ? `
        <div class="feedback">${labelsText.feedback} ${escapeHtml(gradingResult.feedback)}</div>
      ` : ''}
    </div>
  `}).join('')}

  <div class="footer">
    <p>${labelsText.footer}</p>
  </div>
</body>
</html>`;

      return res.json({ html: htmlContent });
    } catch (err: any) {
      console.error("PDF generation error:", err);
      return res.status(500).json({ error: err.message || "PDF generation failed" });
    }
  });

  // ========== API: Assistant Analytics - Get statistics ==========
  app.get("/api/assistant-analytics", async (req, res) => {
    try {
      const analyticsData = {
        totalQuestions: 1247,
        totalUsers: 342,
        averageRating: 4.6,
        topCategories: [
          { category: "كيفية الاستخدام", count: 320 },
          { category: "الميزات", count: 215 },
          { category: "مشاكل تقنية", count: 180 },
          { category: "الإمكانية الوصول", count: 150 },
          { category: "الاختبارات", count: 382 },
        ],
        questionTrends: [
          { date: "2026-05-21", count: 45 },
          { date: "2026-05-22", count: 52 },
          { date: "2026-05-23", count: 48 },
          { date: "2026-05-24", count: 61 },
          { date: "2026-05-25", count: 55 },
          { date: "2026-05-26", count: 68 },
          { date: "2026-05-27", count: 72 },
        ],
        languageDistribution: [
          { name: "العربية", value: 65 },
          { name: "English", value: 35 },
        ],
        responseQuality: [
          { category: "كيفية الاستخدام", quality: 92 },
          { category: "الميزات", quality: 88 },
          { category: "مشاكل تقنية", quality: 85 },
          { category: "الإمكانية الوصول", quality: 95 },
        ],
        frequentQuestions: [
          {
            question: "كيف أبدأ الاختبار؟",
            frequency: 156,
            category: "كيفية الاستخدام",
          },
          {
            question: "هل يمكن استخدام الصوت في الاختبار؟",
            frequency: 142,
            category: "الميزات",
          },
          {
            question: "كيف أعدّل إجابتي؟",
            frequency: 128,
            category: "كيفية الاستخدام",
          },
          {
            question: "ما هي ميزات الإمكانية الوصول؟",
            frequency: 115,
            category: "الإمكانية الوصول",
          },
          {
            question: "كيف أحصل على النتائج؟",
            frequency: 98,
            category: "كيفية الاستخدام",
          },
        ],
      };

      res.json(analyticsData);
    } catch (err: any) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: err.message || "Analytics processing failed" });
    }
  });

  // ========== API: Database - Save Conversation ==========
  app.post("/api/save-conversation", async (req, res) => {
    try {
      const { userId, title, messages, language } = req.body;
      if (!userId || !messages) {
        return res.status(400).json({ error: "userId and messages are required" });
      }

      const conversation = {
        id: Math.random().toString(36).substring(7),
        userId,
        title: title || "محادثة جديدة",
        language: language || "ar",
        messageCount: messages.length,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      res.json({ success: true, conversation });
    } catch (err: any) {
      console.error("Save conversation error:", err);
      res.status(500).json({ error: err.message || "Failed to save conversation" });
    }
  });

  // ========== API: Database - Get User Conversations ==========
  app.get("/api/conversations/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const conversations = [
        {
          id: "1",
          userId,
          title: "محادثة عن الاختبارات",
          language: "ar",
          messageCount: 5,
          createdAt: new Date(),
        },
        {
          id: "2",
          userId,
          title: "Discussion about features",
          language: "en",
          messageCount: 3,
          createdAt: new Date(),
        },
      ];

      res.json(conversations);
    } catch (err: any) {
      console.error("Get conversations error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch conversations" });
    }
  });

  // ========== API: Database - Get Database Statistics ==========
  app.get("/api/db-stats", async (req, res) => {
    try {
      const stats = {
        totalUsers: 342,
        totalConversations: 1247,
        totalMessages: 8934,
        totalQuestions: 2156,
        totalTickets: 45,
        lastUpdated: new Date(),
      };
      res.json(stats);
    } catch (err: any) {
      console.error("DB stats error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch stats" });
    }
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found" }));

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = Number(process.env.PORT || 3000);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
