import { describe, expect, it } from "vitest";
import { parseMobileManifest } from "./mobileReleaseInfo";

const good = {
  schemaVersion: 1,
  product: "basira",
  sourceRevision: "a".repeat(40),
  sourceVerified: true,
  webBundle: {
    assetCount: 2,
    totalBytes: 1000,
    sha256: "b".repeat(64),
    indexSha256: "c".repeat(64),
  },
  declaredRoutes: ["/navigation", "/navigation/vision", "/exam-demo"],
  disclaimer: "This is a build receipt, not a field safety certificate",
};

describe("mobile native release manifest verification", () => {
  it("accepts a build manifest with a real revision and digest fields", () => {
    expect(parseMobileManifest(JSON.stringify(good))?.sourceVerified).toBe(true);
  });
  it.each([
    null, [], {}, { schemaVersion: 2 },
    { ...good, product: "another-app" },
    { ...good, sourceVerified: true, sourceRevision: "main" },
    { ...good, sourceVerified: false, sourceRevision: good.sourceRevision },
    { ...good, webBundle: { ...good.webBundle, indexSha256: "invalid" } },
    { ...good, webBundle: { ...good.webBundle, assetCount: -1 } },
    { ...good, declaredRoutes: ["../invalid"] },
    { ...good, declaredRoutes: [] },
    { ...good, disclaimer: 123 },
  ])("refuses malformed or untrusted release receipts", value => {
    expect(parseMobileManifest(JSON.stringify(value))).toBeNull();
  });
  it("supports explicitly unknown source without claiming a verified revision", () => {
    const candidate = { ...good, sourceVerified: false, sourceRevision: null };
    expect(parseMobileManifest(JSON.stringify(candidate))?.sourceVerified).toBe(false);
  });
  it("refuses non-JSON and corrupted data", () => {
    expect(parseMobileManifest("{")).toBeNull();
  });
});
