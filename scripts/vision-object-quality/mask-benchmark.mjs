/** Predicted boxes only enter SlimSAM; GT masks are consumed later by the scorer. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-quality-002"
  ),
  stage = process.argv[4] ?? "validation";
const json = async p => JSON.parse(await readFile(p, "utf8")),
  hash = b => createHash("sha256").update(b).digest("hex");
const variant = process.argv[5] ?? stage,
  limit = Number(process.argv[6] ?? 1000);
if (stage === "test" && variant !== "test")
  throw new Error(
    "Consumed final set cannot become a new corrected-adapter test; collect a new cohort"
  );
const selected = await json(resolve(root, "selection-lock.json")),
  manifest = await json(resolve(root, "manifest.json")),
  rows = manifest.samples.filter(r => r.split === stage).slice(0, limit);
const predictions = await json(
    resolve(root, "results", stage, selected.cameraModel + ".json")
  ),
  out = resolve(root, "masks", variant);
await mkdir(out, { recursive: true });
try {
  await readFile(resolve(out, "results.json"));
  throw new Error("Mask run already exists; preserve the original evidence");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const files = new Set([
    "config.json",
    "preprocessor_config.json",
    "onnx/vision_encoder_quantized.onnx",
    "onnx/prompt_encoder_mask_decoder_quantized.onnx",
  ]);
  await context.route("**/*", async r => {
    const u = new URL(r.request().url()),
      prefix = "/api/vision/object-quality/assets/slimsam/";
    if (u.origin !== origin) return r.abort();
    if (u.pathname.startsWith(prefix)) {
      const file = u.pathname.slice(prefix.length);
      if (!files.has(file))
        return r.fulfill({ status: 404, body: "missing optional file" });
      return r.fulfill({
        status: 200,
        body: await readFile(resolve(root, "assets/slimsam", file)),
        contentType: file.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
      });
    }
    return r.continue();
  });
  const page = await context.newPage();
  await page.goto(origin + "/navigation/vision");
  const loadMs = await page.evaluate(async () => {
    const { SlimSamObjectMasks } = await import(
      "/src/lib/vision/objectMasks.ts"
    );
    const t = performance.now();
    window.__masks = await SlimSamObjectMasks.open();
    return performance.now() - t;
  });
  const results = [];
  for (const row of rows) {
    const image = await readFile(resolve(root, row.path));
    if (hash(image) !== row.sha256) throw new Error("Image changed");
    const ds = predictions.predictions
      .find(p => p.id === row.id)
      .detections.filter(d => d.confidence >= selected.threshold);
    const result = await page.evaluate(
      async ({ base64, detections }) => {
        const { sampleColorFrame, analyzeObjectColor } = await import(
          "/src/lib/vision/objectColors.ts"
        );
        const im = new Image();
        im.src = "data:image/png;base64," + base64;
        await im.decode();
        const c = document.createElement("canvas");
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        c.getContext("2d").drawImage(im, 0, 0);
        const t = performance.now(),
          frame = sampleColorFrame(c, t, "mask-evaluation");
        const copied = detections.map(d => ({ ...d, timestamp: t })),
          before = copied.map(d => ({
            id: d.id,
            color: analyzeObjectColor(frame, d, copied),
          })),
          masks = await window.__masks.segment(frame, copied);
        return {
          maskMs: performance.now() - t,
          width: frame.width,
          height: frame.height,
          objects: copied.map(d => {
            const mask = masks.find(m => m.objectId === d.id),
              after = mask?.accepted
                ? analyzeObjectColor(frame, d, copied, mask.mask)
                : mask
                  ? {
                      name: null,
                      status: "UNCLEAR",
                      reason: "MIXED_OR_OCCLUDED",
                      calibrated: false,
                    }
                  : before.find(p => p.id === d.id).color;
            return {
              detection: d,
              before: before.find(p => p.id === d.id).color,
              after,
              mask: mask
                ? {
                    accepted: mask.accepted,
                    score: mask.score,
                    reason: mask.reason,
                    rle: (() => {
                      const out = [];
                      let last = 0,
                        count = 0;
                      for (const value of mask.data) {
                        const bit = value ? 1 : 0;
                        if (bit === last) count++;
                        else {
                          out.push(count);
                          count = 1;
                          last = bit;
                        }
                      }
                      out.push(count);
                      return out;
                    })(),
                  }
                : null,
            };
          }),
        };
      },
      { base64: image.toString("base64"), detections: ds }
    );
    results.push({ id: row.id, sha256: row.sha256, ...result });
    console.log(
      JSON.stringify({
        image: row.id,
        maskMs: Math.round(result.maskMs),
        attempted: result.objects.filter(o => o.mask).length,
        accepted: result.objects.filter(o => o.mask?.accepted).length,
      })
    );
  }
  await writeFile(
    resolve(out, "results.json"),
    JSON.stringify(
      {
        stage,
        variant,
        scope:
          variant === stage
            ? "frozen_evaluation"
            : "development_contract_recheck_not_independent_final",
        promptMode: "supported_points_from_predicted_boxes",
        loadMs,
        model: "SlimSAM-77-uniform q8",
        predictedBoxesOnly: true,
        humanApproval: false,
        results,
      },
      null,
      2
    ),
    { flag: "wx" }
  );
  await page.evaluate(() => window.__masks.close());
} finally {
  await browser.close();
}
