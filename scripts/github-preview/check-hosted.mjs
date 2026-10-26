/** Strict HTTPS/read-only deployment verification. Never proves camera hardware or iPhone performance. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const [originArg, receiptArg, outArg] = process.argv.slice(2),
  url = new URL(originArg),
  receipt = JSON.parse(await readFile(resolve(receiptArg), "utf8"));
if (
  url.protocol !== "https:" ||
  url.hostname !== "ras222003-boop.github.io" ||
  url.pathname !== receipt.base ||
  url.search ||
  url.hash
)
  throw Error("Use the exact separate Pages HTTPS base");
const read = async path => {
  const r = await fetch(new URL(path, url), {
    redirect: "error",
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw Error("Preview resource failed: " + path + " " + r.status);
  return Buffer.from(await r.arrayBuffer());
};
const files = [];
for (const row of receipt.files) {
  const bytes = await read(row.path);
  if (
    bytes.length !== row.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== row.sha256
  )
    throw Error("Hosted resource mismatch: " + row.path);
  files.push(row.path);
}
const status = JSON.parse(await read("api/preview/status"));
if (
  status.sourceCommit !== receipt.sourceCommit ||
  status.databaseConnected !== false ||
  status.cloudInferenceEnabled !== false
)
  throw Error("Unexpected hosted preview identity");
const result = {
  status: "VERIFIED_PUBLIC_HTTPS_STATIC_ASSETS",
  url: url.href + "#/navigation/vision",
  sourceCommit: receipt.sourceCommit,
  verifiedFiles: files.length,
  bytes: receipt.bytes,
  strictTlsVerification: true,
  models: receipt.models.map(m => ({ id: m.id, sha256: m.sha256 })),
  cameraHardwareTested: false,
  microphoneHardwareTested: false,
  arabicAudibleQualityTested: false,
  iphoneTested: false,
  voiceOverTested: false,
  originalManusModified: false,
};
await writeFile(resolve(outArg), JSON.stringify(result, null, 2), {
  flag: "wx",
});
console.log(JSON.stringify(result));
