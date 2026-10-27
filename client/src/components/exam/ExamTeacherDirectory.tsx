import { useEffect, useState, type FormEvent } from 'react';
import type { ExamLanguage } from '@shared/ocr';

type TeacherContact = { id: string; name: string; email: string; course: string; organization: string | null };
type DraftContact = { name: string; email: string; course: string; organization: string };
const emptyContact: DraftContact = { name: '', email: '', course: '', organization: '' };
const validEmail = (value: string) => value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const text = {
  ar: {
    title: 'دليل المعلمين وإيميلاتهم', description: 'احفظ بريد كل معلم قبل بدء الاختبار، ثم اختره لاحقًا عند إرسال نسخة الاختبار النهائية.',
    name: 'اسم المعلم', email: 'البريد الإلكتروني للمعلم', course: 'المقرر الدراسي', organization: 'الجهة (اختياري)',
    save: 'حفظ المعلم', saving: 'جارٍ الحفظ…', consent: 'أوافق على حفظ بيانات التواصل الخاصة بهذا المعلم في حسابي.',
    saved: 'المعلمون المحفوظون', empty: 'لم تحفظ أي معلم بعد.', delete: 'حذف', confirmDelete: 'هل تريد حذف هذا المعلم من دليلك؟',
    added: 'تم حفظ المعلم، ويمكن اختياره عند إرسال الاختبار.', deleted: 'تم حذف المعلم.',
    invalid: 'أدخل اسم المعلم والمقرر وبريدًا إلكترونيًا صحيحًا.',
    duplicate: 'هذا البريد محفوظ بالفعل لهذا المقرر.', limit: 'وصلت إلى الحد الأقصى: 20 معلمًا.',
    error: 'تعذر إتمام العملية. تحقق من اتصال الإنترنت وحاول مجددًا.', loading: 'جارٍ تحميل الدليل…',
    login: 'سجّل الدخول لحفظ المعلمين واسترجاعهم من حسابك.', loginLink: 'تسجيل الدخول',
    privacy: 'لا يُرسل أي اختبار بمجرد حفظ البريد. يتطلب الإرسال مراجعة المستلمين والموافقة الصريحة.',
  },
  en: {
    title: 'Saved teacher emails', description: 'Save your teachers before starting an exam, then select them when submitting the final copy.',
    name: 'Teacher name', email: 'Teacher email', course: 'Course', organization: 'Organization (optional)',
    save: 'Save teacher', saving: 'Saving…', consent: 'I agree to save this teacher’s contact details to my account.',
    saved: 'Saved teachers', empty: 'No saved teachers yet.', delete: 'Delete', confirmDelete: 'Delete this teacher from your directory?',
    added: 'Teacher saved. You can select them when submitting an exam.', deleted: 'Teacher deleted.',
    invalid: 'Enter a teacher name, course, and valid email address.',
    duplicate: 'This email is already saved for this course.', limit: 'You have reached the 20-teacher limit.',
    error: 'Could not complete the action. Check your connection and retry.', loading: 'Loading directory…',
    login: 'Sign in to save teachers to your account.', loginLink: 'Sign in',
    privacy: 'Saving an address does not send an exam. Delivery requires recipient review and explicit confirmation.',
  },
  'zh-CN': {
    title: '教师邮箱通讯录', description: '考试开始前保存教师信息，提交最终试卷时直接选择。',
    name: '教师姓名', email: '教师邮箱', course: '课程', organization: '机构（可选）',
    save: '保存教师', saving: '保存中…', consent: '我同意将此教师的联系方式保存到我的账户。',
    saved: '已保存的教师', empty: '尚未保存教师。', delete: '删除', confirmDelete: '确定删除这位教师吗？',
    added: '教师已保存，可在提交试卷时选择。', deleted: '教师已删除。',
    invalid: '请输入教师姓名、课程和有效邮箱。',
    duplicate: '此课程已保存该邮箱。', limit: '最多保存 20 位教师。',
    error: '操作失败，请检查网络后重试。', loading: '正在加载通讯录…',
    login: '请登录以保存教师。', loginLink: '登录',
    privacy: '保存邮箱不会发送试卷。发送前需审核收件人并明确确认。',
  },
} as const;

const fieldClass = 'mt-1 min-h-11 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-stone-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const actionClass = 'min-h-11 rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export default function ExamTeacherDirectory({ uiLanguage }: { uiLanguage: ExamLanguage }) {
  const t = text[uiLanguage];
  const [contacts, setContacts] = useState<TeacherContact[]>([]);
  const [form, setForm] = useState<DraftContact>(emptyContact);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/exam-delivery/contacts', { credentials: 'include', signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) { setAuthRequired(true); return; }
        if (!response.ok) throw new Error('contacts_unavailable');
        const data = await response.json() as { contacts?: TeacherContact[] };
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        setAuthRequired(false);
      })
      .catch(error => { if (!controller.signal.aborted) setNotice({ message: t.error, error: true }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [t.error]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || authRequired || !consent) return;
    const value = {
      name: form.name.trim(), email: form.email.trim().toLowerCase(),
      course: form.course.trim(), organization: form.organization.trim(),
    };
    if (!value.name || value.name.length > 120 || !validEmail(value.email) ||
        !value.course || value.course.length > 180 || value.organization.length > 180) {
      setNotice({ message: t.invalid, error: true }); return;
    }
    if (contacts.some(contact => contact.email.toLowerCase() === value.email &&
          contact.course.toLowerCase() === value.course.toLowerCase())) {
      setNotice({ message: t.duplicate, error: true }); return;
    }
    if (contacts.length >= 20) { setNotice({ message: t.limit, error: true }); return; }
    setSaving(true); setNotice(null);
    try {
      const response = await fetch('/api/exam-delivery/contacts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...value, consent: true }),
      });
      if (response.status === 401) { setAuthRequired(true); setNotice({ message: t.login, error: true }); return; }
      if (response.status === 409) { setNotice({ message: t.duplicate, error: true }); return; }
      if (response.status === 429) { setNotice({ message: t.limit, error: true }); return; }
      if (!response.ok) throw new Error('save_failed');
      const created = await response.json() as TeacherContact;
      setContacts(previous => [created, ...previous]);
      setForm(emptyContact); setConsent(false);
      setNotice({ message: t.added, error: false });
    } catch { setNotice({ message: t.error, error: true }); }
    finally { setSaving(false); }
  };

  const remove = async (contact: TeacherContact) => {
    if (deletingId || !window.confirm(t.confirmDelete)) return;
    setDeletingId(contact.id); setNotice(null);
    try {
      const response = await fetch(`/api/exam-delivery/contacts/${encodeURIComponent(contact.id)}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (response.status === 401) { setAuthRequired(true); setNotice({ message: t.login, error: true }); return; }
      if (!response.ok) throw new Error('delete_failed');
      setContacts(previous => previous.filter(item => item.id !== contact.id));
      setNotice({ message: t.deleted, error: false });
    } catch { setNotice({ message: t.error, error: true }); }
    finally { setDeletingId(''); }
  };

  return <section className="mx-auto mb-8 max-w-2xl rounded-2xl border-2 border-blue-200 bg-blue-50 p-5 text-start text-stone-950" aria-labelledby="exam-teacher-directory-title">
    <h2 id="exam-teacher-directory-title" className="text-xl font-bold">{t.title}</h2>
    <p className="mt-2 text-sm">{t.description}</p>
    {authRequired ? <p className="mt-4 rounded-lg bg-amber-100 p-3" role="status">
      {t.login} <a href="/account" className="font-bold text-blue-800 underline">{t.loginLink}</a>
    </p> : <form onSubmit={save} className="mt-4 space-y-3" aria-busy={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block font-medium">{t.name}<input className={fieldClass} value={form.name} onChange={e => setForm(previous => ({ ...previous, name: e.target.value }))} maxLength={120} autoComplete="name" required /></label>
        <label className="block font-medium">{t.email}<input className={fieldClass} value={form.email} onChange={e => setForm(previous => ({ ...previous, email: e.target.value }))} type="email" dir="ltr" maxLength={254} autoComplete="email" required /></label>
        <label className="block font-medium">{t.course}<input className={fieldClass} value={form.course} onChange={e => setForm(previous => ({ ...previous, course: e.target.value }))} maxLength={180} required /></label>
        <label className="block font-medium">{t.organization}<input className={fieldClass} value={form.organization} onChange={e => setForm(previous => ({ ...previous, organization: e.target.value }))} maxLength={180} /></label>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={e => setConsent(e.target.checked)} required />{t.consent}</label>
      <button type="submit" className={actionClass} disabled={saving || loading || !consent || contacts.length >= 20}>{saving ? t.saving : t.save}</button>
    </form>}
    <h3 className="mt-5 text-lg font-bold">{t.saved} ({contacts.length})</h3>
    {loading ? <p className="mt-2" role="status">{t.loading}</p> :
      contacts.length === 0 ? <p className="mt-2 text-sm">{t.empty}</p> :
      <ul className="mt-3 space-y-2">{contacts.map(contact => <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-white p-3">
        <div className="min-w-0">
          <strong className="block">{contact.name}</strong>
          <span className="block break-all" dir="ltr">{contact.email}</span>
          <span className="block text-sm text-stone-600">{contact.course}{contact.organization ? ` · ${contact.organization}` : ''}</span>
        </div>
        <button type="button" className="min-h-11 rounded-lg border border-red-300 px-3 text-red-800 disabled:opacity-50" disabled={Boolean(deletingId)} onClick={() => void remove(contact)} aria-label={`${t.delete}: ${contact.name}`}>{t.delete}</button>
      </li>)}</ul>}
    {contacts.length >= 20 && <p className="mt-2 text-sm">{t.limit}</p>}
    {notice && <p className={`mt-3 rounded-lg p-3 ${notice.error ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900'}`} role={notice.error ? 'alert' : 'status'} aria-live="polite">{notice.message}</p>}
    <p className="mt-3 text-xs text-stone-700">{t.privacy}</p>
  </section>;
}
