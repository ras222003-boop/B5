/**
 * Vite middleware plugin that handles /api/* requests during development.
 * In production, the Express server handles these directly.
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
                content: `أنت نظام OCR متقدم متخصص في قراءة أوراق الاختبارات بالعربية والإنجليزية.
مهمتك: استخراج جميع الأسئلة من صورة ورقة الاختبار وتنظيمها.
اكتشف لغة الاختبار تلقائياً وأرجع الأسئلة بنفس اللغة الأصلية.

يجب أن تُرجع JSON بالتنسيق التالي:
{
  "examTitle": "عنوان الاختبار",
  "language": "ar" أو "en",
  "questions": [
    {
      "id": 1,
      "text": "نص السؤال",
      "type": "multiple" أو "text",
      "options": ["خيار1", "خيار2", ...] // فقط إذا كان اختيار من متعدد
    }
  ]
}`,
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
                      examTitle: { type: "string" },
                      language: { type: "string", enum: ["ar", "en"] },
                      questions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "integer" },
                            text: { type: "string" },
                            type: { type: "string", enum: ["multiple", "text"] },
                            options: { type: "array", items: { type: "string" } },
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
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No response from AI" }));
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(content);
        } catch (err: any) {
          console.error("OCR error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "OCR processing failed" }));
        }
      });

      // Grade endpoint
      server.middlewares.use("/api/grade", async (req: any, res: any) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const body = await parseBody(req);
          const { examTitle, questions, answers, language } = body;

          if (!questions || !Array.isArray(questions)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "questions array is required" }));
            return;
          }

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
- قدم الإجابة الصحيحة لكل سؤال`,
              },
              {
                role: "user",
                content: `اختبار: ${examTitle || "اختبار"}\nلغة الاختبار: ${language || "ar"}\n\nالأسئلة والإجابات:\n${JSON.stringify(questionsWithAnswers, null, 2)}\n\nصحح الإجابات وأعطِ التقييم.`,
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
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No response from AI" }));
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(content);
        } catch (err: any) {
          console.error("Grading error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Grading failed" }));
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
          // Just proxy to the same logic as production - simple HTML generation
          const { examTitle, questions, answers, grading, language } = body;

          if (!questions || !Array.isArray(questions)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "questions array is required" }));
            return;
          }

          const isArabic = (language || "ar") === "ar";
          const dir = isArabic ? "rtl" : "ltr";
          const answeredCount = Object.keys(answers || {}).length;
          const totalScore = grading?.totalScore;
          const totalCorrect = grading?.totalCorrect || 0;
          const arLabels = ["\u0623", "\u0628", "\u062c", "\u062f", "\u0647\u0640", "\u0648", "\u0632", "\u062d"];
          const enLabels = ["a", "b", "c", "d", "e", "f", "g", "h"];
          const labels = isArabic ? arLabels : enLabels;

          const htmlContent = `<!DOCTYPE html><html dir="${dir}" lang="${isArabic ? 'ar' : 'en'}"><head><meta charset="UTF-8"><style>${isArabic ? "@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');" : ""}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:${isArabic ? "'Tajawal','Arial'" : "'Arial','Helvetica'"},sans-serif;direction:${dir};padding:40px;color:#1a1a1a;line-height:1.8;}.header{text-align:center;margin-bottom:40px;padding-bottom:20px;border-bottom:3px solid #d97706;}.header h1{font-size:28px;color:#92400e;margin-bottom:8px;}.header .subtitle{font-size:14px;color:#78716c;}.header .logo{font-size:16px;color:#d97706;font-weight:700;margin-bottom:10px;}.stats{display:flex;justify-content:center;gap:30px;margin-bottom:30px;}.stat{text-align:center;}.stat-num{font-size:24px;font-weight:700;color:#d97706;}.stat-label{font-size:12px;color:#78716c;}.score-box{text-align:center;margin-bottom:30px;padding:20px;border-radius:16px;}.score-box.pass{background:#f0fdf4;border:2px solid #22c55e;}.score-box.fail{background:#fef2f2;border:2px solid #ef4444;}.score-num{font-size:48px;font-weight:700;}.score-box.pass .score-num{color:#16a34a;}.score-box.fail .score-num{color:#dc2626;}.score-label{font-size:14px;color:#78716c;margin-top:4px;}.overall-feedback{text-align:center;margin-bottom:30px;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;font-size:15px;color:#92400e;}.question{margin-bottom:28px;padding:20px;border:1px solid #e7e5e4;border-radius:12px;background:#fafaf9;}.question.correct{border-color:#86efac;background:#f0fdf4;}.question.incorrect{border-color:#fca5a5;background:#fef2f2;}.question.partial{border-color:#fde68a;background:#fffbeb;}.question-header{display:flex;align-items:center;gap:10px;margin-bottom:12px;}.question-num{background:#d97706;color:white;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;}.question-text{font-size:16px;font-weight:500;flex:1;}.badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;}.badge-correct{background:#dcfce7;color:#16a34a;}.badge-incorrect{background:#fee2e2;color:#dc2626;}.badge-partial{background:#fef3c7;color:#d97706;}.badge-unanswered{background:#f3f4f6;color:#6b7280;}.answer{margin-top:12px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;}.answer-label{font-size:12px;color:#15803d;font-weight:700;margin-bottom:4px;}.answer-text{font-size:15px;color:#166534;}.correct-answer{margin-top:8px;padding:12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;}.correct-answer-label{font-size:12px;color:#059669;font-weight:700;margin-bottom:4px;}.correct-answer-text{font-size:14px;color:#047857;}.feedback{margin-top:8px;padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;color:#1e40af;}.no-answer{margin-top:12px;padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;}.no-answer-text{font-size:14px;color:#dc2626;}.footer{margin-top:40px;padding-top:20px;border-top:2px solid #e7e5e4;text-align:center;color:#78716c;font-size:12px;}</style></head><body><div class="header"><div class="logo">${isArabic ? '\u0628\u0635\u064a\u0631\u0629 - \u0645\u0646\u0635\u0629 \u0627\u0644\u0627\u062e\u062a\u0628\u0627\u0631\u0627\u062a \u0627\u0644\u0630\u0643\u064a\u0629' : 'Basira - Smart Exam Platform'}</div><h1>${examTitle || (isArabic ? '\u0627\u062e\u062a\u0628\u0627\u0631' : 'Exam')}</h1><div class="subtitle">${new Date().toLocaleDateString(isArabic ? 'ar-SA' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div></div>${totalScore !== undefined ? `<div class="score-box ${totalScore >= 50 ? 'pass' : 'fail'}"><div class="score-num">${totalScore}%</div><div class="score-label">${isArabic ? `${totalCorrect} \u0645\u0646 ${questions.length} \u0625\u062c\u0627\u0628\u0629 \u0635\u062d\u064a\u062d\u0629` : `${totalCorrect} of ${questions.length} correct`}</div></div>${grading?.overallFeedback ? `<div class="overall-feedback">${grading.overallFeedback}</div>` : ''}` : `<div class="stats"><div class="stat"><div class="stat-num">${questions.length}</div><div class="stat-label">${isArabic ? '\u0639\u062f\u062f \u0627\u0644\u0623\u0633\u0626\u0644\u0629' : 'Questions'}</div></div><div class="stat"><div class="stat-num">${answeredCount}</div><div class="stat-label">${isArabic ? '\u062a\u0645\u062a \u0627\u0644\u0625\u062c\u0627\u0628\u0629' : 'Answered'}</div></div></div>`}${questions.map((q: any) => { const gr = grading?.results?.find((r: any) => r.questionId === q.id); const sc = gr?.isCorrect || ''; const bt = gr ? (gr.isCorrect === 'correct' ? (isArabic ? '\u0635\u062d\u064a\u062d \u2713' : 'Correct \u2713') : gr.isCorrect === 'incorrect' ? (isArabic ? '\u062e\u0627\u0637\u0626 \u2717' : 'Incorrect \u2717') : gr.isCorrect === 'partial' ? (isArabic ? '\u062c\u0632\u0626\u064a ~' : 'Partial ~') : (isArabic ? '\u0644\u0645 \u064a\u064f\u062c\u0628' : 'Unanswered')) : ''; return `<div class="question ${sc}"><div class="question-header"><div class="question-num">${q.id}</div><div class="question-text">${q.text}</div>${gr ? `<span class="badge badge-${gr.isCorrect}">${bt}</span>` : ''}</div>${q.type === 'multiple' && q.options?.length > 0 ? `<div style="margin-top:8px;padding-${isArabic ? 'right' : 'left'}:42px;font-size:14px;color:#57534e;">${q.options.map((o: string, i: number) => { const isSel = answers?.[q.id] === o; const isCor = gr?.correctAnswer === o; return `<div style="margin-bottom:4px;padding:4px 8px;border-radius:6px;${isCor && gr ? 'background:#dcfce7;color:#16a34a;font-weight:600;' : isSel ? 'background:#dbeafe;color:#1d4ed8;' : ''}">${labels[i] || (i+1)}) ${o} ${isCor && gr ? '\u2713' : ''} ${isSel && !isCor && gr ? '\u2717' : ''}</div>`; }).join('')}</div>` : ''}${answers && answers[q.id] ? `<div class="answer"><div class="answer-label">${isArabic ? '\u0625\u062c\u0627\u0628\u0629 \u0627\u0644\u0637\u0627\u0644\u0628:' : 'Student Answer:'}</div><div class="answer-text">${answers[q.id]}</div></div>` : `<div class="no-answer"><div class="no-answer-text">${isArabic ? '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0625\u062c\u0627\u0628\u0629' : 'Not answered'}</div></div>`}${gr && gr.isCorrect !== 'correct' && gr.correctAnswer ? `<div class="correct-answer"><div class="correct-answer-label">${isArabic ? '\u0627\u0644\u0625\u062c\u0627\u0628\u0629 \u0627\u0644\u0635\u062d\u064a\u062d\u0629:' : 'Correct Answer:'}</div><div class="correct-answer-text">${gr.correctAnswer}</div></div>` : ''}${gr?.feedback ? `<div class="feedback">${isArabic ? '\u062a\u0639\u0644\u064a\u0642 \u0627\u0644\u0645\u0639\u0644\u0645:' : 'Feedback:'} ${gr.feedback}</div>` : ''}</div>`; }).join('')}<div class="footer"><p>${isArabic ? '\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0628\u0648\u0627\u0633\u0637\u0629 \u0645\u0646\u0635\u0629 \u0628\u0635\u064a\u0631\u0629' : 'Generated by Basira Platform'}</p></div></body></html>`;

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
- التحدث بلغة عربية أو إنجليزية بسيطة وواضحة حسب لغة المستخدم
- التشجيع والدعم المعنوي
- توجيه المستخدم لاستخدام ميزات المنصة

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
