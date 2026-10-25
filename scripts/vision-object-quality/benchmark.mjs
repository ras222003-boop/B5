/** Real local browser CPU runs; all candidates share images, max100, and low score floor for AP. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-quality-002"
  ),
  stage = process.argv[4] ?? "validation";
const digest = x => createHash("sha256").update(x).digest("hex"),
  json = async p => JSON.parse(await readFile(p, "utf8"));
const manifest = await json(resolve(root, "manifest.json")),
  cohortLock = await json(resolve(root, "cohort-lock.json"));
if (
  digest(await readFile(resolve(root, "manifest.json"))) !==
  cohortLock.manifestSha256
)
  throw new Error("Cohort changed");
if (stage === "test") {
  const selected = await json(resolve(root, "selection-lock.json"));
  if (
    selected.cohortSha256 !== cohortLock.manifestSha256 ||
    selected.detectorSourceSha256 !==
      digest(await readFile("client/src/lib/vision/qualityProviders.ts"))
  )
    throw new Error("Frozen detector/selection changed");
}
const legacy = resolve("../.vision-test-fixtures/object-colors-001");
const rows =
    stage === "legacy"
      ? (await json(resolve(legacy, "manifest.json"))).samples
      : manifest.samples.filter(r => r.split === stage),
  imageRoot = stage === "legacy" ? legacy : root;
if (!rows.length) throw new Error("Unknown/empty stage");
const configs = [
  { id: "lite0-cap12", model: "lite0", cap: 12 },
  { id: "lite0", model: "lite0" },
  { id: "lite2", model: "lite2" },
  { id: "ssd", model: "ssd" },
  { id: "yolox-nano", model: "yolox-nano" },
  { id: "yolox-tiny", model: "yolox-tiny" },
  { id: "lite0-tiles", model: "lite0", tiles: true },
  { id: "lite2-tiles", model: "lite2", tiles: true },
];
const out = resolve(root, "results", stage);
await mkdir(out, { recursive: true });
const run = promisify(execFile);
async function memory(pid) {
  const script = `$objectTasks=Get-CimInstance Win32_Process; $objectIds=@(${Number(pid)}); do {$objectNext=@($objectTasks|Where-Object {$_.ParentProcessId -in $objectIds -and $_.ProcessId -notin $objectIds}|ForEach-Object {$_.ProcessId});$objectIds+= $objectNext} while($objectNext.Count -gt 0);$objectProcesses=Get-Process -Id $objectIds -ErrorAction SilentlyContinue;[pscustomobject]@{rssMiB=($objectProcesses|Measure-Object WorkingSet64 -Sum).Sum/1MB;sumProcessPeaksMiB=($objectProcesses|Measure-Object PeakWorkingSet64 -Sum).Sum/1MB;processes=$objectProcesses.Count}|ConvertTo-Json -Compress`;
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true }
  );
  return JSON.parse(stdout);
}
for (const config of configs) {
  const output = resolve(out, config.id + ".json");
  try {
    await readFile(output);
    console.log(JSON.stringify({ skip: config.id, stage }));
    continue;
  } catch {}
  const modelPath =
    config.model === "lite0"
      ? resolve("client/public/vision/efficientdet_lite0_int8.tflite")
      : config.model.startsWith("yolox")
        ? resolve(
            root,
            "assets/yolox",
            config.model.replace("-", "_") + ".onnx"
          )
        : resolve(legacy, "sources", config.model + ".tflite");
  const bytes = await readFile(modelPath),
    server = await chromium.launchServer({ channel: "chrome", headless: true }),
    browser = await chromium.connect(server.wsEndpoint());
  try {
    if (
      stage === "test" &&
      (await json(resolve(root, "results/validation", config.id + ".json")))
        .modelSha256 !== digest(bytes)
    )
      throw new Error("Frozen weights changed");
    const external = [],
      context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", r => {
      if (
        r
          .request()
          .url()
          .startsWith(origin + "/")
      )
        return r.continue();
      external.push(r.request().url());
      return r.abort();
    });
    const page = await context.newPage();
    await page.goto(origin + "/navigation/vision");
    const baselineMemory = await memory(server.process().pid);
    const loadMs = await page.evaluate(
      async ({ base64, config }) => {
        const { MediaPipeVisionProvider } = await import(
            "/src/lib/vision/providers.ts"
          ),
          { YoloXProvider } = await import(
            "/src/lib/vision/qualityProviders.ts"
          ),
          { DEFAULT_VISION_CONFIG } = await import("/src/lib/vision/config.ts");
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)),
          started = performance.now();
        window.__qualityProvider = config.model.startsWith("yolox")
          ? await YoloXProvider.open(bytes, 0.01)
          : await MediaPipeVisionProvider.open(
              { ...DEFAULT_VISION_CONFIG, detectionThreshold: 0.01 },
              bytes,
              config.cap ?? 100
            );
        const load = performance.now() - started,
          c = document.createElement("canvas");
        c.width = 640;
        c.height = 480;
        for (let i = 0; i < 3; i++)
          await window.__qualityProvider.detect(c, performance.now());
        return load;
      },
      { base64: bytes.toString("base64"), config }
    );
    const loadedMemory = await memory(server.process().pid);
    if (loadedMemory.rssMiB > 2048)
      throw new Error("Browser memory budget exceeded");
    const predictions = [];
    for (const row of rows) {
      const image = await readFile(resolve(imageRoot, row.path));
      if (digest(image) !== row.sha256) throw new Error("Image changed");
      const result = await page.evaluate(
        async ({ base64, tiles }) => {
          const image = new Image();
          image.src = "data:image/png;base64," + base64;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d").drawImage(image, 0, 0);
          const { detectTiled } = await import(
              "/src/lib/vision/qualityProviders.ts"
            ),
            at = performance.now(),
            start = performance.now();
          const detections = tiles
            ? await detectTiled(window.__qualityProvider, canvas, at)
            : await window.__qualityProvider.detect(canvas, at);
          return {
            detections,
            detectorMs: performance.now() - start,
            width: canvas.width,
            height: canvas.height,
          };
        },
        { base64: image.toString("base64"), tiles: config.tiles === true }
      );
      predictions.push({ id: row.id, sha256: row.sha256, ...result });
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const metrics = await cdp.send("Performance.getMetrics"),
      peak = await memory(server.process().pid);
    const report = {
      stage,
      config,
      cohortSha256: cohortLock.manifestSha256,
      modelSha256: digest(bytes),
      modelBytes: bytes.length,
      loadMs,
      browser: await page.evaluate(() => navigator.userAgent),
      memory: {
        baseline: baselineMemory,
        loaded: loadedMemory,
        after: peak,
        meaning:
          "OS browser process-tree working set; sum of individual process peaks is an upper bound, not simultaneous peak",
        jsHeapUsedBytes: metrics.metrics.find(m => m.name === "JSHeapUsedSize")
          ?.value,
      },
      predictions,
      referencesUsedInInference: false,
      externalRequestsBlocked: external,
      phoneTested: false,
      training: false,
    };
    await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(
      JSON.stringify({
        stage,
        model: config.id,
        images: predictions.length,
        detections: predictions.reduce((n, p) => n + p.detections.length, 0),
        medianMs: predictions.map(p => p.detectorMs).sort((a, b) => a - b)[
          Math.floor(predictions.length / 2)
        ],
        rssMiB: peak.rssMiB,
      })
    );
    await page.evaluate(() => window.__qualityProvider.close());
  } catch (error) {
    await writeFile(
      resolve(out, config.id + ".failure.json"),
      JSON.stringify({ error: error.message }, null, 2)
    );
    console.error(config.id + ": " + error.message);
  } finally {
    await browser.close();
    await server.close();
  }
}
