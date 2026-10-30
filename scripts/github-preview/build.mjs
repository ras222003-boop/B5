/** A separately published, read-only browser experiment. Never the full Express/MySQL application. */
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import {
  mkdir,
  cp,
  copyFile,
  writeFile,
  readFile,
  readdir,
  lstat,
} from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { prepareModels } from "../manus-preview/prepare-models.mjs";
import { previewPathPlugin, validBase } from "./paths.mjs";
const [expected, registry, base, outArg] = process.argv.slice(2),
  repo = resolve(import.meta.dirname, "../.."),
  out = resolve(outArg ?? "");
validBase(base);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
if (!/^[a-f0-9]{40}$/.test(expected ?? "") || commit !== expected)
  throw Error("Exact source commit required");
const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repo,
    encoding: "utf8",
  }).trim(),
  development = process.argv.includes("--development");
if (dirty && !development)
  throw Error("Only a clean source checkout may produce publishable output");
if (
  Object.keys(process.env).some(
    k => k.startsWith("VITE_") && k !== "VITE_BASIRA_RESEARCH_SEGMENTATION"
  )
)
  throw Error("Do not carry production VITE variables into this build");
process.env.VITE_BASIRA_RESEARCH_SEGMENTATION = "false";
await mkdir(out);
const publicDir = resolve(out, "public-source"),
  site = resolve(out, "site"),
  env = resolve(out, "empty-env");
await mkdir(publicDir);
await mkdir(env);
for (const name of [
  "vision/efficientdet_lite0_int8.tflite",
  "vision/mediapipe",
  "vision/onnx",
]) {
  await mkdir(dirname(resolve(publicDir, name)), { recursive: true });
  await cp(resolve(repo, "client/public", name), resolve(publicDir, name), {
    recursive: true,
  });
}
await copyFile(
  resolve(repo, "client/public/basira-icon.svg"),
  resolve(publicDir, "basira-icon.svg")
);
await writeFile(
  resolve(publicDir, "manifest.webmanifest"),
  JSON.stringify({
    name: "بصيرة — معاينة رؤية بحثية",
    short_name: "بصيرة تجربة",
    start_url: base + "#/navigation/vision",
    scope: base,
    display: "browser",
    lang: "ar",
    dir: "rtl",
    icons: [
      { src: base + "basira-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  })
);
const previewEntry = resolve(
  repo,
  "scripts/github-preview/entry.tsx"
).replaceAll("\\", "/");
const entryPlugin = {
  name: "existing-vision-page-preview-entry",
  enforce: "pre",
  transform(code, id) {
    return id.replaceAll("\\", "/").endsWith("/client/src/main.tsx")
      ? { code: "import " + JSON.stringify(previewEntry) + ";", map: null }
      : null;
  },
  transformIndexHtml(html) {
    return html
      .replace(/<script>[\s\S]*?<\/script>/g, "")
      .replace(/<link[^>]+href=["']https:\/\/[^>]+>/g, "")
      .replace(
        "<head>",
        '<head><meta name="robots" content="noindex,nofollow,noarchive"><meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;; connect-src &apos;self&apos;; script-src &apos;self&apos; &apos;wasm-unsafe-eval&apos;; style-src &apos;self&apos; &apos;unsafe-inline&apos;; worker-src &apos;self&apos; blob:; img-src &apos;self&apos; data: blob:; media-src &apos;self&apos; data: blob:; font-src &apos;self&apos; data:; object-src &apos;none&apos;; base-uri &apos;self&apos;; form-action &apos;none&apos;">'
      );
  },
};
await build({
  configFile: false,
  envDir: env,
  root: resolve(repo, "client"),
  base,
  publicDir,
  plugins: [entryPlugin, previewPathPlugin(base), react(), tailwind()],
  worker: { format: "es", plugins: () => [previewPathPlugin(base)] },
  resolve: {
    alias: {
      "@": resolve(repo, "client/src"),
      "@shared": resolve(repo, "shared"),
      "@assets": resolve(repo, "attached_assets"),
    },
  },
  build: { outDir: site, emptyOutDir: false },
});
// --lite0-only: development-only build without the private Tiny/V3 weights. Never publishable.
const lite0Only = process.argv.includes("--lite0-only");
if (lite0Only && !development)
  throw Error("--lite0-only is a development build and needs --development");
const packageRoot = resolve(out, "model-package"),
  admission = lite0Only
    ? null
    : await prepareModels(resolve(registry), packageRoot, commit),
  profiles = [];
for (const [id, folder, endpoint] of lite0Only
  ? []
  : [
      ["objects-yolox-tiny", "", "api/vision/object-quality"],
      [
        "objects-basira-v3",
        "finetuned-v3/",
        "api/vision/object-quality/models/objects-basira-v3",
      ],
    ]) {
  const profile = JSON.parse(
    await readFile(resolve(packageRoot, folder + "manifest.json"), "utf8")
  );
  profiles.push(profile);
  for (const path of Object.keys(profile.assets)) {
    const target = resolve(site, endpoint, "assets", path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(packageRoot, folder + path), target);
  }
}
const json = async (path, value) => {
  await mkdir(dirname(resolve(site, path)), { recursive: true });
  await writeFile(resolve(site, path), JSON.stringify(value, null, 2), {
    flag: "wx",
  });
};
if (lite0Only) {
  await json("api/vision/object-quality/manifest", { enabled: false });
} else {
  await json("api/vision/object-quality/manifest", {
    enabled: true,
    profile: profiles[0],
    profiles,
  });
  const knowledge = JSON.parse(
    await readFile(
      resolve(packageRoot, "finetuned-v3/basira-knowledge.json"),
      "utf8"
    )
  );
  await json("api/vision/object-quality/knowledge", knowledge);
  await json(
    "api/vision/object-quality/models/objects-basira-v3/knowledge",
    knowledge
  );
}
await json("api/vision/experimental-models", { enabled: false, models: [] });
await json("api/preview/status", {
  sourceCommit: commit,
  scope: "STATIC_VISION_RESEARCH_PREVIEW",
  developmentBuild: development,
  originalOrigin: "https://basira-m7myneuo.manus.space",
  databaseConnected: false,
  cloudInferenceEnabled: false,
  cameraMediaUploadsEnabled: false,
  nativeSpeechRecognitionEnabled: false,
  nativeLidarBridgeAvailable: false,
  nativeHapticsAvailable: false,
  safariVibrationAvailable: false,
  experimentalDefault: false,
  masksEnabled: false,
  iphoneTested: false,
  voiceOverTested: false,
  productionEligible: false,
  navigationEligible: false,
});
await mkdir(resolve(site, "model-notices"));
if (!lite0Only)
  await copyFile(
    resolve(packageRoot, "preview-admission.json"),
    resolve(site, "model-notices/preview-admission.json")
  );
await writeFile(resolve(site, ".nojekyll"), "");
const inventory = [];
async function walk(dir) {
  for (const name of await readdir(dir)) {
    const file = resolve(dir, name),
      stat = await lstat(file);
    if (stat.isSymbolicLink()) throw Error("No symlinks in published output");
    if (stat.isDirectory()) await walk(file);
    else {
      const bytes = await readFile(file),
        path = relative(site, file).replaceAll("\\", "/");
      if (
        bytes.length > 90_000_000 ||
        /Xenova|onnx-community|slimsam|(?:^|\/)\.env|\.pem$|\.key$|\.cer$|\.pth$|\.pt$/i.test(
          path
        )
      )
        throw Error("Unqualified/oversized public asset");
      inventory.push({
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await walk(site);
const receipt = {
  schemaVersion: 1,
  sourceCommit: commit,
  sourceWasClean: !dirty,
  developmentBuild: development,
  publishable: !development && !dirty,
  base,
  files: inventory,
  bytes: inventory.reduce((n, r) => n + r.bytes, 0),
  models: admission ? admission.models : [],
  noDatabase: true,
  noCloudInference: true,
  privateMediaIncluded: false,
  restrictedModelsIncluded: false,
  iphoneTested: false,
};
if (receipt.bytes > 500_000_000) throw Error("Static preview storage budget");
await writeFile(
  resolve(out, "static-build-receipt.json"),
  JSON.stringify(receipt, null, 2),
  { flag: "wx" }
);
console.log(
  JSON.stringify({
    site,
    sourceCommit: commit,
    bytes: receipt.bytes,
    files: inventory.length,
    publishable: receipt.publishable,
    remoteDeploymentPerformed: false,
  })
);
