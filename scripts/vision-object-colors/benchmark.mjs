/** Desktop CPU comparison only; no candidate replaces Lite0. Real public photos stay local. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-colors-001"
  );
const digest = data => createHash("sha256").update(data).digest("hex");
const bytes = await readFile(resolve(root, "manifest.json")),
  manifest = JSON.parse(bytes),
  lock = JSON.parse(
    await readFile(resolve(root, "evaluation-lock.json"), "utf8")
  );
if (
  digest(bytes) !== lock.manifestSha256 ||
  digest(await readFile("client/src/lib/vision/objectColors.ts")) !==
    lock.colorSourceSha256
)
  throw new Error("Frozen evaluation/config changed");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = {},
  external = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
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
  for (const name of ["lite0", "lite2", "ssd"]) {
    const modelBytes = await readFile(
      name === "lite0"
        ? "client/public/vision/efficientdet_lite0_int8.tflite"
        : resolve(root, "sources", name + ".tflite")
    );
    if (digest(modelBytes) !== lock.models[name])
      throw new Error("Model changed");
    const load = await page.evaluate(
      async ({ modelBase64 }) => {
        const { MediaPipeVisionProvider } = await import(
          "/src/lib/vision/providers.ts"
        );
        const { DEFAULT_VISION_CONFIG } = await import(
          "/src/lib/vision/config.ts"
        );
        const started = performance.now();
        window.__benchProvider = await MediaPipeVisionProvider.open(
          DEFAULT_VISION_CONFIG,
          Uint8Array.from(atob(modelBase64), x => x.charCodeAt(0))
        );
        return performance.now() - started;
      },
      { modelBase64: modelBytes.toString("base64") }
    );
    const predictions = [];
    for (const row of manifest.samples) {
      const raw = await readFile(resolve(root, row.path));
      if (digest(raw) !== row.sha256) throw new Error("Frozen photo changed");
      const result = await page.evaluate(
        async ({ imageBase64 }) => {
          const colors = await import("/src/lib/vision/objectColors.ts");
          const image = new Image();
          image.src = "data:image/png;base64," + imageBase64;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d").drawImage(image, 0, 0);
          const timestamp = performance.now(),
            started = performance.now(),
            pixels = colors.sampleColorFrame(
              canvas,
              timestamp,
              "benchmark-photo"
            );
          const detectionStart = performance.now(),
            all = await window.__benchProvider.detect(canvas, timestamp),
            detectorMs = performance.now() - detectionStart;
          const named = all.filter(d => d.confidence >= 0.65),
            predictions = named.map(d => ({
              ...d,
              color: colors.analyzeObjectColor(pixels, d, named),
            }));
          return {
            predictions,
            detectorMs,
            totalMs: performance.now() - started,
            width: canvas.width,
            height: canvas.height,
          };
        },
        { imageBase64: raw.toString("base64") }
      );
      predictions.push({ id: row.id, imageSha256: row.sha256, ...result });
    }
    await page.evaluate(() => window.__benchProvider.close());
    results[name] = {
      modelSha256: digest(modelBytes),
      bytes: modelBytes.length,
      loadMs: load,
      predictions,
    };
    await writeFile(
      resolve(root, `predictions-${name}.json`),
      JSON.stringify(
        {
          scope: "desktop_CPU_real_public_photos",
          referencesUsedInInference: false,
          ...results[name],
        },
        null,
        2
      ),
      { flag: "wx" }
    );
    console.log(
      JSON.stringify({
        model: name,
        photos: predictions.length,
        detections: predictions.reduce((n, r) => n + r.predictions.length, 0),
      })
    );
  }
  await writeFile(
    resolve(root, "benchmark-runtime.json"),
    JSON.stringify(
      {
        browser: await page.evaluate(() => navigator.userAgent),
        phoneTestPerformed: false,
        externalRequestsBlocked: external,
        models: Object.fromEntries(
          Object.entries(results).map(([name, r]) => [
            name,
            { sha256: r.modelSha256, bytes: r.bytes, loadMs: r.loadMs },
          ])
        ),
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
