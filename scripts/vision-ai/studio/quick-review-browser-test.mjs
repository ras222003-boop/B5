/** Actual Chrome, isolated synthetic images/accounts only; never reads the private library. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { fileHash, repo } from "../common.mjs";
import * as assistant from "./assistant.mjs";
import * as prereview from "./prereview.mjs";
const temp = await fs.mkdtemp(resolve(tmpdir(), "basira-fast-browser-")),
  root = resolve(temp, "data"),
  evidence = resolve(repo, ".vision-ai/quick-review");
let studio, browser;
const errors = [],
  network = [],
  external = [],
  analysisRequests = [];
try {
  await fixture(root, { images: 3, classes: [23] });
  const manifest = resolve(root, "incoming/demo/dataset.review.pending.json"),
    data = JSON.parse(await fs.readFile(manifest));
  for (const [n, s] of data.samples.entries()) {
    s.taskCandidate = { task: "basira-stairs-v1" };
    s.annotation.objects[0].classId = 23;
    if (n)
      s.annotation.objects[0].stairsDirection = {
        label: "stairs_up",
        evidence: "Fictional visible ascending risers",
      };
  }
  data.samples[2].conditions.lighting = "unreviewed";
  await fs.writeFile(manifest, JSON.stringify(data));
  studio = await createStudio(root);
  const items = (await studio.workspace.catalog()).items,
    before = await Promise.all(
      items.map(async i => [
        i.key,
        await fileHash(await studio.workspace.mediaPath(i, true)),
      ])
    );
  for (const p of (await assistant.scan(studio.workspace)).pairs)
    if (p.requiresReview)
      await assistant.reviewPair(
        studio.workspace,
        {
          id: p.id,
          relation: "different",
          reason: "Independent fictional drawing comparison",
        },
        { id: "reviewer", roles: ["rights", "privacy", "labels"] }
      );
  for (const i of items.slice(0, 2))
    await prereview.analyze(studio.workspace, i.key, {
      privacyTool: async () => ({
        status: "fictional-test-only",
        regions: [],
        limits: ["Synthetic only; no real privacy assertion"],
      }),
    });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  async function login(id) {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await c.route("**/*", r =>
      r
        .request()
        .url()
        .startsWith(studio.url + "/")
        ? r.continue()
        : (external.push(r.request().url()), r.abort())
    );
    const p = await c.newPage();
    p.on("pageerror", e => errors.push(e.message));
    p.on("console", m => {
      if (m.type() === "error") errors.push(m.text());
    });
    p.on("response", r => {
      if (r.status() >= 400)
        network.push({ status: r.status(), path: new URL(r.url()).pathname });
    });
    p.on("request", r => {
      if (
        /\/api\/(?:prereview\/analyze|assistant\/(?:analyze|model-results))/.test(
          r.url()
        )
      )
        analysisRequests.push(r.url());
    });
    await p.goto(studio.url);
    await p.locator("input[name=id]").fill(id);
    await p.locator("input[name=password]").fill("synthetic-fixture-password");
    await p.getByRole("button", { name: "دخول", exact: true }).click();
    await p.locator(".card").first().waitFor();
    await p.locator("[data-tab=batch]").click();
    await p.locator("#batch-kind").selectOption("synthetic");
    await p.locator("[data-batch-inspect]").first().waitFor();
    return { c, p };
  }
  const ready = p =>
    p.waitForFunction(
      () =>
        document.getElementById("batch-detail").open &&
        !document.getElementById("batch-fields").disabled
    );
  async function title(p, id) {
    await p.waitForFunction(
      id =>
        document.getElementById("batch-title").textContent.includes(id) &&
        !document.getElementById("batch-fields").disabled,
      id
    );
  }
  let { c, p } = await login("editor");
  await p.locator("#batch-fast-start").click();
  await ready(p);
  for (const k of ["faces", "plates", "personalText"])
    assert.equal(
      await p.locator("#batch-privacy-" + k).inputValue(),
      "unreviewed"
    );
  await p
    .locator('[data-quick-direction="0"]')
    .selectOption("stairs_present_uncertain_direction");
  await p
    .locator('[data-quick-evidence="0"]')
    .fill("Fictional drawing hides flight orientation; no up/down claim");
  await p
    .locator("#batch-condition-motion")
    .selectOption("unknown_stairs_still");
  await p.locator("#batch-privacy-absent").click();
  await p
    .locator("#batch-reason")
    .fill("Synthetic quick review save/reopen test");
  await p.waitForFunction(() =>
    document
      .getElementById("batch-draft-status")
      .textContent.startsWith("حُفظت مسودة")
  );
  assert.equal((await studio.workspace.item(items[0].key)).version, 0);
  await p.reload();
  await p.locator("[data-tab=batch]").click();
  await p.locator("#batch-kind").selectOption("synthetic");
  await p.locator("#batch-fast-start").click();
  await ready(p);
  assert.equal(
    await p.locator('[data-quick-direction="0"]').inputValue(),
    "stairs_present_uncertain_direction"
  );
  assert.equal(
    await p.locator("#batch-condition-motion").inputValue(),
    "unknown_stairs_still"
  );
  assert.equal(
    await p.locator("#batch-reason").inputValue(),
    "Synthetic quick review save/reopen test"
  );
  await p.locator("#batch-attest").press("Control+Enter");
  await title(p, items[1].sample.id);
  assert.equal((await studio.workspace.item(items[0].key)).version, 0);
  // A real process/session restart must preserve actual pending inspections without committing them.
  const port = new URL(studio.url).port;
  await c.close();
  await studio.close();
  studio = await createStudio(root, { port: +port });
  ({ c, p } = await login("editor"));
  await p.locator("#batch-fast-start").click();
  await ready(p);
  await title(p, items[1].sample.id);
  await p.locator("#batch-privacy-absent").click();
  await p.locator("#batch-attest").press("Control+Enter");
  await title(p, items[2].sample.id);
  await p.locator("#batch-title").click();
  await p.keyboard.press("s");
  await p.waitForFunction(() => !document.getElementById("batch-detail").open);
  let commits = 0;
  p.on("request", r => {
    if (r.url().endsWith("/api/batch/commit") && r.method() === "POST")
      commits++;
  });
  await p.locator("#batch-commit").evaluate(b => {
    b.click();
    b.click();
  });
  await p.waitForFunction(() =>
    document.getElementById("batch-result").textContent.includes("حُفظت 2 صور")
  );
  assert.equal(commits, 1);
  for (const i of items.slice(0, 2)) {
    const a = await studio.workspace.item(i.key);
    assert.equal(a.version, 1);
    assert.deepEqual(a.decisions, {});
  }
  assert.equal((await studio.workspace.item(items[2].key)).version, 0);
  await c.close();
  ({ c, p } = await login("reviewer"));
  await p.locator("#batch-fast-start").click();
  await ready(p);
  await title(p, items[0].sample.id);
  assert.match(await p.locator("#batch-detail-status").textContent(), /editor/);
  for (const k of ["faces", "plates", "personalText"])
    assert.equal(
      await p.locator("#batch-privacy-" + k).inputValue(),
      "unreviewed"
    );
  await fs.mkdir(evidence, { recursive: true });
  await p.screenshot({
    path: resolve(evidence, "quick-review-synthetic.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true
  );
  await p.screenshot({
    path: resolve(evidence, "quick-review-mobile-synthetic.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.locator("#batch-privacy-preparer").click();
  await p.locator("#batch-attest").press("Control+Enter");
  await title(p, items[1].sample.id);
  await p.locator("#batch-privacy-preparer").click();
  await p.locator("#batch-attest").press("Control+Enter");
  await p.waitForFunction(() => !document.getElementById("batch-detail").open);
  await p.locator("#batch-commit").click();
  await p.waitForFunction(() =>
    document.getElementById("batch-result").textContent.includes("حُفظت 2 صور")
  );
  for (const i of items.slice(0, 2)) {
    const a = await studio.workspace.item(i.key);
    assert.equal(a.version, 2);
    for (const kind of ["rights", "privacy", "labels"])
      assert.equal(a.decisions[kind].reviewer, "reviewer");
  }
  assert.equal((await studio.workspace.item(items[2].key)).version, 0);
  for (const [key, sha] of before)
    assert.equal(
      await fileHash(
        await studio.workspace.mediaPath(await studio.workspace.item(key), true)
      ),
      sha
    );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  assert.deepEqual(external, []);
  assert.deepEqual(analysisRequests, []);
  const result = {
    browser: "Chrome",
    syntheticOnly: true,
    draftSaveReopen: true,
    inspectionSurvivesRestartAndLogin: true,
    noCommitOnRestore: true,
    inlineDirectionAndUnknownMotionSaved: true,
    keyboardAndAutoNext: true,
    oneBatchCommit: true,
    independentPrivacyDecisionNotPreselected: true,
    threeSeparateIndependentDecisions: true,
    incompleteSampleExcluded: true,
    originalsPreserved: true,
    consoleErrors: errors,
    failedRequests: network,
    externalRequests: external,
    newInferenceRequests: analysisRequests,
    trainingStarted: false,
  };
  await fs.writeFile(
    resolve(evidence, "validation.json"),
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
  await c.close();
} finally {
  await browser?.close();
  await studio?.close();
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
  await fs.rm(temp, { recursive: true, force: true });
}
