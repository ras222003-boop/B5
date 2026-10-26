/** Actual built-page inference on a licensed development still + native SOFTWARE media. Not an iPhone/hardware trial. */
import { chromium } from "@playwright/test";
import express from "express";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const [folder, photo, output] = process.argv.slice(2).map(x => resolve(x)),
  receipt = JSON.parse(
    await readFile(resolve(folder, "static-build-receipt.json"))
  ),
  base = receipt.base;
const hosted = process.argv[5] ? new URL(process.argv[5]) : null;
if (
  hosted &&
  (hosted.protocol !== "https:" ||
    hosted.hostname !== "ras222003-boop.github.io" ||
    hosted.pathname !== base)
)
  throw Error("Use only the independent Pages HTTPS origin");
const app = express();
app.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return void res.status(405).end();
  next();
});
app.use(base, express.static(resolve(folder, "site"), { dotfiles: "allow" }));
const server = hosted ? null : app.listen(4378, "127.0.0.1");
if (server) await new Promise(r => server.once("listening", r));
const origin = hosted ? hosted.origin : "http://127.0.0.1:4378";
const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  }),
  errors = [],
  writes = [],
  escaped = [],
  results = [];
let activeModel = null,
  currentPage = null;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    locale: "ar-SA",
    serviceWorkers: "block",
  });
  await context.route("**/*", route => {
    const r = route.request(),
      u = new URL(r.url());
    if (u.origin !== origin || !u.pathname.startsWith(base)) {
      escaped.push(u.pathname);
      return route.abort();
    }
    if (!["GET", "HEAD"].includes(r.method())) writes.push(u.pathname);
    return route.continue();
  });
  await context.addInitScript(() => {
    window.__previewTracks = [];
    const native = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await native(options);
      window.__previewTracks.push(...stream.getTracks());
      return stream;
    };
  });
  const page = await context.newPage();
  currentPage = page;
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + base + "#/navigation/vision", {
    waitUntil: "domcontentloaded",
  });
  const select = page.locator("#basira-vision-model");
  await select.waitFor();
  assert.equal(await select.inputValue(), "original");
  await page.waitForFunction(() =>
    document.querySelector(
      '#basira-vision-model option[value="objects-basira-v3"]'
    )
  );
  for (const id of ["original", "objects-yolox-tiny", "objects-basira-v3"]) {
    activeModel = id;
    console.log(
      JSON.stringify({ phase: "photo-start", id, hosted: Boolean(hosted) })
    );
    await select.selectOption(id);
    const panel = page.getByTestId("object-photo-input");
    await panel.getByRole("checkbox").check();
    const at = Date.now();
    await panel.locator("input[type=file]").setInputFiles(photo);
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector("[data-testid=object-photo-input]")
            ?.getAttribute("data-count")
        ) > 0,
      {},
      { timeout: hosted ? 210000 : 90000 }
    );
    const count = Number(await panel.getAttribute("data-count"));
    assert.ok(count > 0);
    results.push({
      id,
      photoDetections: count,
      wallPhotoMs: Date.now() - at,
      referenceAccuracy: null,
    });
    console.log(JSON.stringify({ phase: "photo-passed", ...results.at(-1) }));
  }
  const blocked = await page.evaluate(async () => {
    const response = await fetch("/api/vision/describe", {
      method: "POST",
      body: "synthetic-test-sentinel-not-real-media",
    });
    return {
      status: response.status,
      beacon: navigator.sendBeacon("/api/upload", "synthetic sentinel"),
      nativeTranscriptionDisabled:
        typeof window.webkitSpeechRecognition === "undefined",
    };
  });
  assert.equal(blocked.status, 405);
  assert.equal(blocked.beacon, false);
  assert.equal(blocked.nativeTranscriptionDisabled, true);
  await page
    .getByRole("button", { name: "تشغيل رؤية بصيرة", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid=vision-page]")
        ?.getAttribute("data-state") === "WORKING",
    {},
    { timeout: 60000 }
  );
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "إيقاف الرؤية", exact: true }).click();
  await page
    .getByRole("button", {
      name: "اختبار إذن الميكروفون دون تسجيل",
      exact: true,
    })
    .click();
  await page
    .getByText(
      "وصل مسار ميكروفون وأُغلق؛ لم يُسجّل أو يُرسل صوت، ولم تُختبر جودته",
      { exact: true }
    )
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.__previewTracks.every(t => t.readyState === "ended")
    ),
    true
  );
  await select.selectOption("original");
  assert.equal(await select.inputValue(), "original");
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(escaped, []);
  const report = {
    scope:
      "STATIC_EXISTING_VISION_PAGE_REAL_MODELS_WITH_SOFTWARE_CAMERA_MICROPHONE_NOT_DEVICE_ACCURACY",
    sourceCommit: receipt.sourceCommit,
    developmentBuild: receipt.developmentBuild,
    base,
    results,
    softwareCameraPipelineStarted: true,
    softwareMicrophonePermissionAndTeardown: true,
    allTracksEnded: true,
    blockedPostBeforeNetwork: blocked.status === 405,
    beaconDisabled: true,
    nativeTranscriptionDisabled: true,
    rollbackToLite0: true,
    experimentalDefault: false,
    pageErrors: errors,
    mediaWritesObserved: writes.length,
    outsidePreviewRequests: escaped.length,
    manusOriginalModified: false,
    hostedHttpsTested: Boolean(hosted),
    iphoneTested: false,
    voiceOverTested: false,
  };
  await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report));
} catch (e) {
  await writeFile(
    output.replace(/\.json$/, ".failed.json"),
    JSON.stringify(
      {
        status: "FAILED",
        message: e.message,
        activeModel,
        results,
        panelText: currentPage
          ? await currentPage
              .getByTestId("object-photo-input")
              .innerText()
              .catch(() => null)
          : null,
        pageErrors: errors,
        escaped,
        writes,
        iphoneTested: false,
      },
      null,
      2
    ),
    { flag: "wx" }
  );
  throw e;
} finally {
  await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}
