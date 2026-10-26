/** Build the existing app for an isolated vision preview; never copy local secrets or restricted models. */
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { build as bundle } from "esbuild";
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const repo = resolve(import.meta.dirname, "../.."),
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
const requested = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(requested ?? "") || requested !== commit)
  throw Error("Supply the exact verified 40-character source commit");
const dirty = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=no"],
  { cwd: repo, encoding: "utf8" }
);
if (dirty.trim())
  throw Error(
    "Use a clean checkout of the pinned commit; never bundle unreviewed local changes"
  );
if (
  Object.keys(process.env).some(
    k => k.startsWith("VITE_") && k !== "VITE_BASIRA_RESEARCH_SEGMENTATION"
  )
)
  throw Error("Do not inject production VITE variables into a preview build");
process.env.VITE_BASIRA_RESEARCH_SEGMENTATION = "false";
const out = resolve(repo, ".vision-ai/manus-preview", commit);
await mkdir(resolve(repo, ".vision-ai/manus-preview"), { recursive: true });
await mkdir(out); // A previous build is immutable; choose a new commit instead of overwriting it.
const publicDir = resolve(out, "public-source"),
  emptyEnv = resolve(out, "empty-env");
await mkdir(emptyEnv);
const source = resolve(repo, "client/public");
const excluded = [
  "vision/models/Xenova",
  "vision/models/onnx-community",
  "__manus__",
  "manus-routes.json",
];
await cp(source, publicDir, {
  recursive: true,
  filter: p =>
    !excluded.some(x => {
      const r = relative(source, p).split(sep).join("/");
      return r === x || r.startsWith(x + "/");
    }),
});
await build({
  configFile: false,
  envFile: false,
  envDir: emptyEnv,
  root: resolve(repo, "client"),
  publicDir,
  plugins: [react(), tailwind()],
  worker: { format: "es" },
  resolve: {
    alias: {
      "@": resolve(repo, "client/src"),
      "@shared": resolve(repo, "shared"),
      "@assets": resolve(repo, "attached_assets"),
    },
  },
  build: { outDir: resolve(out, "app"), emptyOutDir: false },
});
await bundle({
  entryPoints: [resolve(repo, "scripts/manus-preview/server.ts")],
  outfile: resolve(out, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const receipt = {
  schemaVersion: 1,
  sourceCommit: commit,
  scope: "EXISTING_BASIRA_VISION_PAGE_ISOLATED_PREVIEW",
  originalProjectModified: false,
  databaseConnected: false,
  cloudInferenceEnabled: false,
  experimentalDefault: false,
  excludedPublicModels: excluded,
  iphoneTested: false,
  weightsIncluded: false,
  serverSha256: createHash("sha256")
    .update(await readFile(resolve(out, "server.mjs")))
    .digest("hex"),
};
await writeFile(
  resolve(out, "build-receipt.json"),
  JSON.stringify(receipt, null, 2),
  { flag: "wx" }
);
console.log(
  JSON.stringify({
    out,
    sourceCommit: commit,
    weightsIncluded: false,
    remoteDeploymentPerformed: false,
  })
);
