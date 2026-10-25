/** Actual CC0 video frames. No frame-level GT identities: descriptive stability, never ID accuracy. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-quality-002"
  ),
  source = resolve("../.vision-test-fixtures/object-colors-001");
const manifest = JSON.parse(
    await readFile(resolve(source, "motion-manifest.json"), "utf8")
  ),
  hash = b => createHash("sha256").update(b).digest("hex"),
  results = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
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
  for (const model of process.argv[4] === "finetune"
    ? ["yolox-tiny", "objects-basira-v1"]
    : ["lite0", "yolox-tiny"])
    for (const clip of manifest.clips) {
      await page.evaluate(async model => {
        const { ObjectTracker } = await import(
            "/src/lib/vision/objectTracking.ts"
          ),
          { ObjectColorTracker } = await import(
            "/src/lib/vision/objectColors.ts"
          ),
          { ObjectSpeechTracker } = await import(
            "/src/lib/vision/objectSpeech.ts"
          ),
          { visionMessages } = await import("/src/i18n/locales/vision.ts");
        const { MediaPipeVisionProvider } = await import(
            "/src/lib/vision/providers.ts"
          ),
          { DEFAULT_VISION_CONFIG } = await import("/src/lib/vision/config.ts");
        const { availableObjectQualityProfiles, ObjectQualityProvider } =
          await import("/src/lib/vision/objectQuality.ts");
        const profile =
          model === "lite0"
            ? null
            : (await availableObjectQualityProfiles()).find(
                p =>
                  p.id ===
                  (model === "yolox-tiny" ? "objects-yolox-tiny" : model)
              );
        if (model !== "lite0" && !profile)
          throw new Error("Research model unavailable");
        window.__videoProvider = profile
          ? await ObjectQualityProvider.open(profile, false)
          : await MediaPipeVisionProvider.open(DEFAULT_VISION_CONFIG);
        const threshold = profile?.threshold ?? 0.65;
        window.__tracker = new ObjectTracker(1200, 1800, threshold);
        window.__colors = new ObjectColorTracker();
        window.__speech = new ObjectSpeechTracker(
          visionMessages.ar,
          4500,
          undefined,
          threshold
        );
        window.__spoken = [];
      }, model);
      const frames = [];
      for (const frame of clip.frames) {
        const bytes = await readFile(resolve(source, frame.path));
        if (hash(bytes) !== frame.sha256)
          throw new Error("Licensed frame changed");
        const value = await page.evaluate(
          async ({ base64, at, id }) => {
            const { sampleColorFrame, analyzeObjectColor } = await import(
                "/src/lib/vision/objectColors.ts"
              ),
              im = new Image();
            im.src = "data:image/png;base64," + base64;
            await im.decode();
            const c = document.createElement("canvas");
            c.width = im.naturalWidth;
            c.height = im.naturalHeight;
            c.getContext("2d").drawImage(im, 0, 0);
            const start = performance.now(),
              pixels = sampleColorFrame(c, at, id),
              raw = await window.__videoProvider.detect(c, at),
              tracked = window.__tracker.update(raw, {
                frameId: id,
                capturedAt: at,
                now: at,
              });
            const detections = tracked.detections.map(d => ({
              ...d,
              color: window.__colors.update(
                d,
                analyzeObjectColor(pixels, d, tracked.detections)
              ),
            }));
            window.__speech.observe(
              detections,
              at,
              text => {
                window.__spoken.push(text);
                return true;
              },
              [],
              true,
              () => false,
              true
            );
            return { detections, totalMs: performance.now() - start };
          },
          {
            base64: bytes.toString("base64"),
            at: frame.mediaTimeMs,
            id: frame.id,
          }
        );
        frames.push({ id: frame.id, mediaTimeMs: frame.mediaTimeMs, ...value });
      }
      const speech = await page.evaluate(() => window.__spoken);
      await page.evaluate(() => window.__videoProvider.close());
      const observations = frames.flatMap(f => f.detections),
        latency = frames.map(f => f.totalMs).sort((a, b) => a - b);
      const summary = {
        model,
        clip: clip.id,
        frames: frames.length,
        observations: observations.length,
        uniqueIds: new Set(observations.map(d => d.trackId)).size,
        ambiguous: observations.filter(d => d.tracking?.state === "AMBIGUOUS")
          .length,
        tracked: observations.filter(d => d.tracking?.state === "TRACKED")
          .length,
        colorDecisions: observations.filter(d => d.color?.name).length,
        colorAbstentions: observations.filter(d => !d.color?.name).length,
        speech: speech.length,
        repeatedExactSpeech: speech.length - new Set(speech).size,
        medianMs: latency[Math.floor(latency.length / 2)],
        identityAccuracy: null,
        referenceStatus: "independent_frame_identity_annotations_pending",
      };
      results.push({ summary, frames, speech });
      console.log(JSON.stringify(summary));
    }
  await writeFile(
    resolve(root, "motion-comparison.json"),
    JSON.stringify(
      {
        results,
        scope: "real_CC0_video_frames_offline",
        phoneTested: false,
        physicalCameraTested: false,
        syntheticMotion: false,
        note: "Media timestamps drive association; CPU latency is not actual live phone FPS. No reference identities, no ID accuracy claim.",
      },
      null,
      2
    ),
    { flag: "wx" }
  );
} finally {
  await browser.close();
}
