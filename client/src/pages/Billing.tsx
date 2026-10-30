import { useEffect, useState } from "react";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";

type Plan = {
  id: "basic" | "plus" | "premium";
  titleAr: string;
  titleEn: string;
  benefitsAr: string[];
  price: null;
  availability: "not_configured";
};
type Catalog = {
  schemaVersion: number;
  plans: Plan[];
  providers: {
    appleStoreKit: { checkoutEnabled: boolean };
    tapWeb: { checkoutEnabled: boolean };
  };
};
type AccountStatus = {
  authenticated: boolean;
  entitlement: { tier: string; activePaidSubscription: boolean; verifiedByServer: boolean };
};

export default function Billing() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const zh = lang === "zh-CN";
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch("/api/billing/catalog", { credentials: "same-origin", cache: "no-store" }),
      fetch("/api/billing/me", { credentials: "include", cache: "no-store" }),
    ]).then(async ([plans, me]) => {
      if (!plans.ok) throw Error("catalog_unavailable");
      const publicCatalog = (await plans.json()) as Catalog;
      const status = me.ok ? await me.json() as AccountStatus : null;
      if (!mounted) return;
      setCatalog(publicCatalog);
      setAccount(status);
      setError(false);
    }).catch(() => { if (mounted) setError(true); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const title = ar ? "اشتراكات بصيرة" : zh ? "Basira 订阅" : "Basira subscriptions";
  const caption = ar
    ? "خدمات رقمية باشتراكات واضحة. لن نحصّل أي مبلغ حتى تكتمل بوابات الدفع والتحقق من المدفوعات."
    : zh
      ? "付费功能尚未启用。所有付款须经过官方渠道验证。"
      : "Digital subscriptions are being prepared. No payments are accepted until secure verification is ready.";

  return (
    <Layout>
      <main className="container max-w-5xl py-12 sm:py-16" dir={ar ? "rtl" : "ltr"}>
        <h1 className="text-3xl font-black text-foreground">{title}</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">{caption}</p>
        <section className="mt-8 rounded-2xl border border-amber-300/30 bg-card p-5" aria-label={ar ? "حالة الحساب" : "Account status"}>
          <h2 className="text-xl font-bold">{ar ? "الحساب" : "Account"}</h2>
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {account?.authenticated
              ? (ar ? "تم العثور على جلسة حساب. لا توجد صلاحيات مدفوعة مفعّلة حتى اكتمال التحقق الخادمي." : "Signed in. Paid entitlements are not yet enabled.")
              : (ar ? "يمكنك إنشاء حساب أو تسجيل الدخول مجانًا." : "Create an account or sign in for free.")}
          </p>
          <Link href="/account" className="mt-4 inline-flex min-h-12 items-center rounded-lg border border-amber-400/60 px-5 font-semibold text-amber-700">
            {ar ? "تسجيل الدخول أو إنشاء حساب" : "Sign in or sign up"}
          </Link>
        </section>

        {loading && <p className="mt-8" role="status">{ar ? "جارٍ تحميل خيارات الاشتراك…" : "Loading subscription options…"}</p>}
        {error && <p className="mt-8 text-amber-700" role="alert">
          {ar ? "تعذر تحميل خيارات الاشتراك. لم يتم بدء أي عملية دفع." : "Could not load plans. No payment was initiated."}
        </p>}

        <section className="mt-8 grid gap-5 sm:grid-cols-3" aria-label={ar ? "الخطط" : "Plans"}>
          {catalog?.plans.map(plan => (
            <article key={plan.id} className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-xl font-bold">{ar ? plan.titleAr : plan.titleEn}</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {ar ? "السعر لم يُعتمد بعد" : "Price not set"}
              </p>
              <ul className="mt-5 list-disc space-y-2 ps-5 text-sm">
                {plan.benefitsAr.map(benefit => <li key={benefit}>{benefit}</li>)}
              </ul>
              <p className="mt-5 rounded-lg bg-muted p-3 text-sm" role="status">
                {ar ? "غير متاح للشراء حاليًا" : "Not available for purchase"}
              </p>
            </article>
          ))}
        </section>
        <section className="mt-8 rounded-xl border border-border p-5">
          <h2 className="font-bold">{ar ? "وسائل الدفع" : "Payment methods"}</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {ar
              ? "على iPhone تُباع الاشتراكات الرقمية عبر Apple StoreKit. ويجري تجهيز Tap للمدفوعات عبر موقع الويب فقط، بما يتوافق مع سياسة App Store."
              : "Digital iPhone subscriptions use Apple StoreKit. Tap is reserved for a separate web checkout subject to App Store rules."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {ar ? "لن تُفعّل أي اشتراكات اعتمادًا على تأكيد صادر من المتصفح وحده." : "Browser-only confirmations never activate subscriptions."}
          </p>
        </section>
      </main>
    </Layout>
  );
}
