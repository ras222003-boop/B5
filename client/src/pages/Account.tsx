import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Check, LockKeyhole, LogOut, Mail, ShieldCheck, UserRound } from "lucide-react";
import Layout from "@/components/Layout";
import { authClient } from "@/lib/auth-client";

type Provider = "google" | "microsoft" | "apple" | "facebook";
const social: { id: Provider; name: string; mark: string }[] = [
  { id: "google", name: "Google", mark: "G" },
  { id: "microsoft", name: "Microsoft", mark: "M" },
  { id: "apple", name: "Apple", mark: "●" },
  { id: "facebook", name: "Facebook", mark: "f" },
];
type Ticket = { id: string; subject: string; status: string; deliveryStatus: string; createdAt: string };

export default function Account() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<Record<Provider, boolean>>({ google: false, microsoft: false, apple: false, facebook: false });
  const [tickets, setTickets] = useState<Ticket[]>([]);
  useEffect(() => { document.title = "حسابي | بصيرة · Aurum Nexus"; }, []);
  useEffect(() => { fetch("/api/auth/providers").then(r => r.json()).then(data => { if (data.providers) setProviders(data.providers); }).catch(() => setError("تعذّر قراءة حالة موفري تسجيل الدخول")); }, []);
  useEffect(() => {
    if (!session?.user) { setTickets([]); return; }
    fetch("/api/support/tickets", { credentials: "include" }).then(r => r.ok ? r.json() : { tickets: [] }).then(data => setTickets(data.tickets || [])).catch(() => {});
  }, [session?.user?.id]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const result = mode === "signup"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) throw new Error(result.error.message || "تعذّر إكمال تسجيل الدخول");
      await refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذّر إكمال العملية"); }
    finally { setWorking(false); }
  };
  const signInSocial = async (provider: Provider) => {
    if (!providers[provider]) return;
    setWorking(true); setError("");
    try {
      const result = await authClient.signIn.social({ provider, callbackURL: "/account" });
      if (result.error) throw new Error(result.error.message || "تعذّر الدخول عبر هذا المزود");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذّر بدء تسجيل الدخول"); setWorking(false); }
  };

  return <Layout>
    <section className="border-b border-amber-200/15 bg-[#0b0a08] py-14 sm:py-20"><div className="container max-w-5xl"><span className="text-sm font-bold text-amber-300">حساب بصيرة</span><h1 className="mt-3 text-4xl font-black text-white sm:text-5xl">مساحتك في بصيرة</h1><p className="mt-4 max-w-xl text-lg leading-8 text-stone-300">أنشئ حسابًا للاحتفاظ بجلسة دخولك ومتابعة تذاكر الدعم التي فتحتها أثناء تسجيل الدخول.</p></div></section>
    <div className="container max-w-5xl py-12 sm:py-16">
      {isPending ? <p role="status" className="text-stone-300">جارٍ التحقق من جلسة الحساب...</p> : session?.user ? <div className="space-y-6">
        <div className="rounded-2xl border border-amber-200/20 bg-card p-7 sm:p-9"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-4 inline-flex rounded-xl bg-amber-300/10 p-3 text-amber-300"><UserRound aria-hidden="true" className="h-7 w-7" /></div><h2 className="text-2xl font-bold text-white">مرحبًا، {session.user.name}</h2><p className="mt-2 text-stone-300" dir="ltr">{session.user.email}</p></div><button type="button" onClick={async () => { await authClient.signOut(); await refetch(); }} className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 px-4 py-3 text-sm font-bold text-amber-200 hover:bg-amber-300/10"><LogOut aria-hidden="true" className="h-4 w-4" /> تسجيل الخروج</button></div></div>
        <section aria-labelledby="tickets-title" className="rounded-2xl border border-amber-200/15 bg-card p-7"><h2 id="tickets-title" className="mb-4 text-xl font-bold text-white">تذاكر الدعم الخاصة بك</h2>{tickets.length ? <ul className="space-y-3">{tickets.map(ticket => <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/10 p-4 text-sm"><span className="font-bold text-stone-200">{ticket.subject}</span><span className="text-amber-200" dir="ltr">#{ticket.id.slice(0, 8)}</span></li>)}</ul> : <p className="text-sm text-stone-400">لا توجد تذاكر مرتبطة بحسابك بعد. <Link href="/support" className="text-amber-200 underline">انتقل إلى الدعم الفني</Link>.</p>}</section>
      </div> : <div className="grid gap-8 lg:grid-cols-[1fr_0.85fr]">
        <section className="rounded-2xl border border-amber-200/20 bg-card p-6 sm:p-8">
          <div role="tablist" aria-label="طريقة الوصول للحساب" className="mb-7 grid grid-cols-2 gap-2 rounded-xl bg-[#0b0a08] p-1"><button type="button" role="tab" aria-selected={mode === "login"} onClick={() => { setMode("login"); setError(""); }} className={`rounded-lg p-3 text-sm font-bold ${mode === "login" ? "bg-amber-300 text-[#17130d]" : "text-stone-300"}`}>تسجيل الدخول</button><button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }} className={`rounded-lg p-3 text-sm font-bold ${mode === "signup" ? "bg-amber-300 text-[#17130d]" : "text-stone-300"}`}>إنشاء حساب</button></div>
          <h2 className="mb-6 text-xl font-bold text-white">{mode === "login" ? "أهلًا بعودتك" : "حساب جديد بخطوات بسيطة"}</h2>
          <form onSubmit={submit} className="space-y-5">
            {mode === "signup" && <label className="grid gap-2 text-sm font-bold text-stone-200">الاسم<input required autoComplete="name" maxLength={120} value={name} onChange={e => setName(e.target.value)} className="min-h-12 rounded-xl border border-amber-200/20 bg-[#090806] px-4 text-white" /></label>}
            <label className="grid gap-2 text-sm font-bold text-stone-200">البريد الإلكتروني<input required type="email" dir="ltr" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="min-h-12 rounded-xl border border-amber-200/20 bg-[#090806] px-4 text-white" /></label>
            <label className="grid gap-2 text-sm font-bold text-stone-200">كلمة المرور<input required type="password" minLength={mode === "signup" ? 10 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} className="min-h-12 rounded-xl border border-amber-200/20 bg-[#090806] px-4 text-white" />{mode === "signup" && <span className="font-normal text-stone-400">10 أحرف على الأقل. لا تشاركها مع أحد.</span>}</label>
            {mode === "signup" && <label className="flex items-start gap-3 text-xs leading-6 text-stone-300"><input type="checkbox" required className="mt-1 h-4 w-4 accent-amber-300" /> أوافق على <Link href="/terms" className="text-amber-200 underline">الشروط والأحكام</Link> و<Link href="/privacy" className="text-amber-200 underline">سياسة الخصوصية</Link></label>}
            <button type="submit" disabled={working} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-300 font-extrabold text-[#17130d] disabled:opacity-50"><LockKeyhole aria-hidden="true" className="h-4 w-4" /> {working ? "جارٍ التحقق..." : mode === "login" ? "تسجيل الدخول" : "إنشاء حساب"}</button>
          </form>
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 p-3 text-sm text-red-200">{error}</p>}
        </section>
        <aside className="space-y-5"><div className="rounded-2xl border border-amber-200/20 bg-[#17140f] p-6 sm:p-8"><h2 className="mb-2 text-xl font-bold text-white">أو استخدم حسابك المعتاد</h2><p className="mb-5 text-sm leading-7 text-stone-400">تُفعَّل خيارات مزودي الدخول بعد ربط مفاتيحهم ونطاق العودة الآمن. الخيارات غير المهيأة معروضة بوضوح ولا تبدأ تسجيل دخول وهميًا.</p><div className="space-y-3">{social.map(item => <button type="button" key={item.id} disabled={!providers[item.id] || working} onClick={() => void signInSocial(item.id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-amber-200/20 bg-[#0d0b08] px-4 text-start text-sm font-bold text-stone-100 enabled:hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-55"><span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border border-amber-300/40 font-bold text-amber-300">{item.mark}</span> المتابعة عبر {item.name}<span className="mr-auto text-xs font-normal text-stone-400">{providers[item.id] ? "متاح" : "بانتظار الربط"}</span></button>)}</div></div><p className="flex items-center gap-2 text-sm text-stone-400"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-amber-300" /> جلسات الحساب على اتصال HTTPS آمن.</p><Link href="/support" className="inline-flex items-center gap-2 text-sm text-amber-200 hover:text-amber-100"><Mail aria-hidden="true" className="h-4 w-4" /> لديك مشكلة في الدخول؟ تواصل مع الدعم</Link></aside>
      </div>}
    </div>
  </Layout>;
}
