export type OAuthReturnReceipt = "success" | "failure" | "cancelled";
export type AccountOAuthNotice = OAuthReturnReceipt | "unconfirmed";

/** A provider return URL is only a receipt, never proof of authentication. */
export function parseOAuthReturn(search: string): OAuthReturnReceipt | null {
  const params = new URLSearchParams(search);
  const results = params.getAll("auth");
  const errors = params.getAll("error");
  if (!results.length && !errors.length) return null;
  if (results.length > 1 || errors.length > 1) return "failure";

  const result = results[0]?.trim().toLowerCase();
  const error = errors[0]?.trim().toLowerCase() ?? "";
  if (result === "success" && !errors.length) return "success";
  if (
    ["cancel", "cancelled", "canceled"].includes(result ?? "") ||
    error === "access_denied" ||
    error.includes("cancel")
  )
    return "cancelled";
  return "failure";
}

/** Only the account SDK's completed session lookup can confirm sign-in. */
export function accountOAuthNotice(
  receipt: OAuthReturnReceipt | null,
  session: { pending: boolean; authenticated: boolean; failed: boolean }
): AccountOAuthNotice | null {
  if (receipt !== "success") return receipt;
  if (session.pending) return null;
  return session.authenticated && !session.failed ? "success" : "unconfirmed";
}
