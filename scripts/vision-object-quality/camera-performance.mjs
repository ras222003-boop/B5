/** Software camera throughput in the actual Basira page; not an iPhone or natural motion test. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-quality-002"
  ),
  output = process.argv[4] ?? "camera-performance-visible.json",
  bytes = await readFile(
    resolve(
      "../.vision-test-fixtures/object-colors-development-001/images/de8a8b01519aea3d.png"
    )
  );
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
  await context.addInitScript(base64 => {
    localStorage.setItem("basira-auto-meter-enabled-v1", "false");
    localStorage.setItem("basira-vision-object-speech-v1", "false");
    localStorage.setItem("basira-object-color-speech-v1", "false");
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const c = document.createElement("canvas"),
        scale = Math.min(640 / image.naturalWidth, 480 / image.naturalHeight);
      c.width = Math.round(image.naturalWidth * scale);
      c.height = Math.round(image.naturalHeight * scale);
      const draw = () =>
        c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
      draw();
      const timer = setInterval(draw, 50),
        stream = c.captureStream(20);
      stream
        .getTracks()[0]
        .addEventListener("ended", () => clearInterval(timer), { once: true });
      return stream;
    };
  }, bytes.toString("base64"));
  const page = await context.newPage();
  await page.goto(origin + "/navigation/vision");
  await page.waitForFunction(() =>
    document.querySelector(
      '#basira-vision-model option[value="objects-yolox-tiny"]'
    )
  );
  await page.locator("#basira-vision-model").selectOption("objects-yolox-tiny");
  await page
    .getByRole("button", { name: "تشغيل رؤية بصيرة", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid=tracking-status]")
        ?.textContent.includes("التتبع يعمل"),
    {},
    { timeout: 30000 }
  );
  await page
    .getByRole("button", { name: "تفاصيل جودة التحليل", exact: true })
    .click();
  await page.locator("main video").scrollIntoViewIfNeeded();
  const snapshot = () =>
    page.evaluate(() => {
      const video = document.querySelector("main video"),
        q = video.getVideoPlaybackQuality(),
        rect = video.getBoundingClientRect();
      return {
        at: performance.now(),
        width: video.videoWidth,
        height: video.videoHeight,
        totalVideoFrames: q.totalVideoFrames,
        droppedVideoFrames: q.droppedVideoFrames,
        videoInViewport: rect.top >= 0 && rect.bottom <= innerHeight,
        documentVisibility: document.visibilityState,
        text: document.querySelector("[data-testid=perception-telemetry]")
          .textContent,
      };
    });
  const before = await snapshot();
  await page.waitForTimeout(10000);
  const after = await snapshot();
  const parse = s => {
    const m = s.match(
      /الإطارات المعالجة: (\d+)؛ المعدل الفعلي ([\d.]+).*95: (\d+)/
    );
    if (!m) throw new Error("Actual camera telemetry missing");
    return { processed: Number(m[1]), fps: Number(m[2]), p95Ms: Number(m[3]) };
  };
  const a = parse(before.text),
    b = parse(after.text),
    elapsedMs = after.at - before.at,
    available = after.totalVideoFrames - before.totalVideoFrames,
    processed = b.processed - a.processed;
  const report = {
    scope: "actual_Basira_UI_with_software_camera_from_licensed_still",
    elapsedMs,
    configuredAnalysisFps: 2,
    processedAnalyses: processed,
    observedAnalysisFps: (processed * 1000) / elapsedMs,
    availableVideoFrames: available,
    browserDroppedVideoFrames:
      after.droppedVideoFrames - before.droppedVideoFrames,
    unanalysedVideoFrames: Math.max(0, available - processed),
    sessionRollingP95Ms: b.p95Ms,
    videoWidth: after.width,
    videoHeight: after.height,
    physicalCameraTested: false,
    iphoneTested: false,
    memoryOnPhone: null,
    note: "Unanalysed frames include intentional 2 FPS sampling; do not call all of them inference failures. P95 is session telemetry, including startup, not a calibrated phone benchmark.",
    before,
    after,
  };
  await page.getByRole("button", { name: "إيقاف الرؤية", exact: true }).click();
  await writeFile(resolve(root, output), JSON.stringify(report, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
