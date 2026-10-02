import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  LockKeyhole,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n, useMessages } from "@/i18n";
import { accountMessages } from "@/i18n/locales/account";
import { authClient } from "@/lib/auth-client";

type Provider = "google" | "microsoft" | "apple" | "facebook";
type ErrorKind = "authentication" | "providerStatus" | "socialStart";
type OAuthNotice = "success" | "failure" | "cancelled";
type Ticket = {
  id: string;
  subject: string;
  status: string;
  deliveryStatus: string;
  createdAt: string;
};

const social: { id: Provider; mark: string }[] = [
  { id: "google", mark: "G" },
  { id: "microsoft", mark: "M" },
  { id: "apple", mark: "●" },
  { id: "facebook", mark: "f" },
];

export default function Account() {
  const t = useMessages(accountMessages);
  const { formatDate } = useI18n();
  const { data: session, isPending, refetch } = authClient.useSession();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [oauthNotice, setOauthNotice] = useState<OAuthNotice | null>(null);
  const [providers, setProviders] = useState<Record<Provider, boolean>>({
    google: false,
    microsoft: false,
    apple: false,
    facebook: false,
  });
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    document.title = `${t.pageTitle} · Aurum Nexus`;
  }, [t.pageTitle]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("auth")?.trim().toLowerCase();
    const providerError = params.get("error")?.trim().toLowerCase() ?? "";
    const isCancelled =
      authResult === "cancel" ||
      authResult === "cancelled" ||
      authResult === "canceled" ||
      providerError === "access_denied" ||
      providerError.includes("cancel");

    if (authResult === "success" && !params.has("error"))
      setOauthNotice("success");
    else if (isCancelled) setOauthNotice("cancelled");
    else if (params.has("auth") || params.has("error"))
      setOauthNotice("failure");

    if (params.has("auth") || params.has("error")) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.hash}`
      );
    }
  }, []);
  useEffect(() => {
    fetch("/api/auth/providers")
      .then(response =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Provider status unavailable"))
      )
      .then(data => {
        if (data.providers) setProviders(data.providers);
      })
      .catch(() => setErrorKind("providerStatus"));
  }, []);
  useEffect(() => {
    if (!session?.user) {
      setTickets([]);
      return;
    }
    fetch("/api/support/tickets", { credentials: "include" })
      .then(response => (response.ok ? response.json() : { tickets: [] }))
      .then(data => setTickets(data.tickets || []))
      .catch(() => setTickets([]));
  }, [session?.user?.id]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setErrorKind(null);
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              name: name.trim(),
              email: email.trim(),
              password,
            })
          : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setErrorKind("authentication");
        return;
      }
      await refetch();
    } catch {
      setErrorKind("authentication");
    } finally {
      setWorking(false);
    }
  };
  const signInSocial = async (provider: Provider) => {
    if (!providers[provider]) return;
    setWorking(true);
    setErrorKind(null);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/account?auth=success",
        errorCallbackURL: "/account?auth=error",
      });
      if (result.error) setErrorKind("socialStart");
    } catch {
      setErrorKind("socialStart");
    } finally {
      setWorking(false);
    }
  };
  const statusLabel = (status: string) => {
    const key = status
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const labels: Record<string, string> = {
      open: t.tickets.statuses.open,
      pending: t.tickets.statuses.pending,
      in_progress: t.tickets.statuses.inProgress,
      resolved: t.tickets.statuses.resolved,
      closed: t.tickets.statuses.closed,
    };
    return labels[key] ?? t.tickets.statuses.unknown;
  };
  const deliveryLabel = (deliveryStatus: string) => {
    const key = deliveryStatus
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const labels: Record<string, string> = {
      sent: t.tickets.delivery.sent,
      pending: t.tickets.delivery.pending,
      failed: t.tickets.delivery.failed,
      not_configured: t.tickets.delivery.notConfigured,
    };
    return labels[key] ?? t.tickets.delivery.unknown;
  };
  const createdDate = (value: string) =>
    Number.isNaN(new Date(value).getTime())
      ? t.tickets.dateUnavailable
      : formatDate(value, { dateStyle: "medium" });

  return (
    <Layout>
      <section className="border-b border-amber-200/15 bg-[#0b0a08] py-14 sm:py-20">
        <div className="container max-w-5xl">
          <span className="text-sm font-bold text-amber-300">
            {t.hero.eyebrow}
          </span>
          <h1 className="mt-3 text-4xl font-black text-white sm:text-5xl">
            {t.hero.title}
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-stone-300">
            {t.hero.description}
          </p>
        </div>
      </section>
      <div className="container max-w-5xl py-12 sm:py-16">
        {oauthNotice && (
          <p
            role={oauthNotice === "success" ? "status" : "alert"}
            aria-live="polite"
            className={`mb-6 rounded-xl border p-4 text-sm ${oauthNotice === "success" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-amber-300/30 bg-amber-300/10 text-amber-100"}`}
          >
            {t.oauth[oauthNotice]}
          </p>
        )}
        {isPending ? (
          <p role="status" className="text-stone-300">
            {t.loadingSession}
          </p>
        ) : session?.user ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-amber-200/20 bg-card p-7 sm:p-9">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="mb-4 inline-flex rounded-xl bg-amber-300/10 p-3 text-amber-300">
                    <UserRound aria-hidden="true" className="h-7 w-7" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">
                    {t.signedIn.welcome(session.user.name || t.signedIn.member)}
                  </h2>
                  <p className="mt-2 text-stone-300" dir="ltr">
                    <span className="sr-only">{t.signedIn.emailLabel}: </span>
                    {session.user.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await authClient.signOut();
                    await refetch();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 px-4 py-3 text-sm font-bold text-amber-200 hover:bg-amber-300/10"
                >
                  <LogOut aria-hidden="true" className="h-4 w-4" />
                  {t.signedIn.signOut}
                </button>
              </div>
            </div>
            <section
              aria-labelledby="tickets-title"
              className="rounded-2xl border border-amber-200/15 bg-card p-7"
            >
              <h2
                id="tickets-title"
                className="mb-4 text-xl font-bold text-white"
              >
                {t.tickets.title}
              </h2>
              {tickets.length ? (
                <ul className="space-y-3">
                  {tickets.map(ticket => (
                    <li
                      key={ticket.id}
                      className="rounded-xl border border-amber-200/10 p-4 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="font-bold text-stone-200">
                          {ticket.subject}
                        </h3>
                        <span className="text-amber-200" dir="ltr">
                          <span className="sr-only">{t.tickets.number}: </span>#
                          {ticket.id.slice(0, 8)}
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs text-stone-400">
                            {t.tickets.statusLabel}
                          </dt>
                          <dd className="mt-1 font-medium text-stone-200">
                            {statusLabel(ticket.status)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-stone-400">
                            {t.tickets.deliveryLabel}
                          </dt>
                          <dd className="mt-1 font-medium text-stone-200">
                            {deliveryLabel(ticket.deliveryStatus)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-stone-400">
                            {t.tickets.createdLabel}
                          </dt>
                          <dd className="mt-1 font-medium text-stone-200">
                            {createdDate(ticket.createdAt)}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone-400">
                  {t.tickets.emptyBefore}{" "}
                  <Link href="/support" className="text-amber-200 underline">
                    {t.tickets.supportLink}
                  </Link>
                  .
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_0.85fr]">
            <section className="rounded-2xl border border-amber-200/20 bg-card p-6 sm:p-8">
              <div
                role="tablist"
                aria-label={t.auth.tabsLabel}
                className="mb-7 grid grid-cols-2 gap-2 rounded-xl bg-[#0b0a08] p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  onClick={() => {
                    setMode("login");
                    setErrorKind(null);
                  }}
                  className={`rounded-lg p-3 text-sm font-bold ${mode === "login" ? "bg-amber-300 text-[#17130d]" : "text-stone-300"}`}
                >
                  {t.auth.loginTab}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signup"}
                  onClick={() => {
                    setMode("signup");
                    setErrorKind(null);
                  }}
                  className={`rounded-lg p-3 text-sm font-bold ${mode === "signup" ? "bg-amber-300 text-[#17130d]" : "text-stone-300"}`}
                >
                  {t.auth.signupTab}
                </button>
              </div>
              <h2 className="mb-6 text-xl font-bold text-white">
                {mode === "login" ? t.auth.loginTitle : t.auth.signupTitle}
              </h2>
              <form onSubmit={submit} className="space-y-5">
                {mode === "signup" && (
                  <label className="grid gap-2 text-sm font-bold text-stone-200">
                    {t.auth.nameLabel}
                    <input
                      required
                      autoComplete="name"
                      maxLength={120}
                      value={name}
                      onChange={event => setName(event.target.value)}
                      placeholder={t.auth.namePlaceholder}
                      className="min-h-12 rounded-xl border border-amber-200/20 bg-[#090806] px-4 text-white placeholder:text-stone-500"
                    />
                  </label>
                )}
                <label className="grid gap-2 text-sm font-bold text-stone-200">
                  {t.auth.emailLabel}
                  <input
                    required
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    maxLength={254}
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    placeholder={t.auth.emailPlaceholder}
                    className="min-h-12 rounded-xl border border-amber-200/20 bg-[#090806] px-4 text-white placeholder:text-stone-500"
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-stone-200">
                  {t.auth.passwordLabel}
                  <input
                    required
                    type="password"
                    minLength={mode === "signup" ? 10 : undefined}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    placeholder={t.auth.passwordPlaceholder}
                    className="min-h-12 rounded-xl border border-amber-200/20 bg-[#090806] px-4 text-white placeholder:text-stone-500"
                  />
                  {mode === "signup" && (
                    <span className="font-normal text-stone-400">
                      {t.auth.passwordHint}
                    </span>
                  )}
                </label>
                {mode === "signup" && (
                  <label className="flex items-start gap-3 text-xs leading-6 text-stone-300">
                    <input
                      type="checkbox"
                      required
                      className="mt-1 h-4 w-4 accent-amber-300"
                    />
                    <span>
                      {t.auth.consentPrefix}{" "}
                      <Link href="/terms" className="text-amber-200 underline">
                        {t.auth.terms}
                      </Link>{" "}
                      {t.auth.consentAnd}{" "}
                      <Link
                        href="/privacy"
                        className="text-amber-200 underline"
                      >
                        {t.auth.privacy}
                      </Link>
                    </span>
                  </label>
                )}
                <button
                  type="submit"
                  disabled={working}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-300 font-extrabold text-[#17130d] disabled:opacity-50"
                >
                  <LockKeyhole aria-hidden="true" className="h-4 w-4" />
                  {working
                    ? t.auth.checking
                    : mode === "login"
                      ? t.auth.loginSubmit
                      : t.auth.signupSubmit}
                </button>
              </form>
              {errorKind && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-red-400/30 p-3 text-sm text-red-200"
                >
                  {t.errors[errorKind]}
                </p>
              )}
            </section>
            <aside className="space-y-5">
              <div className="rounded-2xl border border-amber-200/20 bg-[#17140f] p-6 sm:p-8">
                <h2 className="mb-2 text-xl font-bold text-white">
                  {t.social.title}
                </h2>
                <p className="mb-5 text-sm leading-7 text-stone-400">
                  {t.social.description}
                </p>
                <div className="space-y-3">
                  {social.map(item => {
                    const providerName = t.social.providers[item.id];
                    return (
                      <button
                        type="button"
                        key={item.id}
                        disabled={!providers[item.id] || working}
                        onClick={() => void signInSocial(item.id)}
                        aria-label={t.social.continueWith(providerName)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-amber-200/20 bg-[#0d0b08] px-4 text-start text-sm font-bold text-stone-100 enabled:hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <span
                          aria-hidden="true"
                          className="grid h-7 w-7 place-items-center rounded-full border border-amber-300/40 font-bold text-amber-300"
                        >
                          {item.mark}
                        </span>
                        {t.social.continueWith(providerName)}
                        <span className="ms-auto text-xs font-normal text-stone-400">
                          {providers[item.id]
                            ? t.social.available
                            : t.social.pending}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="flex items-center gap-2 text-sm text-stone-400">
                <ShieldCheck
                  aria-hidden="true"
                  className="h-4 w-4 text-amber-300"
                />
                {t.security}
              </p>
              <Link
                href="/support"
                className="inline-flex items-center gap-2 text-sm text-amber-200 hover:text-amber-100"
              >
                <Mail aria-hidden="true" className="h-4 w-4" />
                {t.support}
              </Link>
            </aside>
          </div>
        )}
      </div>
    </Layout>
  );
}
