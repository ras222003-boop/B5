import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { fileHash, repo } from "../common.mjs";
import { importBundle } from "../storage.mjs";

const temp = await mkdtemp(resolve(tmpdir(), "basira-studio-browser-")),
  root = resolve(temp, "data");
const evidence = resolve(
  repo,
  process.env.BASIRA_STUDIO_EVIDENCE_DIR ?? "docs/vision-ai-evidence/studio"
);
await mkdir(evidence, { recursive: true });
const data = await fixture(root);
const studio = await createStudio(root);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  locale: "ar-SA",
});
const page = await context.newPage();
const external = [],
  errors = [];
page.on("request", r => {
  if (!r.url().startsWith(studio.url + "/")) external.push(r.url());
});
page.on("pageerror", e => errors.push(e.message));
const checks = [],
  shots = [];
const screenshot = async name => {
  await page.screenshot({ path: resolve(evidence, name), fullPage: true });
  shots.push({
    path: relative(repo, resolve(evidence, name)).replaceAll("\\", "/"),
    sha256: await fileHash(resolve(evidence, name)),
    contentKind: "synthetic-ui-only",
  });
};
try {
  await page.goto(studio.url);
  await page.locator("input[name=id]").fill("editor");
  await page.locator("input[name=password]").fill("synthetic-fixture-password");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "12"
  );
  await page.locator(".card img").first().waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".card img")].every(
      i => i.complete && i.naturalWidth > 0
    )
  );
  await screenshot("desktop-synthetic.png");
  checks.push("12 synthetic images decode and display bounding boxes");
  await page.locator("#class-filter").selectOption("5");
  assert.equal(await page.locator(".card").count(), 2);
  await page.locator("#search").fill("demo-007");
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator("#search").fill("");
  await page.locator("#class-filter").selectOption("");
  await page.locator("#source-filter").selectOption("licensed_dataset");
  assert.equal(await page.locator(".card").count(), 0);
  await page.locator("#source-filter").selectOption("");
  checks.push("Arabic search and class/source filters");
  await page.locator(".card").first().click();
  await page.locator('[data-coord="0,0"]').fill("0.2");
  await page.locator("#reason").fill("تصحيح تجريبي لموضع مربع الجسم");
  const saveResponsePromise = page.waitForResponse(
    r => r.url().includes("/api/items/") && r.request().method() === "POST"
  );
  await page.locator("#save-labels").click();
  const saveResponse = await saveResponsePromise;
  assert.equal(saveResponse.status(), 200, await saveResponse.text());
  await page.waitForFunction(() =>
    document.getElementById("revision").textContent.includes("الإصدار 1")
  );
  await page.locator("#review-kind").selectOption("labels");
  await page.locator("#reason").fill("محاولة اعتماد ذاتي اصطناعية يجب رفضها");
  await page.locator("#confirm-review").check();
  assert.ok(await page.locator("#approve").isDisabled());
  const forbiddenReview = await page.evaluate(async () => {
    const b = await (await fetch("/api/bootstrap")).json();
    const c = await (await fetch("/api/catalog")).json();
    const item = c.items.find(i => i.sample.id === "demo-001");
    const r = await fetch("/api/items/" + item.key, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Studio-CSRF": b.csrf },
      body: JSON.stringify({
        version: item.version,
        action: "review",
        kind: "labels",
        status: "approved",
        exhaustive: true,
        reason: "fictional unauthorized reviewer",
      }),
    });
    return r.status;
  });
  assert.equal(forbiddenReview, 400);
  await screenshot("editor-synthetic.png");
  checks.push("UI saves versioned boxes; contributor cannot approve");
  await page.locator("#close-editor").click();
  // Real existing import tool, fictional permissions and generated pixels exclusively.
  const sample = data.samples[0],
    source = structuredClone(data.sources[0]);
  source.trainingAllowed = true;
  source.rightsReview = {
    ...source.rightsReview,
    status: "approved",
    reviewer: "synthetic-import-fixture",
    at: new Date().toISOString(),
  };
  const imported = await importBundle(
    {
      schemaVersion: 1,
      id: "synthetic-auto-import",
      contentKind: "real",
      containsUserData: false,
      sources: [source],
      files: [
        {
          path: sample.path,
          kind: "image",
          sourceId: source.id,
          originalId: "synthetic-auto-import",
          origin: "synthetic fixture",
          sha256: sample.sha256,
        },
        {
          path: "rights/team.txt",
          kind: "rights",
          sourceId: source.id,
          originalId: "synthetic-permission",
          origin: "synthetic fixture",
          sha256: source.rightsReview.evidence.sha256,
        },
      ],
      samples: [{ ...sample, id: "synthetic-newly-imported" }],
    },
    resolve(root, "incoming/demo"),
    root
  );
  const before = Date.now();
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "13",
    {},
    { timeout: 10000 }
  );
  const updateMs = Date.now() - before;
  assert.equal(
    await page
      .getByRole("button", {
        name: "مراجعة synthetic-newly-imported",
        exact: true,
      })
      .count(),
    1
  );
  checks.push(
    "existing importBundle adds new synthetic batch automatically without HTML regeneration"
  );
  // Playwright records a generated animation only. No camera, personal data or external resource.
  const videoContext = await browser.newContext({
    viewport: { width: 320, height: 240 },
    recordVideo: { dir: temp, size: { width: 320, height: 240 } },
  });
  const videoPage = await videoContext.newPage();
  await videoPage.setContent(
    '<!doctype html><html><body style="margin:0;background:#c8ddc9;color:#236950;font:18px sans-serif"><p>SYNTHETIC VIDEO ONLY</p><div style="width:120px;height:80px;background:#236950;animation:move .6s infinite alternate"></div><style>@keyframes move{to{transform:translateX(120px)}}</style></body></html>'
  );
  await videoPage.waitForTimeout(1500);
  const recorded = videoPage.video();
  await videoContext.close();
  const videoPath = resolve(root, "incoming/demo/videos/synthetic.webm");
  await copyFile(await recorded.path(), videoPath);
  const manifest = resolve(root, "incoming/demo/dataset.review.pending.json"),
    updated = JSON.parse(await readFile(manifest));
  updated.samples[1].media = {
    kind: "video_frame",
    timestampMs: 0,
    video: {
      id: "synthetic-video",
      path: "videos/synthetic.webm",
      sha256: await fileHash(videoPath),
    },
  };
  updated.samples[1].annotation.objects[0].trackId = "synthetic-track";
  await writeFile(manifest, JSON.stringify(updated));
  await page.waitForFunction(
    () => document.querySelectorAll("#videos video").length === 1
  );
  const videoState = await page.locator("video").evaluate(async v => {
    v.preload = "auto";
    v.load();
    try {
      await v.play();
    } catch (e) {
      return {
        error: e.message,
        mediaError: v.error?.message,
        src: v.currentSrc,
      };
    }
    return { width: v.videoWidth };
  });
  console.log(
    JSON.stringify({
      videoState,
      videoBytes: (await readFile(videoPath)).length,
    })
  );
  assert.ok(videoState.width > 0, JSON.stringify(videoState));
  checks.push(
    "synthetic reference video decodes through authenticated ranged endpoint"
  );
  await page.locator("[data-tab=experiments]").click();
  await screenshot("experiments-synthetic.png");
  const officialPanel = page
    .getByRole("heading", { name: "مسار الاعتماد الرسمي", exact: true })
    .locator("..");
  assert.equal(await officialPanel.locator("button").count(), 0);
  assert.ok(
    await officialPanel
      .getByText(
        "يبقى مستقلًا ويتطلب اعتماد البيانات والأوزان والخطة وتجميد الاختبار.",
        { exact: true }
      )
      .isVisible()
  );
  const researchStarts = [];
  const watchResearch = r => {
    if (r.method() === "POST" && r.url().includes("/api/self-training/"))
      researchStarts.push(r.url());
  };
  page.on("request", watchResearch);
  assert.equal(await page.locator("#self-authorize").isChecked(), false);
  await page.locator("#self-start").click();
  await page
    .getByText("حدد التفويض المحلي المحدود أولًا.", { exact: true })
    .first()
    .waitFor();
  assert.deepEqual(
    researchStarts,
    [],
    "No research start may be sent without explicit bounded authorization"
  );
  page.off("request", watchResearch);
  const unconfiguredAgents = await page
    .locator("#self-provider option")
    .evaluateAll(options =>
      options
        .filter(o => ["codex", "claude"].includes(o.value))
        .map(o => ({
          value: o.value,
          disabled: o.disabled,
          disabledAttribute: o.hasAttribute("disabled"),
        }))
    );
  assert.deepEqual(unconfiguredAgents, [
    { value: "codex", disabled: true, disabledAttribute: true },
    { value: "claude", disabled: true, disabledAttribute: true },
  ]);
  checks.push(
    "official panel has no training trigger; separate research mode cannot start without bounded authorization; unconfigured cloud agents remain disabled"
  );
  await page.locator("[data-tab=gallery]").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("mobile-synthetic.png");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  checks.push("390px RTL viewport has no horizontal overflow");
  const accessibility = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    accessibility.violations,
    [],
    JSON.stringify(
      accessibility.violations.map(v => ({ id: v.id, nodes: v.nodes.length })),
      null,
      2
    )
  );
  checks.push("axe accessibility scan passes on library");
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const report = {
    at: new Date().toISOString(),
    contentKind: "synthetic-ui-only",
    checks,
    autoUpdate: {
      before: 12,
      after: 13,
      observedMs: updateMs,
      timeoutMs: 10000,
      importStatus: imported.status,
      recreatedHtml: false,
    },
    externalRequests: external,
    pageErrors: errors,
    accessibilityViolations: accessibility.violations.length,
    screenshots: shots,
    trainingPerformed: false,
    limitation:
      "All identities, rights approvals, images and video are fictional fixtures. An import flag of real is required by the existing file importer, and is not a claim that fixture content is real training data.",
  };
  await writeFile(
    resolve(evidence, "browser-validation.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await studio.close();
  assert.ok(root.startsWith(temp));
  await rm(temp, { recursive: true, force: true });
}
