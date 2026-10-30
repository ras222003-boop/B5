/** Tap Payments hosted-charge adapter for WEBSITE sandbox integration only.
 *
 * No payment endpoint calls this adapter today. Enable checkout only after
 * server-owned pricing, authenticated orders, replay-safe Tap webhook hash
 * verification, payment reconciliation and subscription policy are reviewed.
 *
 * Never use this service for digital purchases inside iOS App Store builds.
 */
type HttpClient = typeof fetch;

export interface TapHostedChargeInput {
  orderId: string;
  amountHalalas: number;
  email: string;
  firstName: string;
  lastName: string;
  returnUrl: string;
  webhookUrl: string;
}

export interface TapMerchantTestCredentials {
  secretKey: string;
  merchantId: string;
}

// Require paired HTTPS callback URLs on the same public origin; never
// allow private/loopback hosts or authentication credentials in callbacks.
function publicCallbackOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.search || url.hash || url.pathname === "/" || value !== url.href) return null;
    const hostname = url.hostname.toLowerCase();
    const labels = hostname.split(".");
    if (hostname.length > 253 || labels.length < 2 ||
        !/[a-z]/.test(hostname) ||
        /\\.(localhost|local|example|invalid|test)$/.test(hostname) ||
        labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    return url.origin;
  } catch {
    return null;
  }
}
const ORDER_ID = /^[a-zA-Z0-9_-]{10,90}$/;

export function validTapHostedChargeInput(value: TapHostedChargeInput): boolean {
  return ORDER_ID.test(value.orderId)
    && Number.isSafeInteger(value.amountHalalas)
    && value.amountHalalas >= 100
    && value.amountHalalas <= 1_000_000
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
    && value.email.length <= 254
    && value.firstName.length >= 1 && value.firstName.length <= 120
    && value.lastName.length >= 1 && value.lastName.length <= 120
    && publicCallbackOrigin(value.returnUrl) !== null
    && publicCallbackOrigin(value.returnUrl) === publicCallbackOrigin(value.webhookUrl);
}

export async function createTapSandboxHostedCharge(
  input: TapHostedChargeInput,
  credentials: TapMerchantTestCredentials,
  requester: HttpClient,
): Promise<{ chargeId: string; checkoutUrl: string }> {
  if (!validTapHostedChargeInput(input)) throw new Error("invalid_tap_checkout_input");
  if (!credentials.secretKey.startsWith("sk_test_") || !/^[0-9A-Za-z_-]{3,80}$/.test(credentials.merchantId)) {
    throw new Error("tap_sandbox_credentials_required");
  }
  const response = await requester("https://api.tap.company/v2/charges/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.secretKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      lang_code: "ar",
    },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      amount: input.amountHalalas / 100,
      currency: "SAR",
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      description: "Basira web subscription sandbox test",
      order: { id: input.orderId },
      customer: {
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
      },
      merchant: { id: credentials.merchantId },
      source: { id: "src_all" },
      post: { url: input.webhookUrl },
      redirect: { url: input.returnUrl },
    }),
  });
  if (!response.ok) throw new Error("tap_sandbox_charge_failed");
  const payload = await response.json() as {
    id?: unknown;
    live_mode?: unknown;
    status?: unknown;
    transaction?: { url?: unknown };
  };
  const checkoutUrl = typeof payload.transaction?.url === "string" ? payload.transaction.url : "";
  let checkout: URL;
  try { checkout = new URL(checkoutUrl); } catch { throw new Error("tap_invalid_checkout_url"); }
  if (payload.live_mode !== false ||
      typeof payload.id !== "string" || !/^chg_[a-zA-Z0-9_-]{10,}$/.test(payload.id) ||
      !["INITIATED", "IN_PROGRESS"].includes(String(payload.status)) ||
      !/^([a-z0-9-]+\\.)*tap\\.company$/i.test(checkout.hostname) ||
      checkout.protocol !== "https:" || checkout.username || checkout.password ||
      checkout.port || checkout.hash || !checkoutUrl.startsWith("https://")) {
    throw new Error("tap_untrusted_checkout_response");
  }
  return { chargeId: payload.id, checkoutUrl };
}

/** NEVER infer subscription entitlement from a redirect or initial charge.
 * Tap result must be retrieved and independently reconciled with a signed
 * verified webhook and an idempotent database order. Not implemented yet.
 */
