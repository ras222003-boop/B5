import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { run } from "./prereview-run.mjs";
import { createStudio } from "./server.mjs";
import * as a from "./assistant.mjs";
import * as p from "./prereview.mjs";
import { fileHash, repo } from "../common.mjs";
const temp = await mkdtemp(resolve(tmpdir(), "basira-prereview-browser-")),
  root = resolve(temp, "data");
let studio, browser;
try {
  await fixture(root, { images: 2 });
  if (process.env.BASIRA_TEST_CV_CONFIG)
    await writeFile(
      resolve(root, ".studio/prereview-cv.json"),
      await readFile(process.env.BASIRA_TEST_CV_CONFIG)
    );
  const image = resolve(root, "incoming/demo/images/demo-001.png");
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="white"/><text x="45" y="120" font-family="Arial" font-size="40" fill="black">reviewer@example.invalid</text><text x="45" y="230" font-family="Arial" font-size="40" fill="black">SYNTHETIC TEST ONLY</text><rect x="80" y="330" width="700" height="130" fill="#236950"/></svg>'
    )
  )
    .png()
    .toFile(image);
  const manifestPath = resolve(
    root,
    "incoming/demo/dataset.review.pending.json"
  );
  const data = JSON.parse(await readFile(manifestPath));
  data.samples[0].sha256 = await fileHash(image);
  data.samples[0].width = 1000;
  data.samples[0].height = 600;
  await writeFile(manifestPath, JSON.stringify(data));
  const before = await fileHash(image);
  const batch = await run(root, { syntheticOnly: true });
  assert.equal(batch.completed, 2);
  assert.equal(batch.failed, 0);
  studio = await createStudio(root);
  const c = await studio.workspace.catalog(),
    item = c.items.find(i => i.sample.id === "demo-001");
  const reports = await a.reports(studio.workspace, item.key),
    model = reports.find(r => r.scope === "local-model-proposals");
  assert.deepEqual(model.modelFailures, []);
  assert.ok(model.redactionRegions.length > 0);
  assert.ok(!JSON.stringify(model).includes("reviewer@example.invalid"));
  let report = (await p.board(studio.workspace)).items.find(
    i => i.key === item.key
  ).report;
  if (process.env.BASIRA_TEST_CV_CONFIG) {
    assert.equal(report.privacy.status, "completed");
    assert.equal(report.privacy.models.length, 4);
  }
  // Explicit fixture detector outputs exercise human selection; these are not real inference results.
  await a.saveModelReport(
    studio.workspace,
    {
      key: item.key,
      version: item.version,
      imageSha256: item.sample.sha256,
      detections: [{ classId: 2, score: 0.7, box: [0.1, 0.1, 0.2, 0.2] }],
      text: [
        {
          text: "reviewer@example.invalid",
          score: 0.9,
          box: [0.04, 0.1, 0.75, 0.14],
        },
      ],
    },
    p.producer,
    {}
  );
  report = await p.analyze(studio.workspace, item.key);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    }),
    external = [],
    errors = [];
  await context.route("**/*", route => {
    if (
      route
        .request()
        .url()
        .startsWith(studio.url + "/")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  async function login(id) {
    await page.locator("input[name=id]").fill(id);
    await page
      .locator("input[name=password]")
      .fill("synthetic-fixture-password");
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await page.waitForFunction(
      () => document.getElementById("total").textContent === "2"
    );
  }
  await page.goto(studio.url);
  await login("editor");
  await page.locator("[data-tab=assistant]").click();
  await page.locator("#prereview-kind").selectOption("synthetic");
  const evidence = resolve(repo, "docs/vision-ai-evidence/smart-prereview");
  await mkdir(evidence, { recursive: true });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-open-prereview]").length === 2
  );
  await page.screenshot({
    path: resolve(evidence, "synthetic-board.png"),
    fullPage: true,
  });
  await page.locator(`[data-open-prereview="${item.key}"]`).click();
  await page.locator("#prereview-confirm-human").waitFor();
  assert.equal(
    await page.locator("[data-confirm-proposal]:checked").count(),
    0
  );
  await page
    .getByText("مقارنة الأصل والنسخة المقترحة غير المفعلة", { exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".prereview-compare img")].every(
      i => i.complete && i.naturalWidth > 0
    )
  );
  await page.locator("#prereview-detail").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidence, "synthetic-preparer.png"),
    fullPage: true,
  });
  await page.locator("#prereview-edit-regions").click();
  assert.equal(
    await page.locator("[data-remove-region]").count(),
    report.privacy.regions.length
  );
  assert.equal(await page.locator("#confirm-redaction").isChecked(), false);
  await page.locator("[data-remove-region]").first().click();
  assert.equal((await studio.workspace.item(item.key)).version, 0);
  await page.locator("[data-confirm-proposal]").first().check();
  await page.locator("#prereview-confirm-human").check();
  await page.locator("#reason").fill("تحققت من الاقتراح الاصطناعي بنفسي");
  await page.locator("#prereview-save-proposals").click();
  await page.waitForFunction(() =>
    document.getElementById("revision").textContent.includes("الإصدار 1")
  );
  assert.equal(
    (await studio.workspace.item(item.key)).sample.annotation.annotator,
    "editor"
  );
  assert.equal(await fileHash(image), before);
  await page.locator("#close-editor").click();
  await page.locator("#logout").click();
  await login("reviewer");
  await page.reload();
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "2"
  );
  await page.locator("[data-tab=assistant]").click();
  await page.locator("#prereview-kind").selectOption("synthetic");
  await page.locator(`[data-open-prereview="${item.key}"]`).click();
  await page.waitForFunction(() => document.getElementById("editor").open);
  await page
    .locator("#prereview-detail")
    .getByText("تقرير إصدار سابق للقراءة فقط.", { exact: false })
    .waitFor();
  assert.equal(
    await page.locator("#prereview-save-proposals").isDisabled(),
    true
  );
  assert.equal(
    (await studio.workspace.item(item.key)).sample.annotation.reviewer,
    ""
  );
  const eligibility = await page.evaluate(
    async key => await (await fetch("/api/review-eligibility/" + key)).json(),
    item.key
  );
  assert.equal(eligibility.independent, true);
  assert.ok(eligibility.allowedKinds.includes("labels"));
  await page.screenshot({
    path: resolve(evidence, "synthetic-reviewer.png"),
    fullPage: true,
  });
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      syntheticImages: 2,
      localDetectorAndOCR: "passed",
      localPrivacy: process.env.BASIRA_TEST_CV_CONFIG
        ? "passed"
        : "not_configured",
      humanApprovalsRecorded: 0,
      externalRequests: 0,
      originalUnchanged: true,
    })
  );
} finally {
  await browser?.close();
  await studio?.close();
  await rm(temp, { recursive: true, force: true });
}
