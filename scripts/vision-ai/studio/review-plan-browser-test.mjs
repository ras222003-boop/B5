import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
const temp = await mkdtemp(resolve(tmpdir(), "basira-review-ui-")),
  root = resolve(temp, "data");
await fixture(root, { images: 2 });
const intakeManifest = resolve(
  root,
  "incoming/demo/dataset.review.pending.json"
);
const { readFile } = await import("node:fs/promises");
const intake = JSON.parse(await readFile(intakeManifest));
intake.samples[1].candidateClassId = 23;
await writeFile(intakeManifest, JSON.stringify(intake));
const studio = await createStudio(root),
  items = (await studio.workspace.catalog()).items;
await writeFile(
  resolve(root, ".studio/human-review-plan.json"),
  JSON.stringify({
    schemaVersion: 1,
    items: [
      {
        key: items[1].key,
        version: 0,
        imageSha256: items[1].sample.sha256,
        priority: 1,
        tasks: [
          {
            kind: "source_unmatched",
            label: "وسم مصدر غير مطابق — راجعه دون اعتماد تلقائي",
            classId: 2,
            box: [0.2, 0.2, 0.3, 0.3],
          },
        ],
      },
    ],
  })
);
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  }),
  page = await context.newPage(),
  external = [],
  errors = [];
await context.route("**/*", r => {
  if (
    r
      .request()
      .url()
      .startsWith(studio.url + "/")
  )
    return r.continue();
  external.push("external");
  return r.abort();
});
page.on("pageerror", e => errors.push(e.message));
try {
  await page.goto(studio.url);
  await page.locator("input[name=id]").fill("reviewer");
  await page.locator("input[name=password]").fill("synthetic-fixture-password");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "2"
  );
  assert.equal(
    await page.locator(".card").first().getAttribute("data-item"),
    items[1].key
  );
  await page.locator("#start-final-review").click();
  await page.waitForFunction(() =>
    document.getElementById("review-position").textContent.includes("1 من 2")
  );
  assert.ok(await page.locator("#review-previous").isDisabled());
  await page.locator("[data-focus-task]").click();
  assert.equal(await page.locator("#review-task-overlay rect").count(), 1);
  assert.equal((await studio.workspace.item(items[1].key)).version, 0);
  assert.equal((await studio.workspace.catalog()).summary.approved, 0);
  assert.ok(await page.locator("#save-labels").isDisabled());
  await page.locator("#review-kind").selectOption("privacy");
  await page.locator("#faces").selectOption("absent");
  await page.locator("#confirm-review").check();
  await page
    .locator("#reason")
    .fill("synthetic unsaved decision must not leak to next image");
  await page.locator("#review-next").click();
  await page.waitForFunction(() =>
    document.getElementById("review-position").textContent.includes("2 من 2")
  );
  assert.equal(await page.locator("#reason").inputValue(), "");
  assert.equal(await page.locator("#faces").inputValue(), "unreviewed");
  assert.equal(await page.locator("#confirm-review").isChecked(), false);
  assert.ok(await page.locator("#review-next").isDisabled());
  assert.ok(
    (await studio.workspace.catalog()).items.every(i => i.version === 0)
  );
  await page.locator("#review-previous").click();
  await page.waitForFunction(() =>
    document.getElementById("review-position").textContent.includes("1 من 2")
  );
  await page.locator("#close-editor").click();
  await page.locator("#class-filter").selectOption("23");
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator("#class-filter").selectOption("");
  const axe = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    axe.violations,
    [],
    JSON.stringify(axe.violations.map(v => v.id))
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      contentKind: "synthetic-functional-checks",
      priorityOrder: true,
      sourceUnmatchedVisible: true,
      readonlyOverlay: true,
      versionUnchanged: true,
      sequentialReview: true,
      unsavedDecisionReset: true,
      approved: 0,
      externalRequests: 0,
      pageErrors: 0,
      accessibilityViolations: 0,
      trainingPerformed: false,
    })
  );
} finally {
  await browser.close();
  await studio.close();
  assert.ok(root.startsWith(temp));
  await rm(temp, { recursive: true, force: true });
}
