/** Real Chrome against fictional images and isolated accounts, never the private library. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep, basename } from "node:path";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { fileHash } from "../common.mjs";
const temp = await fs.mkdtemp(resolve(tmpdir(), "basira-stairs-browser-")),
  root = resolve(temp, "data");
let studio, browser;
const errors = [],
  external = [],
  network = [];
try {
  await fixture(root, { images: 1 });
  studio = await createStudio(root);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const initial = (await studio.workspace.catalog()).items[0],
    original = await fileHash(await studio.workspace.mediaPath(initial, true));
  async function login(id) {
    const c = await browser.newContext();
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
      if (r.status() >= 400) network.push(r.status());
    });
    await p.goto(studio.url);
    await p.locator("input[name=id]").fill(id);
    await p.locator("input[name=password]").fill("synthetic-fixture-password");
    await p.getByRole("button", { name: "دخول", exact: true }).click();
    await p.locator(".card").click();
    await p.waitForFunction(
      () =>
        document.getElementById("editor").open &&
        !document.getElementById("editor-fields").disabled
    );
    return p;
  }
  const editor = await login("editor");
  await editor.locator('[data-class="0"]').selectOption("23");
  assert.equal(await editor.locator('[data-stairs="0"]').inputValue(), "");
  await editor
    .locator('[data-stairs="0"]')
    .selectOption("stairs_present_uncertain_direction");
  await editor
    .locator('[data-stairs-evidence="0"]')
    .fill("Fictional scene: no visible evidence for an up/down decision.");
  await editor.locator('#condition-motion').selectOption('unknown_stairs_still');
  await editor
    .locator("#reason")
    .fill("Synthetic stairs annotation save and independent review test");
  const response = editor.waitForResponse(
    r =>
      r.request().method() === "POST" &&
      r.url().endsWith("/api/items/" + initial.key)
  );
  await editor.locator("#save-labels").click();
  assert.equal((await response).status(), 200);
  await editor.waitForFunction(
    () =>
      document
        .getElementById("editor-save-status")
        .textContent.startsWith("تم حفظ الإصدار") &&
      !document.getElementById("editor-fields").disabled
  );
  await editor.locator("#close-editor").click();
  await editor.locator(".card").click();
  await editor.waitForFunction(
    () =>
      document.getElementById("editor").open &&
      !document.getElementById("editor-fields").disabled
  );
  assert.equal(
    await editor.locator('[data-stairs="0"]').inputValue(),
    "stairs_present_uncertain_direction"
  );
  assert.match(
    await editor.locator('[data-stairs-evidence="0"]').inputValue(),
    /Fictional scene/
  );
  assert.equal(await editor.locator('#condition-motion').inputValue(), 'unknown_stairs_still');
  let item = await studio.workspace.item(initial.key);
  assert.equal(item.version, 1);
  assert.equal(item.sample.annotation.annotator, "editor");
  assert.notEqual(item.status, "approved");
  await assert.rejects(
    studio.workspace.change(
      item.key,
      {
        action: "review",
        version: item.version,
        kind: "labels",
        status: "approved",
        exhaustive: true,
        reason: "Synthetic self-review must fail",
      },
      { id: "editor", roles: ["labels"] }
    ),
    /Independent/
  );
  const reviewer = await login("reviewer");
  assert.equal(await reviewer.locator('[data-stairs="0"]').isDisabled(), true);
  await reviewer.locator("#review-kind").selectOption("labels");
  await reviewer
    .locator("#reason")
    .fill("Independent fictional reference inspection");
  await reviewer.locator("#confirm-review").check();
  const reviewed = reviewer.waitForResponse(
    r =>
      r.request().method() === "POST" &&
      r.url().endsWith("/api/items/" + item.key)
  );
  await reviewer.locator("#approve").click();
  assert.equal((await reviewed).status(), 200);
  item = await studio.workspace.item(item.key);
  assert.equal(item.sample.annotation.reviewer, "reviewer");
  assert.equal(item.sample.annotation.status, "reviewed");
  assert.equal(item.sample.conditions.motion, 'unknown_stairs_still');
  assert.notEqual(item.status, "approved");
  assert.equal(
    item.sample.annotation.objects[0].stairsDirection.label,
    "stairs_present_uncertain_direction"
  );
  assert.equal(
    await fileHash(await studio.workspace.mediaPath(item, true)),
    original
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(network, []);
  console.log(
    JSON.stringify({
      status: "passed",
      syntheticOnly: true,
      saveReopen: true,
      explicitlySelectedUnknownCaptureMotionPersisted: true,
      independentLabelReview: true,
      selfReviewBlocked: true,
      rightsPrivacyStillPending: true,
      originalUnchanged: true,
      unexpectedNetworkErrors: 0,
      consoleErrors: 0,
      externalRequests: 0,
      trainingPerformed: false,
    })
  );
} finally {
  await browser?.close();
  await studio?.close();
  if (
    !resolve(temp).startsWith(resolve(tmpdir()) + sep) ||
    !basename(temp).startsWith("basira-stairs-browser-")
  )
    throw new Error("Unsafe fixture cleanup");
  await fs.rm(temp, { recursive: true, force: true });
}
