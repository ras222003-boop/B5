import { createHash, randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { auth, pool } from "./auth";
import { toExamLanguage, type ExamLanguage } from "../shared/ocr";

const SUPPORT_EMAIL = "aurum.nexus.r1@gmail.com";
const recipient = process.env.SUPPORT_EMAIL_TO || SUPPORT_EMAIL;
const SMTP_READY = Boolean(process.env.SUPPORT_SMTP_HOST && process.env.SUPPORT_SMTP_USER && process.env.SUPPORT_SMTP_PASSWORD && process.env.SUPPORT_EMAIL_FROM);
const windows = new Map<string, { count: number; endsAt: number }>();

type TicketRow = RowDataPacket & {
  id: string; user_id: string | null; contact_name: string; email: string;
  subject: string; description: string; transcript: string | null; delivery_status: string;
  created_at: Date;
};

const strings: Record<ExamLanguage, Record<string, string>> = {
  ar: {
    json: "يجب إرسال بيانات JSON", rate: "انتظر قليلًا قبل إعادة المحاولة", invalidChat: "اكتب وصف المشكلة في رسالة لا تتجاوز 1200 حرف",
    unavailable: "مساعد الدعم غير متاح الآن؛ يمكنك فتح تذكرة متابعة مباشرة", aiFailed: "تعذّر رد المساعد الآن؛ يمكنك فتح تذكرة متابعة مباشرة",
    ticketRate: "تم الوصول إلى حد التذاكر مؤقتًا؛ راسل البريد مباشرة إذا كانت المشكلة عاجلة",
    ticketInvalid: "أدخل اسمًا وبريدًا صحيحًا وعنوانًا واضحًا ووصفًا للمشكلة (10 أحرف على الأقل)",
    storageFailed: "لم تُحفظ التذكرة. أعد المحاولة أو أرسل رسالة للبريد الظاهر", login: "سجل دخولك لعرض تذاكرك", listFailed: "تعذّر عرض التذاكر مؤقتًا",
  },
  en: {
    json: "Send JSON data", rate: "Please wait a moment before trying again", invalidChat: "Describe the problem in a message of up to 1,200 characters",
    unavailable: "AI support is unavailable right now. You can open a support ticket directly.", aiFailed: "The assistant could not reply. You can open a support ticket directly.",
    ticketRate: "You've reached the temporary ticket limit. Email support directly if your issue is urgent.",
    ticketInvalid: "Enter a name, valid email, clear subject, and problem description (at least 10 characters).",
    storageFailed: "Your ticket could not be saved. Please try again or email support.", login: "Sign in to view your tickets", listFailed: "Tickets are temporarily unavailable.",
  },
  "zh-CN": {
    json: "请发送 JSON 数据", rate: "请稍等片刻再试", invalidChat: "请在不超过 1,200 字的消息中描述问题",
    unavailable: "智能客服暂时不可用。您可以直接创建支持工单。", aiFailed: "助手暂时无法回复。您可以直接创建支持工单。",
    ticketRate: "您已达到临时工单数量上限。如有紧急问题，请直接发送邮件给客服。",
    ticketInvalid: "请输入姓名、有效邮箱、清晰的主题和至少 10 字的问题描述。",
    storageFailed: "工单未能保存，请重试或发送邮件给客服。", login: "请登录以查看您的工单", listFailed: "暂时无法显示工单。",
  },
};

function language(req: Request): ExamLanguage {
  return toExamLanguage(req.body?.language ?? req.query?.language ?? req.headers["accept-language"], "ar");
}
function limited(req: Request, action: string, max: number, interval: number) {
  const key = `${req.ip}:${action}`;
  const now = Date.now();
  const bucket = windows.get(key);
  if (!bucket || bucket.endsAt < now) {
    windows.set(key, { count: 1, endsAt: now + interval });
    if (windows.size > 3000) windows.forEach((item, id) => { if (item.endsAt < now) windows.delete(id); });
    return false;
  }
  bucket.count++;
  return bucket.count > max;
}
function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max + 1) : "";
}
function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

/**
 * An atomic DB claim prevents two workers from sending the same ticket.
 * Stable Message-ID also allows mail transports that support idempotency to dedupe.
 * Ambiguous outcomes (e.g. timeout after provider acceptance or process crash)
 * are deliberately NOT retried automatically: SMTP cannot guarantee exactly-once
 * delivery across a network failure. They remain "uncertain" for owner review.
 */
export async function sendTicketEmail(id: string): Promise<string> {
  if (!SMTP_READY) return "pending";
  const [claim] = await pool.execute<any>(
    "UPDATE basira_support_tickets SET delivery_status='sending', delivery_attempts=delivery_attempts+1 WHERE id=? AND delivery_status IN ('pending','failed') AND delivery_attempts < 3", [id],
  );
  if (claim.affectedRows !== 1) {
    const [rows] = await pool.execute<TicketRow[]>("SELECT delivery_status FROM basira_support_tickets WHERE id=? LIMIT 1", [id]);
    return rows[0]?.delivery_status || "unknown";
  }
  const [rows] = await pool.execute<TicketRow[]>("SELECT * FROM basira_support_tickets WHERE id=? LIMIT 1", [id]);
  const ticket = rows[0];
  if (!ticket) return "unknown";
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    const port = Number(process.env.SUPPORT_SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP port");
    const secure = process.env.SUPPORT_SMTP_SECURE === undefined
      ? port === 465
      : process.env.SUPPORT_SMTP_SECURE.toLowerCase() === "true";
    transport = nodemailer.createTransport({
      host: process.env.SUPPORT_SMTP_HOST!, port,
      secure, requireTLS: !secure,
      auth: { user: process.env.SUPPORT_SMTP_USER!, pass: process.env.SUPPORT_SMTP_PASSWORD! },
      connectionTimeout: 12000, socketTimeout: 12000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    const receipt = await transport.sendMail({
      from: process.env.SUPPORT_EMAIL_FROM!, to: recipient, replyTo: ticket.email,
      messageId: `<basira-ticket-${id}@aurum-nexus.support>`,
      subject: `[Basira Support] New Ticket #${id.slice(0, 8)}: ${ticket.subject.replace(/[\r\n]/g, " ")}`,
      text: `رقم التذكرة: ${id}\nالاسم: ${ticket.contact_name}\nالبريد: ${ticket.email}\nالموضوع: ${ticket.subject}\nتاريخ الإنشاء: ${ticket.created_at instanceof Date ? ticket.created_at.toISOString() : ticket.created_at}\n\nالمشكلة:\n${ticket.description}${ticket.transcript ? `\n\nمقتطف المحادثة (بموافقة المستخدم):\n${ticket.transcript}` : ""}`,
    });
    if (!receipt.accepted?.some((address: string) => address.toLowerCase() === recipient.toLowerCase())) {
      await pool.execute("UPDATE basira_support_tickets SET delivery_status='failed' WHERE id=?", [id]);
      return "failed";
    }
    await pool.execute("UPDATE basira_support_tickets SET delivery_status='sent' WHERE id=?", [id]);
    return "sent";
  } catch (error: any) {
    // SMTP 4xx/5xx is an explicit rejection: safe to retry. Network errors may
    // occur after acceptance; do not risk a duplicate email in that case.
    const rejected = typeof error?.responseCode === "number" && error.responseCode >= 400;
    const status = rejected ? "failed" : "uncertain";
    // SMTP errors may contain server responses or connection details. Log only
    // the ticket reference and delivery state, never the raw error or credentials.
    console.error("Ticket delivery failed", id, status);
    await pool.execute("UPDATE basira_support_tickets SET delivery_status=? WHERE id=?", [status, id]);
    return status;
  } finally {
    transport?.close();
  }
}

export function registerSupportRoutes(app: Express) {
  app.get("/api/support/status", (_req, res) => res.set("Cache-Control", "no-store").json({ email: SUPPORT_EMAIL, emailDeliveryConfigured: SMTP_READY }));

  app.post("/api/support/chat", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const lang = language(req), t = strings[lang];
    if (!req.is("application/json")) return res.status(415).json({ error: t.json });
    if (limited(req, "chat", 15, 5 * 60_000)) return res.status(429).json({ error: t.rate });
    const entries = req.body?.messages;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 12 || entries.some(m => !["user", "assistant"].includes(m?.role) || !text(m?.content, 1200) || text(m?.content, 1200).length > 1200) || entries.at(-1)?.role !== "user") {
      return res.status(400).json({ error: t.invalidChat });
    }
    if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) return res.status(503).json({ error: t.unavailable });
    try {
      const system = `You are the technical support assistant for Basira by Aurum Nexus. Reply ONLY in ${lang === "ar" ? "clear Arabic" : lang === "en" ? "clear English" : "Simplified Chinese"}. Give short, practical troubleshooting steps for the user's issue. Features: exam scanning (/exam-demo), online exams (/online-exams), digital assistant (/assistant), account (/account), support (/support). Never claim to access their account or to have solved an unverified issue. Never ask for passwords. If steps don't resolve it, explain that the user can open a ticket from /support. Do not promise an email was sent if SMTP isn't configured.`;
      const answer = await fetch(`${process.env.MANUS_API_URL.replace(/\/+$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.MANUS_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5-mini", messages: [{ role: "system", content: system }, ...entries.map(m => ({ role: m.role, content: text(m.content, 1200) }))] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!answer.ok) throw new Error(`Support AI returned ${answer.status}`);
      const data = await answer.json();
      if (data.error) throw new Error("Support AI returned an error");
      const reply = text(data.choices?.[0]?.message?.content, 4000);
      if (!reply) throw new Error("Support AI returned an empty reply");
      return res.json({ reply, canOpenTicket: true });
    } catch (error) {
      console.error("Support AI error", error instanceof Error ? error.message : "unknown");
      return res.status(503).json({ error: t.aiFailed });
    }
  });

  app.post("/api/support/tickets", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const lang = language(req), t = strings[lang];
    if (!req.is("application/json")) return res.status(415).json({ error: t.json });
    const name = text(req.body?.name, 120);
    const email = text(req.body?.email, 254).toLowerCase();
    const subject = text(req.body?.subject, 160);
    const description = text(req.body?.description, 4000);
    const transcript = text(req.body?.transcript, 5000);
    if (!name || name.length > 120 || !validEmail(email) || subject.length < 4 || subject.length > 160 || description.length < 10 || description.length > 4000 || transcript.length > 5000) {
      return res.status(400).json({ error: t.ticketInvalid });
    }
    // The client sends a stable UUID for a retried submission. A 10-minute
    // content hash is the fallback for older clients that send no request key.
    const providedKey = req.header("Idempotency-Key");
    const token = providedKey && /^[a-zA-Z0-9-]{8,100}$/.test(providedKey) ? providedKey : `${subject}:${description}:${Math.floor(Date.now() / 600_000)}`;
    const requestKey = createHash("sha256").update(`${email}:${token}`).digest("hex");
    try {
      const [existing] = await pool.execute<TicketRow[]>("SELECT id,delivery_status FROM basira_support_tickets WHERE request_key=? LIMIT 1", [requestKey]);
      if (existing[0]) return res.status(200).json({ id: existing[0].id, deliveryStatus: existing[0].delivery_status, email: SUPPORT_EMAIL, duplicate: true });
      if (limited(req, "ticket", 3, 60 * 60_000)) return res.status(429).json({ error: t.ticketRate });
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      const id = randomUUID();
      try {
        await pool.execute(
          "INSERT INTO basira_support_tickets (id,user_id,contact_name,email,subject,description,transcript,request_key) VALUES (?,?,?,?,?,?,?,?)",
          [id, session?.user.id ?? null, name, email, subject, description, transcript || null, requestKey],
        );
      } catch (error: any) {
        if (error?.code !== "ER_DUP_ENTRY") throw error;
        const [existing] = await pool.execute<TicketRow[]>("SELECT id,delivery_status FROM basira_support_tickets WHERE request_key=? LIMIT 1", [requestKey]);
        if (existing[0]) return res.status(200).json({ id: existing[0].id, deliveryStatus: existing[0].delivery_status, email: SUPPORT_EMAIL, duplicate: true });
        throw error;
      }
      let deliveryStatus: string;
      try {
        deliveryStatus = await sendTicketEmail(id);
      } catch {
        // The insert has committed. A mail/queue failure must not turn a saved
        // ticket into an apparent storage failure or prompt a duplicate retry.
        console.error("Ticket notification could not be confirmed", id);
        deliveryStatus = "uncertain";
      }
      return res.status(201).json({ id, deliveryStatus, email: SUPPORT_EMAIL });
    } catch (error) {
      console.error("Support ticket storage failed");
      return res.status(503).json({ error: t.storageFailed });
    }
  });

  app.get("/api/support/tickets", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const t = strings[language(req)];
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return res.status(401).json({ error: t.login });
      const [tickets] = await pool.execute<RowDataPacket[]>(
        "SELECT id, subject, status, delivery_status AS deliveryStatus, created_at AS createdAt FROM basira_support_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
        [session.user.id],
      );
      return res.json({ tickets });
    } catch {
      return res.status(503).json({ error: t.listFailed });
    }
  });
}

/** Retry explicitly rejected notifications; uncertain delivery is never auto-retried. */
export function startTicketMailWorker() {
  if (!SMTP_READY) return;
  const run = async () => {
    try {
      // A dead process may have sent the email. Do not blindly resend it.
      await pool.execute("UPDATE basira_support_tickets SET delivery_status='uncertain' WHERE delivery_status='sending' AND updated_at < NOW() - INTERVAL 15 MINUTE");
      const [rows] = await pool.execute<TicketRow[]>("SELECT id FROM basira_support_tickets WHERE delivery_status IN ('pending','failed') AND delivery_attempts < 3 ORDER BY created_at ASC LIMIT 10");
      for (const item of rows) await sendTicketEmail(item.id);
    } catch { console.error("Ticket mail worker failed"); }
  };
  void run();
  setInterval(run, 5 * 60_000).unref();
}
