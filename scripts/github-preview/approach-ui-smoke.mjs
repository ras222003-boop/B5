/** Mobile-width browser UI check only. It cannot prove iPhone, LiDAR or vibration behaviour. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import express from "express";

const [buildArg, reportArg, hostedArg] = process.argv.slice(2),
  build = resolve(buildArg),
  report = resolve(reportArg),
  receipt = JSON.parse(
    await readFile(resolve(build, "static-build-receipt.json"), "utf8")
  ),
  base = receipt.base;
let server;
let origin;
if (hostedArg) {
  const hosted = new URL(hostedArg);
  if (
    hosted.protocol !== "https:" ||
    hosted.hostname !== "ras222003-boop.github.io" ||
    hosted.pathname !== base ||
    hosted.search ||
    hosted.hash
  )
    throw Error("Use only the independent Pages HTTPS base");
  origin = hosted.origin;
} else {
  const app = express();
  app.use((req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) return void res.status(405).end();
    next();
  });
  app.use(base, express.static(resolve(build, "site")));
  server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  origin = `http://127.0.0.1:${server.address().port}`;
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-SA",
      serviceWorkers: "block",
    }),
    escaped = [],
    writes = [],
    pageErrors = [];
  await context.route("**/*", route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin || !url.pathname.startsWith(base)) {
      escaped.push(url.href);
      return route.abort();
    }
    if (!["GET", "HEAD"].includes(request.method())) writes.push(url.href);
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(origin + base + "#/navigation/vision", {
    waitUntil: "domcontentloaded",
  });
  await page.getByText("لا يدعم Safari الاهتزازات الأصلية", { exact: false }).waitFor();
  const selector = page.locator("#basira-vision-model");
  await selector.waitFor();
  await page.waitForFunction(() =>
    document.querySelector(
      '#basira-vision-model option[value="objects-basira-v3"]'
    )
  );
  const models = ["original", "objects-yolox-tiny", "objects-basira-v3"];
  for (const model of models) {
    await selector.selectOption(model);
    assert.equal(
      await page
        .getByRole("heading", { name: "المسافات وتنبيهات الاقتراب" })
        .isVisible(),
      true,
      `Approach settings disappeared for ${model}`
    );
    assert.equal(
      await page.getByTestId("approach-risk-status").isVisible(),
      true,
      `Approach status disappeared for ${model}`
    );
    assert.equal(
      await page.getByRole("checkbox", { name: "تشغيل اهتزازات الاقتراب" }).isVisible(),
      true
    );
    assert.equal(
      await page.getByRole("checkbox", { name: "تشغيل تنبيهات الاقتراب الصوتية" }).isVisible(),
      true
    );
  }
  const status = await page.evaluate(async path =>
    (await fetch(path + "api/preview/status")).json(), base
  );
  assert.equal(status.sourceCommit, receipt.sourceCommit);
  assert.equal(status.nativeLidarBridgeAvailable, false);
  assert.equal(status.nativeHapticsAvailable, false);
  assert.equal(status.safariVibrationAvailable, false);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(escaped, []);
  assert.deepEqual(writes, []);
  const result = {
    status: "PASSED_MOBILE_WIDTH_BROWSER_UI_ONLY",
    sourceCommit: receipt.sourceCommit,
    developmentBuild: receipt.developmentBuild,
    hostedHttpsTested: Boolean(hostedArg),
    models,
    approachControlsPresentForAllModels: true,
    safariVibrationNoticePresent: true,
    nativeLidarBridgeAvailable: false,
    nativeHapticsAvailable: false,
    viewportWidth: 390,
    pageErrors,
    networkWrites: writes.length,
    outsidePreviewRequests: escaped.length,
    iphoneTested: false,
  };
  await writeFile(report, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  if (server) await new Promise(r => server.close(r));
}
