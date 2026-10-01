import { randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { auth, pool } from "./auth";

const SUPPORT_EMAIL = "aurum.nexus.r1@gmail.com";
const SMTP_READY = Boolean(process.env.SUPPORT_SMTP_HOST && process.env.SUPPORT_SMTP_USER && process.env.SUPPORT_SMTP_PASSWORD);
const windows = new Map<string, { count: number; endsAt: number }>();

type TicketRow = RowDataPacket & {
  id: string; user_id: string | null; contact_name: string; email: string;
  subject: string; description: string; transcript: string | null; delivery_status: string;
};

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

async function sendTicketEmail(id: string): Promise<"sent" | "pending" | "failed"> {
  if (!SMTP_READY) return "pending";
  // Claim atomically so overlapping server instances do not deliver the same ticket twice.
  const [claim] = await pool.execute<any>(
    "UPDATE basira_support_tickets SET delivery_status='sending', delivery_attempts=delivery_attempts+1 WHERE id=? AND delivery_status IN ('pending','failed') AND delivery_attempts < 3", [id],
  );
  if (claim.affectedRows !== 1) return "pending";
  const [rows] = await pool.execute<TicketRow[]>("SELECT * FROM basira_support_tickets WHERE id=? LIMIT 1", [id]);
  const ticket = rows[0];
  if (!ticket) return "failed";
  try {
    const port = Number(process.env.SUPPORT_SMTP_PORT || 465);
    const transport = nodemailer.createTransport({
      host: process.env.SUPPORT_SMTP_HOST!, port,
      secure: port === 465, requireTLS: port !== 465,
      auth: { user: process.env.SUPPORT_SMTP_USER!, pass: process.env.SUPPORT_SMTP_PASSWORD! },
      connectionTimeout: 12000, socketTimeout: 12000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    const receipt = await transport.sendMail({
      from: process.env.SUPPORT_SMTP_USER!, to: SUPPORT_EMAIL, replyTo: ticket.email,
      subject: `[بصيرة #${id.slice(0, 8)}] ${ticket.subject.replace(/[\r\n]/g, " ")}`,
      text: `رقم التذكرة: ${id}\nالاسم: ${ticket.contact_name}\nالبريد: ${ticket.email}\nالموضوع: ${ticket.subject}\n\nالمشكلة:\n${ticket.description}\n\nمقتطف المحادثة (بموافقة المستخدم):\n${ticket.transcript || "لم يُرسل"}`,
    });
    if (!receipt.accepted?.some(a => a.toLowerCase() === SUPPORT_EMAIL)) throw new Error("SMTP did not accept the recipient");
    await pool.execute("UPDATE basira_support_tickets SET delivery_status='sent' WHERE id=?", [id]);
    return "sent";
  } catch (error) {
    console.error("Ticket delivery failed", id, error instanceof Error ? error.message : "unknown SMTP error");
    await pool.execute("UPDATE basira_support_tickets SET delivery_status='failed' WHERE id=?", [id]);
    return "failed";
  }
}

export function registerSupportRoutes(app: Express) {
  app.get("/api/support/status", (_req, res) => res.set("Cache-Control", "no-store").json({ email: SUPPORT_EMAIL, emailDeliveryConfigured: SMTP_READY }));

  app.post("/api/support/chat", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) return res.status(415).json({ error: "يجب إرسال بيانات JSON" });
    if (limited(req, "chat", 15, 5 * 60_000)) return res.status(429).json({ error: "انتظر قليلًا قبل إعادة المحاولة" });
    const entries = req.body?.messages;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 12 || entries.some(m => !["user", "assistant"].includes(m?.role) || !text(m?.content, 1200) || text(m?.content, 1200).length > 1200) || entries.at(-1)?.role !== "user") {
      return res.status(400).json({ error: "اكتب وصف المشكلة في رسالة لا تتجاوز 1200 حرف" });
    }
    if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) return res.status(503).json({ error: "مساعد الدعم غير متاح الآن؛ يمكنك فتح تذكرة متابعة مباشرة" });
    try {
      const answer = await fetch(`${process.env.MANUS_API_URL.replace(/\/+$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.MANUS_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-mini",
          messages: [
            { role: "system", content: "أنت مساعد الدعم الفني لمنصة بصيرة التابعة لـ Aurum Nexus. قدّم خطوات قصيرة بالعربية لفحص المشكلة بناءً على وصف المستخدم. الخدمات: مسح اختبار بالكاميرا (/exam-demo)، اختبارات إلكترونية (/online-exams)، المساعد الرقمي (/assistant)، الحساب (/account)، الدعم (/support). لا تدّعِ الوصول إلى حسابه أو حل مشكلة لم تتحقق منها، ولا تطلب كلمات مرور. عند عدم وضوح الحل أو انتهاء الخطوات قل: إذا لم تُحل المشكلة افتح تذكرة من صفحة الدعم. لا تعد بإرسال بريد إن لم تُهيأ خدمة البريد." },
            ...entries.map(m => ({ role: m.role, content: text(m.content, 1200) })),
          ],
        }),
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
      return res.status(503).json({ error: "تعذّر رد المساعد الآن؛ يمكنك فتح تذكرة متابعة مباشرة" });
    }
  });

  app.post("/api/support/tickets", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) return res.status(415).json({ error: "يجب إرسال بيانات JSON" });
    if (limited(req, "ticket", 3, 60 * 60_000)) return res.status(429).json({ error: "تم الوصول إلى حد التذاكر مؤقتًا؛ راسل البريد مباشرة إذا كانت المشكلة عاجلة" });
    const name = text(req.body?.name, 120);
    const email = text(req.body?.email, 254).toLowerCase();
    const subject = text(req.body?.subject, 160);
    const description = text(req.body?.description, 4000);
    const transcript = text(req.body?.transcript, 5000);
    if (!name || name.length > 120 || !validEmail(email) || subject.length < 4 || subject.length > 160 || description.length < 10 || description.length > 4000 || transcript.length > 5000) {
      return res.status(400).json({ error: "أدخل اسمًا وبريدًا صحيحًا وعنوانًا واضحًا ووصفًا للمشكلة (10 أحرف على الأقل)" });
    }
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      const id = randomUUID();
      await pool.execute(
        "INSERT INTO basira_support_tickets (id,user_id,contact_name,email,subject,description,transcript) VALUES (?,?,?,?,?,?,?)",
        [id, session?.user.id ?? null, name, email, subject, description, transcript || null],
      );
      const deliveryStatus = await sendTicketEmail(id);
      return res.status(201).json({ id, deliveryStatus, email: SUPPORT_EMAIL });
    } catch (error) {
      console.error("Support ticket storage failed", error instanceof Error ? error.message : "unknown");
      return res.status(503).json({ error: "لم تُحفظ التذكرة. أعد المحاولة أو أرسل رسالة للبريد الظاهر" });
    }
  });

  app.get("/api/support/tickets", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return res.status(401).json({ error: "سجل دخولك لعرض تذاكرك" });
      const [tickets] = await pool.execute<RowDataPacket[]>(
        "SELECT id, subject, status, delivery_status AS deliveryStatus, created_at AS createdAt FROM basira_support_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
        [session.user.id],
      );
      return res.json({ tickets });
    } catch {
      return res.status(503).json({ error: "تعذّر عرض التذاكر مؤقتًا" });
    }
  });
}

/** Retry pending notifications when SMTP is connected after tickets were saved. */
export function startTicketMailWorker() {
  if (!SMTP_READY) return;
  const run = async () => {
    try {
      await pool.execute("UPDATE basira_support_tickets SET delivery_status='pending' WHERE delivery_status='sending' AND updated_at < NOW() - INTERVAL 15 MINUTE");
      const [rows] = await pool.execute<TicketRow[]>("SELECT id FROM basira_support_tickets WHERE delivery_status IN ('pending','failed') AND delivery_attempts < 3 ORDER BY created_at ASC LIMIT 10");
      for (const item of rows) await sendTicketEmail(item.id);
    } catch (error) { console.error("Ticket mail worker error", error instanceof Error ? error.message : "unknown"); }
  };
  void run();
  setInterval(run, 5 * 60_000).unref();
}
