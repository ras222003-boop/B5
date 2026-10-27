/** Resumable HTTPS/read-only deployment verification. Never proves hardware or iPhone performance. */
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
const output = resolve(outArg),
  hash = b => createHash("sha256").update(b).digest("hex"),
  identity = hash(Buffer.from(JSON.stringify(receipt)));
let journal;
try {
  journal = JSON.parse(await readFile(output + ".progress.json", "utf8"));
  if (journal.receiptSha256 !== identity)
    throw Error("Another build owns this verification journal");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
journal ??= {
  receiptSha256: identity,
  url: url.href,
  verified: [],
  complete: false,
};
const save = () =>
  writeFile(output + ".progress.json", JSON.stringify(journal, null, 2));
async function read(path, start, end) {
  for (let attempt = 0; attempt < 2; attempt++)
    try {
      const r = await fetch(new URL(path, url), {
        redirect: "error",
        headers: start === undefined ? {} : { Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(90000),
      });
      if (
        !r.ok ||
        (start !== undefined &&
          (r.status !== 206 ||
            r.headers.get("content-range") !==
              `bytes ${start}-${end}/${receipt.files.find(f => f.path === path).bytes}`))
      )
        throw Error("Unexpected HTTP/range response " + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt === 1)
        throw Error("HTTPS verification failed for " + path + ": " + e.message);
    }
}
try {
  for (const row of receipt.files) {
    if (
      journal.verified.some(r => r.path === row.path && r.sha256 === row.sha256)
    )
      continue;
    const chunks = [];
    if (row.bytes > 2_000_000)
      for (let start = 0; start < row.bytes; start += 2_000_000)
        chunks.push(
          await read(
            row.path,
            start,
            Math.min(row.bytes - 1, start + 1_999_999)
          )
        );
    else chunks.push(await read(row.path));
    const bytes = Buffer.concat(chunks);
    if (
      bytes.length !== row.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== row.sha256
    )
      throw Error("Hosted resource mismatch: " + row.path);
    journal.verified.push({
      path: row.path,
      bytes: bytes.length,
      sha256: row.sha256,
    });
    delete journal.failure;
    await save();
    console.log(
      JSON.stringify({
        verified: journal.verified.length,
        total: receipt.files.length,
        path: row.path,
      })
    );
  }
  const status = JSON.parse(await read("api/preview/status"));
  if (
    status.sourceCommit !== receipt.sourceCommit ||
    status.databaseConnected !== false ||
    status.cloudInferenceEnabled !== false ||
    status.nativeLidarBridgeAvailable !== false ||
    status.nativeHapticsAvailable !== false ||
    status.safariVibrationAvailable !== false
  )
    throw Error("Unexpected hosted preview identity");
  const result = {
    status: "VERIFIED_PUBLIC_HTTPS_STATIC_ASSETS",
    url: url.href + "#/navigation/vision",
    sourceCommit: receipt.sourceCommit,
    verifiedFiles: journal.verified.length,
    bytes: receipt.bytes,
    strictTlsVerification: true,
    models: receipt.models.map(m => ({ id: m.id, sha256: m.sha256 })),
    cameraHardwareTested: false,
    microphoneHardwareTested: false,
    arabicAudibleQualityTested: false,
    iphoneTested: false,
    voiceOverTested: false,
    nativeLidarBridgeAvailable: false,
    nativeHapticsAvailable: false,
    safariVibrationAvailable: false,
    originalManusModified: false,
  };
  journal.complete = true;
  await save();
  await writeFile(output, JSON.stringify(result, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(result));
} catch (e) {
  journal.failure = { message: e.message, atUtc: new Date().toISOString() };
  await save();
  throw e;
}
