import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { fileHash, repo } from "../common.mjs";

const temp = await mkdtemp(resolve(tmpdir(), "basira-assistant-browser-"));
const root = resolve(temp, "data");
await fixture(root, { images: 2 });
const original = resolve(root, "incoming/demo/images/demo-001.png");
await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="white"/><text x="45" y="120" font-family="Arial" font-size="40" fill="black">reviewer@example.invalid</text><text x="45" y="230" font-family="Arial" font-size="40" fill="black">SYNTHETIC TEST ONLY</text><rect x="80" y="330" width="700" height="130" fill="#236950"/></svg>'
  )
)
  .png()
  .toFile(original);
const manifestPath = resolve(root, "incoming/demo/dataset.review.pending.json");
const manifest = JSON.parse(await readFile(manifestPath));
manifest.samples[0].sha256 = await fileHash(original);
manifest.samples[0].width = 1000;
manifest.samples[0].height = 600;
await writeFile(manifestPath, JSON.stringify(manifest));
const originalHash = await fileHash(original);
const evidence = resolve(repo, "docs/vision-ai-evidence/studio-assistant");
await mkdir(evidence, { recursive: true });
const studio = await createStudio(root);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  locale: "ar-SA",
});
const page = await context.newPage();
const external = [],
  errors = [],
  checks = [],
  screenshots = [];
await context.route("**/*", route => {
  const url = route.request().url();
  if (url.startsWith(studio.url + "/")) return route.continue();
  external.push(url);
  return route.abort();
});
page.on("pageerror", e => errors.push(e.message));
const shot = async name => {
  const path = resolve(evidence, name);
  await page.screenshot({ path, fullPage: true });
  screenshots.push({
    path: relative(repo, path).replaceAll("\\", "/"),
    sha256: await fileHash(path),
    contentKind: "synthetic-ui-only",
  });
};
try {
  await page.goto(studio.url);
  await page.locator("input[name=id]").fill("editor");
  await page.locator("input[name=password]").fill("synthetic-fixture-password");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "2"
  );
  await page.locator(".card").first().click();
  await page.locator("#use-ocr").check();
  await page.locator("#analyze-models").click();
  await page.waitForFunction(
    () =>
      document
        .getElementById("assistant-result")
        .textContent.includes("local-model-proposals"),
    {},
    { timeout: 120000 }
  );
  const report = await page.evaluate(async () => {
    const r = await (await fetch("/api/assistant/reports")).json();
    return r.reports.find(r => r.scope === "local-model-proposals");
  });
  console.log(
    JSON.stringify({
      modelFailures: report.modelFailures,
      issues: report.issues,
      proposals: report.proposals.length,
    })
  );
  assert.deepEqual(report.modelFailures, []);
  assert.ok(
    report.redactionRegions.length > 0,
    "OCR must find fictional sensitive text"
  );
  assert.ok(!JSON.stringify(report).includes("reviewer@example.invalid"));
  checks.push(
    "Existing EfficientDet Lite0 and Tesseract run locally; fictional email produces a proposed ROI, no raw text is persisted"
  );
  await page.locator("#reason").fill("تغطية النص الاصطناعي في نسخة مستقلة");
  await page.locator("#confirm-redaction").check();
  await page.locator("#apply-redaction").click();
  await page.waitForFunction(() =>
    document.getElementById("revision").textContent.includes("الإصدار 1")
  );
  assert.equal(await fileHash(original), originalHash);
  await page.locator("#compare-versions").click();
  await page.waitForFunction(() =>
    ["compare-before", "compare-after"].every(id => {
      const e = document.getElementById(id);
      return e.complete && e.naturalWidth > 0;
    })
  );
  await shot("comparison-synthetic.png");
  checks.push(
    "Explicit confirmed redaction creates audited derivative; original SHA stays unchanged, before/after decode, approvals stay pending"
  );
  const current = (await studio.workspace.catalog()).items.find(
    i => i.sample.id === "demo-001"
  );
  assert.equal(current.sample.privacy.status, "pending");
  assert.equal(current.sample.annotation.status, "pending");
  const box = report.redactionRegions[0].box;
  const pixel = await sharp(await studio.workspace.mediaPath(current))
    .extract({
      left: Math.floor((box[0] + box[2] / 2) * 1000),
      top: Math.floor((box[1] + box[3] / 2) * 600),
      width: 1,
      height: 1,
    })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok([...pixel].every(v => v === 0));
  await page.locator("#close-editor").click();
  await page.locator("[data-tab=assistant]").click();
  await page.locator("#batch-models").click();
  await page.waitForFunction(() =>
    document.getElementById("batch-progress").textContent.includes("2 / 2")
  );
  const batchReports = await page.evaluate(async () =>
    (await (await fetch("/api/assistant/reports")).json()).reports.filter(
      r => r.scope === "local-model-proposals"
    )
  );
  assert.equal(batchReports.length, 3);
  assert.ok(batchReports.every(r => r.modelFailures.length === 0));
  checks.push(
    "Batch local detection processes both synthetic samples without modifying or approving them"
  );
  await page.locator("#scan-similarity").click();
  await page.waitForFunction(() =>
    document.getElementById("similarity-results").textContent.includes("عينات")
  );
  await page.locator("#export-chatgpt").click();
  await page.waitForFunction(() =>
    document
      .getElementById("packet-preview")
      .textContent.includes("chatgpt-review-packet-without-media")
  );
  await shot("assistant-synthetic.png");
  const packet = JSON.parse(
    await page.locator("#packet-preview").textContent()
  );
  assert.equal(packet.cloudUploadPerformed, false);
  assert.ok(!JSON.stringify(packet).includes("reviewer@example.invalid"));
  assert.equal(packet.planning.classes.length, 35);
  checks.push(
    "Issue panel, similarity scan and previewable 35-class ChatGPT needs packet work with no media export or cloud upload"
  );
  const source = await sharp({
    create: { width: 480, height: 320, channels: 3, background: "#81acba" },
  })
    .png()
    .toBuffer();
  await page.locator("details:has(#synthetic-form) summary").click();
  await page
    .locator("#synthetic-file")
    .setInputFiles({
      name: "synthetic-only.png",
      mimeType: "image/png",
      buffer: source,
    });
  for (const [name, value] of Object.entries({
    generator: "Vector synthetic test generator",
    model: "solid-fill fixture",
    prompt: "New independently created plain test scene",
    origin: "independent synthetic test",
    license: "fictional-test-permission",
    rightsText: "Fictional test rights only; independent human review required",
    generatedAt: "2026-10-15T00:00",
    settings: '{"color":"#81acba"}',
  }))
    await page.locator(`#synthetic-form [name=${name}]`).fill(value);
  await page.locator("#synthetic-form [name=independentCreation]").check();
  await page.locator("#synthetic-form [name=noUserData]").check();
  const before = Date.now();
  await page.locator("#synthetic-form button").click();
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "3",
    {},
    { timeout: 10000 }
  );
  const importUpdateMs = Date.now() - before;
  const imported = (await studio.workspace.catalog()).items.find(
    i => i.sample.generation
  );
  assert.equal(imported.contentKind, "synthetic");
  assert.equal(imported.sample.privacy.status, "pending");
  assert.equal(imported.sample.split, null);
  await page.locator("[data-tab=gallery]").click();
  await page.locator("#content-filter").selectOption("real");
  assert.equal(await page.locator(".card").count(), 0);
  await page.locator("#content-filter").selectOption("synthetic");
  assert.equal(await page.locator(".card").count(), 3);
  checks.push(
    "Synthetic upload uses existing bundle/draft tools, records model/settings/rights, auto-refreshes and is isolated by filter with no approvals/split"
  );
  const denied = await page.evaluate(async () => {
    const r = await fetch("/api/assistant/synthetic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return {
      csrf: r.status,
      cloud: (await fetch("/api/assistant/cloud")).status,
    };
  });
  assert.equal(denied.csrf, 400);
  assert.equal(denied.cloud, 404);
  checks.push(
    "Assistant modifications require session CSRF; no cloud route exists"
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-tab=assistant]").click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    "mobile panel overflow"
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    accessibility.violations,
    [],
    JSON.stringify(
      accessibility.violations.map(v => ({ id: v.id, nodes: v.nodes.length }))
    )
  );
  checks.push("390px assistant panel does not overflow and passes axe");
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const validation = {
    at: new Date().toISOString(),
    contentKind: "synthetic-ui-only",
    checks,
    modelFailures: report.modelFailures,
    ocrSensitiveRegions: report.redactionRegions.length,
    detectorProposals: report.proposals.length,
    modelManifest: report.models,
    autoUpdate: {
      before: 2,
      after: 3,
      observedMs: importUpdateMs,
      recreatedHtml: false,
    },
    originalSha256Unchanged: true,
    externalRequests: external,
    pageErrors: errors,
    accessibilityViolations: accessibility.violations.length,
    screenshots,
    trainingPerformed: false,
    limitation:
      "Synthetic functional checks only. No accuracy, privacy recall, distance or real training claim. Object detector successfully executes even if it finds no objects in a text fixture.",
  };
  await writeFile(
    resolve(evidence, "browser-validation.json"),
    JSON.stringify(validation, null, 2) + "\n"
  );
  console.log(JSON.stringify(validation, null, 2));
} finally {
  await browser.close();
  await studio.close();
  assert.ok(root.startsWith(temp));
  await rm(temp, { recursive: true, force: true });
}
