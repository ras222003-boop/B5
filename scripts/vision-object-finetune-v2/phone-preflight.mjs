/** Read-only connectivity/model contract preflight. Does not install trust or relax TLS. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { X509Certificate } from "node:crypto";
export function isLocalPrivateUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return false;
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
  const parts = url.hostname.split(".");
  if (parts.length !== 4 || parts.some(p => !/^\d+$/.test(p))) return false;
  const a = parts.map(Number);
  if (a.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  return (
    a[0] === 10 ||
    (a[0] === 192 && a[1] === 168) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31)
  );
}
async function main() {
  const args = process.argv.slice(2),
    arg = name => {
      const i = args.indexOf(name);
      return i < 0 ? null : args[i + 1];
    };
  const origin = arg("--origin") ?? "http://127.0.0.1:4350";
  const output = resolve(
    arg("--output") ??
      "../.vision-test-fixtures/object-finetune-v2-001/camera/phone-preflight.json"
  );
  if (!isLocalPrivateUrl(origin))
    throw new Error("Only local/private origin allowed");
  const report = {
    schemaVersion: 1,
    scope: "existing_Basira_page_phone_readiness_not_a_phone_trial",
    phoneTested: false,
    physicalDeviceTested: false,
    status: "NOT_RUN_ON_IPHONE",
    mediaUploaded: false,
    trustStoreChanged: false,
    firewallChanged: false,
    securityProtectionChanged: false,
    tlsVerificationBypassed: false,
    httpsValidated: false,
    phoneModelAssetsAuthorized: false,
    iphoneMemoryMiB: null,
    iphoneLatencyMs: null,
    nortonStatus: "HISTORICAL_INTERCEPTION_REPORTED_NOT_RETESTED",
  };
  const response = await fetch(origin + "/api/vision/object-quality/manifest", {
    signal: AbortSignal.timeout(10000),
  });
  report.httpStatus = response.status;
  if (response.ok) {
    const j = await response.json();
    report.localProfiles = (j.profiles ?? [j.profile])
      .filter(Boolean)
      .map(p => ({
        id: p.id,
        modelSha256: p.modelSha256,
        maskForStills: p.maskForStills,
        navigationEligible: p.navigationEligible,
        productionEligible: p.productionEligible,
      }));
  }
  const secure = arg("--https-url"),
    caPath = arg("--ca");
  if (Boolean(secure) !== Boolean(caPath))
    throw new Error(
      "Supply both authorized HTTPS URL and public CA certificate"
    );
  if (secure && caPath) {
    const url = new URL(secure);
    if (url.protocol !== "https:" || !isLocalPrivateUrl(url))
      throw new Error("Explicit private HTTPS target required");
    if (/(?:^|[-_.])(private|key)(?:[-_.]|$)/i.test(basename(caPath)))
      throw new Error("Pass the public root certificate, never a key");
    const certificate = await readFile(resolve(caPath));
    const parsed = new X509Certificate(certificate);
    if (!parsed.ca)
      throw new Error("The public trust anchor must be a CA certificate");
    report.publicRootCertificate = {
      fingerprint256: parsed.fingerprint256,
      subject: parsed.subject,
      issuer: parsed.issuer,
      validFrom: parsed.validFrom,
      validTo: parsed.validTo,
    };
    report.httpsUrl = secure;
    report.httpsValidationMeaning =
      "TLS chain/hostname only; an authenticated phone model-asset path still requires its own authorized test.";
    await new Promise(resolveDone => {
      const request = https.get(
        url,
        { ca: parsed.toString(), rejectUnauthorized: true, timeout: 10000 },
        r => {
          report.httpsStatus = r.statusCode;
          report.httpsValidated = r.socket.authorized === true;
          report.peerCertificateIssuer =
            r.socket.getPeerCertificate().issuer ?? null;
          r.resume();
          r.on("end", resolveDone);
        }
      );
      request.on("timeout", () =>
        request.destroy(new Error("HTTPS preflight timed out"))
      );
      request.on("error", e => {
        report.httpsError = { code: e.code ?? null, message: e.message };
        resolveDone();
      });
    });
  } else
    report.httpsPendingReason =
      "No explicit authorized HTTPS target and public CA certificate supplied. Current development origin is HTTP/loopback; LAN model access remains restricted.";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
