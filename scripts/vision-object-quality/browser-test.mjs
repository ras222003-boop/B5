/** Existing Basira route, actual local YOLOX + SlimSAM. Camera is software, not a physical phone. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve("../.vision-test-fixtures/object-quality-002"),
  out = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-quality-browser-002"
  ),
  modelId = process.argv[4] ?? "objects-yolox-tiny";
await mkdir(out, { recursive: true });
const photo = resolve(
    "../.vision-test-fixtures/object-colors-development-001/images/de8a8b01519aea3d.png"
  ),
  base64 = (await readFile(photo)).toString("base64");
const browser = await chromium.launch({ channel: "chrome", headless: true });
let page;
const errors = [],
  uploads = [],
  external = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    serviceWorkers: "block",
  });
  await context.route("**/*", r => {
    const request = r.request();
    if (request.url().startsWith(origin + "/")) {
      if (
        ["POST", "PUT", "PATCH"].includes(request.method()) &&
        !request.url().includes("/__manus__/logs")
      )
        uploads.push(request.url());
      return r.continue();
    }
    external.push(request.url());
    return r.abort();
  });
  await context.addInitScript(
    ({ base64 }) => {
      localStorage.setItem("basira-auto-meter-enabled-v1", "false");
      localStorage.setItem("basira-auto-meter-speech-v1", "false");
      window.__tracks = [];
      window.__speech = [];
      window.__haptics = [];
      navigator.vibrate = value => {
        window.__haptics.push(value);
        return true;
      };
      navigator.mediaDevices.getUserMedia = async options => {
        if (options.audio) throw new Error("Unexpected microphone");
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const canvas = document.createElement("canvas"),
          scale = Math.min(640 / image.naturalWidth, 480 / image.naturalHeight);
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        let frame = 0;
        const draw = () => {
          const dx = Math.sin(frame++ / 30) * 2;
          canvas
            .getContext("2d")
            .drawImage(image, dx, 0, canvas.width, canvas.height);
        };
        draw();
        const timer = setInterval(draw, 50),
          stream = canvas.captureStream(20);
        window.__tracks.push(...stream.getTracks());
        stream
          .getTracks()[0]
          .addEventListener("ended", () => clearInterval(timer), {
            once: true,
          });
        return stream;
      };
    },
    { base64 }
  );
  page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/navigation/vision");
  const select = page.locator("#basira-vision-model");
  await select.waitFor();
  await page.waitForFunction(
    id =>
      !!document.querySelector(`#basira-vision-model option[value="${id}"]`),
    modelId
  );
  assert.equal(await select.inputValue(), "original");
  await select.selectOption(modelId);
  await page.evaluate(async () => {
    const { speechEngine } = await import("/src/lib/speechEngine.ts");
    speechEngine.enqueue = async (input, priority) =>
      window.__speech.push({ text: input.text, priority });
  });
  const input = page.getByTestId("object-photo-input");
  await input.getByRole("checkbox").check();
  await input
    .locator("input[type=file]")
    .setInputFiles(resolve(root, "images/85157.png"));
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid=object-photo-input]")
        ?.textContent.includes("صورة ثابتة"),
    {},
    { timeout: 90000 }
  );
  const photoText = await page.getByTestId("photo-object-results").innerText();
  assert.ok(Number(await input.getAttribute("data-count")) > 1);
  const profile = await page.evaluate(async id => {
    const r = await fetch("/api/vision/object-quality/manifest");
    const data = await r.json();
    return (data.profiles ?? [data.profile]).find(p => p.id === id);
  }, modelId);
  assert.equal(profile.maskForStills, false);
  assert.equal(profile.maskQualification, "REJECTED_FINAL");
  assert.doesNotMatch(photoText, /قناع آلي اجتاز/);
  await page.waitForTimeout(16000);
  assert.equal(await select.inputValue(), modelId);
  await page.screenshot({
    path: resolve(out, "photo-masks.png"),
    fullPage: true,
  });
  // Cancelling an actual subsequent mask load/inference must leave no late result.
  await input.locator("input[type=file]").setInputFiles(photo);
  await input.getByRole("button", { name: "إيقاف تحليل الصورة" }).click();
  await page.waitForTimeout(1000);
  assert.equal(await input.getAttribute("data-count"), "0");
  await page
    .getByRole("button", { name: "تشغيل رؤية بصيرة", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid=vision-page]")
        ?.getAttribute("data-state") === "WORKING",
    {},
    { timeout: 45000 }
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-testid=perception-objects] li").length >
      0,
    {},
    { timeout: 15000 }
  );
  await page.waitForTimeout(6500);
  const cameraText = await page.getByTestId("perception-objects").innerText(),
    speech = await page.evaluate(() => window.__speech),
    haptics = await page.evaluate(() => window.__haptics);
  assert.ok(speech.every(s => s.priority === "INFORMATION"));
  assert.deepEqual(haptics, []);
  await page.screenshot({ path: resolve(out, "camera.png"), fullPage: true });
  if (modelId.startsWith("objects-basira-v")) {
    await page
      .getByRole("button", {
        name: "الرجوع فورًا إلى Tiny السابق",
        exact: true,
      })
      .click();
    assert.equal(await select.inputValue(), "objects-yolox-tiny");
    assert.equal(
      await page.evaluate(() =>
        window.__tracks.every(t => t.readyState === "ended")
      ),
      true
    );
    await page
      .getByRole("button", { name: "تشغيل رؤية بصيرة", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-testid=vision-page]")
          ?.getAttribute("data-state") === "WORKING",
      {},
      { timeout: 45000 }
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-testid=perception-objects] li")
          .length > 0,
      {},
      { timeout: 15000 }
    );
  }
  await page
    .getByRole("button", { name: "الرجوع فورًا إلى Lite0", exact: true })
    .click();
  assert.equal(await select.inputValue(), "original");
  assert.equal(
    await page.evaluate(() =>
      window.__tracks.every(t => t.readyState === "ended")
    ),
    true
  );
  await page
    .getByRole("button", { name: "تشغيل رؤية بصيرة", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      ["WORKING", "ANALYZING"].includes(
        document
          .querySelector("[data-testid=basira-original-engine]")
          ?.getAttribute("data-state")
      ),
    {},
    { timeout: 45000 }
  );
  await page.getByRole("button", { name: "إيقاف الرؤية", exact: true }).click();
  // A modified weight file fails closed; no silent replacement with Lite0 in the research session.
  await page.route(
    origin +
      "/api/vision/object-quality" +
      (modelId.startsWith("objects-basira-v") ? "/models/" + modelId : "") +
      "/assets/yolox/yolox_tiny.onnx",
    r => r.fulfill({ status: 200, body: "invalid model bytes" })
  );
  await select.selectOption(modelId);
  await page
    .getByRole("button", { name: "تشغيل رؤية بصيرة", exact: true })
    .click();
  await page
    .getByText(/تعذر النموذج التجريبي: object_quality_hash_mismatch/)
    .waitFor({ timeout: 30000 });
  assert.equal(
    await page.evaluate(() =>
      window.__tracks.every(t => t.readyState === "ended")
    ),
    true
  );
  await page
    .getByRole("button", { name: "الرجوع فورًا إلى Lite0", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  await page.screenshot({
    path: resolve(out, "mobile-layout.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(uploads, []);
  await writeFile(
    resolve(out, "browser-validation.json"),
    JSON.stringify(
      {
        scope:
          "actual_Basira_YOLOX_public_photos_and_software_camera_after_final_mask_veto",
        photoText,
        cameraText,
        speech,
        haptics,
        maskInference: false,
        maskDeploymentRejected: true,
        cancelledPhoto: true,
        originalProviderRestarted: true,
        previousTinyRollbackVerified: modelId.startsWith("objects-basira-v"),
        corruptedModelRejected: true,
        tracksStopped: true,
        phoneTested: false,
        physicalCameraTested: false,
        voicesAudiblyTested: false,
        modelId,
        modelSha256: profile.modelSha256,
        trainedCheckpointTested: modelId.startsWith("objects-basira-v"),
        uploads,
        external,
        pageErrors: errors,
        mobileChromeLayoutOnly: true,
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({
      photoText,
      cameraText,
      speechSubmissions: speech.length,
      uploads: uploads.length,
      corruptedModelRejected: true,
    })
  );
} catch (error) {
  if (page) {
    await writeFile(
      resolve(out, "failure.json"),
      JSON.stringify(
        {
          error: error.message,
          stack: error.stack,
          pageErrors: errors,
          url: page.url(),
          body: await page.locator("body").innerText({ timeout: 2000 }).catch(() => "unavailable"),
        },
        null,
        2
      )
    );
    await page.screenshot({
      path: resolve(out, "failure.png"),
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
}
