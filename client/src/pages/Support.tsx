import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Headphones,
  LifeBuoy,
  Mail,
  Send,
  Ticket,
  UserRound,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import Layout from "@/components/Layout";
import { useI18n, useMessages } from "@/i18n";
import { supportMessages } from "@/i18n/locales/support";

const SUPPORT_EMAIL = "aurum.nexus.r1@gmail.com";
const GREETING_ID = "support-greeting";
type Message = { id: string; role: "user" | "assistant"; content: string };
type TicketResult = {
  id: string;
  deliveryStatus: "sent" | "pending" | "failed";
  email: string;
};
type TicketRequest = {
  name: string;
  email: string;
  subject: string;
  description: string;
  transcript: string;
};
type IdempotencyEntry = { fingerprint: string; key: string };

export default function Support() {
  const { data: session } = authClient.useSession();
  const { dir, isRTL, lang } = useI18n();
  const t = useMessages(supportMessages);
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: GREETING_ID, role: "assistant", content: t.chat.greeting },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ticketError, setTicketError] = useState(false);
  const [ticket, setTicket] = useState<TicketResult | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const ticketIdempotencyRef = useRef<IdempotencyEntry | null>(null);

  useEffect(() => {
    document.title = t.meta.title;
  }, [t.meta.title]);
  useEffect(() => {
    setMessages(current =>
      current.map(message =>
        message.id === GREETING_ID
          ? { ...message, content: t.chat.greeting }
          : message
      )
    );
  }, [t.chat.greeting]);
  useEffect(() => {
    if (!session?.user) return;
    setName(current => {
      const next = current || session.user.name || "";
      if (next !== current) ticketIdempotencyRef.current = null;
      return next;
    });
    setEmail(current => {
      const next = current || session.user.email || "";
      if (next !== current) ticketIdempotencyRef.current = null;
      return next;
    });
  }, [session?.user]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages]);

  const resetTicketIdempotencyKey = () => {
    ticketIdempotencyRef.current = null;
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy) return;

    setChatError(false);
    setInput("");
    setBusy(true);
    const next = [
      ...messages,
      { id: crypto.randomUUID(), role: "user" as const, content },
    ];
    setMessages(next);

    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next
            .slice(1)
            .slice(-12)
            .map(({ role, content: messageContent }) => ({
              role,
              content: messageContent,
            })),
          language: lang,
        }),
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.reply !== "string")
        throw new Error("Support chat failed");
      setMessages(current => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: payload.reply },
      ]);
    } catch {
      setChatError(true);
      setMessages(current => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: t.chat.fallbackReply,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const createTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setTicketError(false);
    const ticketRequest: TicketRequest = {
      name: name.trim(),
      email: email.trim(),
      subject: subject.trim(),
      description: description.trim(),
      transcript: includeTranscript
        ? messages
            .map(
              message =>
                `${message.role === "user" ? t.transcript.user : t.transcript.assistant}: ${message.content}`
            )
            .join("\n")
            .slice(0, 5000)
        : "",
    };
    const fingerprint = JSON.stringify(ticketRequest);
    const existingEntry = ticketIdempotencyRef.current;
    const idempotencyKey =
      existingEntry?.fingerprint === fingerprint
        ? existingEntry.key
        : crypto.randomUUID();
    ticketIdempotencyRef.current = { fingerprint, key: idempotencyKey };

    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: fingerprint,
      });
      const payload = await response.json();
      if (!response.ok || !payload.id)
        throw new Error("Ticket submission failed");
      setTicket(payload);
      resetTicketIdempotencyKey();
    } catch {
      setTicketError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div dir={dir}>
        <section className="relative overflow-hidden border-b border-amber-200/15 bg-[#0b0a08] py-14 sm:py-20">
          <div
            className="absolute -start-20 top-8 h-80 w-80 rounded-full border border-amber-300/10"
            aria-hidden="true"
          />
          <div className="container relative max-w-6xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-bold text-amber-200">
              <Headphones aria-hidden="true" className="h-4 w-4" />{" "}
              {t.hero.badge}
            </span>
            <h1 className="mt-5 text-4xl font-black text-white sm:text-5xl">
              {t.hero.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-9 text-stone-300">
              {t.hero.description}
            </p>
          </div>
        </section>
        <div className="container grid max-w-6xl gap-8 py-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)] lg:py-16">
          <section
            aria-labelledby="chat-title"
            className="overflow-hidden rounded-2xl border border-amber-200/20 bg-[#14120e] shadow-xl"
          >
            <header className="flex items-center gap-3 border-b border-amber-200/15 p-5">
              <span className="rounded-xl bg-amber-300/15 p-3 text-amber-300">
                <Bot aria-hidden="true" className="h-6 w-6" />
              </span>
              <span>
                <h2 id="chat-title" className="text-lg font-bold text-white">
                  {t.chat.title}
                </h2>
                <span className="text-xs text-stone-400">
                  {t.chat.subtitle}
                </span>
              </span>
            </header>
            <div
              aria-label={t.chat.logLabel}
              aria-live="polite"
              className="max-h-[28rem] min-h-64 space-y-4 overflow-y-auto p-5"
            >
              {messages.map(message => (
                <div
                  key={message.id}
                  className={`max-w-[90%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-7 ${message.role === "user" ? "ms-auto rounded-se-none bg-amber-300 text-[#17130d]" : "me-auto rounded-ss-none border border-amber-200/15 bg-[#232019] text-stone-100"}`}
                >
                  {message.content}
                </div>
              ))}
              {busy && (
                <p className="text-sm text-amber-200" role="status">
                  {t.chat.thinking}
                </p>
              )}
              <div ref={endRef} />
            </div>
            <form
              onSubmit={sendMessage}
              className="flex gap-2 border-t border-amber-200/15 p-4"
            >
              <label htmlFor="support-message" className="sr-only">
                {t.chat.inputLabel}
              </label>
              <input
                id="support-message"
                value={input}
                onChange={event => setInput(event.target.value)}
                maxLength={1200}
                placeholder={t.chat.inputPlaceholder}
                className="min-w-0 flex-1 rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white placeholder:text-stone-500"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-xl bg-amber-300 px-5 font-bold text-[#17130d] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={t.chat.sendMessage}
              >
                <Send
                  aria-hidden="true"
                  className={`h-5 w-5 ${isRTL ? "-scale-x-100" : ""}`}
                />
              </button>
            </form>
            {chatError && (
              <p
                role="alert"
                className="mx-4 mb-4 rounded-lg border border-red-400/30 p-3 text-sm text-red-200"
              >
                {t.errors.chatUnavailable}
              </p>
            )}
          </section>
          <aside className="space-y-5">
            <div className="rounded-2xl border border-amber-300/25 bg-gradient-to-br from-[#302309] to-[#14110d] p-6">
              <LifeBuoy
                aria-hidden="true"
                className="mb-4 h-8 w-8 text-amber-300"
              />
              <h2 className="mb-3 text-xl font-bold text-white">
                {t.contact.title}
              </h2>
              <p className="mb-5 text-sm leading-7 text-stone-300">
                {t.contact.description}
              </p>
              <button
                type="button"
                onClick={() => {
                  setTicketOpen(true);
                  document
                    .getElementById("ticket-form")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-3 font-bold text-[#17130d] hover:bg-amber-200"
              >
                <Ticket aria-hidden="true" className="h-5 w-5" />{" "}
                {t.contact.openTicket}
              </button>
            </div>
            <div className="rounded-2xl border border-amber-200/15 bg-card p-6">
              <Mail
                aria-hidden="true"
                className="mb-3 h-6 w-6 text-amber-300"
              />
              <h2 className="font-bold text-white">{t.contact.emailTitle}</h2>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="mt-2 block break-all text-sm text-amber-200 underline"
                dir="ltr"
              >
                {SUPPORT_EMAIL}
              </a>
              <p className="mt-3 text-sm leading-7 text-stone-400">
                {t.contact.emailDescription}
              </p>
            </div>
            <Link
              href="/account"
              className="inline-flex items-center gap-2 text-sm text-amber-200 hover:text-amber-100"
            >
              <UserRound aria-hidden="true" className="h-4 w-4" />{" "}
              {t.contact.accountLink}{" "}
              <ArrowLeft
                aria-hidden="true"
                className={`h-4 w-4 ${isRTL ? "" : "rotate-180"}`}
              />
            </Link>
          </aside>
        </div>
        {ticketOpen && (
          <section
            id="ticket-form"
            aria-labelledby="ticket-heading"
            className="container max-w-4xl pb-16"
          >
            <div className="rounded-2xl border border-amber-200/20 bg-[#17140f] p-6 sm:p-9">
              <h2
                id="ticket-heading"
                className="mb-2 text-2xl font-black text-white"
              >
                {t.ticket.title}
              </h2>
              <p className="mb-6 text-sm leading-7 text-stone-400">
                {t.ticket.description}
              </p>
              {ticket ? (
                <div
                  role="status"
                  className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-5 text-stone-100"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="mb-2 h-7 w-7 text-amber-300"
                  />
                  <p className="font-bold">{t.ticket.saved(ticket.id)}</p>
                  <p className="mt-2 text-sm leading-7">
                    {ticket.deliveryStatus === "sent"
                      ? t.delivery.sent(SUPPORT_EMAIL)
                      : ticket.deliveryStatus === "failed"
                        ? t.delivery.failed
                        : ticket.deliveryStatus === "pending"
                          ? t.delivery.pending
                          : t.delivery.uncertain}
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={createTicket}
                  className="grid gap-5 sm:grid-cols-2"
                >
                  <label className="grid gap-2 text-sm font-bold text-stone-200">
                    {t.ticket.nameLabel}
                    <input
                      required
                      maxLength={120}
                      value={name}
                      onChange={event => {
                        resetTicketIdempotencyKey();
                        setName(event.target.value);
                      }}
                      className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-stone-200">
                    {t.ticket.emailLabel}
                    <input
                      required
                      type="email"
                      dir="ltr"
                      maxLength={254}
                      value={email}
                      onChange={event => {
                        resetTicketIdempotencyKey();
                        setEmail(event.target.value);
                      }}
                      className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-stone-200 sm:col-span-2">
                    {t.ticket.subjectLabel}
                    <input
                      required
                      minLength={4}
                      maxLength={160}
                      value={subject}
                      onChange={event => {
                        resetTicketIdempotencyKey();
                        setSubject(event.target.value);
                      }}
                      className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-bold text-stone-200 sm:col-span-2">
                    {t.ticket.descriptionLabel}
                    <textarea
                      required
                      minLength={10}
                      maxLength={4000}
                      rows={5}
                      value={description}
                      onChange={event => {
                        resetTicketIdempotencyKey();
                        setDescription(event.target.value);
                      }}
                      className="rounded-xl border border-amber-200/20 bg-[#090806] px-4 py-3 text-white"
                      placeholder={t.ticket.descriptionPlaceholder}
                    />
                  </label>
                  <label className="flex items-center gap-3 text-sm text-stone-300 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={includeTranscript}
                      onChange={event => {
                        resetTicketIdempotencyKey();
                        setIncludeTranscript(event.target.checked);
                      }}
                      className="h-5 w-5 accent-amber-300"
                    />{" "}
                    {t.ticket.transcriptConsent}
                  </label>
                  <button
                    disabled={saving}
                    type="submit"
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-6 font-bold text-[#17130d] disabled:opacity-50"
                  >
                    <Ticket aria-hidden="true" className="h-5 w-5" />{" "}
                    {saving ? t.ticket.saving : t.ticket.save}
                  </button>
                </form>
              )}
              {ticketError && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-red-400/30 p-3 text-sm text-red-200"
                >
                  {t.errors.ticketUnavailable}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
