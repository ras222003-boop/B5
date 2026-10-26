/** Bounded GET-only public deployment audit. Never authenticates, probes secrets or changes production. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const origin = process.argv[2],
  root = resolve(process.argv[3] ?? "");
const u = new URL(origin);
if (
  u.protocol !== "https:" ||
  u.origin !== origin ||
  u.hostname !== "basira-m7myneuo.manus.space"
)
  throw Error("Use the owner-identified original HTTPS origin explicitly");
await mkdir(resolve(root, "published-public"), { recursive: true });
const rows = [],
  hash = b => createHash("sha256").update(b).digest("hex");
async function get(path, max = 2_000_000) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
    throw Error("Invalid observed resource path");
  const started = performance.now();
  try {
    const r = await fetch(origin + path, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      }),
      buffers = [];
    let n = 0;
    for await (const b of r.body ?? []) {
      n += b.length;
      if (n > max) {
        await r.body?.cancel().catch(() => {});
        throw Error("Public resource exceeds audit bound");
      }
      buffers.push(b);
    }
    const bytes = Buffer.concat(buffers),
      type = r.headers.get("content-type") ?? "";
    const row = {
      path,
      status: r.status,
      contentType: type,
      bytes: bytes.length,
      sha256: hash(bytes),
      elapsedMs: Math.round(performance.now() - started),
    };
    rows.push(row);
    return { row, bytes, text: bytes.toString("utf8") };
  } catch (e) {
    const row = { path, status: null, error: e.message };
    rows.push(row);
    return { row, bytes: Buffer.alloc(0), text: "" };
  }
}
const page = await get("/");
await writeFile(resolve(root, "published-public/index.html"), page.bytes, {
  flag: "wx",
});
const scripts = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
  .map(x => x[1])
  .filter(x => /^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(x));
let entry = "",
  vision = "";
for (const path of scripts.slice(0, 2)) {
  const r = await get(path, 8_000_000);
  entry += r.text;
  await writeFile(
    resolve(root, "published-public", path.split("/").at(-1)),
    r.bytes,
    { flag: "wx" }
  );
}
const observed = [
  ...entry.matchAll(/["']((?:\/)?assets\/Vision-[a-zA-Z0-9_.-]+\.js)["']/g),
].map(x => "/" + x[1].replace(/^\//, ""));
for (const path of [...new Set(observed)].slice(0, 2)) {
  const r = await get(path, 3_000_000);
  vision += r.text;
  await writeFile(
    resolve(root, "published-public", path.split("/").at(-1)),
    r.bytes,
    { flag: "wx" }
  );
}
for (const path of [
  "/__manus__/version.json",
  "/api/health",
  "/api/readiness",
  "/api/vision/object-quality/manifest",
  "/api/vision/experimental-models",
  "/api/speech/capabilities",
])
  await get(path, 100_000);
const detector = await get("/vision/efficientdet_lite0_int8.tflite", 6_000_000);
let localSha = null;
try {
  localSha = hash(
    await readFile("client/public/vision/efficientdet_lite0_int8.tflite")
  );
} catch {}
const corpus = entry + vision;
const report = {
  schemaVersion: 1,
  originalOrigin: origin,
  atUtc: new Date().toISOString(),
  method: "GET_ONLY_PUBLIC_RESOURCES_NO_LOGIN_OR_MUTATION",
  title: page.text.match(/<title>([^<]+)<\/title>/)?.[1] ?? null,
  observedEntryScripts: scripts,
  observedVisionChunks: [...new Set(observed)],
  rows,
  compiledFeatureStrings: {
    objectModelV3: corpus.includes("objects-basira-v3"),
    localTrial: corpus.includes("sourcePixelVariation"),
    objectColour:
      corpus.includes("وصف الألوان") || corpus.includes("object-color"),
    previewSourceCommit: corpus.includes("c06f056"),
  },
  featureStringMeaning:
    "Bundle string presence is not a runtime test or proof of complete source equality",
  lite0PublicBytesMatchLocal:
    detector.row.status === 200 ? detector.row.sha256 === localSha : null,
  fullSourceCompared: false,
  databaseOrSecretConfigurationCompared: false,
  deployedGitCommitVerified: false,
  originalProjectModified: false,
  privateMediaUploaded: false,
};
await writeFile(
  resolve(root, "published-comparison.json"),
  JSON.stringify(report, null, 2),
  { flag: "wx" }
);
console.log(JSON.stringify(report));
