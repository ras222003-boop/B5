import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORGE_API_URL = (process.env.BUILT_IN_FORGE_API_URL || "https://forge.manus.ai").replace(/\/+$/, "");
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || "";

/**
 * Call the LLM via Forge API
 */
async function invokeLLM(messages: Array<{ role: string; content: any }>, options?: { response_format?: any }) {
  const url = `${FORGE_API_URL}/v1/chat/completions`;
  const body: any = {
    messages,
    model: "anthropic/claude-sonnet-4-20250514",
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
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${text}`);
  }

  return resp.json();
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Parse JSON bodies up to 20MB for image data
  app.use(express.json({ limit: "20mb" }));

  // ========== API: OCR - Extract questions from exam image ==========
  app.post("/api/ocr", async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: "imageBase64 is required" });
      }

      const response = await invokeLLM(
        [
          {
            role: "system",
            content: `أنت نظام OCR متقدم متخصص في قراءة أوراق الاختبارات بالعربية والإنجليزية.
مهمتك: استخراج جميع الأسئلة من صورة ورقة الاختبار وتنظيمها.
اكتشف لغة الاختبار تلقائياً (عربي أو إنجليزي) وأرجع الأسئلة بنفس اللغة الأصلية.

يجب أن تُرجع JSON بالتنسيق التالي:
{
  "examTitle": "عنوان الاختبار إن وجد",
  "language": "ar" أو "en",
  "questions": [
    {
      "id": 1,
      "text": "نص السؤال",
      "type": "multiple" أو "text",
      "options": ["خيار1", "خيار2", ...] // فقط إذا كان اختيار من متعدد
    }
  ]
}

ملاحظات مهمة:
- إذا كان الاختبار بالعربية، أرجع language: "ar"
- إذا كان بالإنجليزية، أرجع language: "en"
- استخرج الأسئلة بنفس لغتها الأصلية بدقة
- إذا لم تتمكن من قراءة الصورة بوضوح، أرجع ما تستطيع قراءته`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "اقرأ ورقة الاختبار هذه واستخرج جميع الأسئلة منها بدقة. أرجع النتيجة بصيغة JSON فقط.",
              },
              {
                type: "image_url",
                image_url: {
                  url: imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "exam_ocr_result",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  examTitle: { type: "string", description: "عنوان الاختبار" },
                  language: { type: "string", enum: ["ar", "en"], description: "لغة الاختبار" },
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "integer", description: "رقم السؤال" },
                        text: { type: "string", description: "نص السؤال" },
                        type: { type: "string", enum: ["multiple", "text"], description: "نوع السؤال" },
                        options: {
                          type: "array",
                          items: { type: "string" },
                          description: "خيارات الإجابة إذا كان اختيار من متعدد",
                        },
                      },
                      required: ["id", "text", "type", "options"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["examTitle", "language", "questions"],
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
      console.error("OCR error:", err);
      return res.status(500).json({ error: err.message || "OCR processing failed" });
    }
  });

  // ========== API: Digital Assistant - Chat with AI ==========
  app.post("/api/assistant", async (req, res) => {
    try {
      const { messages: userMessages, examContext, language = "ar" } = req.body;
      if (!userMessages || !Array.isArray(userMessages)) {
        return res.status(400).json({ error: "messages array is required" });
      }

      // Build language-specific system prompt for clarity
      const systemPrompt = language === "en" 
        ? `You are an intelligent digital assistant named "Basira Assistant", specialized in helping visually impaired students take their exams.

Your tasks:
- Read questions and explain them clearly
- Help the user understand what each question asks
- Provide general tips without giving direct answers
- Speak in simple, clear English
- Offer encouragement and emotional support
- Guide the user to use platform features

${examContext ? `Current exam context:\n${examContext}` : "No active exam currently."}

Be friendly, encouraging, and concise in your responses. Don't give answers directly, but help the student think through problems. Use short, clear sentences for better text-to-speech clarity.`
        : `أنت مساعد رقمي ذكي اسمه "مساعد بصيرة"، مخصص لمساعدة الأشخاص ذوي الإعاقة البصرية في أداء اختباراتهم.

مهامك:
- قراءة الأسئلة وشرحها بوضوح جداً
- مساعدة المستخدم في فهم المطلوب من كل سؤال
- تقديم نصائح عامة دون إعطاء الإجابات مباشرة
- التحدث بلغة عربية بسيطة وواضحة جداً
- التشجيع والدعم المعنوي
- توجيه المستخدم لاستخدام ميزات المنصة

${examContext ? `سياق الاختبار الحالي:\n${examContext}` : "لا يوجد اختبار نشط حالياً."}

كن ودوداً ومشجعاً ومختصراً في ردودك. استخدم جملاً قصيرة وواضحة لتحسين وضوح قراءة النصوص الصوتية. لا تعطي الإجابات مباشرة بل ساعد الطالب على التفكير.`;

      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...userMessages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const response = await invokeLLM(llmMessages);
      const content = response.choices?.[0]?.message?.content;

      return res.json({ content: content || "عذراً، لم أتمكن من معالجة طلبك. حاول مرة أخرى." });
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

      // Build comprehensive system prompt for AI Guide
      const systemPrompt = language === "en"
        ? `You are an advanced AI guide for Basira platform, working like ChatGPT. Your role is to provide comprehensive, step-by-step guidance about the platform.

Your responsibilities:
1. Explain platform features in detail
2. Provide step-by-step instructions for using the platform
3. Answer technical questions
4. Give practical tips for exam success
5. Explain accessibility features
6. Help troubleshoot issues
7. Provide encouragement and support

Always:
- Use clear, simple language
- Break down complex topics into steps
- Provide examples when helpful
- Be friendly and supportive
- Use short sentences for better text-to-speech clarity
- Format responses with clear structure (headings, bullet points, numbered lists)
- Provide detailed, comprehensive answers

Be thorough and informative, like ChatGPT, providing complete guidance on any topic related to Basira.`
        : `أنت مساعد ذكي متقدم لمنصة بصيرة، تعمل مثل ChatGPT. دورك تقديم إرشادات شاملة وخطوة بخطوة حول المنصة.

مسؤولياتك:
1. شرح مميزات المنصة بالتفصيل
2. تقديم تعليمات خطوة بخطوة لاستخدام المنصة
3. الإجابة على الأسئلة التقنية
4. تقديم نصائح عملية للنجاح في الاختبارات
5. شرح ميزات الإمكانية الوصول
6. مساعدة المستخدم في حل المشاكل
7. تقديم التشجيع والدعم

دائماً:
- استخدم لغة واضحة وبسيطة
- قسّم المواضيع المعقدة إلى خطوات
- قدّم أمثلة عند الحاجة
- كن ودوداً وداعماً
- استخدم جملاً قصيرة وواضحة لتحسين وضوح قراءة النصوص الصوتية
- نسّق الإجابات بشكل واضح (عناوين، نقاط، قوائم مرقمة)
- قدّم إجابات مفصلة وشاملة

كن شاملاً وغنياً بالمعلومات، مثل ChatGPT، مقدماً إرشادات كاملة حول أي موضوع يتعلق ببصيرة.`;

      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...userMessages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const response = await invokeLLM(llmMessages);
      const content = response.choices?.[0]?.message?.content;

      return res.json({ content: content || (language === "ar" ? "عذراً، لم أتمكن من معالجة طلبك. حاول مرة أخرى." : "Sorry, I couldn't process your request. Try again.") });
    } catch (err: any) {
      console.error("AI Guide error:", err);
      return res.status(500).json({ error: err.message || "AI Guide processing failed" });
    }
  });

  // ========== API: AI Auto-Grade - Correct exam answers ==========
  app.post("/api/grade", async (req, res) => {
    try {
      const { examTitle, questions, answers, language } = req.body;
      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: "questions array is required" });
      }

      const lang = language || "ar";
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
      const { examTitle, questions, answers, grading, language } = req.body;
      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: "questions array is required" });
      }

      const isArabic = (language || "ar") === "ar";
      const dir = isArabic ? "rtl" : "ltr";
      const fontFamily = isArabic ? "'Tajawal', 'Arial', sans-serif" : "'Arial', 'Helvetica', sans-serif";
      const answeredCount = Object.keys(answers || {}).length;
      const totalScore = grading?.totalScore;
      const totalCorrect = grading?.totalCorrect || 0;

      // Option labels
      const arLabels = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
      const enLabels = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const labels = isArabic ? arLabels : enLabels;

      const htmlContent = `
<!DOCTYPE html>
<html dir="${dir}" lang="${isArabic ? 'ar' : 'en'}">
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
    .question-text { font-size: 16px; font-weight: 500; flex: 1; }
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
    .answer-text { font-size: 15px; color: #166534; }
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
    <div class="logo">${isArabic ? 'بصيرة - منصة الاختبارات الذكية' : 'Basira - Smart Exam Platform'}</div>
    <h1>${examTitle || (isArabic ? 'اختبار' : 'Exam')}</h1>
    <div class="subtitle">${isArabic ? 'تاريخ التصدير' : 'Export Date'}: ${new Date().toLocaleDateString(isArabic ? 'ar-SA' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>

  ${totalScore !== undefined ? `
  <div class="score-box ${totalScore >= 50 ? 'pass' : 'fail'}">
    <div class="score-num">${totalScore}%</div>
    <div class="score-label">${isArabic ? `${totalCorrect} من ${questions.length} إجابة صحيحة` : `${totalCorrect} of ${questions.length} correct`}</div>
  </div>
  ${grading?.overallFeedback ? `<div class="overall-feedback">${grading.overallFeedback}</div>` : ''}
  ` : `
  <div class="stats">
    <div class="stat"><div class="stat-num">${questions.length}</div><div class="stat-label">${isArabic ? 'عدد الأسئلة' : 'Questions'}</div></div>
    <div class="stat"><div class="stat-num">${answeredCount}</div><div class="stat-label">${isArabic ? 'تمت الإجابة' : 'Answered'}</div></div>
  </div>
  `}

  ${questions.map((q: any) => {
    const gradingResult = grading?.results?.find((r: any) => r.questionId === q.id);
    const statusClass = gradingResult ? gradingResult.isCorrect : '';
    const badgeClass = gradingResult ? `badge-${gradingResult.isCorrect}` : '';
    const badgeText = gradingResult ? (
      gradingResult.isCorrect === 'correct' ? (isArabic ? 'صحيح ✓' : 'Correct ✓') :
      gradingResult.isCorrect === 'incorrect' ? (isArabic ? 'خاطئ ✗' : 'Incorrect ✗') :
      gradingResult.isCorrect === 'partial' ? (isArabic ? 'جزئي ~' : 'Partial ~') :
      (isArabic ? 'لم يُجب' : 'Unanswered')
    ) : '';

    return `
    <div class="question ${statusClass}">
      <div class="question-header">
        <div class="question-num">${q.id}</div>
        <div class="question-text">${q.text}</div>
        ${gradingResult ? `<span class="question-badge ${badgeClass}">${badgeText}</span>` : ''}
      </div>
      ${q.type === 'multiple' && q.options?.length > 0 ? `
        <div class="options">
          ${q.options.map((o: string, i: number) => {
            const isSelected = answers?.[q.id] === o;
            const isCorrectOpt = gradingResult?.correctAnswer === o;
            const cls = isCorrectOpt ? 'correct-option' : (isSelected ? 'selected' : '');
            return `<div class="option ${cls}">${labels[i] || (i + 1)}) ${o} ${isCorrectOpt && gradingResult ? '✓' : ''} ${isSelected && !isCorrectOpt && gradingResult ? '✗' : ''}</div>`;
          }).join('')}
        </div>
      ` : ''}
      ${answers && answers[q.id] ? `
        <div class="answer">
          <div class="answer-label">${isArabic ? 'إجابة الطالب:' : 'Student Answer:'}</div>
          <div class="answer-text">${answers[q.id]}</div>
        </div>
      ` : `
        <div class="no-answer">
          <div class="no-answer-text">${isArabic ? 'لم يتم الإجابة' : 'Not answered'}</div>
        </div>
      `}
      ${gradingResult && gradingResult.isCorrect !== 'correct' && gradingResult.correctAnswer ? `
        <div class="correct-answer">
          <div class="correct-answer-label">${isArabic ? 'الإجابة الصحيحة:' : 'Correct Answer:'}</div>
          <div class="correct-answer-text">${gradingResult.correctAnswer}</div>
        </div>
      ` : ''}
      ${gradingResult?.feedback ? `
        <div class="feedback">${isArabic ? 'تعليق المعلم:' : 'Teacher Feedback:'} ${gradingResult.feedback}</div>
      ` : ''}
    </div>
  `}).join('')}

  <div class="footer">
    <p>${isArabic ? 'تم إنشاء هذا الملف بواسطة منصة بصيرة - الاختبارات الذكية لذوي الإعاقة البصرية' : 'Generated by Basira - Smart Exam Platform for Visually Impaired'}</p>
  </div>
</body>
</html>`;

      return res.json({ html: htmlContent });
    } catch (err: any) {
      console.error("PDF generation error:", err);
      return res.status(500).json({ error: err.message || "PDF generation failed" });
    }
  });

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

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
