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

      // Use LLM with vision to extract questions
      const response = await invokeLLM(
        [
          {
            role: "system",
            content: `أنت نظام OCR متقدم متخصص في قراءة أوراق الاختبارات العربية. 
مهمتك: استخراج جميع الأسئلة من صورة ورقة الاختبار وتنظيمها.

يجب أن تُرجع JSON بالتنسيق التالي:
{
  "examTitle": "عنوان الاختبار إن وجد",
  "questions": [
    {
      "id": 1,
      "text": "نص السؤال",
      "type": "multiple" أو "text",
      "options": ["خيار1", "خيار2", ...] // فقط إذا كان اختيار من متعدد
    }
  ]
}

إذا لم تتمكن من قراءة الصورة بوضوح، أرجع ما تستطيع قراءته مع ملاحظة.
تأكد من استخراج جميع الأسئلة بدقة.`,
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
                required: ["examTitle", "questions"],
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
      const { messages: userMessages, examContext } = req.body;
      if (!userMessages || !Array.isArray(userMessages)) {
        return res.status(400).json({ error: "messages array is required" });
      }

      const systemPrompt = `أنت مساعد رقمي ذكي اسمه "مساعد بصيرة"، مخصص لمساعدة الأشخاص ذوي الإعاقة البصرية في أداء اختباراتهم.

مهامك:
- قراءة الأسئلة وشرحها بوضوح
- مساعدة المستخدم في فهم المطلوب من كل سؤال
- تقديم نصائح عامة دون إعطاء الإجابات مباشرة
- التحدث بلغة عربية بسيطة وواضحة
- التشجيع والدعم المعنوي

${examContext ? `سياق الاختبار الحالي:\n${examContext}` : "لا يوجد اختبار نشط حالياً."}

كن ودوداً ومشجعاً ومختصراً في ردودك. لا تعطي الإجابات مباشرة بل ساعد الطالب على التفكير.`;

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

  // ========== API: Generate PDF ==========
  app.post("/api/generate-pdf", async (req, res) => {
    try {
      const { examTitle, questions, answers } = req.body;
      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: "questions array is required" });
      }

      // Generate HTML for the PDF
      const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Tajawal', 'Arial', sans-serif; direction: rtl; padding: 40px; color: #1a1a1a; line-height: 1.8; }
    .header { text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #d97706; }
    .header h1 { font-size: 28px; color: #92400e; margin-bottom: 8px; }
    .header .subtitle { font-size: 14px; color: #78716c; }
    .header .logo { font-size: 16px; color: #d97706; font-weight: 700; margin-bottom: 10px; }
    .question { margin-bottom: 28px; padding: 20px; border: 1px solid #e7e5e4; border-radius: 12px; background: #fafaf9; }
    .question-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .question-num { background: #d97706; color: white; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
    .question-text { font-size: 16px; font-weight: 500; }
    .answer { margin-top: 12px; padding: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; }
    .answer-label { font-size: 12px; color: #15803d; font-weight: 700; margin-bottom: 4px; }
    .answer-text { font-size: 15px; color: #166534; }
    .no-answer { margin-top: 12px; padding: 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; }
    .no-answer-text { font-size: 14px; color: #dc2626; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e7e5e4; text-align: center; color: #78716c; font-size: 12px; }
    .stats { display: flex; justify-content: center; gap: 30px; margin-bottom: 30px; }
    .stat { text-align: center; }
    .stat-num { font-size: 24px; font-weight: 700; color: #d97706; }
    .stat-label { font-size: 12px; color: #78716c; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">\u0628\u0635\u064A\u0631\u0629 - \u0645\u0646\u0635\u0629 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0627\u0644\u0630\u0643\u064A\u0629</div>
    <h1>${examTitle || '\u0627\u062E\u062A\u0628\u0627\u0631'}</h1>
    <div class="subtitle">\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0635\u062F\u064A\u0631: ${new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${questions.length}</div><div class="stat-label">\u0639\u062F\u062F \u0627\u0644\u0623\u0633\u0626\u0644\u0629</div></div>
    <div class="stat"><div class="stat-num">${Object.keys(answers || {}).length}</div><div class="stat-label">\u062A\u0645\u062A \u0627\u0644\u0625\u062C\u0627\u0628\u0629</div></div>
  </div>
  ${questions.map((q: any) => `
    <div class="question">
      <div class="question-header">
        <div class="question-num">${q.id}</div>
        <div class="question-text">${q.text}</div>
      </div>
      ${q.type === 'multiple' && q.options?.length > 0 ? `<div style="margin-top:8px;padding-right:42px;font-size:14px;color:#57534e;">${q.options.map((o: string, i: number) => `<div style="margin-bottom:4px;">${String.fromCharCode(1571 + i)}) ${o}</div>`).join('')}</div>` : ''}
      ${answers && answers[q.id] ? `<div class="answer"><div class="answer-label">\u0627\u0644\u0625\u062C\u0627\u0628\u0629:</div><div class="answer-text">${answers[q.id]}</div></div>` : `<div class="no-answer"><div class="no-answer-text">\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0625\u062C\u0627\u0628\u0629</div></div>`}
    </div>
  `).join('')}
  <div class="footer">
    <p>\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0628\u0648\u0627\u0633\u0637\u0629 \u0645\u0646\u0635\u0629 \u0628\u0635\u064A\u0631\u0629 - \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0627\u0644\u0630\u0643\u064A\u0629 \u0644\u0630\u0648\u064A \u0627\u0644\u0625\u0639\u0627\u0642\u0629 \u0627\u0644\u0628\u0635\u0631\u064A\u0629</p>
  </div>
</body>
</html>`;

      // Return HTML that the client can use to generate PDF
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
