/** Overlay a Lite0-only app build onto an existing, already verified preview deployment checkout.
 * The app files (index, hashed assets, workers, vision runtime, status) are replaced; the Tiny/V3 model files,
 * their manifests and notices are kept byte-identical from the previously verified deployment, so no model
 * weights are needed on this machine. Nothing is pushed here.
 * Usage: node overlay-deploy.mjs <build-dir> <deployment-checkout>
 */
import { readFile, writeFile, copyFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const [buildArg, deployArg] = process.argv.slice(2);
const build = resolve(buildArg),
  deploy = resolve(deployArg);
const sha = b => createHash("sha256").update(b).digest("hex");
const receipt = JSON.parse(await readFile(resolve(build, "static-build-receipt.json"), "utf8"));
const oldSource = JSON.parse(await readFile(resolve(deploy, "SOURCE.json"), "utf8"));
if (receipt.sourceWasClean !== true || receipt.privateMediaIncluded !== false || receipt.restrictedModelsIncluded !== false)
  throw Error("Build must come from a clean tree without private media or restricted models");
if (oldSource.publishable !== true || oldSource.restrictedModelsIncluded !== false)
  throw Error("The retained deployment must itself be a verified publishable preview");
// Keep naming the ORIGINAL verified deployment as the source of the retained model files across repeated overlays.
const modelsFrom =
  oldSource.overlay?.modelsRetainedFrom ??
  oldSource.overlay?.models?.match(/from ([a-f0-9]{40})/)?.[1] ??
  oldSource.sourceCommit;
const keep = p => p.startsWith("api/vision/object-quality/") || p.startsWith("model-notices/");
const retained = oldSource.files.filter(r => keep(r.path));
const incoming = receipt.files.filter(r => !keep(r.path));
const incomingPaths = new Set(incoming.map(r => r.path));

// Remove superseded app files from the previous deployment (only files it listed itself).
for (const r of oldSource.files)
  if (!keep(r.path) && !incomingPaths.has(r.path)) await rm(resolve(deploy, r.path), { force: true });

for (const r of incoming) {
  const from = resolve(build, "site", r.path),
    bytes = await readFile(from);
  if (bytes.length !== r.bytes || sha(bytes) !== r.sha256) throw Error("Build changed after validation: " + r.path);
  const to = resolve(deploy, r.path);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

// Status: say exactly what this deployment is.
const statusPath = resolve(deploy, "api/preview/status");
const status = JSON.parse(await readFile(statusPath, "utf8"));
Object.assign(status, {
  sourceCommit: receipt.sourceCommit,
  developmentBuild: false,
  appBuiltWith: "--lite0-only (no model weights on the build machine)",
  modelFilesRetainedFrom: { sourceCommit: modelsFrom, meaning: "Tiny/V3 files kept byte-identical from the previously verified deployment" },
  colourEngineV4Experimental: true,
  colourSpeechQualified: false,
  iphoneTested: false,
  voiceOverTested: false,
});
const statusBytes = Buffer.from(JSON.stringify(status, null, 2));
await writeFile(statusPath, statusBytes);
const statusEntry = { path: "api/preview/status", bytes: statusBytes.length, sha256: sha(statusBytes) };
const files = [...retained, ...incoming.filter(r => r.path !== "api/preview/status"), statusEntry].sort((a, b) =>
  a.path.localeCompare(b.path)
);
for (const r of files) {
  if (oldSource.files.some(o => o.path === r.path && keep(o.path))) continue; // retained model files are checked by assemble-preview
  const b = await readFile(resolve(deploy, r.path));
  if (b.length !== r.bytes || sha(b) !== r.sha256) throw Error("Mismatch after overlay: " + r.path);
}
const source = {
  ...oldSource,
  sourceCommit: receipt.sourceCommit,
  sourceWasClean: true,
  developmentBuild: false,
  publishable: true,
  overlay: {
    app: "built from the source commit with scripts/github-preview/build.mjs --development --lite0-only on a clean tree",
    modelsRetainedFrom: modelsFrom,
    models: "api/vision/object-quality/** and model-notices/** retained byte-identical from " + modelsFrom,
  },
  files,
  bytes: files.reduce((n, r) => n + r.bytes, 0),
  iphoneTested: false,
};
await writeFile(resolve(deploy, "SOURCE.json"), JSON.stringify(source, null, 2));
console.log(JSON.stringify({ sourceCommit: receipt.sourceCommit, files: files.length, retainedModelFiles: retained.length, replacedAppFiles: incoming.length }));
