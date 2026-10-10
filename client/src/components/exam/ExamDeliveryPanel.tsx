import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { ExamLanguage, OcrResult } from '@shared/ocr';
import { loadAcademicDirectory, type AcademicDirectory } from '@/lib/academicDirectory';

type Recipient = { name: string; email: string; course: string; organization: string; teacherId?: string };
type Contact = Recipient & { id: string };
type DeliveryResult = { deliveryId: string; status: 'SENDING' | 'SENT' | 'FAILED'; recipients: Array<Recipient & { deliveryStatus: string; sentAt: string | null; failureReasonCode: string | null }> };
export type SubmissionSummary = { submissionId: string; course: string; examTitle: string; status: string; approvedAt: string; latestDeliveryId: string | null };
type Props = { exam?: OcrResult; answers?: Record<number, string>; grading?: unknown; language?: ExamLanguage; uiLanguage: ExamLanguage; restored?: SubmissionSummary };
const labels = {
  ar: { title:'إرسال الاختبار إلى', course:'اسم المقرر', recipient:'المستلم', name:'الاسم', email:'البريد الإلكتروني', organization:'الجهة (اختياري)', add:'إضافة مستلم', remove:'حذف', approve:'أعتمد النسخة النهائية', approval:'راجعت إجاباتي وأوافق على اعتماد النسخة النهائية', review:'مراجعة المستلمين', confirm:'أؤكد إرسال الاختبار النهائي إلى القائمة أعلاه', send:'تأكيد الإرسال', retry:'إعادة الإرسال بعملية جديدة', save:'حفظ هذا الأستاذ لحسابي', saved:'الأساتذة المحفوظون', use:'استخدام', delete:'حذف المحفوظ', download:'تحميل النسخة النهائية', ready:'الاختبار النهائي جاهز للإرسال', sent:'اكتمل التسليم', failed:'تعذر تأكيد التسليم إلى بعض المستلمين. النسخة النهائية محفوظة ويمكن إعادة الإرسال صراحةً.', invalid:'تحقق من اسم المقرر وأسماء المستلمين وعناوين البريد.', error:'تعذر إتمام العملية الآن.', login:'سجّل الدخول قبل اعتماد الاختبار وإرساله.', smtp:'خدمة البريد غير مهيأة الآن.', limit:'يمكن إرسال الاختبار إلى خمسة مستلمين كحد أقصى.', status:'حالة التسليم', consent:'لن يُرسل الاختبار إلا بعد التأكيد.' },
  en: { title:'Send exam to', course:'Course name', recipient:'Recipient', name:'Name', email:'Email address', organization:'Organization (optional)', add:'Add recipient', remove:'Remove', approve:'Approve final exam', approval:'I reviewed my answers and approve the final version', review:'Review recipients', confirm:'I confirm sending the final exam to the list above', send:'Confirm send', retry:'Resend as a new operation', save:'Save this professor to my account', saved:'Saved professors', use:'Use', delete:'Delete saved', download:'Download final PDF', ready:'Final exam ready to send', sent:'Delivery complete', failed:'Delivery to some recipients was not confirmed. The final PDF is saved and can be resent explicitly.', invalid:'Check the course, recipient names, and email addresses.', error:'The operation could not be completed.', login:'Sign in before approving and sending.', smtp:'Email delivery is not configured.', limit:'Up to five recipients are allowed.', status:'Delivery status', consent:'The exam is sent only after confirmation.' },
  'zh-CN': { title:'发送考试至', course:'课程名称', recipient:'收件人', name:'姓名', email:'电子邮箱', organization:'机构（可选）', add:'添加收件人', remove:'删除', approve:'批准最终试卷', approval:'我已检查答案并批准最终版本', review:'检查收件人', confirm:'我确认将最终试卷发送给上述收件人', send:'确认发送', retry:'创建新操作并重新发送', save:'将此教师保存到我的账户', saved:'已保存的教师', use:'使用', delete:'删除保存项', download:'下载最终 PDF', ready:'最终试卷已准备好发送', sent:'发送完成', failed:'部分收件人的发送未得到确认。最终 PDF 已保存，可明确选择重新发送。', invalid:'请检查课程、收件人姓名和邮箱地址。', error:'目前无法完成操作。', login:'请先登录再批准并发送。', smtp:'邮件服务尚未配置。', limit:'最多允许五位收件人。', status:'发送状态', consent:'仅在确认后发送试卷。' },
} as const;
const extraLabels = {
  ar: { recent:'الاختبارات النهائية المحفوظة', open:'فتح الإرسال', sending:'جارٍ التحقق من حالة التسليم…',directory:'المعلمون والمقررات',savedCourse:'اختر مقررًا محفوظًا',savedTeacher:'اختر معلمًا مرتبطًا',manual:'إدخال يدوي',changed:'تغيرت بيانات المعلم أو المقرر. راجع الدفتر والمستلم ثم أكد من جديد.' },
  en: { recent:'Saved final exams', open:'Open delivery', sending:'Checking delivery status…',directory:'Teachers and courses',savedCourse:'Choose a saved course',savedTeacher:'Choose a linked teacher',manual:'Manual entry',changed:'The teacher or course changed. Review the directory and recipient, then confirm again.' },
  'zh-CN': { recent:'已保存的最终试卷', open:'打开发送', sending:'正在检查发送状态…',directory:'教师与课程',savedCourse:'选择已保存课程',savedTeacher:'选择关联教师',manual:'手动输入',changed:'教师或课程信息已更改。请检查目录和收件人后重新确认。' },
} as const;
const field = 'min-h-11 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-stone-950';
const button = 'min-h-11 rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50';
const secondary = 'min-h-11 rounded-lg border border-blue-400 px-4 py-2 font-bold text-blue-900';
const validEmail = (value: string) => value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const blank = (course = ''): Recipient => ({ name:'', email:'', course, organization:'' });

export default function ExamDeliveryPanel({ exam, answers, grading, language, uiLanguage, restored }: Props) {
  const t = labels[uiLanguage], [course, setCourse] = useState(restored?.course ?? ''), [approved, setApproved] = useState(false), [submissionId, setSubmissionId] = useState(restored?.submissionId ?? '');
  const [recipients, setRecipients] = useState<Recipient[]>([blank(restored?.course)]), [contacts, setContacts] = useState<Contact[]>([]), [reviewed, setReviewed] = useState(false), [confirmed, setConfirmed] = useState(false), [saveContact, setSaveContact] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [delivery, setDelivery] = useState<DeliveryResult | null>(null), [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [directory,setDirectory]=useState<AcademicDirectory>({teachers:[],courses:[]}),[selectedCourseId,setSelectedCourseId]=useState('');
  const requestKey = useRef('');
  useEffect(() => { void fetch('/api/exam-delivery/contacts', { credentials:'include' }).then(response => response.ok ? response.json() : null).then(data => { if (data?.contacts) setContacts(data.contacts); }).catch(() => {}); }, []);
  useEffect(() => { void fetch('/api/exam-delivery/settings', { credentials:'include' }).then(response => response.ok ? response.json() : null).then(data => { if (data) setSmtpConfigured(Boolean(data.emailDeliveryConfigured)); }).catch(() => {}); }, []);
  useEffect(()=>{void loadAcademicDirectory().then(setDirectory).catch(()=>{});},[]);
  useEffect(() => {
    if (!restored?.latestDeliveryId) return;
    void fetch(`/api/exam-delivery/operations/${restored.latestDeliveryId}`, { credentials:'include' }).then(response => response.ok ? response.json() : null).then((data: DeliveryResult | null) => {
      if (!data?.deliveryId) return;
      setDelivery(data);
      if (data.recipients.length) setRecipients(data.recipients.map(({ name, email, course, organization }) => ({ name, email, course, organization: organization ?? '' })));
    }).catch(() => {});
  }, [restored?.latestDeliveryId]);
  useEffect(() => {
    if (delivery?.status !== 'SENDING') return;
    const timer = window.setInterval(() => { void fetch(`/api/exam-delivery/operations/${delivery.deliveryId}`, { credentials:'include' }).then(response => response.ok ? response.json() : null).then((data: DeliveryResult | null) => {
      if (!data?.deliveryId) return;
      setDelivery(data);
      if (data.status !== 'SENDING') setNotice(data.status === 'SENT' ? t.sent : t.failed);
    }).catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, [delivery?.deliveryId, delivery?.status, t.sent, t.failed]);
  const updateRecipient = (index: number, patch: Partial<Recipient>) => { setRecipients(previous => previous.map((item, i) => i === index ? { ...item, ...patch,teacherId:undefined } : item)); setSelectedCourseId('');setReviewed(false); setConfirmed(false); requestKey.current = ''; };
  const chooseCourse=(id:string)=>{
    const saved=directory.courses.find(item=>item.id===id);
    if(!saved){setSelectedCourseId('');return;}
    const teacher=directory.teachers.find(item=>item.id===(saved.defaultTeacherId??saved.teacherIds[0]));
    setSelectedCourseId(id);if(!submissionId)setCourse(saved.name);
    setRecipients(teacher?[{name:teacher.name,email:teacher.email,course:saved.name,organization:teacher.institution,teacherId:teacher.id}]:[blank(saved.name)]);
    setReviewed(false);setConfirmed(false);requestKey.current='';
  };
  const chooseTeacher=(index:number,id:string)=>{
    const teacher=directory.teachers.find(item=>item.id===id);
    if(!teacher)return;
    setRecipients(previous=>previous.map((item,i)=>i===index?{name:teacher.name,email:teacher.email,course,organization:teacher.institution,teacherId:teacher.id}:item));
    setReviewed(false);setConfirmed(false);requestKey.current='';
  };
  const approve = async () => {
    if (!exam || !approved || !course.trim()) { setNotice(t.invalid); return; }
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/exam-delivery/submissions', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ approved:true, course:course.trim(), examTitle:exam.examTitle, questions:exam.questions, answers, grading, language:language ?? 'ar', uiLanguage }) });
      if (!response.ok) throw new Error(response.status === 401 ? t.login : t.error);
      const data = await response.json() as { submissionId: string };
      setSubmissionId(data.submissionId); setRecipients(previous => previous.map(item => ({ ...item, course:course.trim() }))); setNotice(t.ready);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.error); } finally { setBusy(false); }
  };
  const review = () => {
    const normalized = recipients.map(item => ({ ...item, name:item.name.trim(), email:item.email.trim().toLowerCase(), course:course.trim(), organization:item.organization.trim() }));
    if (!normalized.length || normalized.length > 5 || normalized.some(item => !item.name || !validEmail(item.email)) || new Set(normalized.map(item => item.email)).size !== normalized.length || (selectedCourseId && normalized.some(item=>!item.teacherId))) { setNotice(t.invalid); return; }
    setRecipients(normalized); setReviewed(true); setConfirmed(false); requestKey.current = crypto.randomUUID(); setNotice('');
  };
  const send = async (resend = false) => {
    if (!submissionId || !reviewed || !confirmed || busy) return;
    setBusy(true); setNotice('');
    if (resend) requestKey.current = crypto.randomUUID();
    try {
      const response = await fetch('/api/exam-delivery/operations', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json', 'Idempotency-Key':requestKey.current }, body:JSON.stringify({ submissionId, recipients, courseId:selectedCourseId||undefined, confirmed:true, resend }) });
      const data = await response.json().catch(() => null) as DeliveryResult | null;
      if (data?.deliveryId) { setDelivery(data); setNotice(data.status === 'SENT' ? t.sent : data.status === 'SENDING' ? extraLabels[uiLanguage].sending : t.failed); }
      else setNotice(response.status === 401 ? t.login : response.status===409?extraLabels[uiLanguage].changed:t.error);
    } catch { setNotice(t.error); } finally { setBusy(false); }
  };
  const storeContact = async (recipient: Recipient) => {
    if (!saveContact) return;
    try { const response = await fetch('/api/exam-delivery/contacts', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...recipient, consent:true }) }); if (response.ok) { const data = await response.json() as Contact; setContacts(previous => [data, ...previous]); setSaveContact(false); } } catch { setNotice(t.error); }
  };
  const deleteContact = async (id: string) => { try { const response = await fetch(`/api/exam-delivery/contacts/${id}`, { method:'DELETE', credentials:'include' }); if (response.ok) setContacts(previous => previous.filter(item => item.id !== id)); } catch { setNotice(t.error); } };
  return <section className="mx-auto mb-6 max-w-2xl rounded-2xl border border-blue-200 bg-blue-50 p-5 text-start text-stone-950" aria-labelledby="exam-delivery-title">
    <h2 id="exam-delivery-title" className="text-xl font-bold">{t.title}</h2><p className="mt-1 text-sm">{t.consent}</p><p className="mt-2 font-semibold" role="status" aria-live="polite">{t.status}: {busy && delivery?.status !== 'SENT' ? 'SENDING' : delivery?.status ?? (submissionId ? 'READY_TO_SEND' : 'DRAFT')}</p>
    {smtpConfigured === false && <p className="mt-2 rounded-lg bg-amber-100 p-2" role="status">{t.smtp}</p>}
    <Link href="/academics" className="mt-3 inline-block text-blue-800 underline">{extraLabels[uiLanguage].directory}</Link>
    {directory.courses.length>0&&<label className="mt-4 block font-medium">{extraLabels[uiLanguage].savedCourse}<select className={field} value={selectedCourseId} onChange={event=>chooseCourse(event.target.value)}><option value="">{extraLabels[uiLanguage].manual}</option>{directory.courses.filter(item=>!submissionId||item.name===course).map(item=><option key={item.id} value={item.id}>{item.name}{item.code?` · ${item.code}`:''}</option>)}</select></label>}
    <label className="mt-4 block font-medium">{t.course}<input className={field} value={course} onChange={event => {setCourse(event.target.value);setSelectedCourseId('');}} maxLength={180} disabled={Boolean(submissionId)} required /></label>
    {!submissionId && <div className="mt-4 space-y-3"><label className="flex items-start gap-2"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />{t.approval}</label><button type="button" className={button} disabled={busy || !approved || !course.trim()} onClick={approve}>{t.approve}</button></div>}
    {submissionId && <>
      <a className="mt-3 inline-block text-blue-800 underline" href={`/api/exam-delivery/submissions/${submissionId}/pdf`}>{t.download}</a>
      <div className="mt-4 space-y-4">{recipients.map((recipient, index) => <fieldset key={index} className="rounded-xl border border-blue-300 p-3"><legend className="px-1 font-bold">{t.recipient} {index + 1}</legend>{selectedCourseId&&<label className="mb-3 block">{extraLabels[uiLanguage].savedTeacher}<select className={field} value={recipient.teacherId??''} onChange={event=>chooseTeacher(index,event.target.value)}><option value="">{extraLabels[uiLanguage].manual}</option>{directory.courses.find(item=>item.id===selectedCourseId)?.teacherIds.map(id=>directory.teachers.find(teacher=>teacher.id===id)).filter((item):item is NonNullable<typeof item>=>Boolean(item)).map(item=><option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select></label>}<div className="grid gap-3 sm:grid-cols-2"><label>{t.name}<input className={field} value={recipient.name} onChange={event => updateRecipient(index, { name:event.target.value })} maxLength={120} /></label><label>{t.email}<input className={field} type="email" dir="ltr" value={recipient.email} onChange={event => updateRecipient(index, { email:event.target.value })} maxLength={254} /></label><label>{t.course}<input className={field} value={course} disabled /></label><label>{t.organization}<input className={field} value={recipient.organization} onChange={event => updateRecipient(index, { organization:event.target.value })} maxLength={180} /></label></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => { setRecipients(previous => previous.filter((_, i) => i !== index)); setReviewed(false); }}>{t.remove}</button><button type="button" className={secondary} onClick={() => void storeContact(recipient)} disabled={!saveContact || !recipient.name || !validEmail(recipient.email)}>{t.save}</button></div></fieldset>)}</div>
      <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={saveContact} onChange={event => setSaveContact(event.target.checked)} />{t.save}</label>
      <button type="button" className={`${secondary} mt-3`} disabled={recipients.length >= 5} onClick={() => { setRecipients(previous => [...previous, blank(course)]); setReviewed(false); }}>{t.add}</button>{recipients.length >= 5 && <p>{t.limit}</p>}
      {contacts.length > 0 && <div className="mt-4"><h3 className="font-bold">{t.saved}</h3><ul className="space-y-2">{contacts.map(contact => <li key={contact.id} className="flex flex-wrap items-center gap-2"><span>{contact.name} · {contact.email}</span><button type="button" className={secondary} onClick={() => { setRecipients(previous => previous.length === 1 && !previous[0].email ? [{ ...contact, course }] : [...previous.slice(0, 4), { ...contact, course }]); setReviewed(false); }}>{t.use}</button><button type="button" className={secondary} onClick={() => void deleteContact(contact.id)}>{t.delete}</button></li>)}</ul></div>}
      <button type="button" className={`${button} mt-4`} onClick={review}>{t.review}</button>
      {reviewed && <div className="mt-4 rounded-xl border border-blue-400 bg-white p-4"><h3 className="font-bold">{t.review}</h3><ul className="mt-2 list-inside list-disc">{recipients.map(item => <li key={item.email}>{item.name} · {item.email} · {course}</li>)}</ul><label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t.confirm}</label><button type="button" className={`${button} mt-3`} disabled={!confirmed || busy || delivery?.status === 'SENT' || delivery?.status === 'SENDING'} onClick={() => void send(false)}>{t.send}</button>{(delivery?.status === 'FAILED' || delivery?.status === 'SENT') && <button type="button" className={`${secondary} ms-2 mt-3`} disabled={!confirmed || busy} onClick={() => void send(true)}>{t.retry}</button>}</div>}
      {delivery && <div className="mt-4" aria-live="polite"><h3 className="font-bold">{t.status}: {delivery.status} · {delivery.deliveryId}</h3><ul>{delivery.recipients.map(item => <li key={item.email}>{item.name} · {item.email} · {item.deliveryStatus}{item.sentAt ? ` · ${new Date(item.sentAt).toLocaleString(uiLanguage)}` : ''}{item.failureReasonCode ? ` · ${item.failureReasonCode}` : ''}</li>)}</ul></div>}
    </>}
    {notice && <p className="mt-3 rounded-lg bg-amber-100 p-3" role={delivery?.status === 'FAILED' ? 'alert' : 'status'} aria-live="polite">{notice}</p>}
  </section>;
}

export function RecentExamSubmissions({ uiLanguage }: { uiLanguage: ExamLanguage }) {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [selected, setSelected] = useState<SubmissionSummary | null>(null);
  useEffect(() => {
    void fetch('/api/exam-delivery/submissions', { credentials:'include' })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (Array.isArray(data?.submissions)) setSubmissions(data.submissions); })
      .catch(() => {});
  }, []);
  if (!submissions.length) return null;
  const t = extraLabels[uiLanguage];
  return <section className="mx-auto mt-10 max-w-2xl rounded-2xl border border-blue-200 bg-white p-5 text-start" aria-label={t.recent}>
    <h2 className="text-xl font-bold">{t.recent}</h2>
    <ul className="mt-3 space-y-3">{submissions.map(item => <li key={item.submissionId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
      <span><strong>{item.course}</strong> · {item.examTitle} · {item.status}</span>
      <span className="flex gap-2"><a className={secondary} href={`/api/exam-delivery/submissions/${item.submissionId}/pdf`}>{labels[uiLanguage].download}</a><button type="button" className={secondary} onClick={() => setSelected(item)}>{t.open}</button></span>
    </li>)}</ul>
    {selected && <div className="mt-5"><ExamDeliveryPanel key={selected.submissionId} restored={selected} uiLanguage={uiLanguage} /></div>}
  </section>;
}
