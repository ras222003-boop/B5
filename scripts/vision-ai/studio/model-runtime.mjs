import { build } from "esbuild";
import { readFile, readdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { repo, fileHash } from "../common.mjs";

/** Fixed bundled assets only; no dataset path or remote fallback can enter this map. */
export async function modelRuntime() {
  const assets = new Map(),
    manifest = {
      objectDetector: { status: "unavailable" },
      semanticSegmenter: { status: "unavailable" },
      ocr: { status: "unavailable" },
      faceDetector: { status: "not-configured" },
      plateDetector: { status: "not-configured" },
      cloud: { enabled: false },
    };
  const paths = [
    "vision/efficientdet_lite0_int8.tflite",
    "vision/mediapipe",
    "vision/tesseract",
    "vision/onnx",
    "vision/models/Xenova/segformer-b0-finetuned-ade-512-512",
  ];
  const add = async rel => {
    const path = resolve(repo, "client/public", rel);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for (const n of await readdir(path)) await add(rel + "/" + n);
      } else if (/\.(?:tflite|wasm|js|mjs|gz|onnx|json)$/.test(rel))
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
  const segmenter = "/vision/models/Xenova/segformer-b0-finetuned-ade-512-512/onnx/model_quantized.onnx";
  if (assets.get(segmenter)?.sha256 === "9a98d6daf3d926869ab8cc4c2ed7374a2bc23b889bb7ca3b0915d15e3c4756bb" &&
      assets.has("/vision/onnx/ort-wasm-simd-threaded.wasm"))
    manifest.semanticSegmenter = {
      status: "available",
      name: "existing-local-segformer-ade20k",
      sha256: assets.get(segmenter).sha256,
      scope: "noncommercial research; stairs region only, direction uncertain; heuristic score",
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
  path.endsWith(".json")
    ? "application/json"
    : path.endsWith(".mjs") || path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".wasm")
    ? "application/wasm"
      : path.endsWith(".gz")
        ? "application/gzip"
        : "application/octet-stream";
