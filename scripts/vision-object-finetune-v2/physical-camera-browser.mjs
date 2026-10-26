/** Actual Basira page + native getUserMedia. No fake device flags or media API replacement. */
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const origin = process.argv[2] ?? "http://127.0.0.1:4350";
const output = resolve(
  process.argv[3] ??
    "../.vision-test-fixtures/object-finetune-v2-001/camera/browser-tiny-001.json"
);
const model = process.argv[4] ?? "objects-yolox-tiny";
if (!/^objects-(yolox-tiny|basira-v\d+)$/.test(model))
  throw new Error("Unknown research model id");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname))
  throw new Error("Local origin required");
try {
  await readFile(output);
  throw new Error("Evidence output already exists");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const inventory = JSON.parse(
  await readFile(
    resolve(dirname(output), "windows-camera-devices.json"),
    "utf8"
  )
);
const run = promisify(execFile);
async function memory(pid) {
  const source = `$cameraTasks=Get-CimInstance Win32_Process;$cameraIds=@(${Number(pid)});do{$cameraNext=@($cameraTasks|Where-Object {$_.ParentProcessId -in $cameraIds -and $_.ProcessId -notin $cameraIds}|ForEach-Object {$_.ProcessId});$cameraIds+=$cameraNext}while($cameraNext.Count -gt 0);$cameraProcesses=Get-Process -Id $cameraIds -ErrorAction SilentlyContinue;[pscustomobject]@{rssMiB=($cameraProcesses|Measure-Object WorkingSet64 -Sum).Sum/1MB;processes=$cameraProcesses.Count}|ConvertTo-Json -Compress`;
  const result = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", source],
    { windowsHide: true }
  );
  return JSON.parse(result.stdout);
}
const server = await chromium.launchServer({
  channel: "chrome",
  headless: true,
});
const browser = await chromium.connect(server.wsEndpoint());
const report = {
  schemaVersion: 1,
  scope: "existing_Basira_page_real_Windows_webcam_operational_trial",
  model,
  physicalCameraTested: false,
  iphoneTested: false,
  rawFramesSaved: false,
  mediaUploaded: false,
  audibleVoiceQualityTested: false,
  modelAccuracy: null,
  groundTruthStatus: "NO_INDEPENDENT_LIVE_SCENE_REFERENCE",
  mediaSourceOverride: false,
  fakeCaptureArguments: [],
  pageErrors: [],
  uploads: [],
  externalBlocked: [],
  modelSpeechRequests: [],
  memoryMeaning:
    "OS Chrome process-tree working set includes page/WASM/capture/CDP; not model-only or iPhone memory",
  navigationEligible: false,
  maskInference: false,
};
let page, tracksAtStart;
try {
  const command = server.process().spawnargs;
  if (!Array.isArray(command))
    throw new Error("Cannot verify browser capture arguments");
  report.argumentVerificationMethod = "launchServer child-process spawnargs";
  report.fakeCaptureArguments = command.filter(a =>
    /use-fake-device-for-media-stream|use-file-for-fake-video-capture/.test(a)
  );
  if (report.fakeCaptureArguments.length)
    throw new Error("Fake source prohibited in a physical trial");
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    serviceWorkers: "block",
  });
  await context.grantPermissions(["camera"], { origin });
  await context.route("**/*", r => {
    const request = r.request();
    if (!request.url().startsWith(origin + "/")) {
      report.externalBlocked.push(request.url());
      return r.abort();
    }
    if (
      ["POST", "PUT", "PATCH"].includes(request.method()) &&
      !request.url().includes("/__manus__/logs")
    )
      report.uploads.push(request.url());
    return r.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem("basira-auto-meter-enabled-v1", "false");
    localStorage.setItem("basira-auto-meter-speech-v1", "false");
    localStorage.setItem("basira-vision-object-speech-v1", "false");
    localStorage.setItem("basira-object-color-speech-v1", "false");
  });
  page = await context.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.goto(origin + "/navigation/vision");
  await page.waitForFunction(
    id => document.querySelector(`#basira-vision-model option[value="${id}"]`),
    model,
    { timeout: 30000 }
  );
  const profile = await page.evaluate(async id => {
    const r = await fetch("/api/vision/object-quality/manifest");
    const j = await r.json();
    return (j.profiles ?? [j.profile]).find(p => p.id === id);
  }, model);
  report.modelSha256 = profile.modelSha256;
  await page.locator("#basira-vision-model").selectOption(model);
  await page.evaluate(async () => {
    const { speechEngine } = await import("/src/lib/speechEngine.ts");
    window.__cameraProbeSpeech = [];
    speechEngine.enqueue = async (input, priority) => {
      window.__cameraProbeSpeech.push({ priority });
      return true;
    };
  });
  report.memoryBeforeCamera = await memory(server.process().pid);
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
    () => {
      const v = document.querySelector("main video");
      return v && v.readyState >= 2 && v.videoWidth > 0;
    },
    {},
    { timeout: 15000 }
  );
  const device = await page.evaluate(() => {
    const video = document.querySelector("main video");
    const stream = video.srcObject;
    window.__cameraProbeTracks = stream.getTracks();
    const track = stream.getVideoTracks()[0],
      s = track.getSettings();
    return {
      label: track.label,
      readyState: track.readyState,
      audioTracks: stream.getAudioTracks().length,
      width: s.width,
      height: s.height,
      frameRate: s.frameRate,
      facingMode: s.facingMode,
      resizeMode: s.resizeMode,
      isSecureContext: window.isSecureContext,
    };
  });
  report.device = device;
  report.physicalPnPMatch = inventory.devices
    .filter(
      d =>
        d.HardwareBus === "USB" &&
        device.label.toLowerCase().includes(d.Name.toLowerCase())
    )
    .map(d => d.Name);
  report.physicalCameraTested =
    report.physicalPnPMatch.length > 0 && device.readyState === "live";
  await page
    .getByRole("button", { name: "تفاصيل جودة التحليل", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid=perception-telemetry]")
        ?.textContent.includes("الإطارات المعالجة"),
    {},
    { timeout: 10000 }
  );
  const snapshot = () =>
    page.evaluate(async () => {
      const video = document.querySelector("main video"),
        q = video.getVideoPlaybackQuality(),
        canvas = new OffscreenCanvas(32, 24),
        ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, 32, 24);
      const p = ctx.getImageData(0, 0, 32, 24).data;
      let sum = 0,
        sq = 0;
      for (let i = 0; i < p.length; i += 4) {
        const y = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
        sum += y;
        sq += y * y;
      }
      const mean = sum / (p.length / 4),
        std = Math.sqrt(Math.max(0, sq / (p.length / 4) - mean * mean));
      const sampleHash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", p)),
        v => v.toString(16).padStart(2, "0")
      ).join("");
      return {
        at: performance.now(),
        width: video.videoWidth,
        height: video.videoHeight,
        currentTime: video.currentTime,
        totalVideoFrames: q.totalVideoFrames,
        droppedVideoFrames: q.droppedVideoFrames,
        documentVisibility: document.visibilityState,
        meanLuminance: mean,
        luminanceStd: std,
        sampledFrameSha256: sampleHash,
        text: document.querySelector("[data-testid=perception-telemetry]")
          .textContent,
      };
    });
  const before = await snapshot();
  await page.waitForTimeout(10000);
  const after = await snapshot();
  const parse = text => {
    const m = text.match(
      /الإطارات المعالجة: (\d+)؛ المعدل الفعلي ([\d.]+).*95: (\d+)/
    );
    if (!m) throw new Error("Camera telemetry missing");
    return { processed: Number(m[1]), fps: Number(m[2]), p95Ms: Number(m[3]) };
  };
  const a = parse(before.text),
    b = parse(after.text),
    elapsed = after.at - before.at;
  report.measurement = {
    before,
    after,
    elapsedMs: elapsed,
    processedAnalyses: b.processed - a.processed,
    observedAnalysisFps: ((b.processed - a.processed) * 1000) / elapsed,
    sessionRollingP95Ms: b.p95Ms,
    availableVideoFrames: after.totalVideoFrames - before.totalVideoFrames,
    browserDroppedVideoFrames:
      after.droppedVideoFrames - before.droppedVideoFrames,
    unanalysedVideoFrames: Math.max(
      0,
      after.totalVideoFrames -
        before.totalVideoFrames -
        (b.processed - a.processed)
    ),
    note: "Unanalysed frames include deliberate2FPS sampling; rollingP95 includes session startup, not pure ONNX latency.",
  };
  report.memoryAfterAnalysis = await memory(server.process().pid);
  report.modelSpeechRequests = await page.evaluate(
    () => window.__cameraProbeSpeech
  );
  await page.getByRole("button", { name: "إيقاف الرؤية", exact: true }).click();
  report.appStopEndsTracks = await page.evaluate(() =>
    window.__cameraProbeTracks.every(t => t.readyState === "ended")
  );
  report.sceneVariationObserved =
    before.sampledFrameSha256 !== after.sampledFrameSha256;
  report.status =
    report.physicalCameraTested &&
    report.measurement.processedAnalyses > 0 &&
    after.luminanceStd >= 2
      ? report.sceneVariationObserved
        ? "PHYSICAL_CAMERA_BASIRA_OPERATIONAL"
        : "PHYSICAL_DEVICE_STATIC_OUTPUT_SCENE_UNVERIFIED"
      : "LIVE_SOURCE_NOT_QUALIFIED";
  if (report.uploads.length)
    throw new Error("Unexpected write request during capture");
} catch (error) {
  report.status = "FAILED_OR_BLOCKED";
  report.error = error.message;
} finally {
  if (page) {
    await page
      .evaluate(() => {
        for (const t of window.__cameraProbeTracks ?? []) t.stop();
      })
      .catch(() => {});
  }
  await browser.close();
  await server.close();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
}
console.log(
  JSON.stringify({
    status: report.status,
    device: report.device,
    physicalPnPMatch: report.physicalPnPMatch,
    physicalCameraTested: report.physicalCameraTested,
    measurement: report.measurement,
    error: report.error,
    rawFramesSaved: false,
  })
);
if (report.status !== "PHYSICAL_CAMERA_BASIRA_OPERATIONAL")
  process.exitCode = 2;
