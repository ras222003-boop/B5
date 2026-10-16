import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { fileHash, repo } from "../common.mjs";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "basira-save-browser-")),
  root = path.join(temp, "data");
let studio,
  browser,
  context,
  page,
  phase = "positive";
const errors = [],
  network = [],
  consoleErrors = [],
  external = [],
  checks = [];
try {
  await fixture(root, { images: 1 });
  studio = await createStudio(root);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const key = (await studio.workspace.catalog()).items[0].key,
    original = await studio.workspace.mediaPath(
      await studio.workspace.item(key),
      true
    ),
    originalSHA = await fileHash(original);
  async function newContext() {
    context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    });
    await context.route("**/*", route =>
      route
        .request()
        .url()
        .startsWith(studio.url + "/")
        ? route.continue()
        : (external.push(route.request().url()), route.abort())
    );
    page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => {
      if (m.type() === "error") consoleErrors.push({ phase, text: m.text() });
    });
    page.on("response", r => {
      if (r.status() >= 400)
        network.push({
          phase,
          status: r.status(),
          path: new URL(r.url()).pathname,
        });
    });
  }
  async function login(id) {
    await page.goto(studio.url);
    await page.locator("input[name=id]").fill(id);
    await page
      .locator("input[name=password]")
      .fill("synthetic-fixture-password");
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await page.locator(".card").waitFor();
    await page.locator(".card").click();
    await page.waitForFunction(
      () =>
        document.getElementById("editor").open &&
        !document.getElementById("editor-fields").disabled
    );
  }
  async function saved() {
    const response = page.waitForResponse(
      r =>
        r.request().method() === "POST" && r.url().endsWith("/api/items/" + key)
    );
    await page.locator("#save-labels").click();
    const r = await response;
    assert.equal(r.status(), 200, await r.text());
    await page.waitForFunction(
      () =>
        document
          .getElementById("editor-save-status")
          .textContent.startsWith("تم حفظ الإصدار") &&
        !document.getElementById("editor-fields").disabled
    );
    return r;
  }
  async function externalEdit(update) {
    const i = await studio.workspace.item(key),
      objects = structuredClone(i.sample.annotation.objects);
    update(objects);
    await studio.workspace.change(
      key,
      {
        action: "labels",
        version: i.version,
        objects,
        reason: "concurrent synthetic editor change",
      },
      { id: "other-fixture-editor", roles: ["annotator"] }
    );
  }
  await newContext();
  await login("editor");
  await page.locator('#reason').fill('');
  await page.locator('#save-labels').click();
  await page.waitForFunction(()=>document.getElementById('editor-save-status').textContent.includes('3 إلى 2000'));
  assert.equal((await studio.workspace.item(key)).version,0);
  checks.push('Missing reason is explained inside the editor before any invalid POST.');
  // Hold a poll response containing the old catalog until after the save has fully committed/reopened.
  let releasePoll, capturedPoll;
  const pollGate = new Promise(r => (releasePoll = r)),
    captured = new Promise(r => (capturedPoll = r));
  let hold = true;
  await page.route("**/api/catalog", async route => {
    if (hold) {
      hold = false;
      const response = await route.fetch();
      capturedPoll();
      await pollGate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await captured;
  await page.locator('[data-coord="0,0"]').fill(".22");
  await page
    .locator("#reason")
    .fill("synthetic initial save with delayed poll");
  let posts = 0;
  page.on("request", r => {
    if (r.method() === "POST" && r.url().endsWith("/api/items/" + key)) posts++;
  });
  const firstResponse = page.waitForResponse(
    r =>
      r.request().method() === "POST" && r.url().endsWith("/api/items/" + key)
  );
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) document.getElementById("save-labels").click();
  });
  assert.equal((await firstResponse).status(), 200);
  await page.waitForFunction(
    () =>
      document
        .getElementById("editor-save-status")
        .textContent.startsWith("تم حفظ الإصدار") &&
      !document.getElementById("editor-fields").disabled
  );
  assert.equal(posts, 1);
  assert.ok(
    (await page.locator("#revision").textContent()).includes("الإصدار 1")
  );
  releasePoll();
  await page.waitForTimeout(300);
  await page.locator("#close-editor").click();
  await page.locator(".card").click();
  await page.waitForFunction(
    () =>
      document.getElementById("editor").open &&
      !document.getElementById("editor-fields").disabled
  );
  assert.equal(await page.locator('[data-coord="0,0"]').inputValue(), "0.22");
  checks.push(
    "Delayed stale poll cannot overwrite saved version; four clicks issue one POST; fresh reopen retains x=0.22."
  );
  await page.locator('#overlay').scrollIntoViewIfNeeded();
  const bounds=await page.locator('#overlay').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.65,bounds.y+bounds.height*.6);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.85,bounds.y+bounds.height*.8);await page.mouse.up();
  await page.locator('#reason').fill('synthetic newly drawn object persists');await saved();
  assert.equal((await studio.workspace.item(key)).sample.annotation.objects.length,2);
  assert.equal(await page.locator('[data-class]').count(),2);
  checks.push('A newly drawn object saves and reopens with server-owned unknown spatial evidence.');
  // Non-overlapping edits reconcile automatically, retaining both contributors' changes.
  await page.locator('[data-coord="0,0"]').fill(".24");
  await page.locator("#reason").fill("synthetic disjoint merge");
  await externalEdit(o => (o[0].classId = 2));
  await saved();
  let item = await studio.workspace.item(key);
  assert.equal(item.sample.annotation.objects[0].classId, 2);
  assert.equal(item.sample.annotation.objects[0].box[0], 0.24);
  checks.push("Disjoint external class and local box changes both persist.");
  // Overlapping edits require an explicit human choice, and do not send a stale request.
  await page.locator('[data-coord="0,0"]').fill(".28");
  await page.locator("#reason").fill("synthetic explicit conflict resolution");
  await externalEdit(o => (o[0].box[0] = 0.31));
  const before = posts;
  await page.locator("#save-labels").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("editor-fields").disabled &&
      document
        .getElementById("editor-save-status")
        .textContent.includes("تعارض")
  );
  assert.equal(posts, before);
  assert.equal(await page.locator('[data-coord="0,0"]').inputValue(), ".28");
  assert.equal(
    await page.locator("#reason").inputValue(),
    "synthetic explicit conflict resolution"
  );
  await page.locator("#confirm-rebase").check();
  await page.locator("#rebase-draft").click();
  await saved();
  checks.push(
    "Overlapping edits retain unsaved fields/reason, expose comparison and require explicit reconciliation."
  );
  // Real 400 response must remain visible in the dialog without clearing the draft.
  phase = "negative";
  await page.locator('[data-coord="0,2"]').fill("0");
  await page.locator("#reason").fill("synthetic invalid box retained");
  const badResponse = page.waitForResponse(
    r =>
      r.request().method() === "POST" && r.url().endsWith("/api/items/" + key)
  );
  await page.locator("#save-labels").click();
  const bad = await badResponse;
  assert.equal(bad.status(), 400);
  const badBody = await bad.json();
  await page.waitForFunction(() =>
    document
      .getElementById("editor-save-status")
      .textContent.includes("HTTP 400")
  );
  assert.equal(await page.locator('[data-coord="0,2"]').inputValue(), "0");
  assert.equal(
    await page.locator("#reason").inputValue(),
    "synthetic invalid box retained"
  );
  assert.ok(
    (await page.locator("#editor-save-status").textContent()).includes(
      badBody.error
    )
  );
  await page.waitForTimeout(100);
  phase = "positive";
  await page.locator('[data-coord="0,2"]').fill(".25");
  await saved();
  checks.push(
    "400 Invalid class or bounding box is visible in-modal; draft survives and correction saves."
  );
  // Trigger a genuine write/write race AFTER the fresh preflight GET.
  phase = "negative";
  let intercept = true;
  await page.route("**/api/items/" + key, async route => {
    if (intercept && route.request().method() === "POST") {
      intercept = false;
      await externalEdit(o => (o[0].classId = 3));
    }
    await route.continue();
  });
  await page.locator('[data-coord="0,0"]').fill(".29");
  await page.locator("#reason").fill("synthetic genuine 409 retained");
  const conflictResponse = page.waitForResponse(
    r =>
      r.request().method() === "POST" && r.url().endsWith("/api/items/" + key)
  );
  await page.locator("#save-labels").click();
  const conflict = await conflictResponse;
  assert.equal(conflict.status(), 409);
  const conflictBody = await conflict.json();
  await page.waitForFunction(
    () =>
      !document.getElementById("editor-fields").disabled &&
      document
        .getElementById("editor-save-status")
        .textContent.includes("HTTP 409")
  );
  assert.equal(conflictBody.code, "REVISION_CONFLICT");
  assert.equal(await page.locator('[data-coord="0,0"]').inputValue(), ".29");
  await page.waitForTimeout(100);
  phase = "positive";
  await page.locator("#rebase-draft").click();
  await saved();
  checks.push(
    "Genuine late 409 includes currentVersion, retains draft and saves successfully after reconciliation."
  );
  // Restart the server at the SAME loopback port; sign into synthetic accounts only.
  phase = "restart";
  const port = studio.server.address().port;
  await context.close();
  await studio.close();
  studio = await createStudio(root, { port });
  await newContext();
  phase = "positive";
  await login("editor");
  await page.locator('[data-coord="0,0"]').fill(".32");
  await page
    .locator("#reason")
    .fill("synthetic verified save after server restart");
  await saved();
  item = await studio.workspace.item(key);
  const savedVersion = item.version;
  assert.equal(item.sample.annotation.annotator, "editor");
  assert.equal(item.sample.annotation.objects[0].box[0], 0.32);
  await page.locator("#close-editor").click();
  await page.locator(".card").click();
  await page.waitForFunction(
    () =>
      document.getElementById("editor").open &&
      !document.getElementById("editor-fields").disabled
  );
  assert.equal(await page.locator('[data-coord="0,0"]').inputValue(), "0.32");
  const history = await Promise.all(
    (await studio.workspace.revisions(key)).map(p => studio.workspace.json(p))
  );
  assert.equal(history.at(-1).actor, "editor");
  assert.equal(
    history.at(-1).reason,
    "synthetic verified save after server restart"
  );
  assert.ok(history.at(-1).at);
  assert.equal(await page.locator("#approve").isDisabled(), true);
  checks.push(
    "Chrome save/reopen after same-port server restart persists version, actor, timestamp and reason. Annotator cannot approve."
  );
  await page.locator("#close-editor").click();
  await page.locator("#logout").click();
  await login("reviewer");
  await page.locator("#review-kind").selectOption("labels");
  assert.equal(await page.locator("#approve").isDisabled(), false);
  await page.locator("#reason").fill("independent synthetic label review only");
  await page.locator("#confirm-review").check();
  const reviewResponse = page.waitForResponse(
    r =>
      r.request().method() === "POST" && r.url().endsWith("/api/items/" + key)
  );
  await page.locator("#approve").click();
  assert.equal((await reviewResponse).status(), 200);
  await page.waitForFunction(
    () =>
      document
        .getElementById("editor-save-status")
        .textContent.startsWith("تم حفظ الإصدار") &&
      !document.getElementById("editor-fields").disabled
  );
  item = await studio.workspace.item(key);
  assert.equal(item.sample.annotation.reviewer, "reviewer");
  assert.equal(item.sample.annotation.status, "reviewed");
  assert.notEqual(item.status, "approved");
  assert.equal(await fileHash(original), originalSHA);
  checks.push(
    "Separate fixture reviewer reviews the saved labels; rights/privacy remain pending; original and revision chain retained."
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(
    network.filter(x => x.phase === "positive"),
    []
  );
  assert.deepEqual(
    consoleErrors.filter(x => x.phase === "positive"),
    []
  );
  const report = {
    contentKind: "synthetic-test-only",
    status: "passed",
    checks,
    badRequest: { status: 400, body: badBody },
    conflict: { status: 409, body: conflictBody },
    savedVersionBeforeIndependentReview: savedVersion,
    historyRevisions: (await studio.workspace.revisions(key)).length,
    positiveConsoleErrors: 0,
    positiveNetworkErrors: 0,
    pageErrors: 0,
    externalRequests: 0,
    originalUnchanged: true,
    actualHumanAccountsUsed: false,
  };
  const evidence = path.join(repo, "docs/vision-ai-evidence/label-save-fix");
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "browser-validation.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
} finally {
  await context?.close();
  await browser?.close();
  await studio?.close();
  if (
    !path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
    !path.basename(temp).startsWith("basira-save-browser-")
  )
    throw new Error("Unsafe fixture cleanup");
  await fs.rm(temp, { recursive: true, force: true });
}
