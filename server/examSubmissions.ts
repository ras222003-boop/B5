import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import nodemailer from 'nodemailer';
import { pool } from './auth';
import { createReportPdf, limited, sanitizePayload, sessionFor, validEmail } from './examDelivery';

type Recipient = { name: string; email: string; course: string; organization: string | null; teacherId?: string };
type SubmissionRow = RowDataPacket & { id: string; user_id: string; course_name: string; exam_title: string; pdf_data: Buffer; status: string };
type OperationRow = RowDataPacket & { id: string; status: string; submission_id: string };
type TargetRow = RowDataPacket & { recipient_name: string; recipient_email: string; course_name: string; organization: string | null; delivery_status: string; sent_at: Date | null; failure_reason_code: string | null };
const smtpReady = () => Boolean(process.env.SUPPORT_SMTP_HOST && process.env.SUPPORT_SMTP_USER && process.env.SUPPORT_SMTP_PASSWORD && process.env.SUPPORT_EMAIL_FROM);
const idPattern = /^[0-9a-f-]{36}$/i;
const plain = (value: unknown, max: number) => typeof value === 'string' ? value.trim().replace(/[\r\n\t]+/g, ' ').slice(0, max + 1) : '';
const safeId = (value: unknown) => typeof value === 'string' && idPattern.test(value) ? value : null;
function parseRecipient(value: unknown, course: string): Recipient | null {
  const item = value as Record<string, unknown> | null;
  const name = plain(item?.name, 120), email = plain(item?.email, 254).toLowerCase();
  const recipientCourse = plain(item?.course, 180) || course, organization = plain(item?.organization, 180);
  if (!name || name.length > 120 || !validEmail(email) || !recipientCourse || recipientCourse.length > 180 || organization.length > 180) return null;
  const teacherId=item?.teacherId==null?undefined:safeId(item.teacherId);
  if(item?.teacherId!=null&&!teacherId)return null;
  return { name, email, course: recipientCourse, organization: organization || null, teacherId:teacherId??undefined };
}
function parseRecipients(value: unknown, course: string): Recipient[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  const recipients = value.map(item => parseRecipient(item, course));
  if (recipients.some(item => !item)) return null;
  const valid = recipients as Recipient[];
  if (new Set(valid.map(item => item.email)).size !== valid.length) return null;
  return valid;
}
async function getSubmission(id: string, userId: string) {
  const [rows] = await pool.execute<SubmissionRow[]>('SELECT id,user_id,course_name,exam_title,pdf_data,status FROM basira_exam_submissions WHERE id=? AND user_id=? LIMIT 1', [id, userId]);
  return rows[0] ?? null;
}
async function operationResult(id: string, userId: string) {
  const [operations] = await pool.execute<OperationRow[]>('SELECT id,status,submission_id FROM basira_exam_delivery_operations WHERE id=? AND user_id=? LIMIT 1', [id, userId]);
  const operation = operations[0];
  if (!operation) return null;
  const [targets] = await pool.execute<TargetRow[]>('SELECT recipient_name,recipient_email,course_name,organization,delivery_status,sent_at,failure_reason_code FROM basira_exam_delivery_targets WHERE operation_id=? ORDER BY recipient_email', [id]);
  return { deliveryId: operation.id, submissionId: operation.submission_id, status: operation.status, recipients: targets.map(row => ({ name: row.recipient_name, email: row.recipient_email, course: row.course_name, organization: row.organization, deliveryStatus: row.delivery_status, sentAt: row.sent_at, failureReasonCode: row.failure_reason_code })) };
}
async function settleStaleOperation(id: string, userId: string) {
  // A timed-out SMTP exchange can have been accepted by the remote server.
  // Preserve that ambiguity and require an explicit new operation to retry.
  const [stale] = await pool.execute<ResultSetHeader>("UPDATE basira_exam_delivery_operations SET status='FAILED' WHERE id=? AND user_id=? AND status='SENDING' AND created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE)", [id, userId]);
  if (!stale.affectedRows) return;
  await pool.execute("UPDATE basira_exam_delivery_targets SET delivery_status='UNCERTAIN',failure_reason_code='delivery_interrupted' WHERE operation_id=? AND delivery_status='SENDING'", [id]);
  await pool.execute("UPDATE basira_exam_submissions SET status='FAILED',sending_started_at=NULL WHERE id=(SELECT submission_id FROM basira_exam_delivery_operations WHERE id=?) AND user_id=? AND status='SENDING'", [id, userId]);
}
export function deliveryMessage(recipient:Recipient,studentName:string,examDate:Date,operationId:string){
  return {subject:`اختبار الطالب – ${recipient.course}`,
    text:`السلام عليكم ورحمة الله وبركاته،\n\nمرفق لكم الاختبار المكتمل بواسطة الطالب عبر منصة بصيرة، المخصصة لدعم الوصول المستقل إلى الاختبارات للأشخاص ذوي الإعاقة البصرية.\n\nاسم الطالب: ${studentName}\nاسم المقرر: ${recipient.course}\nتاريخ الاختبار: ${examDate.toISOString().slice(0,10)}\nمرجع الإرسال: ${operationId}\n\nمع خالص التحية،\nمنصة بصيرة BASIRA`};
}
async function deliver(recipient: Recipient, pdf: Buffer, senderEmail: string, studentName:string, operationId: string): Promise<'SENT' | 'FAILED' | 'UNCERTAIN'> {
  if (!smtpReady()) return 'FAILED';
  const secure = process.env.SUPPORT_SMTP_SECURE?.toLowerCase() === 'true';
  let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
  try {
    transport = nodemailer.createTransport({ host: process.env.SUPPORT_SMTP_HOST!, port: Number(process.env.SUPPORT_SMTP_PORT || 587), secure, requireTLS: !secure, auth: { user: process.env.SUPPORT_SMTP_USER!, pass: process.env.SUPPORT_SMTP_PASSWORD! }, connectionTimeout: 12000, socketTimeout: 12000, disableFileAccess: true, disableUrlAccess: true });
    const message=deliveryMessage(recipient,studentName,new Date(),operationId);
    const receipt = await transport.sendMail({
      from: process.env.SUPPORT_EMAIL_FROM!, to: recipient.email, replyTo: senderEmail,
      subject:message.subject,text:message.text,
      attachments: [{ filename: 'basira-final-exam.pdf', content: pdf, contentType: 'application/pdf' }],
    });
    return receipt.accepted?.some((address: string) => address.toLowerCase() === recipient.email) ? 'SENT' : 'FAILED';
  } catch (error: any) {
    return typeof error?.responseCode === 'number' && error.responseCode >= 400 ? 'FAILED' : 'UNCERTAIN';
  } finally { transport?.close(); }
}

export function registerExamSubmissionRoutes(app: Express) {
  app.post('/api/exam-delivery/submissions', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/json')) return res.status(415).json({ error: 'json_required' });
    try {
      const session = await sessionFor(req, res); if (!session) return;
      if (req.body?.approved !== true) return res.status(400).json({ error: 'approval_required' });
      const course = plain(req.body?.course, 180), payload = sanitizePayload(req.body);
      if (!course || course.length > 180 || !payload) return res.status(400).json({ error: 'invalid_final_exam' });
      const pdf = await createReportPdf(payload);
      const id = randomUUID();
      await pool.execute('INSERT INTO basira_exam_submissions (id,user_id,course_name,exam_title,pdf_data,status) VALUES (?,?,?,?,?,?)', [id, session.user.id, course, payload.examTitle, pdf, 'READY_TO_SEND']);
      return res.status(201).json({ submissionId: id, status: 'READY_TO_SEND', approvedAt: new Date().toISOString() });
    } catch { return res.status(503).json({ error: 'submission_unavailable' }); }
  });

  app.get('/api/exam-delivery/submissions/:id/pdf', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const session = await sessionFor(req, res); if (!session) return; const id = safeId(req.params.id); if (!id) return res.status(404).end(); const submission = await getSubmission(id, session.user.id); if (!submission) return res.status(404).end(); return res.type('application/pdf').set('Content-Disposition', 'attachment; filename="basira-final-exam.pdf"').send(submission.pdf_data); }
    catch { return res.status(503).json({ error: 'submission_unavailable' }); }
  });

  app.get('/api/exam-delivery/submissions', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const session = await sessionFor(req, res); if (!session) return;
      const [rows] = await pool.execute<RowDataPacket[]>("SELECT s.id,s.course_name,s.exam_title,s.status,s.approved_at,(SELECT o.id FROM basira_exam_delivery_operations o WHERE o.submission_id=s.id ORDER BY o.created_at DESC LIMIT 1) AS latest_delivery_id FROM basira_exam_submissions s WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT 10", [session.user.id]);
      return res.json({ submissions: rows.map(row => ({ submissionId: row.id, course: row.course_name, examTitle: row.exam_title, status: row.status, approvedAt: row.approved_at, latestDeliveryId: row.latest_delivery_id })) });
    } catch { return res.status(503).json({ error: 'submission_unavailable' }); }
  });

  app.get('/api/exam-delivery/submissions/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const session = await sessionFor(req, res); if (!session) return; const id = safeId(req.params.id); if (!id) return res.status(404).end(); const submission = await getSubmission(id, session.user.id); if (!submission) return res.status(404).end(); return res.json({ submissionId: id, course: submission.course_name, examTitle: submission.exam_title, status: submission.status }); }
    catch { return res.status(503).json({ error: 'submission_unavailable' }); }
  });

  app.get('/api/exam-delivery/contacts', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const session = await sessionFor(req, res); if (!session) return; const [rows] = await pool.execute<RowDataPacket[]>('SELECT id,recipient_name,recipient_email,course_name,organization FROM basira_exam_recipient_contacts WHERE user_id=? ORDER BY created_at DESC LIMIT 20', [session.user.id]); return res.json({ contacts: rows.map(row => ({ id: row.id, name: row.recipient_name, email: row.recipient_email, course: row.course_name, organization: row.organization })) }); }
    catch { return res.status(503).json({ error: 'contacts_unavailable' }); }
  });
  app.post('/api/exam-delivery/contacts', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const session = await sessionFor(req, res); if (!session) return; if (req.body?.consent !== true) return res.status(400).json({ error: 'consent_required' }); const recipient = parseRecipient(req.body, ''); if (!recipient) return res.status(400).json({ error: 'invalid_recipient' }); const id = randomUUID(); await pool.execute('INSERT INTO basira_exam_recipient_contacts (id,user_id,recipient_name,recipient_email,course_name,organization) VALUES (?,?,?,?,?,?)', [id, session.user.id, recipient.name, recipient.email, recipient.course, recipient.organization]); return res.status(201).json({ id, ...recipient }); }
    catch { return res.status(503).json({ error: 'contacts_unavailable' }); }
  });
  app.delete('/api/exam-delivery/contacts/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const session = await sessionFor(req, res); if (!session) return; const id = safeId(req.params.id); if (!id) return res.status(404).end(); await pool.execute('DELETE FROM basira_exam_recipient_contacts WHERE id=? AND user_id=?', [id, session.user.id]); return res.status(204).end(); }
    catch { return res.status(503).json({ error: 'contacts_unavailable' }); }
  });

  app.get('/api/exam-delivery/operations/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const session = await sessionFor(req, res); if (!session) return; const id = safeId(req.params.id); if (!id) return res.status(404).end(); await settleStaleOperation(id, session.user.id); const result = await operationResult(id, session.user.id); return result ? res.json(result) : res.status(404).end(); }
    catch { return res.status(503).json({ error: 'delivery_unavailable' }); }
  });

  app.post('/api/exam-delivery/operations', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/json')) return res.status(415).json({ error: 'json_required' });
    let claimed: { submissionId: string; userId: string; operationId: string | null } | null = null;
    try {
      const session = await sessionFor(req, res); if (!session) return;
      const submissionId = safeId(req.body?.submissionId), suppliedKey = req.header('Idempotency-Key');
      if (!submissionId || !suppliedKey || !/^[a-zA-Z0-9-]{8,100}$/.test(suppliedKey) || req.body?.confirmed !== true) return res.status(400).json({ error: 'confirmation_required' });
      const key = createHash('sha256').update(`${session.user.id}:${suppliedKey}`).digest('hex');
      const [existing] = await pool.execute<OperationRow[]>('SELECT id,status,submission_id FROM basira_exam_delivery_operations WHERE request_key=? AND user_id=? LIMIT 1', [key, session.user.id]);
      if (existing[0]) {
        if (existing[0].submission_id !== submissionId) return res.status(409).json({ error: 'idempotency_key_conflict' });
        await settleStaleOperation(existing[0].id, session.user.id);
        const result = await operationResult(existing[0].id, session.user.id); return res.json({ ...result, duplicate: true });
      }
      const submission = await getSubmission(submissionId, session.user.id);
      if (!submission) return res.status(404).json({ error: 'submission_not_found' });
      if (submission.status === 'SENDING') {
        const [active] = await pool.execute<OperationRow[]>("SELECT id,status,submission_id FROM basira_exam_delivery_operations WHERE submission_id=? AND user_id=? AND status='SENDING' ORDER BY created_at DESC LIMIT 1", [submissionId, session.user.id]);
        if (active[0]) await settleStaleOperation(active[0].id, session.user.id);
        else await pool.execute("UPDATE basira_exam_submissions SET status='FAILED',sending_started_at=NULL WHERE id=? AND user_id=? AND status='SENDING' AND sending_started_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE)", [submissionId, session.user.id]);
        const current = await getSubmission(submissionId, session.user.id);
        if (current?.status === 'SENDING') return res.status(409).json({ error: 'delivery_in_progress' });
        submission.status = current?.status ?? submission.status;
      }
      if (submission.status === 'SENT' && req.body?.resend !== true) return res.status(409).json({ error: 'explicit_resend_required' });
      const recipients = parseRecipients(req.body?.recipients, submission.course_name);
      if (!recipients || recipients.some(item => item.course !== submission.course_name)) return res.status(400).json({ error: 'invalid_recipients' });
      if(req.body?.courseId!=null){
        const courseId=safeId(req.body.courseId);
        if(!courseId||recipients.some(item=>!item.teacherId))return res.status(400).json({error:'invalid_directory_selection'});
        const [linked]=await pool.execute<(RowDataPacket&{teacher_id:string;name:string;email:string;institution:string|null;course_name:string})[]>(
          'SELECT t.id AS teacher_id,t.name,t.email,t.institution,c.name AS course_name FROM basira_courses c JOIN basira_course_teachers ct ON ct.course_id=c.id JOIN basira_teachers t ON t.id=ct.teacher_id AND t.user_id=c.user_id WHERE c.id=? AND c.user_id=?',[courseId,session.user.id]);
        if(!linked.length||linked[0].course_name!==submission.course_name||recipients.some(item=>{
          const teacher=linked.find(row=>row.teacher_id===item.teacherId);
          return !teacher||teacher.name!==item.name||teacher.email.toLowerCase()!==item.email||(teacher.institution??null)!==item.organization;
        }))return res.status(409).json({error:'directory_selection_changed'});
      }
      if (limited(req, session.user.id)) return res.status(429).json({ error: 'delivery_rate_limited' });
      const [claim] = await pool.execute<ResultSetHeader>("UPDATE basira_exam_submissions SET status='SENDING',sending_started_at=CURRENT_TIMESTAMP(3) WHERE id=? AND user_id=? AND status IN ('READY_TO_SEND','FAILED','SENT')", [submissionId, session.user.id]);
      if (!claim.affectedRows) {
        const [raced] = await pool.execute<OperationRow[]>('SELECT id,status,submission_id FROM basira_exam_delivery_operations WHERE request_key=? AND user_id=? LIMIT 1', [key, session.user.id]);
        if (raced[0]) return res.json({ ...await operationResult(raced[0].id, session.user.id), duplicate: true });
        return res.status(409).json({ error: 'delivery_in_progress' });
      }
      claimed = { submissionId, userId: session.user.id, operationId: null };
      const id = randomUUID();
      try { await pool.execute('INSERT INTO basira_exam_delivery_operations (id,submission_id,user_id,request_key,status) VALUES (?,?,?,?,?)', [id, submissionId, session.user.id, key, 'SENDING']); }
      catch { throw new Error('operation_insert_failed'); }
      claimed.operationId = id;
      for (const recipient of recipients) await pool.execute('INSERT INTO basira_exam_delivery_targets (id,operation_id,recipient_name,recipient_email,course_name,organization,delivery_status) VALUES (?,?,?,?,?,?,?)', [randomUUID(), id, recipient.name, recipient.email, recipient.course, recipient.organization, 'SENDING']);
      for (const recipient of recipients) {
        const result = await deliver(recipient, submission.pdf_data, session.user.email,session.user.name||session.user.email,id);
        await pool.execute('UPDATE basira_exam_delivery_targets SET delivery_status=?,sent_at=?,failure_reason_code=? WHERE operation_id=? AND recipient_email=?', [result, result === 'SENT' ? new Date() : null, result === 'SENT' ? null : !smtpReady() ? 'smtp_not_configured' : result === 'UNCERTAIN' ? 'smtp_unconfirmed' : 'smtp_rejected', id, recipient.email]);
      }
      const [statuses] = await pool.execute<RowDataPacket[]>('SELECT delivery_status FROM basira_exam_delivery_targets WHERE operation_id=?', [id]);
      const status = statuses.length === recipients.length && statuses.every(row => row.delivery_status === 'SENT') ? 'SENT' : 'FAILED';
      await pool.execute('UPDATE basira_exam_delivery_operations SET status=? WHERE id=?', [status, id]);
      await pool.execute('UPDATE basira_exam_submissions SET status=?,sending_started_at=NULL WHERE id=? AND user_id=?', [status, submissionId, session.user.id]);
      claimed = null;
      return res.status(status === 'SENT' ? 201 : 503).json(await operationResult(id, session.user.id));
    } catch {
      if (claimed) {
        try {
          if (claimed.operationId) {
            await pool.execute("UPDATE basira_exam_delivery_targets SET delivery_status='UNCERTAIN',failure_reason_code='delivery_interrupted' WHERE operation_id=? AND delivery_status='SENDING'", [claimed.operationId]);
            await pool.execute("UPDATE basira_exam_delivery_operations SET status='FAILED' WHERE id=? AND status='SENDING'", [claimed.operationId]);
          }
          await pool.execute("UPDATE basira_exam_submissions SET status='FAILED',sending_started_at=NULL WHERE id=? AND user_id=? AND status='SENDING'", [claimed.submissionId, claimed.userId]);
        } catch { /* The stale-operation check reconciles a later retry. */ }
      }
      return res.status(503).json({ error: 'delivery_unavailable' });
    }
  });
}
