/** Built app + real pinned ONNX, loopback SOFTWARE media only. Never a Manus TLS/iPhone test. */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
const [build, models, photo, output] = process.argv
  .slice(2)
  .map(x => resolve(x));
const username = "local-software-test",
  password = randomBytes(32).toString("hex"),
  port = 4373,
  origin = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, [resolve(build, "server.mjs")], {
  windowsHide: true,
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    PORT: "4374",
    BASIRA_PREVIEW_ORIGIN: "https://127.0.0.1:" + port,
    BASIRA_PREVIEW_ACCESS_USERNAME: username,
    BASIRA_PREVIEW_ACCESS_PASSWORD: password,
    BASIRA_PREVIEW_MODEL_ROOT: models,
    BASIRA_PREVIEW_ENABLE_MODELS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let childError = "";
child.stderr.on("data", b => (childError += String(b).slice(0, 2000)));
await new Promise((done, reject) => {
  const timer = setTimeout(() => {
    child.kill();
    reject(Error("Compiled preview entry did not start"));
  }, 15000);
  child.stdout.once("data", () => {
    clearTimeout(timer);
    done();
  });
  child.once("exit", code => {
    clearTimeout(timer);
    reject(Error("Compiled preview entry exited " + code + ": " + childError));
  });
  child.once("error", reject);
});
// Test transport only: emulate the HTTPS Origin which Manus's TLS edge will receive.
// Never claim this loopback HTTP probe verifies a certificate or a real hosted HTTPS proxy.
const server = createServer((req, res) => {
  if (req.headers.origin === origin)
    req.headers.origin = "https://127.0.0.1:" + port;
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 4374,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    reply => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    }
  );
  upstream.once("error", () => {
    res.statusCode = 502;
    res.end();
  });
  req.pipe(upstream);
});
server.listen(port, "127.0.0.1");
await new Promise(r => server.once("listening", r));
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const errors = [],
  writes = [],
  blockedExternal = [],
  results = [];
try {
  const context = await browser.newContext({
    httpCredentials: { username, password },
    viewport: { width: 1280, height: 1000 },
    serviceWorkers: "block",
  });
  await context.route("**/*", route => {
    const request = route.request();
    if (!request.url().startsWith(origin + "/")) {
      blockedExternal.push(request.url());
      return route.abort();
    }
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(new URL(request.url()).pathname);
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem("basira-auto-meter-enabled-v1", "false");
    localStorage.setItem("basira-auto-meter-speech-v1", "false");
  });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/navigation/vision", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const select = page.locator("#basira-vision-model");
  await select.waitFor();
  assert.equal(await select.inputValue(), "original");
  await page.waitForFunction(() =>
    document.querySelector(
      '#basira-vision-model option[value="objects-basira-v3"]'
    )
  );
  const profiles = await page.evaluate(() =>
    fetch("/api/vision/object-quality/manifest").then(r => r.json())
  );
  assert.deepEqual(profiles.profiles.map(p => p.id).sort(), [
    "objects-basira-v3",
    "objects-yolox-tiny",
  ]);
  assert.ok(profiles.profiles.every(p => p.maskForStills === false));
  for (const id of ["objects-yolox-tiny", "objects-basira-v3"]) {
    await select.selectOption(id);
    const input = page.getByTestId("object-photo-input");
    await input.getByRole("checkbox").check();
    await input.locator("input[type=file]").setInputFiles(photo);
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector("[data-testid=object-photo-input]")
            ?.getAttribute("data-count")
        ) > 0,
      {},
      { timeout: 90000 }
    );
    const count = Number(await input.getAttribute("data-count"));
    assert.ok(count > 1, "Actual multi-object ONNX inference is required");
    results.push({
      id,
      photoDetections: count,
      maskEnabled: false,
      actualModelSha256: profiles.profiles.find(p => p.id === id).modelSha256,
    });
  }
  // On a software browser capture stream, exercise worker/runtime/camera teardown, not physical camera accuracy.
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
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "إيقاف الرؤية", exact: true }).click();
  const microphone = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    const tracks = stream.getTracks();
    tracks.forEach(t => t.stop());
    return {
      tracks: tracks.length,
      allEnded: tracks.every(t => t.readyState === "ended"),
      isSecureContext,
    };
  });
  assert.ok(microphone.tracks > 0 && microphone.allEnded);
  await select.selectOption("original");
  assert.equal(await select.inputValue(), "original");
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  const report = {
    scope:
      "BUILT_PAGE_REAL_ONNX_WITH_LOOPBACK_SOFTWARE_CAMERA_AND_MICROPHONE_NOT_MANUS_HTTPS_OR_IPHONE",
    sourceCommit: JSON.parse(
      await readFile(resolve(build, "build-receipt.json"))
    ).sourceCommit,
    results,
    softwareCameraPipelineStarted: true,
    microphoneApiWithSoftwareDevice: microphone,
    compiledServerEntryStarted: true,
    rollbackToLite0: true,
    experimentalDefault: false,
    privateMediaUploads: writes.length,
    pageErrors: errors,
    externalRequestsBlocked: blockedExternal.length,
    databaseConnected: false,
    cloudInferenceEnabled: false,
    testTransportEmulatesHttpsOrigin: true,
    manusDeploymentTested: false,
    trustedPublicHttpsTested: false,
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
        pageErrors: errors,
        privateMediaUploads: writes.length,
        trustedPublicHttpsTested: false,
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
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  child.kill();
}
