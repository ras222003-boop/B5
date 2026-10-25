/** Actual Basira page; licensed local photos + fake camera. Speech submission is stubbed, not listening validation. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  out = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-colors-browser-001"
  );
const root = resolve("../.vision-test-fixtures/object-colors-001"),
  dev = resolve("../.vision-test-fixtures/object-colors-development-001");
await mkdir(out, { recursive: true });
const source = resolve(dev, "images/de8a8b01519aea3d.png"),
  photo = `data:image/png;base64,${(await readFile(source)).toString("base64")}`;
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
  await context.route("**/*", route => {
    const req = route.request();
    if (req.url().startsWith(origin + "/")) {
      if (req.method() === "POST" && !req.url().includes("/__manus__/logs"))
        uploads.push(req.url());
      return route.continue();
    }
    external.push(req.url());
    return route.abort();
  });
  await context.addInitScript(
    ({ photo }) => {
      localStorage.setItem("basira-auto-meter-enabled-v1", "false");
      localStorage.setItem("basira-auto-meter-speech-v1", "false");
      localStorage.setItem("basira-object-color-speech-v1", "true");
      localStorage.setItem("basira-vision-object-speech-v1", "true");
      window.__tracks = [];
      window.__spoken = [];
      navigator.mediaDevices.getUserMedia = async options => {
        if (options.audio) throw new Error("Unexpected microphone");
        const image = new Image();
        image.src = photo;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const draw = () =>
          canvas.getContext("2d").drawImage(image, 0, 0, 640, 480);
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
    { photo }
  );
  page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/navigation/vision");
  await page.locator("#basira-vision-model").waitFor({ timeout: 60000 });
  assert.equal(
    await page.locator("#basira-vision-model").inputValue(),
    "original"
  );
  await page.evaluate(async () => {
    const { speechEngine } = await import("/src/lib/speechEngine.ts");
    speechEngine.enqueue = async (input, priority) => {
      window.__spoken.push({ text: input.text, priority });
    };
  });
  const input = page.getByTestId("object-photo-input");
  await input.getByRole("checkbox").check();
  const photoResults = [];
  for (const path of [
    resolve(root, "images/0071f62f5d703904.png"),
    source,
    resolve(dev, "images/86f11d6200964c9f.png"),
    resolve(dev, "images/1eddbeb71c160e03.png"),
  ]) {
    const previous = Number(await input.getAttribute("data-analysis-id"));
    await input.locator("input[type=file]").setInputFiles(path);
    await page.waitForFunction(
      before =>
        Number(
          document
            .querySelector("[data-testid=object-photo-input]")
            ?.getAttribute("data-analysis-id")
        ) > before &&
        document
          .querySelector("[data-testid=object-photo-input]")
          ?.textContent.includes("صورة ثابتة"),
      previous,
      { timeout: 45000 }
    );
    const text = await page.getByTestId("photo-object-results").innerText();
    photoResults.push({
      file: path.split(/[\\/]/).pop(),
      objects: Number(await input.getAttribute("data-count")),
      text,
    });
    if (path.includes("0071f62")) {
      assert.ok(Number(await input.getAttribute("data-count")) >= 2);
      assert.ok((text.match(/كوب/g) ?? []).length >= 2);
    }
    await page.screenshot({
      path: resolve(out, `photo-${photoResults.length}.png`),
      fullPage: true,
    });
  }
  const colorButton = page.getByRole("button", { name: /وصف الألوان صوتيًا/ });
  const objectButton = page.getByRole("button", {
    name: /النطق التلقائي للأشياء المرئية:/,
  });
  await colorButton.click();
  assert.equal(await colorButton.getAttribute("aria-pressed"), "false");
  assert.equal(await objectButton.getAttribute("aria-pressed"), "true");
  await colorButton.click();
  await objectButton.click();
  assert.equal(await objectButton.getAttribute("aria-pressed"), "false");
  assert.equal(await colorButton.getAttribute("aria-pressed"), "true");
  await objectButton.click();
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
    { timeout: 60000 }
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid=perception-objects]")
        ?.textContent.includes("كرسي"),
    {},
    { timeout: 15000 }
  );
  await page.waitForTimeout(6000);
  const cameraText = await page.getByTestId("perception-objects").innerText();
  await page.screenshot({
    path: resolve(out, "camera-colors.png"),
    fullPage: true,
  });
  const spoken = await page.evaluate(() => window.__spoken);
  await page.getByRole("button", { name: "إيقاف الرؤية", exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      window.__tracks.every(t => t.readyState === "ended")
    ),
    true
  );
  await page.waitForFunction(() =>
    document.querySelector("[data-testid=perception-empty]")
  );
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(out,"mobile-layout.png"),fullPage:true});
  const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  assert.equal(horizontalOverflow,false);
  assert.deepEqual(errors, []);
  assert.deepEqual(uploads, []);
  const report = {
    scope: "actual_basira_photos_and_fake_camera_with_local_lite0",
    photoResults,
    cameraText,
    speechSubmissions: spoken,
    voicesAudiblyTested: false,
    independentSpeechToggles: true,
    stoppedTracks: true,
    privateMediaUploads: uploads,
    externalRequestsBlocked: external,
    pageErrors: errors,
    realPhysicalCameraTested: false,
    iphoneTested: false,
    mobileChromeLayoutOnly:true,
    horizontalOverflow,
    trainingPerformed: false,
  };
  await writeFile(
    resolve(out, "browser-validation.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify({
      photos: photoResults.map(r => ({ file: r.file, objects: r.objects })),
      cameraText,
      speechSubmissions: spoken.length,
      uploads: uploads.length,
    })
  );
} catch (error) {
  if (page) {
    await writeFile(
      resolve(out, "failure.json"),
      JSON.stringify(
        { error: error.message, body: await page.locator("main").innerText() },
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
