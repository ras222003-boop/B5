import { describe, expect, it, vi } from "vitest";
import { fetchBillingAccountStatus } from "./billingAccount";

const requester = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue(new Response(
    body === undefined ? null : JSON.stringify(body),
    { status, headers: { "content-type": "application/json" } },
  )) as unknown as typeof fetch;

const paid = (tier: "basic" | "plus" | "premium") => ({
  authenticated: true,
  entitlement: {
    tier,
    activePaidSubscription: tier !== "basic",
    verifiedByServer: tier !== "basic",
  },
});

describe("billing page account state is fail-closed", () => {
  it("treats only an explicit 401 as signed out", async () => {
    expect(await fetchBillingAccountStatus(requester(401))).toEqual({ kind: "signed_out" });
    for (const code of [403, 429, 500, 503]) {
      expect(await fetchBillingAccountStatus(requester(code))).toEqual({ kind: "unavailable" });
    }
  });

  it("separates a genuine signed-in free account from verified paid plans", async () => {
    for (const tier of ["basic", "plus", "premium"] as const) {
      expect(await fetchBillingAccountStatus(requester(200, paid(tier)))).toEqual({
        kind: "signed_in", tier,
      });
    }
  });

  it("rejects empty, contradictory and unverified responses", async () => {
    for (const bad of [
      {}, null, { authenticated: false }, { ...paid("plus"), authenticated: false },
      { ...paid("plus"), entitlement: { ...paid("plus").entitlement, verifiedByServer: false } },
      { ...paid("premium"), entitlement: { ...paid("premium").entitlement, activePaidSubscription: false } },
      { ...paid("basic"), entitlement: { ...paid("basic").entitlement, activePaidSubscription: true } },
      { ...paid("basic"), entitlement: { ...paid("basic").entitlement, tier: "unknown" } },
    ]) {
      expect(await fetchBillingAccountStatus(requester(200, bad))).toEqual({ kind: "unavailable" });
    }
    expect(await fetchBillingAccountStatus(requester(200, { unexpected: "data" })))
      .toEqual({ kind: "unavailable" });
  });

  it("does not interpret network errors or broken JSON as sign-out", async () => {
    const networkError = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await fetchBillingAccountStatus(networkError)).toEqual({ kind: "unavailable" });
    const invalidJson = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchBillingAccountStatus(invalidJson)).toEqual({ kind: "unavailable" });
  });

  it("requests the server account without using stale cached status", async () => {
    const mock = requester(200, paid("basic"));
    await fetchBillingAccountStatus(mock);
    expect(mock).toHaveBeenCalledWith("/api/billing/me", {
      credentials: "include",
      cache: "no-store",
    });
  });
});
