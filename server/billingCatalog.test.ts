import { describe, expect, it } from "vitest";
import { basiraBillingCapabilities, basiraPlans } from "./billingCatalog";

describe("Basira subscription release controls", () => {
  it("offers three clearly distinguished tiers without fabricated prices", () => {
    expect(basiraPlans.map(plan => plan.id)).toEqual(["basic", "plus", "premium"]);
    expect(new Set(basiraPlans.map(plan => plan.id)).size).toBe(3);
    expect(basiraPlans.every(plan => plan.availability === "not_configured" && plan.price === null)).toBe(true);
  });

  it("does not activate paid entitlements or external web checkout by default", () => {
    expect(basiraBillingCapabilities.appleStoreKit.checkoutEnabled).toBe(false);
    expect(basiraBillingCapabilities.appleStoreKit.serverVerificationEnabled).toBe(false);
    expect(basiraBillingCapabilities.tapWeb.checkoutEnabled).toBe(false);
    expect(basiraBillingCapabilities.tapWeb.webOnly).toBe(true);
  });
});
