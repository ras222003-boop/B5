/** Server-only subscription entitlement policy.
 * Never activate from a redirect, unsigned receipt, client boolean or
 * unverified claim. The database may only be written by trusted provider
 * verifiers, to be implemented and independently audited before checkout.
 */
export type VerifiedEntitlementRow = {
  plan_id: "basic" | "plus" | "premium";
  provider: "APPLE_STOREKIT" | "TAP_WEB";
  verification_source: "APPLE_SERVER_VERIFIED" | "TAP_SERVER_RECONCILED";
  status: "ACTIVE" | "GRACE" | "EXPIRED" | "REVOKED";
  valid_until: Date | string | null;
  revoked_at: Date | string | null;
};

export function activeVerifiedTier(
  rows: readonly VerifiedEntitlementRow[],
  now = Date.now(),
): "basic" | "plus" | "premium" {
  const allowed = rows.filter(row => {
    if (!["plus", "premium"].includes(row.plan_id)) return false;
    if (!["ACTIVE", "GRACE"].includes(row.status)) return false;
    if (row.revoked_at != null) return false;
    if (!(
      (row.provider === "APPLE_STOREKIT" && row.verification_source === "APPLE_SERVER_VERIFIED") ||
      (row.provider === "TAP_WEB" && row.verification_source === "TAP_SERVER_RECONCILED")
    )) return false;
    if (!row.valid_until) return false;
    const until = new Date(row.valid_until).getTime();
    return Number.isFinite(until) && until > now;
  });
  return allowed.some(row => row.plan_id === "premium") ? "premium"
    : allowed.some(row => row.plan_id === "plus") ? "plus" : "basic";
}
