import { describe, expect, it } from "vitest";
import { authOriginPolicy, validateAuthPublicOrigin } from "./authOrigins";

const approved = "https://basira-m7myneuo.manus.space";
describe("account HTTPS origin and environment boundary", () => {
  it.each([approved, `${approved}/`, "HTTPS://BASIRA-M7MYNEUO.MANUS.SPACE/"])(
    "canonicalizes an explicitly configured public origin: %s",
    input => {
      expect(validateAuthPublicOrigin(input)).toBe(approved);
    }
  );
  it.each([
    "http://basira-m7myneuo.manus.space",
    `${approved}/account`,
    `${approved}//`,
    `${approved}?next=evil`,
    `${approved}/?`,
    `${approved}#`,
    `${approved}:443`,
    "https://user:password@basira-m7myneuo.manus.space",
    `${approved} `,
    ` ${approved}`,
    "https://basira%2emanus.space",
    "https://basira.manus.space\\evil",
    "https://basira.manus.space\n",
    "https://localhost",
    "https://basira.localhost",
    "https://basira.local",
    "https://basira.test",
    "https://basira.example",
    "https://basira.invalid",
    "https://127.0.0.1",
    "https://0x7f.0.0.1",
    "https://basira.999",
    "https://basira..manus.space",
    "https://-basira.manus.space",
    "https://basira-.manus.space",
    "https://basira_manus.space",
    "https://basira.manus.space.",
    `https://${"a".repeat(64)}.manus.space`,
  ])("rejects ambiguous or non-public origin syntax: %s", input => {
    expect(() => validateAuthPublicOrigin(input)).toThrow(
      "BASIRA_PUBLIC_URL must be a public HTTPS origin"
    );
  });
  it.each([undefined, "production", "test"])(
    "never permits loopback hosts or HTTP trusted origins outside development: %s",
    nodeEnv => {
      const policy = authOriginPolicy({ nodeEnv, publicURL: approved });
      expect(policy.production).toBe(true);
      expect(policy.baseURL.protocol).toBe("https");
      expect(policy.baseURL.fallback).toBe(approved);
      expect(policy.baseURL.allowedHosts).toContain(
        "basira-m7myneuo.manus.space"
      );
      expect(
        policy.baseURL.allowedHosts.some(host =>
          /localhost|127\.0\.0\.1|\*/.test(host)
        )
      ).toBe(false);
      expect(
        policy.trustedOrigins.every(origin => origin.startsWith("https://"))
      ).toBe(true);
      expect(policy.trustedOrigins).toContain(approved);
    }
  );
  it("retains explicit development loopback access without trusting arbitrary HTTP hosts", () => {
    const policy = authOriginPolicy({ nodeEnv: "development" });
    expect(policy.production).toBe(false);
    expect(policy.baseURL.protocol).toBe("http");
    expect(policy.baseURL.allowedHosts).toContain("localhost:*");
    expect(policy.baseURL.allowedHosts).toContain("127.0.0.1:*");
    expect(policy.trustedOrigins).toContain("http://localhost:3000");
    expect(policy.trustedOrigins).not.toContain("http://evil.com");
  });
  it("does not silently migrate the deployed origin when configuration is absent", () => {
    expect(authOriginPolicy({}).baseURL.fallback).toBe(
      "https://basira-ve3h8rof.manus.space"
    );
    expect(authOriginPolicy({ publicURL: "" }).baseURL.fallback).toBe(
      "https://basira-ve3h8rof.manus.space"
    );
  });
  it("rejects invalid configuration without including credentials in the error", () => {
    const input = "https://user:very-private-password@basira.manus.space";
    let message = "";
    try {
      authOriginPolicy({ publicURL: input });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("BASIRA_PUBLIC_URL");
    expect(message).not.toContain("very-private-password");
  });
});
