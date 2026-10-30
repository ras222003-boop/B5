import type { Express } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";

type MobileManifest = {
  schemaVersion: 1;
  product: "basira";
  sourceRevision: string | null;
  sourceVerified: boolean;
  webBundle: { assetCount: number; totalBytes: number; sha256: string; indexSha256: string };
  declaredRoutes: string[];
  disclaimer: string;
};

const sha256 = /^[0-9a-f]{64}$/;
const gitSha = /^[0-9a-f]{40}$/;

export function parseMobileManifest(raw: string): MobileManifest | null {
  try {
    const manifest: unknown = JSON.parse(raw);
    if (!manifest || typeof manifest !== "object") return null;
    const m = manifest as Record<string, unknown>;
    if (m.schemaVersion !== 1 || m.product !== "basira") return null;
    if (typeof m.sourceVerified !== "boolean") return null;
    if (m.sourceVerified && (typeof m.sourceRevision !== "string" || !gitSha.test(m.sourceRevision))) return null;
    if (!m.sourceVerified && m.sourceRevision !== null) return null;
    if (!m.webBundle || typeof m.webBundle !== "object") return null;
    const b = m.webBundle as Record<string, unknown>;
    if (!Number.isSafeInteger(b.assetCount) || (b.assetCount as number) <= 0) return null;
    if (!Number.isSafeInteger(b.totalBytes) || (b.totalBytes as number) <= 0) return null;
    if (typeof b.sha256 !== "string" || !sha256.test(b.sha256)) return null;
    if (typeof b.indexSha256 !== "string" || !sha256.test(b.indexSha256)) return null;
    if (!Array.isArray(m.declaredRoutes) || m.declaredRoutes.length === 0 ||
        m.declaredRoutes.some(x => typeof x !== "string" || !x.startsWith("/") || x.length > 200)) return null;
    if (typeof m.disclaimer !== "string") return null;
    return m as MobileManifest;
  } catch {
    return null;
  }
}

/// Reports the actual web build identity next to the live API.
/// Do not use this as an accuracy or physical safety certificate.
/// The release gate still checks public HTML routes, redirects and readiness.
export function registerMobileReleaseInfoRoute(
  app: Express,
  root = path.resolve(process.cwd(), "dist", "public"),
) {
  app.get("/api/mobile-release-info", async (_req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      const raw = await readFile(path.resolve(root, "basira-mobile-release.json"), "utf8");
      const manifest = parseMobileManifest(raw);
      if (!manifest) {
        res.status(503).json({ status: "UNVERIFIED", reason: "invalid_build_manifest" });
        return;
      }
      res.status(manifest.sourceVerified ? 200 : 503).json({
        status: manifest.sourceVerified ? "BUILT" : "UNVERIFIED",
        ...manifest,
      });
    } catch {
      res.status(503).json({ status: "UNVERIFIED", reason: "build_manifest_missing" });
    }
  });
}
