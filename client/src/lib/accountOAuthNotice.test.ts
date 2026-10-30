import { describe, expect, it } from "vitest";
import { accountOAuthNotice, parseOAuthReturn } from "./accountOAuthNotice";

describe("account OAuth receipt and verified session", () => {
  it("never treats a manually supplied success URL as an authenticated session", () => {
    const receipt = parseOAuthReturn("?auth=success");
    expect(
      accountOAuthNotice(receipt, {
        pending: false,
        authenticated: false,
        failed: false,
      })
    ).toBe("unconfirmed");
  });

  it("waits for session verification, including when cached user data exists", () => {
    const receipt = parseOAuthReturn("?auth=success");
    expect(
      accountOAuthNotice(receipt, {
        pending: true,
        authenticated: false,
        failed: false,
      })
    ).toBeNull();
    expect(
      accountOAuthNotice(receipt, {
        pending: true,
        authenticated: true,
        failed: false,
      })
    ).toBeNull();
    expect(
      accountOAuthNotice(receipt, {
        pending: false,
        authenticated: true,
        failed: false,
      })
    ).toBe("success");
  });

  it("does not claim success for a session lookup error with stale user data", () => {
    expect(
      accountOAuthNotice(parseOAuthReturn("?auth=success"), {
        pending: false,
        authenticated: true,
        failed: true,
      })
    ).toBe("unconfirmed");
  });

  it("withdraws confirmation after the account session disappears", () => {
    const receipt = parseOAuthReturn("?auth=success");
    expect(
      accountOAuthNotice(receipt, {
        pending: false,
        authenticated: true,
        failed: false,
      })
    ).toBe("success");
    expect(
      accountOAuthNotice(receipt, {
        pending: false,
        authenticated: false,
        failed: false,
      })
    ).toBe("unconfirmed");
  });

  it.each([
    "?auth=cancel",
    "?auth=cancelled",
    "?auth=canceled",
    "?error=access_denied",
    "?error=user_cancelled",
  ])(
    "preserves cancellation without altering an existing session: %s",
    search => {
      expect(
        accountOAuthNotice(parseOAuthReturn(search), {
          pending: false,
          authenticated: true,
          failed: false,
        })
      ).toBe("cancelled");
    }
  );

  it.each([
    "?auth=error",
    "?error=provider_unavailable",
    "?auth=success&error=server_error",
    "?auth=success&error=",
    "?auth=success&auth=error",
    "?auth=success&error=cancelled&error=server_error",
    "?auth=unknown",
    "?auth=",
  ])(
    "never reports a successful provider return for an error or ambiguous receipt: %s",
    search => {
      expect(
        accountOAuthNotice(parseOAuthReturn(search), {
          pending: false,
          authenticated: true,
          failed: false,
        })
      ).toBe("failure");
    }
  );

  it("shows no provider-return notice for an ordinary account visit", () => {
    expect(parseOAuthReturn("?lang=en")).toBeNull();
    expect(
      accountOAuthNotice(null, {
        pending: false,
        authenticated: true,
        failed: false,
      })
    ).toBeNull();
  });
});
