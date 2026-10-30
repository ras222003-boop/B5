import { describe, expect, it } from "vitest";
import { activeVerifiedTier, type VerifiedEntitlementRow } from "./billingEntitlements";

const baseline: VerifiedEntitlementRow = {
  plan_id: "plus",
  provider: "APPLE_STOREKIT",
  verification_source: "APPLE_SERVER_VERIFIED",
  status: "ACTIVE",
  valid_until: new Date("2027-12-31T00:00:00Z"),
  revoked_at: null,
};
const now = new Date("2026-10-30T00:00:00Z").getTime();

describe("Basira paid access grants require server-verified entitlement", () => {
  it("denies unknown, revoked, expired and indefinite claims", () => {
    expect(activeVerifiedTier([], now)).toBe("basic");
    expect(activeVerifiedTier([{ ...baseline, status: "REVOKED" }], now)).toBe("basic");
    expect(activeVerifiedTier([{ ...baseline, valid_until: new Date("2025-10-30") }], now)).toBe("basic");
    expect(activeVerifiedTier([{ ...baseline, valid_until: null }], now)).toBe("basic");
    expect(activeVerifiedTier([{ ...baseline, revoked_at: new Date() }], now)).toBe("basic");
  });
  it("does not accept mismatched provider verification", () => {
    expect(activeVerifiedTier([{ ...baseline, verification_source: "TAP_SERVER_RECONCILED" }], now)).toBe("basic");
    expect(activeVerifiedTier([{ ...baseline, provider: "TAP_WEB", verification_source: "TAP_SERVER_RECONCILED" }], now)).toBe("plus");
  });
  it("allows non-expired properly verified tiers and prioritizes premium", () => {
    expect(activeVerifiedTier([baseline], now)).toBe("plus");
    expect(activeVerifiedTier([{ ...baseline, status: "GRACE" }], now)).toBe("plus");
    expect(activeVerifiedTier([baseline, { ...baseline, plan_id: "premium" }], now)).toBe("premium");
  });
});
