import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Express, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { jsPDF } from "jspdf";
import type { RowDataPacket } from "mysql2";
import nodemailer from "nodemailer";
import { auth, pool } from "./auth";
import { toExamLanguage, type ExamLanguage } from "../shared/ocr";

type DeliveryStatus = "pending" | "sent" | "failed" | "uncertain" | "not_configured";
type Question = {
  id: number;
  number?: string | number;
  text: string;
  type?: "multiple" | "text";
  options?: string[];
  optionLabels?: string[];
};
type GradingResult = {
  questionId: number;
  isCorrect: "correct" | "incorrect" | "partial" | "unanswered";
  correctAnswer?: string;
  feedback?: string;
};
type Grading = {
  totalScore?: number;
  totalCorrect?: number;
  results?: GradingResult[];
  overallFeedback?: string;
};
type DeliveryPayload = {
  examTitle: string;
  questions: Question[];
  answers: Record<string, string>;
  grading?: Grading;
  language: ExamLanguage;
  uiLanguage: ExamLanguage;
};
type SettingsRow = RowDataPacket & { teacher_email: string };
type DeliveryRow = RowDataPacket & { delivery_status: DeliveryStatus };

const SMTP_READY = Boolean(
  process.env.SUPPORT_SMTP_HOST &&
  process.env.SUPPORT_SMTP_USER &&
  process.env.SUPPORT_SMTP_PASSWORD &&
  process.env.SUPPORT_EMAIL_FROM,
);
const fontPath = resolve(process.cwd(), "server/assets/NotoSansArabic-Regular.ttf");
let fontBase64: Promise<string> | undefined;
const windows = new Map<string, { count: number; endsAt: number }>();

const copy: Record<ExamLanguage, {
  report: string;
  date: string;
  score: string;
  correct: string;
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  feedback: string;
  unanswered: string;
  emailSubject: (title: string) => string;
  emailText: (title: string) => string;
}> = {
  ar: {
    report: "تقرير اختبار بصيرة",
    date: "تاريخ التصدير",
    score: "النتيجة",
    correct: "الإجابات الصحيحة",
    question: "السؤال",
    studentAnswer: "إجابة الطالب",
    correctAnswer: "الإجابة الصحيحة",
    feedback: "ملاحظة التصحيح",
    unanswered: "لم تتم الإجابة",
    emailSubject: (title) => `بصيرة | تقرير الاختبار: ${title}`,
    emailText: (title) => `مرفق تقرير PDF للاختبار: ${title}.`,
  },
  en: {
    report: "Basira exam report",
    date: "Export date",
    score: "Score",
    correct: "Correct answers",
    question: "Question",
    studentAnswer: "Student answer",
    correctAnswer: "Correct answer",
    feedback: "Grading feedback",
    unanswered: "Not answered",
    emailSubject: (title) => `Basira | Exam report: ${title}`,
    emailText: (title) => `A PDF report is attached for the exam: ${title}.`,
  },
  "zh-CN": {
    report: "Basira 考试报告",
    date: "导出日期",
    score: "得分",
    correct: "答对题数",
    question: "题目",
    studentAnswer: "学生答案",
    correctAnswer: "正确答案",
    feedback: "评分说明",
    unanswered: "未作答",
    emailSubject: (title) => `Basira | 考试报告：${title}`,
    emailText: (title) => `已附上考试“${title}”的 PDF 报告。`,
  },
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max + 1) : "";
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function limited(req: Request, userId: string): boolean {
  const key = `${userId}:${req.ip}:exam-delivery`;
  const now = Date.now();
  const bucket = windows.get(key);
  if (!bucket || bucket.endsAt < now) {
    windows.set(key, { count: 1, endsAt: now + 60 * 60_000 });
    if (windows.size > 3000) {
      windows.forEach((item, id) => {
        if (item.endsAt < now) windows.delete(id);
      });
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > 6;
}

function sanitizeQuestions(value: unknown): Question[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 80) return null;
  const questions: Question[] = [];
  for (const candidate of value) {
    const raw = candidate as Record<string, unknown> | null;
    const id = Number(raw?.id);
    const questionText = text(raw?.text, 1800);
    if (!Number.isInteger(id) || id < 1 || id > 1_000_000 || !questionText || questionText.length > 1800) return null;
    const options = Array.isArray(raw?.options)
      ? raw.options.map(option => text(option, 500)).filter(option => option.length > 0).slice(0, 12)
      : [];
    const optionLabels = Array.isArray(raw?.optionLabels)
      ? raw.optionLabels.map(label => text(label, 20)).slice(0, options.length)
      : [];
    questions.push({
      id,
      number: text(raw?.number, 20) || id,
      text: questionText,
      type: raw?.type === "multiple" ? "multiple" : "text",
      options,
      optionLabels,
    });
  }
  return questions;
}

function sanitizeAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    if (/^\d{1,7}$/.test(questionId)) {
      const normalized = text(answer, 3000);
      if (normalized && normalized.length <= 3000) answers[questionId] = normalized;
    }
  }
  return answers;
}

function sanitizeGrading(value: unknown): Grading | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const score = Number(raw.totalScore);
  const totalCorrect = Number(raw.totalCorrect);
  const results = Array.isArray(raw.results)
    ? raw.results.slice(0, 80).flatMap((result): GradingResult[] => {
      const item = result as Record<string, unknown> | null;
      const questionId = Number(item?.questionId);
      const status = item?.isCorrect;
      if (!Number.isInteger(questionId) || !["correct", "incorrect", "partial", "unanswered"].includes(String(status))) return [];
      return [{
        questionId,
        isCorrect: status as GradingResult["isCorrect"],
        correctAnswer: text(item?.correctAnswer, 1000),
        feedback: text(item?.feedback, 1500),
      }];
    })
    : [];
  return {
    ...(Number.isFinite(score) && score >= 0 && score <= 100 ? { totalScore: Math.round(score) } : {}),
    ...(Number.isFinite(totalCorrect) && totalCorrect >= 0 ? { totalCorrect: Math.round(totalCorrect) } : {}),
    results,
    overallFeedback: text(raw.overallFeedback, 2000),
  };
}

function sanitizePayload(body: unknown): DeliveryPayload | null {
  const raw = body as Record<string, unknown> | null;
  const questions = sanitizeQuestions(raw?.questions);
  if (!questions) return null;
  const language = toExamLanguage(raw?.language, "ar");
  return {
    examTitle: text(raw?.examTitle, 180) || copy[language].report,
    questions,
    answers: sanitizeAnswers(raw?.answers),
    grading: sanitizeGrading(raw?.grading),
    language,
    uiLanguage: toExamLanguage(raw?.uiLanguage, language),
  };
}

async function loadFontBase64(): Promise<string> {
  fontBase64 ??= readFile(fontPath).then(font => font.toString("base64"));
  return fontBase64;
}

function ensurePage(doc: jsPDF, y: number): number {
  if (y <= 760) return y;
  doc.addPage();
  return 54;
}

function paragraph(doc: jsPDF, value: string, y: number, rtl: boolean, size = 10, emphasis = false): number {
  const margin = 48;
  const width = 595 - margin * 2;
  doc.setFontSize(size);
  doc.setFont("NotoArabic", emphasis ? "bold" : "normal");
  const lines = doc.splitTextToSize(value, width) as string[];
  y = ensurePage(doc, y + lines.length * (size + 5));
  doc.text(lines, rtl ? 595 - margin : margin, y, { align: rtl ? "right" : "left", baseline: "top" });
  return y + lines.length * (size + 5) + 8;
}

async function createReportPdf(payload: DeliveryPayload): Promise<Buffer> {
  const reportCopy = copy[payload.uiLanguage];
  const rtl = payload.language === "ar";
  const font = await loadFontBase64();
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS("NotoSansArabic-Regular.ttf", font);
  doc.addFont("NotoSansArabic-Regular.ttf", "NotoArabic", "normal");
  doc.addFont("NotoSansArabic-Regular.ttf", "NotoArabic", "bold");
  doc.setTextColor(41, 37, 36);

  let y = 54;
  doc.setTextColor(180, 83, 9);
  y = paragraph(doc, reportCopy.report, y, rtl, 20, true);
  doc.setTextColor(87, 83, 78);
  y = paragraph(doc, `${reportCopy.date}: ${new Date().toLocaleDateString(payload.uiLanguage === "ar" ? "ar-SA" : payload.uiLanguage === "zh-CN" ? "zh-CN" : "en-US")}`, y, rtl, 9);
  doc.setTextColor(41, 37, 36);
  y = paragraph(doc, payload.examTitle, y + 8, rtl, 16, true);

  if (payload.grading?.totalScore !== undefined) {
    const correct = payload.grading.totalCorrect ?? 0;
    y = paragraph(doc, `${reportCopy.score}: ${payload.grading.totalScore}%  •  ${reportCopy.correct}: ${correct}/${payload.questions.length}`, y + 8, rtl, 11, true);
    if (payload.grading.overallFeedback) y = paragraph(doc, payload.grading.overallFeedback, y, rtl, 10);
  }

  for (const question of payload.questions) {
    const result = payload.grading?.results?.find(item => item.questionId === question.id);
    y = paragraph(doc, `${reportCopy.question} ${question.number ?? question.id}: ${question.text}`, y + 10, rtl, 11, true);
    const answer = payload.answers[String(question.id)] || reportCopy.unanswered;
    y = paragraph(doc, `${reportCopy.studentAnswer}: ${answer}`, y, rtl, 10);
    if (result?.correctAnswer && result.isCorrect !== "correct") y = paragraph(doc, `${reportCopy.correctAnswer}: ${result.correctAnswer}`, y, rtl, 10);
    if (result?.feedback) y = paragraph(doc, `${reportCopy.feedback}: ${result.feedback}`, y, rtl, 9);
    y += 4;
  }

  return Buffer.from(doc.output("arraybuffer"));
}

async function sessionFor(req: Request, res: Response) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (session) return session;
  res.status(401).json({ error: "authentication_required" });
  return null;
}

async function readTeacherEmail(userId: string): Promise<string> {
  const [rows] = await pool.execute<SettingsRow[]>(
    "SELECT teacher_email FROM basira_exam_delivery_settings WHERE user_id=? LIMIT 1",
    [userId],
  );
  return rows[0]?.teacher_email || "";
}

async function saveTeacherEmail(userId: string, teacherEmail: string): Promise<void> {
  await pool.execute(
    "INSERT INTO basira_exam_delivery_settings (user_id,teacher_email) VALUES (?,?) ON DUPLICATE KEY UPDATE teacher_email=VALUES(teacher_email),updated_at=CURRENT_TIMESTAMP(3)",
    [userId, teacherEmail],
  );
}

async function deliverReport(recipient: string, senderEmail: string, payload: DeliveryPayload): Promise<DeliveryStatus> {
  if (!SMTP_READY) return "not_configured";
  const transport = nodemailer.createTransport({
    host: process.env.SUPPORT_SMTP_HOST!,
    port: Number(process.env.SUPPORT_SMTP_PORT || 587),
    secure: process.env.SUPPORT_SMTP_SECURE?.toLowerCase() === "true",
    requireTLS: process.env.SUPPORT_SMTP_SECURE?.toLowerCase() !== "true",
    auth: { user: process.env.SUPPORT_SMTP_USER!, pass: process.env.SUPPORT_SMTP_PASSWORD! },
    connectionTimeout: 12000,
    socketTimeout: 12000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const labels = copy[payload.uiLanguage];
    const pdf = await createReportPdf(payload);
    const receipt = await transport.sendMail({
      from: process.env.SUPPORT_EMAIL_FROM!,
      to: recipient,
      replyTo: senderEmail,
      subject: labels.emailSubject(payload.examTitle).replace(/[\r\n]/g, " "),
      text: labels.emailText(payload.examTitle),
      attachments: [{ filename: "basira-exam-report.pdf", content: pdf, contentType: "application/pdf" }],
    });
    return receipt.accepted?.some(address => address.toLowerCase() === recipient.toLowerCase()) ? "sent" : "failed";
  } catch (error: any) {
    const rejected = typeof error?.responseCode === "number" && error.responseCode >= 400;
    return rejected ? "failed" : "uncertain";
  } finally {
    transport.close();
  }
}

function requestKey(req: Request, userId: string, payload: DeliveryPayload): string {
  const supplied = req.header("Idempotency-Key");
  const stable = supplied && /^[a-zA-Z0-9-]{8,100}$/.test(supplied)
    ? supplied
    : `${payload.examTitle}:${payload.questions.length}:${Date.now()}`;
  return createHash("sha256").update(`${userId}:${stable}`).digest("hex");
}

export function registerExamDeliveryRoutes(app: Express) {
  app.get("/api/exam-delivery/settings", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const teacherEmail = await readTeacherEmail(session.user.id);
      return res.json({ teacherEmail, emailDeliveryConfigured: SMTP_READY });
    } catch {
      return res.status(503).json({ error: "delivery_settings_unavailable" });
    }
  });

  app.put("/api/exam-delivery/settings", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) return res.status(415).json({ error: "json_required" });
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const teacherEmail = text(req.body?.teacherEmail, 254).toLowerCase();
      if (!validEmail(teacherEmail)) return res.status(400).json({ error: "invalid_teacher_email" });
      await saveTeacherEmail(session.user.id, teacherEmail);
      return res.json({ teacherEmail, emailDeliveryConfigured: SMTP_READY });
    } catch {
      return res.status(503).json({ error: "delivery_settings_unavailable" });
    }
  });

  app.post("/api/exam-delivery/send", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) return res.status(415).json({ error: "json_required" });
    try {
      const session = await sessionFor(req, res);
      if (!session) return;
      const payload = sanitizePayload(req.body);
      if (!payload) return res.status(400).json({ error: "invalid_exam_payload" });
      const suppliedEmail = text(req.body?.teacherEmail, 254).toLowerCase();
      const teacherEmail = suppliedEmail || await readTeacherEmail(session.user.id);
      if (!validEmail(teacherEmail)) return res.status(400).json({ error: "invalid_teacher_email" });
      await saveTeacherEmail(session.user.id, teacherEmail);

      const key = requestKey(req, session.user.id, payload);
      const [existing] = await pool.execute<DeliveryRow[]>(
        "SELECT delivery_status FROM basira_exam_delivery_log WHERE request_key=? LIMIT 1",
        [key],
      );
      if (existing[0]) return res.status(200).json({ deliveryStatus: existing[0].delivery_status, duplicate: true, emailDeliveryConfigured: SMTP_READY });
      if (limited(req, session.user.id)) return res.status(429).json({ error: "delivery_rate_limited" });

      const id = randomUUID();
      await pool.execute(
        "INSERT INTO basira_exam_delivery_log (id,user_id,teacher_email,exam_title,request_key,delivery_status) VALUES (?,?,?,?,?,?)",
        [id, session.user.id, teacherEmail, payload.examTitle, key, "pending"],
      );
      const deliveryStatus = await deliverReport(teacherEmail, session.user.email, payload);
      await pool.execute(
        "UPDATE basira_exam_delivery_log SET delivery_status=? WHERE id=?",
        [deliveryStatus, id],
      );
      if (deliveryStatus === "sent") return res.status(201).json({ deliveryStatus, teacherEmail, emailDeliveryConfigured: true });
      const error = deliveryStatus === "not_configured" ? "email_not_configured" : "delivery_unconfirmed";
      return res.status(503).json({ error, deliveryStatus, teacherEmail, emailDeliveryConfigured: SMTP_READY });
    } catch {
      return res.status(503).json({ error: "delivery_unavailable" });
    }
  });
}
