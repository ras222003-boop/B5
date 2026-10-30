/** Account status for the billing page, not an authorization token.
 * Only /api/billing/me from the authenticated Basira server can describe
 * server-verified paid access. A network/server error is NOT a sign-out.
 */
export type BillingTier = "basic" | "plus" | "premium";
export type BillingAccountState =
  | { kind: "signed_out" }
  | { kind: "signed_in"; tier: BillingTier }
  | { kind: "unavailable" };

export async function fetchBillingAccountStatus(
  requester: typeof fetch = fetch,
): Promise<BillingAccountState> {
  try {
    const response = await requester("/api/billing/me", {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) return { kind: "signed_out" };
    if (!response.ok) return { kind: "unavailable" };

    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { kind: "unavailable" };
    }
    const data = body as Record<string, unknown>;
    if (data.authenticated !== true || !data.entitlement ||
        typeof data.entitlement !== "object" || Array.isArray(data.entitlement)) {
      return { kind: "unavailable" };
    }
    const entitlement = data.entitlement as Record<string, unknown>;
    const tier = entitlement.tier;
    if (tier !== "basic" && tier !== "plus" && tier !== "premium") {
      return { kind: "unavailable" };
    }
    const hasPaidAccess = tier !== "basic";
    // A conflicting or unverified paid claim is never shown as active.
    if (entitlement.activePaidSubscription !== hasPaidAccess ||
        entitlement.verifiedByServer !== hasPaidAccess) {
      return { kind: "unavailable" };
    }
    return { kind: "signed_in", tier };
  } catch {
    return { kind: "unavailable" };
  }
}
