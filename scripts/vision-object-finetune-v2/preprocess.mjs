/** Frozen development inputs, rendered with the deployed detector's exact Canvas path.
 * No model inference, uploads, label guesses, or protected final pixels.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const self = fileURLToPath(import.meta.url);
const detector = resolve(
  dirname(self),
  "../../client/src/lib/vision/qualityProviders.ts"
);
const rgbaBytes = 416 * 416 * 4;

export function developmentRows(manifest, splits = ["train", "validation"]) {
  if (
    !Array.isArray(splits) ||
    !splits.length ||
    splits.some(s => !["train", "validation"].includes(s))
  )
    throw new Error(
      "Only train/validation preprocessing is permitted; final test is protected"
    );
  if (!Array.isArray(manifest.samples))
    throw new Error("Manifest samples required");
  const ids = new Set(),
    groups = new Map();
  for (const row of manifest.samples) {
    if (!/^[a-zA-Z0-9_-]{1,140}$/.test(row.id) || ids.has(row.id))
      throw new Error("Unsafe/duplicate sample id");
    ids.add(row.id);
    if (!["train", "validation", "test"].includes(row.split))
      throw new Error("Unknown split");
    const group = row.groupId ?? row.sceneId ?? row.siteId;
    if (typeof group !== "string" || !group)
      throw new Error("Source/scene group required");
    const key = String(row.source ?? "") + "::" + group;
    if (groups.has(key) && groups.get(key) !== row.split)
      throw new Error("Scene/source group crosses splits");
    groups.set(key, row.split);
  }
  return manifest.samples.filter(r => splits.includes(r.split));
}

function contained(root, path) {
  if (typeof path !== "string" || isAbsolute(path))
    throw new Error("Relative experiment image path required");
  const absolute = resolve(root, path),
    rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Image outside experiment root");
  return absolute;
}

/** This function intentionally mirrors YoloXProvider.detect before CHW conversion. */
export async function canvasPixels({ base64, width, height }) {
  const image = new Image();
  image.src = "data:image/png;base64," + base64;
  await image.decode();
  if (image.naturalWidth !== width || image.naturalHeight !== height)
    throw new Error("Image/reference dimensions differ");
  // The deployed detector receives a canvas frame, never the decoded Image itself.
  // Chrome can downsample Image and canvas sources with different pixel kernels.
  const source = new OffscreenCanvas(width, height);
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("Source canvas unavailable");
  sourceContext.drawImage(image, 0, 0);
  const canvas = new OffscreenCanvas(416, 416);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas 2D unavailable");
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, 416, 416);
  const ratio = Math.min(416 / width, 416 / height),
    resizedWidth = Math.floor(width * ratio),
    resizedHeight = Math.floor(height * ratio);
  ctx.drawImage(source, 0, 0, resizedWidth, resizedHeight);
  const bytes = ctx.getImageData(0, 0, 416, 416).data;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16_384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return { base64: btoa(binary), ratio, resizedWidth, resizedHeight };
}

async function immutable(path, bytes) {
  try {
    const existing = await readFile(path);
    if (!existing.equals(bytes))
      throw new Error("Existing preprocessing artifact differs: " + path);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(path, bytes, { flag: "wx" });
}

export async function exportDevelopment(
  rootArgument,
  originArgument = "http://127.0.0.1:4350",
  { splits = ["train", "validation"], maxBytes = 512 * 2 ** 20 } = {}
) {
  const root = resolve(rootArgument),
    url = new URL(originArgument);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("A local trusted browser origin is required");
  const origin = url.origin,
    manifestBytes = await readFile(resolve(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes),
    lock = JSON.parse(
      await readFile(resolve(root, "cohort-lock.json"), "utf8")
    );
  const manifestSha256 = hash(manifestBytes);
  if (lock.manifestSha256 !== manifestSha256)
    throw new Error("Dataset must be frozen before preprocessing");
  const rows = developmentRows(manifest, splits);
  if (rows.length * rgbaBytes > maxBytes)
    throw new Error("Preprocessing storage budget exceeded");
  const binding = {
    manifestSha256,
    preprocessorSourceSha256: hash(await readFile(self)),
    detectorSourceSha256: hash(await readFile(detector)),
  };
  const out = resolve(root, "preprocessed");
  await mkdir(out, { recursive: true });
  const indexPath = resolve(out, "index.json");
  let existing = null;
  try {
    existing = JSON.parse(await readFile(indexPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    if (
      Object.entries(binding).some(([key, value]) => existing[key] !== value) ||
      JSON.stringify(existing.splits) !== JSON.stringify(splits)
    )
      throw new Error(
        "Frozen preprocessing/source contract changed; use a new experiment"
      );
    if (existing.entries.length !== rows.length)
      throw new Error("Preprocessing index incomplete");
    for (const row of rows) {
      const entry = existing.entries.find(r => r.id === row.id);
      const input = await readFile(contained(root, row.path));
      if (
        !entry ||
        hash(input) !== row.sha256 ||
        entry.sourceImageSha256 !== row.sha256 ||
        entry.split !== row.split
      )
        throw new Error("Preprocessing image identity changed");
      const bytes = await readFile(contained(root, entry.path));
      if (bytes.length !== rgbaBytes || hash(bytes) !== entry.sha256)
        throw new Error("Preprocessed pixels changed");
    }
    console.log(
      JSON.stringify({
        scope: "development_preprocessing_only",
        verifiedExisting: true,
        images: rows.length,
        protectedTestImagesProcessed: 0,
      })
    );
    return existing;
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" }),
      external = [];
    await context.route("**/*", route => {
      if (
        route
          .request()
          .url()
          .startsWith(origin + "/")
      )
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin + "/navigation/vision");
    const entries = [];
    for (const row of rows) {
      if (!splits.includes(row.split) || row.split === "test")
        throw new Error("Protected final row");
      const input = await readFile(contained(root, row.path));
      if (input.length > 32 * 2 ** 20 || hash(input) !== row.sha256)
        throw new Error("Source image identity/budget");
      const rendered = await page.evaluate(canvasPixels, {
        base64: input.toString("base64"),
        width: row.width,
        height: row.height,
      });
      const bytes = Buffer.from(rendered.base64, "base64");
      if (bytes.length !== rgbaBytes) throw new Error("RGBA output contract");
      const path = "preprocessed/" + row.id + ".rgba";
      const entry = {
        id: row.id,
        split: row.split,
        source: row.source ?? null,
        groupId: row.groupId ?? row.sceneId ?? row.siteId,
        path,
        sha256: hash(bytes),
        sourceImagePath: row.path,
        sourceImageSha256: row.sha256,
        width: 416,
        height: 416,
        channels: 4,
        dtype: "uint8",
        layout: "RGBA_HWC",
        sourceWidth: row.width,
        sourceHeight: row.height,
        ratio: rendered.ratio,
        resizedWidth: rendered.resizedWidth,
        resizedHeight: rendered.resizedHeight,
        ...binding,
      };
      await immutable(resolve(root, path), bytes);
      await immutable(
        resolve(out, row.id + ".json"),
        Buffer.from(JSON.stringify(entry, null, 2))
      );
      entries.push(entry);
      console.log(
        JSON.stringify({
          preprocessed: row.id,
          split: row.split,
          completed: entries.length,
          total: rows.length,
        })
      );
    }
    const index = {
      schemaVersion: 1,
      scope: "frozen_train_validation_original_frames_only",
      ...binding,
      splits,
      entries,
      images: entries.length,
      bytes: entries.length * rgbaBytes,
      format: "RGBA8 416x416; trainer must convert BGR CHW float32 0..255",
      resize:
        "OffscreenCanvas default smoothing, floor dimensions, top-left letterbox RGB114; deployed decoder uses nominal ratio",
      browser: await page.evaluate(() => navigator.userAgent),
      externalRequestsBlocked: external,
      modelInferenceExecuted: false,
      protectedTestImagesProcessed: 0,
      sourceLabelsModified: false,
      syntheticScenesCreated: 0,
    };
    await immutable(indexPath, Buffer.from(JSON.stringify(index, null, 2)));
    return index;
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const requested = process.argv.find(a => a.startsWith("--splits="));
  const splits = requested
    ? requested.slice("--splits=".length).split(",")
    : ["train", "validation"];
  await exportDevelopment(
    process.argv[2],
    process.argv[3]?.startsWith("--") ? undefined : process.argv[3],
    { splits }
  );
}
