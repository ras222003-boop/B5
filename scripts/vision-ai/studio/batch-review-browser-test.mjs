/** Real Chrome, fictional images and isolated test identities only. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { fileHash, repo } from "../common.mjs";
import * as assistant from "./assistant.mjs";
const temp = await mkdtemp(resolve(tmpdir(), "basira-batch-browser-")),
  root = resolve(temp, "data");
let studio, browser;
const errors = [],
  network = [],
  external = [],
  checks = [];
try {
  await fixture(root, { images: 3 });
  studio = await createStudio(root);
  const items = (await studio.workspace.catalog()).items;
  const before = await Promise.all(
    items.map(async i => [
      i.key,
      await fileHash(await studio.workspace.mediaPath(i, true)),
    ])
  );
  const credentials = await fileHash(resolve(root, ".studio/identities.json"));
  browser = await chromium.launch({ channel: "chrome", headless: true });
  async function context(id) {
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
  const { c: editorContext, p: editor } = await context("editor");
  async function inspect(p, key, commercial = false) {
    await p.locator(`[data-batch-inspect="${key}"]`).click();
    await p.waitForFunction(
      () =>
        document.getElementById("batch-detail").open &&
        !document.getElementById("batch-fields").disabled
    );
    await p.locator("#batch-quick-check").click();
    for (const id of [
      "batch-seen-labels",
      "batch-seen-privacy",
      "batch-seen-sources",
    ])
      assert.equal(await p.locator("#" + id).isChecked(), true);
    if (commercial) await p.locator("#batch-commercial").check();
    await p.locator("#batch-attest").click();
    await p.waitForFunction(
      () => !document.getElementById("batch-detail").open
    );
  }
  // A thumbnail does not queue a decision. Only inspected samples enter the operation.
  assert.equal(await editor.locator("#batch-commit").isDisabled(), true);
  for (const i of items) await inspect(editor, i.key);
  let commits = 0;
  editor.on("request", r => {
    if (r.method() === "POST" && r.url().endsWith("/api/batch/commit"))
      commits++;
  });
  // Double click cannot send duplicate operations.
  await editor.locator("#batch-commit").evaluate(b => {
    b.click();
    b.click();
    b.click();
  });
  await editor.waitForFunction(() =>
    document.getElementById("batch-result").textContent.includes("حُفظت 3 صور")
  );
  assert.equal(commits, 1);
  checks.push(
    "Three inspected preparations saved once despite repeated clicks"
  );
  for (const i of items) {
    const after = await studio.workspace.item(i.key);
    assert.equal(after.version, 1);
    assert.equal(after.sample.annotation.annotator, "editor");
    assert.deepEqual(after.decisions, {});
  }
  // Resolve any algorithmic similarity candidates using a separate fictional reviewer.
  for (const p of (await assistant.scan(studio.workspace)).pairs)
    if (p.requiresReview)
      await assistant.reviewPair(
        studio.workspace,
        {
          id: p.id,
          relation: "different",
          reason:
            "Independent synthetic fixture comparison: different drawn objects",
        },
        { id: "reviewer", roles: ["rights", "privacy", "labels"] }
      );
  const { c: reviewerContext, p: reviewer } = await context("reviewer");
  assert.equal(await reviewer.locator("#batch-stage").inputValue(), "approve");
  for (const i of items) await inspect(reviewer, i.key, true);
  await reviewer.locator("#batch-commit").click();
  await reviewer.waitForFunction(() =>
    document.getElementById("batch-result").textContent.includes("حُفظت 3 صور")
  );
  for (const i of items) {
    const after = await studio.workspace.item(i.key);
    assert.equal(after.version, 2);
    assert.equal(after.status, "approved");
    for (const kind of ["rights", "privacy", "labels"])
      assert.equal(after.decisions[kind].reviewer, "reviewer");
    const r = await studio.workspace.json(
      (await studio.workspace.revisions(i.key)).at(-1)
    );
    assert.equal(r.batchAudit.actor, "reviewer");
    assert.ok(r.reason && r.at);
  }
  checks.push(
    "Separate reviewer independently records three decisions per sample in one atomic revision"
  );
  // Fresh page/server reads prove persistence; no in-memory-only success.
  await reviewer.reload();
  await reviewer.locator("[data-tab=batch]").click();
  await reviewer.locator("#batch-kind").selectOption("synthetic");
  await reviewer.locator("[data-batch-inspect]").first().waitFor();
  await reviewer.locator(`[data-batch-inspect="${items[0].key}"]`).click();
  await reviewer.waitForFunction(
    () =>
      document.getElementById("batch-detail").open &&
      !document.getElementById("batch-fields").disabled
  );
  assert.match(await reviewer.locator("#batch-title").textContent(), /إصدار 2/);
  await reviewer.locator("#batch-close").click();
  await editor.locator("#batch-refresh").click();
  await editor.locator("#batch-stage").selectOption("prepare");
  checks.push(
    "Reopened saved revision 2 from server; original files and local credentials unchanged"
  );
  for (const [key, sha] of before)
    assert.equal(
      await fileHash(
        await studio.workspace.mediaPath(await studio.workspace.item(key), true)
      ),
      sha
    );
  assert.equal(
    await fileHash(resolve(root, ".studio/identities.json")),
    credentials
  );
  const evidence = resolve(repo, ".vision-ai/batch-review");
  await mkdir(evidence, { recursive: true });
  await reviewer.screenshot({
    path: resolve(evidence, "batch-synthetic.png"),
    fullPage: true,
  });
  const result = {
    browser: "Chrome",
    syntheticOnly: true,
    checks,
    consoleAndPageErrors: errors,
    failedRequests: network,
    externalRequests: external,
    trainingStarted: false,
  };
  await writeFile(
    resolve(evidence, "browser-validation.json"),
    JSON.stringify(result, null, 2) + "\n"
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify(result, null, 2));
  await editorContext.close();
  await reviewerContext.close();
} finally {
  await browser?.close();
  await studio?.close();
  await rm(temp, { recursive: true, force: true });
}
