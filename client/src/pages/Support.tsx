import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowLeft, Bot, CheckCircle2, Headphones, LifeBuoy, Mail, Send, Ticket, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import Layout from "@/components/Layout";

const SUPPORT_EMAIL = "aurum.nexus.r1@gmail.com";
type Message = { role: "user" | "assistant"; content: string };
type TicketResult = { id: string; deliveryStatus: "sent" | "pending" | "failed"; email: string };

export default function Support() {
  const { data: session } = authClient.useSession();
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "مرحبًا! أخبرني ما المشكلة التي واجهتك في بصيرة. سأقترح خطوات واضحة، وإذا لم تُحل يمكنك فتح تذكرة متابعة." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticketOpen, setTicketOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ticket, setTicket] = useState<TicketResult | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = "الدعم الفني | بصيرة · Aurum Nexus"; }, []);
  useEffect(() => { if (session?.user) { setName(current => current || session.user.name || ""); setEmail(current => current || session.user.email || ""); } }, [session?.user]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    setError(""); setInput(""); setBusy(true);
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    try {
      const response = await fetch("/api/support/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.slice(1).slice(-12) }) });
      const payload = await response.json();
      if (!response.ok || typeof payload.reply !== "string") throw new Error(payload.error || "تعذر الحصول على رد المساعد");
      setMessages([...next, { role: "assistant", content: payload.reply }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر الاتصال بالمساعد");
      setMessages([...next, { role: "assistant", content: "لم أتمكن من الرد الآن. يمكنك فتح تذكرة ليتم متابعة مشكلتك." }]);
    } finally { setBusy(false); }
  };

  const createTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), subject: subject.trim(), description: description.trim(), transcript: includeTranscript ? messages.map(m => `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content}`).join("\n").slice(0, 5000) : "" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.id) throw new Error(payload.error || "تعذر حفظ التذكرة");
      setTicket(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ التذكرة"); }
    finally { setSaving(false); }
  };

  return <Layout>
    <section className="relative overflow-hidden border-b border-amber-200/15 bg-[#0b0a08] py-14 sm:py-20">
      <div className="absolute -left-20 top-8 h-80 w-80 rounded-full border border-amber-300/10" aria-hidden="true" />
      <div className="container relative max-w-6xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-bold text-amber-200"><Headphones aria-hidden="true" className="h-4 w-4" /> دعم العملاء · Aurum Nexus</span>
        <h1 className="mt-5 text-4xl font-black text-white sm:text-5xl">دعم فني يفهم مشكلتك، ويتابعها</h1>
        <p className="mt-5 max-w-2xl text-lg leading-9 text-stone-300">ابدأ بمحادثة المساعد الذكي للحصول على خطوات حل عملية. إذا لم تنجح، افتح تذكرة متابعة برقم مرجعي.</p>
      </div>
    </section>
    <div className="container grid max-w-6xl gap-8 py-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)] lg:py-16">
      <section aria-labelledby="chat-title" className="overflow-hidden rounded-2xl border border-amber-200/20 bg-[#14120e] shadow-xl">
        <header className="flex items-center gap-3 border-b border-amber-200/15 p-5"><span className="rounded-xl bg-amber-300/15 p-3 text-amber-300"><Bot aria-hidden="true" className="h-6 w-6" /></span><span><h2 id="chat-title" className="text-lg font-bold text-white">مساعد الدعم الذكي</h2><span className="text-xs text-stone-400">قدّم وصف المشكلة، ولا تشارك كلمة مرورك</span></span></header>
        <div aria-label="سجل المحادثة" aria-live="polite" className="max-h-[28rem] min-h-64 space-y-4 overflow-y-auto p-5">
          {messages.map((message, index) => <div key={index} className={`max-w-[90%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-7 ${message.role === "user" ? "mr-auto rounded-tr-none bg-amber-300 text-[#17130d]" : "ml-auto rounded-tl-none border border-amber-200/15 bg-[#232019] text-stone-100"}`}>{message.content}</div>)}
          {busy && <p className="text-sm text-amber-200" role="status">يفكر المساعد في خطوات مناسبة...</p>}
          <div ref={endRef} />
        </div>
        <form onSubmit={sendMessage} className="flex gap-2 border-t border-amber-200/15 p-4"><label htmlFor="support-message" className="sr-only">رسالتك إلى مساعد الدعم</label><input id="support-message" value={input} onChange={e => setInput(e.target.value)} maxLength={1200} placeholder="صف المشكلة التي واجهتك..." className="min-w-0 flex-1 rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white placeholder:text-stone-500" /><button type="submit" disabled={busy || !input.trim()} className="rounded-xl bg-amber-300 px-5 font-bold text-[#17130d] disabled:cursor-not-allowed disabled:opacity-50" aria-label="إرسال رسالة إلى المساعد"><Send aria-hidden="true" className="h-5 w-5" /></button></form>
      </section>
      <aside className="space-y-5">
        <div className="rounded-2xl border border-amber-300/25 bg-gradient-to-br from-[#302309] to-[#14110d] p-6"><LifeBuoy aria-hidden="true" className="mb-4 h-8 w-8 text-amber-300" /><h2 className="mb-3 text-xl font-bold text-white">ما زالت المشكلة قائمة؟</h2><p className="mb-5 text-sm leading-7 text-stone-300">يمكنك فتح تذكرة حتى إن تعذّرت الدردشة. سنحفظ وصف المشكلة لتتم متابعتها.</p><button type="button" onClick={() => { setTicketOpen(true); document.getElementById("ticket-form")?.scrollIntoView({ behavior: "smooth" }); }} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-3 font-bold text-[#17130d] hover:bg-amber-200"><Ticket aria-hidden="true" className="h-5 w-5" /> افتح تذكرة دعم</button></div>
        <div className="rounded-2xl border border-amber-200/15 bg-card p-6"><Mail aria-hidden="true" className="mb-3 h-6 w-6 text-amber-300" /><h2 className="font-bold text-white">بريد الدعم</h2><a href={`mailto:${SUPPORT_EMAIL}`} className="mt-2 block break-all text-sm text-amber-200 underline" dir="ltr">{SUPPORT_EMAIL}</a><p className="mt-3 text-sm leading-7 text-stone-400">بإمكانك التواصل مباشرة إذا تعذّر استخدام صفحة الدعم.</p></div>
        <Link href="/account" className="inline-flex items-center gap-2 text-sm text-amber-200 hover:text-amber-100"><UserRound aria-hidden="true" className="h-4 w-4" /> سجّل دخولك لمتابعة تذاكرك <ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>
      </aside>
    </div>
    {ticketOpen && <section id="ticket-form" aria-labelledby="ticket-heading" className="container max-w-4xl pb-16">
      <div className="rounded-2xl border border-amber-200/20 bg-[#17140f] p-6 sm:p-9">
        <h2 id="ticket-heading" className="mb-2 text-2xl font-black text-white">تذكرة دعم جديدة</h2><p className="mb-6 text-sm leading-7 text-stone-400">أدخل بيانات التواصل ووصفًا واضحًا. إرسال المحادثة اختياري وبموافقتك فقط.</p>
        {ticket ? <div role="status" className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-5 text-stone-100"><CheckCircle2 aria-hidden="true" className="mb-2 h-7 w-7 text-amber-300" /><p className="font-bold">حُفظت تذكرتك برقم <span dir="ltr">{ticket.id}</span></p><p className="mt-2 text-sm leading-7">{ticket.deliveryStatus === "sent" ? `قَبِل خادم البريد إرسال إشعار التذكرة إلى ${SUPPORT_EMAIL}.` : ticket.deliveryStatus === "failed" ? "حُفظت التذكرة لكن تعذّر إرسال إشعار البريد حاليًا. يمكنك التواصل بالبريد مباشرة." : "حُفظت التذكرة، لكن إرسال البريد لم يُفعّل بعد. يمكنك التواصل بالبريد مباشرة."}</p></div> : <form onSubmit={createTicket} className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold text-stone-200">الاسم<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white" /></label>
          <label className="grid gap-2 text-sm font-bold text-stone-200">البريد الإلكتروني<input required type="email" dir="ltr" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white" /></label>
          <label className="grid gap-2 text-sm font-bold text-stone-200 sm:col-span-2">موضوع المشكلة<input required minLength={4} maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white" /></label>
          <label className="grid gap-2 text-sm font-bold text-stone-200 sm:col-span-2">وصف المشكلة<textarea required minLength={10} maxLength={4000} rows={5} value={description} onChange={e => setDescription(e.target.value)} className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white" placeholder="ماذا حدث؟ وما الخطوات التي جرّبتها؟" /></label>
          <label className="flex items-center gap-3 text-sm text-stone-300 sm:col-span-2"><input type="checkbox" checked={includeTranscript} onChange={e => setIncludeTranscript(e.target.checked)} className="h-5 w-5 accent-amber-300" /> أوافق على إرفاق مقتطف من محادثة الدعم مع التذكرة</label>
          <button disabled={saving} type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-6 font-bold text-[#17130d] disabled:opacity-50"><Ticket aria-hidden="true" className="h-5 w-5" /> {saving ? "جارٍ الحفظ..." : "حفظ التذكرة وإرسال إشعار إن توفر"}</button>
        </form>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 p-3 text-sm text-red-200">{error}</p>}
      </div>
    </section>}
  </Layout>;
}
