/** Chrome failure/recovery tests with one synthetic sample; no real approvals. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { repo } from "../common.mjs";
const temp = await fs.mkdtemp(resolve(tmpdir(), "basira-quick-conflict-")),
  root = resolve(temp, "data");
let studio, browser;
const pageErrors = [],
  unexpectedConsole = [],
  responses = [],
  external = [];
try {
  await fixture(root, { images: 1, classes: [23] });
  const path = resolve(root, "incoming/demo/dataset.review.pending.json"),
    data = JSON.parse(await fs.readFile(path));
  data.samples[0].annotation.objects[0].stairsDirection = {
    label: "stairs_up",
    evidence: "Fictional visual staircase",
  };
  await fs.writeFile(path, JSON.stringify(data));
  studio = await createStudio(root);
  const item = (await studio.workspace.catalog()).items[0];
  browser = await chromium.launch({ channel: "chrome", headless: true });
  async function login(existing) {
    const c = existing ?? (await browser.newContext());
    if (!existing)
      await c.route("**/*", r =>
        r
          .request()
          .url()
          .startsWith(studio.url + "/")
          ? r.continue()
          : (external.push(r.request().url()), r.abort())
      );
    const p = await c.newPage();
    p.on("pageerror", e => pageErrors.push(e.message));
    p.on("console", m => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
        unexpectedConsole.push(m.text());
    });
    p.on("response", r => {
      if (r.status() >= 400)
        responses.push({ path: new URL(r.url()).pathname, status: r.status() });
    });
    await p.goto(studio.url);
    if (!existing) {
      await p.locator("input[name=id]").fill("editor");
      await p
        .locator("input[name=password]")
        .fill("synthetic-fixture-password");
      await p.getByRole("button", { name: "دخول", exact: true }).click();
    }
    await p.locator(".card").waitFor();
    await p.locator("[data-tab=batch]").click();
    await p.locator("#batch-kind").selectOption("synthetic");
    await p.locator("#batch-fast-start").click();
    await p.waitForFunction(
      () =>
        document.getElementById("batch-detail").open &&
        !document.getElementById("batch-fields").disabled
    );
    return { c, p };
  }
  const saved = p =>
    p.waitForFunction(() =>
      document
        .getElementById("batch-draft-status")
        .textContent.startsWith("حُفظت مسودة")
    );
  const { c: a, p } = await login();
  let intercepted = false;
  await p.route("**/api/batch/draft", async r => {
    if (!intercepted) {
      intercepted = true;
      await r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic interrupted connection" }),
      });
    } else await r.fallback();
  });
  await p
    .locator("#batch-reason")
    .fill("Unsent synthetic draft remains recoverable");
  await p.waitForFunction(() =>
    document
      .getElementById("batch-draft-status")
      .textContent.includes("المسودة باقية")
  );
  await p.locator("#batch-close").click();
  await p.locator("#batch-fast-start").click();
  await p.waitForFunction(
    () =>
      document.getElementById("batch-detail").open &&
      !document.getElementById("batch-fields").disabled
  );
  assert.equal(
    await p.locator("#batch-reason").inputValue(),
    "Unsent synthetic draft remains recoverable"
  );
  await p.locator("#batch-privacy-absent").click();
  await p.locator("#batch-reason").fill("Baseline synthetic draft");
  await saved(p);
  const { c: b, p: q } = await login(a);
  await q
    .locator("#batch-reason")
    .fill("Newer draft from the second synthetic window");
  await saved(q);
  await p
    .locator("#batch-reason")
    .fill("Local first-window draft must not overwrite newer work");
  await p.waitForFunction(() =>
    document
      .getElementById("batch-draft-status")
      .textContent.includes("المسودة باقية")
  );
  // Read the private actor record through the authenticated test browser, not a forged approval.
  const server = await q.evaluate(async () => {
    const r = await fetch("/api/batch/progress");
    return r.json();
  });
  assert.equal(
    Object.values(server.drafts)[0].values.reason,
    "Newer draft from the second synthetic window"
  );
  await p.locator("#batch-close").click();
  await p.locator("#batch-fast-start").click();
  await p.waitForFunction(
    () =>
      document.getElementById("batch-detail").open &&
      !document.getElementById("batch-fields").disabled
  );
  assert.equal(
    await p.locator("#batch-reason").inputValue(),
    "Newer draft from the second synthetic window"
  );
  assert.equal(await p.locator("#batch-draft-recovery").isVisible(), true);
  await p.locator("#batch-draft-recovery summary").click();
  assert.match(
    await p.locator("#batch-draft-diff").textContent(),
    /Local first-window draft/
  );
  await p.locator("#batch-recover-local").click();
  assert.equal(
    await p.locator("#batch-reason").inputValue(),
    "Local first-window draft must not overwrite newer work"
  );
  await saved(p);
  const vote = q.waitForResponse(
    r => r.status() === 409 && /\/api\/batch\/(attest|draft)$/.test(r.url()),
    { timeout: 10000 }
  );
  await q.locator("#batch-attest").press("Control+Enter");
  const v = await vote;
  assert.equal(v.status(), 409, JSON.stringify(await v.json()));
  const after = await studio.workspace.item(item.key);
  assert.equal(after.version, 0);
  assert.deepEqual(after.decisions??{}, {});
  assert.deepEqual(responses.map(x => x.status).sort(), [409, 409, 503]);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedConsole, []);
  assert.deepEqual(external, []);
  const result = {
    browser: "Chrome",
    syntheticOnly: true,
    failedSaveRecoveredWithoutDeadlock: true,
    newerTabDraftNotOverwritten: true,
    explicitComparisonBeforeLocalRestore: true,
    staleInspectionBlocked: true,
    expectedHttpStatuses: responses.map(x => x.status),
    unexpectedPageErrors: pageErrors,
    unexpectedConsoleErrors: unexpectedConsole,
    externalRequests: external,
    annotationsOrApprovalsCreated: 0,
    trainingStarted: false,
  };
  await fs.mkdir(resolve(repo, ".vision-ai/quick-review"), { recursive: true });
  await fs.writeFile(
    resolve(repo, ".vision-ai/quick-review/conflict-validation.json"),
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
  await a.close();
  if (a !== b) await b.close();
} finally {
  await browser?.close();
  await studio?.close();
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
  await fs.rm(temp, { recursive: true, force: true });
}
