import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const gitSHA = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const REQUIRED_ROUTES = [
  "/navigation", "/navigation/vision", "/navigation/guidance",
  "/exam-demo", "/assistant", "/account", "/settings/voice", "/teacher",
];

export function validateMobileOrigin(raw) {
  if (typeof raw !== "string" || raw.trim() !== raw || !raw || /\s|\\/.test(raw)) {
    throw Error("BASIRA_IOS_WEB_ORIGIN is missing or malformed");
  }
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !host ||
      url.username || url.password || url.port ||
      !["", "/"].includes(url.pathname) || url.search || url.hash ||
      host === "localhost" || host.endsWith(".local") ||
      [".example", ".invalid", ".test"].some(suffix => host.endsWith(suffix)) ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) {
    throw Error("BASIRA_IOS_WEB_ORIGIN must be a public, path-free HTTPS origin");
  }
  return url.origin;
}

function sha(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function fetchResource(request, origin, suffix, kind) {
  const response = await request(origin + suffix, {
    redirect: "manual",
    headers: { Accept: kind === "json" ? "application/json" : "text/html" },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status !== 200) {
    throw Error(suffix + " returned HTTP " + response.status +
      (response.status >= 300 && response.status < 400 ? " (redirect: hosting login or unexpected origin)" : ""));
  }
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes(kind === "json" ? "application/json" : "text/html"))
    throw Error(suffix + " returned unexpected Content-Type " + type);
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > 2_000_000) throw Error(suffix + " returned too much content");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2_000_000) throw Error(suffix + " response exceeds 2MB bound");
  return kind === "json" ? JSON.parse(bytes.toString("utf8")) : bytes;
}

export function currentCheckoutSHA(cwd = process.cwd()) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], cwd, timeout: 5000,
  }).trim().toLowerCase();
  if (!gitSHA.test(commit)) throw Error("Cannot verify checked out Git commit");
  return commit;
}

/// Checks the *deployed* server AND its public browser routes, not just
/// Codemagic source code. This does not assert correctness of models, OCR,
/// safety, speech, LiDAR or account login; those need independent field gates.
export async function checkMobileRelease({
  origin, expectedRevision, request = fetch, tier = "internal",
} = {}) {
  const base = validateMobileOrigin(origin);
  if (!gitSHA.test(expectedRevision ?? "")) throw Error("Expected revision must be full Git SHA");
  if (!["internal", "release"].includes(tier)) throw Error("Unknown verification tier");

  const info = await fetchResource(request, base, "/api/mobile-release-info", "json");
  if (info.product !== "basira" || info.schemaVersion !== 1 ||
      info.status !== "BUILT" || info.sourceVerified !== true ||
      info.sourceRevision !== expectedRevision)
    throw Error("Deployed Basira source revision does not match this iOS checkout");
  const bundle = info.webBundle;
  if (!bundle || !Number.isSafeInteger(bundle.assetCount) || bundle.assetCount < 2 ||
      !Number.isSafeInteger(bundle.totalBytes) || bundle.totalBytes <= 0 ||
      !sha256.test(bundle.sha256 ?? "") || !sha256.test(bundle.indexSha256 ?? ""))
    throw Error("Deployed web bundle manifest is invalid");
  if (!Array.isArray(info.declaredRoutes) ||
      REQUIRED_ROUTES.some(route => !info.declaredRoutes.includes(route)))
    throw Error("Deployed Basira build is missing a required public route");

  const readiness = await fetchResource(request, base, "/api/readiness", "json");
  if (readiness.status !== "READY" ||
      ["api", "database", "authentication", "mapCore"].some(key => readiness.capabilities?.[key] !== "READY"))
    throw Error("Basira backend dependencies are not READY");

  // A public route must load directly in the app without an unrelated Manus
  // session or a login redirect. Hashing detects stale HTML in a split CDN.
  const entry = await fetchResource(request, base, "/", "html");
  if (sha(entry) !== bundle.indexSha256)
    throw Error("Root HTML does not match the deployed Basira build manifest");

  for (const route of REQUIRED_ROUTES) {
    const document = await fetchResource(request, base, route, "html");
    if (sha(document) !== bundle.indexSha256)
      throw Error(route + " resolves to a different/obsolete HTML application");
  }

  if (tier === "release") {
    const model = await fetchResource(request, base, "/api/vision/object-quality/manifest", "json");
    if (model.enabled !== true ||
        !Array.isArray(model.profiles) ||
        !model.profiles.some(profile => profile.id === "objects-basira-v3" && profile.commercialTrainingAllowed === true))
      throw Error("Approved commercial V3 model assets are not publicly available; full release blocked");
    if (readiness.capabilities?.optionalModels !== "AVAILABLE")
      throw Error("Optional production model dependencies are degraded");
  }

  return {
    status: "WEB_BACKEND_VERIFIED",
    tier,
    origin: base,
    sourceRevision: info.sourceRevision,
    assetCount: bundle.assetCount,
    routeCount: REQUIRED_ROUTES.length,
    note: "Deployment consistency only; does not certify accessibility or mobility safety",
  };
}

if (process.argv[1]?.endsWith("/check-mobile-release.mjs")) {
  const origin = process.env.BASIRA_IOS_WEB_ORIGIN;
  const revision = currentCheckoutSHA();
  const tier = process.env.BASIRA_MOBILE_RELEASE_TIER || "internal";
  checkMobileRelease({ origin, expectedRevision: revision, tier })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error("BASIRA MOBILE RELEASE BLOCKED:", error.message);
      process.exitCode = 1;
    });
}
