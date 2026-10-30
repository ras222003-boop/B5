import { describe, expect, it, vi } from "vitest";
import { createTapSandboxHostedCharge, validTapHostedChargeInput, type TapHostedChargeInput } from "./tapGateway";

const sample: TapHostedChargeInput = {
  orderId: "basira_web_order_001",
  amountHalalas: 2000,
  email: "example@example.org",
  firstName: "Test",
  lastName: "Customer",
  returnUrl: "https://basira.example.org/billing/return",
  webhookUrl: "https://basira.example.org/api/billing/tap-webhook",
};

const fakeCredentials = { secretKey: "sk_test_fake_value_never_live", merchantId: "123456" };

describe("Tap checkout is confined to server-side sandbox and no live charges", () => {
  it("validates server-owned order data", () => {
    expect(validTapHostedChargeInput(sample)).toBe(true);
    expect(validTapHostedChargeInput({ ...sample, amountHalalas: -1 })).toBe(false);
    expect(validTapHostedChargeInput({ ...sample, amountHalalas: 10.5 })).toBe(false);
    expect(validTapHostedChargeInput({ ...sample, returnUrl: "http://example.org" })).toBe(false);
    expect(validTapHostedChargeInput({ ...sample, webhookUrl: "https://example.org?token=1" })).toBe(false);
  });

  it("rejects private callback targets, ports, credentials and mixed callback origins", () => {
    for (const returnUrl of [
      "https://localhost/billing/return",
      "https://127.0.0.1/billing/return",
      "https://service.local/billing/return",
      "https://basira.example.org:8443/billing/return",
      "https://user:pass@basira.example.org/billing/return",
      "https://basira.example.org/billing/return?token=secret",
    ]) {
      expect(validTapHostedChargeInput({ ...sample, returnUrl })).toBe(false);
    }
    expect(validTapHostedChargeInput({
      ...sample,
      webhookUrl: "https://other.example.org/api/billing/tap-webhook",
    })).toBe(false);
  });

  it("rejects a live secret key before making a request", async () => {
    const request = vi.fn();
    await expect(createTapSandboxHostedCharge(sample,
      { ...fakeCredentials, secretKey: "sk_live_never_use" },
      request as unknown as typeof fetch
    )).rejects.toThrow("tap_sandbox_credentials_required");
    expect(request).not.toHaveBeenCalled();
  });

  it("creates an expected hosted checkout request with a test credential only", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "chg_TS012520220955Rr950709475",
      live_mode: false,
      status: "INITIATED",
      transaction: { url: "https://checkout.payments.tap.company/?token=test-token" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const response = await createTapSandboxHostedCharge(sample, fakeCredentials,
      request as unknown as typeof fetch);
    expect(response.chargeId).toMatch(/^chg_/);
    expect(response.checkoutUrl).toContain("https://checkout.payments.tap.company/");
    const [url, args] = request.mock.calls[0];
    expect(url).toBe("https://api.tap.company/v2/charges/");
    const body = JSON.parse(args.body);
    expect(body.amount).toBe(20);
    expect(body.currency).toBe("SAR");
    expect(body.source.id).toBe("src_all");
    expect(body.save_card).toBe(false);
    expect(body.redirect.url).toBe(sample.returnUrl);
    expect(body.post.url).toBe(sample.webhookUrl);
  });

  it("rejects any unexpected live-mode or redirected checkout domain", async () => {
    for (const payload of [
      { live_mode: true, transaction: { url: "https://checkout.payments.tap.company/" } },
      { live_mode: false, transaction: { url: "https://tap.company.attacker.example/" } },
      { live_mode: false, transaction: { url: "https://user@checkout.payments.tap.company/" } },
      { live_mode: false, transaction: { url: "https://checkout.payments.tap.company:444/" } },
      { live_mode: false, transaction: { url: "https://checkout.payments.tap.company/#fragment" } },
    ]) {
      const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        id: "chg_TS012520220955Rr950709475", status: "INITIATED", ...payload,
      }), { status: 200 }));
      await expect(createTapSandboxHostedCharge(sample, fakeCredentials,
        request as unknown as typeof fetch)).rejects.toThrow("tap_untrusted_checkout_response");
    }
  });
});
