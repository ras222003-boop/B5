/**
 * Vite middleware plugin that handles /api/* requests during development.
 * In production, the Express server handles these directly.
 * During dev, we proxy them to the Forge API.
 */
import type { Plugin, ViteDevServer } from "vite";

const FORGE_API_URL = (process.env.BUILT_IN_FORGE_API_URL || "https://forge.manus.ai").replace(/\/+$/, "");
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || "";

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

function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // If body was already parsed by another middleware
    if (req.body && typeof req.body === "object") {
      return resolve(req.body);
    }
    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function vitePluginApiProxy(): Plugin {
  return {
    name: "manus-api-proxy",
    configureServer(server: ViteDevServer) {
      // OCR endpoint
      server.middlewares.use("/api/ocr", async (req: any, res: any) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const body = await parseBody(req);
          const { imageBase64 } = body;

          if (!imageBase64) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "imageBase64 is required" }));
            return;
          }

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
      "options": ["خيار1", "خيار2", ...] // فقط إذا كان اختيار من متعدد، وإلا مصفوفة فارغة
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
                              description: "خيارات الإجابة",
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
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No response from AI" }));
            return;
          }

          const parsed = JSON.parse(content);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(parsed));
        } catch (err: any) {
          console.error("OCR error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "OCR processing failed" }));
        }
      });

      // PDF generation endpoint
      server.middlewares.use("/api/generate-pdf", async (req: any, res: any) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const body = await parseBody(req);
          const { examTitle, questions, answers } = body;

          if (!questions || !Array.isArray(questions)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "questions array is required" }));
            return;
          }

          const htmlContent = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Tajawal','Arial',sans-serif;direction:rtl;padding:40px;color:#1a1a1a;line-height:1.8;}.header{text-align:center;margin-bottom:40px;padding-bottom:20px;border-bottom:3px solid #d97706;}.header h1{font-size:28px;color:#92400e;margin-bottom:8px;}.header .subtitle{font-size:14px;color:#78716c;}.header .logo{font-size:16px;color:#d97706;font-weight:700;margin-bottom:10px;}.question{margin-bottom:28px;padding:20px;border:1px solid #e7e5e4;border-radius:12px;background:#fafaf9;}.question-header{display:flex;align-items:center;gap:10px;margin-bottom:12px;}.question-num{background:#d97706;color:white;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;}.question-text{font-size:16px;font-weight:500;}.answer{margin-top:12px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;}.answer-label{font-size:12px;color:#15803d;font-weight:700;margin-bottom:4px;}.answer-text{font-size:15px;color:#166534;}.no-answer{margin-top:12px;padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;}.no-answer-text{font-size:14px;color:#dc2626;}.footer{margin-top:40px;padding-top:20px;border-top:2px solid #e7e5e4;text-align:center;color:#78716c;font-size:12px;}.stats{display:flex;justify-content:center;gap:30px;margin-bottom:30px;}.stat{text-align:center;}.stat-num{font-size:24px;font-weight:700;color:#d97706;}.stat-label{font-size:12px;color:#78716c;}</style></head><body><div class="header"><div class="logo">بصيرة - منصة الاختبارات الذكية</div><h1>${examTitle || 'اختبار'}</h1><div class="subtitle">تاريخ التصدير: ${new Date().toLocaleDateString('ar-SA')}</div></div><div class="stats"><div class="stat"><div class="stat-num">${questions.length}</div><div class="stat-label">عدد الأسئلة</div></div><div class="stat"><div class="stat-num">${Object.keys(answers || {}).length}</div><div class="stat-label">تمت الإجابة</div></div></div>${questions.map((q: any) => `<div class="question"><div class="question-header"><div class="question-num">${q.id}</div><div class="question-text">${q.text}</div></div>${q.type === 'multiple' && q.options?.length > 0 ? `<div style="margin-top:8px;padding-right:42px;font-size:14px;color:#57534e;">${q.options.map((o: string, i: number) => `<div style="margin-bottom:4px;">${String.fromCharCode(1571 + i)}) ${o}</div>`).join('')}</div>` : ''}${answers && answers[q.id] ? `<div class="answer"><div class="answer-label">الإجابة:</div><div class="answer-text">${answers[q.id]}</div></div>` : `<div class="no-answer"><div class="no-answer-text">لم يتم الإجابة</div></div>`}</div>`).join('')}<div class="footer"><p>تم إنشاء هذا الملف بواسطة منصة بصيرة</p></div></body></html>`;

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ html: htmlContent }));
        } catch (err: any) {
          console.error("PDF generation error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "PDF generation failed" }));
        }
      });

      // Assistant endpoint
      server.middlewares.use("/api/assistant", async (req: any, res: any) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const body = await parseBody(req);
          const { messages: userMessages, examContext } = body;

          if (!userMessages || !Array.isArray(userMessages)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "messages array is required" }));
            return;
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

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ content: content || "عذراً، لم أتمكن من معالجة طلبك. حاول مرة أخرى." }));
        } catch (err: any) {
          console.error("Assistant error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Assistant processing failed" }));
        }
      });
    },
  };
}
