import { build } from "esbuild";
import { readFile, readdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { repo, fileHash } from "../common.mjs";

/** Fixed bundled assets only; no dataset path or remote fallback can enter this map. */
export async function modelRuntime() {
  const assets = new Map(),
    manifest = {
      objectDetector: { status: "unavailable" },
      ocr: { status: "unavailable" },
      faceDetector: { status: "not-configured" },
      plateDetector: { status: "not-configured" },
      cloud: { enabled: false },
    };
  const paths = [
    "vision/efficientdet_lite0_int8.tflite",
    "vision/mediapipe",
    "vision/tesseract",
  ];
  const add = async rel => {
    const path = resolve(repo, "client/public", rel);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for (const n of await readdir(path)) await add(rel + "/" + n);
      } else if (/\.(?:tflite|wasm|js|gz)$/.test(rel))
        assets.set("/" + rel, { path, sha256: await fileHash(path) });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  };
  for (const path of paths) await add(path);
  if (
    assets.has("/vision/efficientdet_lite0_int8.tflite") &&
    assets.has("/vision/mediapipe/vision_wasm_internal.wasm")
  )
    manifest.objectDetector = {
      status: "available",
      name: "existing-efficientdet-lite0",
      sha256: assets.get("/vision/efficientdet_lite0_int8.tflite").sha256,
      scope:
        "existing COCO object classes; no ground hazard specialization or privacy localization",
    };
  if (
    ["ara", "eng", "chi_sim"].every(l =>
      assets.has("/vision/tesseract/lang/" + l + ".traineddata.gz")
    )
  )
    manifest.ocr = {
      status: "available",
      name: "existing-tesseract",
      languages: ["ara", "eng", "chi_sim"],
      assets: [...assets.entries()]
        .filter(([p]) => p.includes("/tesseract/"))
        .map(([path, a]) => ({ path, sha256: a.sha256 })),
      scope:
        "OCR + potential sensitive-text patterns; not exhaustive PII detection",
    };
  const bundle = await build({
    entryPoints: [resolve(repo, "scripts/vision-ai/studio/ui/model-entry.mjs")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    alias: { "@shared": resolve(repo, "shared") },
    logLevel: "silent",
  });
  return { assets, manifest, script: bundle.outputFiles[0].contents };
}
export const assetMime = path =>
  path.endsWith(".wasm")
    ? "application/wasm"
    : path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".gz")
        ? "application/gzip"
        : "application/octet-stream";
