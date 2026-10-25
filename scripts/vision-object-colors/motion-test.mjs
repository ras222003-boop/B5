import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-colors-001"
  );
const manifest = JSON.parse(
    await readFile(resolve(root, "motion-manifest.json"), "utf8")
  ),
  hash = x => createHash("sha256").update(x).digest("hex");
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", r =>
    r
      .request()
      .url()
      .startsWith(origin + "/")
      ? r.continue()
      : r.abort()
  );
  const page = await context.newPage();
  await page.goto(origin + "/navigation/vision");
  for (const clip of manifest.clips) {
    await page.evaluate(async () => {
      const { MediaPipeVisionProvider } = await import(
          "/src/lib/vision/providers.ts"
        ),
        { DEFAULT_VISION_CONFIG } = await import("/src/lib/vision/config.ts"),
        { ObjectTracker } = await import("/src/lib/vision/objectTracking.ts"),
        { ObjectColorTracker } = await import(
          "/src/lib/vision/objectColors.ts"
        ),
        { ObjectSpeechTracker } = await import(
          "/src/lib/vision/objectSpeech.ts"
        ),
        { visionMessages } = await import("/src/i18n/locales/vision.ts");
      window.__motionProvider = await MediaPipeVisionProvider.open(
        DEFAULT_VISION_CONFIG
      );
      window.__objectTracker = new ObjectTracker();
      window.__colorTracker = new ObjectColorTracker();
      window.__speechTracker = new ObjectSpeechTracker(visionMessages.ar);
      window.__announcements = [];
    });
    const frames = [];
    for (const row of clip.frames) {
      const raw = await readFile(resolve(root, row.path));
      if (hash(raw) !== row.sha256) throw new Error("Source frame changed");
      const value = await page.evaluate(
        async ({ base64, stamp, id }) => {
          const colors = await import("/src/lib/vision/objectColors.ts");
          const image = new Image();
          image.src = "data:image/png;base64," + base64;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d").drawImage(image, 0, 0);
          const started = performance.now(),
            pixels = colors.sampleColorFrame(canvas, stamp, id),
            detected = await window.__motionProvider.detect(canvas, stamp),
            tracked = window.__objectTracker.update(detected, {
              frameId: id,
              capturedAt: stamp,
              now: stamp,
            });
          const output = tracked.detections.map(d => ({
            ...d,
            color: window.__colorTracker.update(
              d,
              colors.analyzeObjectColor(pixels, d, tracked.detections)
            ),
          }));
          window.__speechTracker.observe(
            output,
            stamp,
            text => {
              window.__announcements.push(text);
              return true;
            },
            [],
            true,
            undefined,
            true
          );
          return { detections: output, totalMs: performance.now() - started };
        },
        { base64: raw.toString("base64"), stamp: row.mediaTimeMs, id: row.id }
      );
      frames.push({ id: row.id, mediaTimeMs: row.mediaTimeMs, ...value });
    }
    const speech = await page.evaluate(() => window.__announcements);
    await page.evaluate(() => window.__motionProvider.close());
    const identities = new Set(
        frames.flatMap(f => f.detections.map(d => d.trackId))
      ),
      observed = frames.flatMap(f => f.detections),
      latencies = frames.map(f => f.totalMs).sort((a, b) => a - b);
    const summary = {
      id: clip.id,
      frames: frames.length,
      observations: observed.length,
      uniqueTrackIds: identities.size,
      trackedObservations: observed.filter(d => d.tracking?.state === "TRACKED")
        .length,
      colourDecisions: observed.filter(d => d.color?.name).length,
      colourAbstentions: observed.filter(d => !d.color?.name).length,
      speechSubmissions: speech.length,
      medianMs: latencies[Math.floor(latencies.length / 2)],
      identityAccuracy: null,
      referenceStatus: clip.referenceStatus,
    };
    results.push({ summary, frames, speech });
  }
  await writeFile(
    resolve(root, "motion-results.json"),
    JSON.stringify(
      {
        scope: "actual_licensed_video_offline_frame_stability",
        results,
        phoneTested: false,
        trainingPerformed: false,
        note: "Recorded video timestamps drive tracking; latency is CPU processing time, not observed live camera FPS. Identity accuracy requires independent frame-level labels.",
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results.map(r => r.summary)));
} finally {
  await browser.close();
}
