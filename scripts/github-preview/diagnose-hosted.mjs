/** Read-only diagnosis of the independent preview using an already licensed development still. */
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [photo, out, model = "original"] = process.argv.slice(2),
  base = "https://ras222003-boop.github.io/basira-iphone-research-preview/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
      locale: "ar-SA",
      serviceWorkers: "block",
    }),
    events = [],
    at = Date.now();
  await context.route("**/*", r =>
    r.request().url().startsWith(base) &&
    ["GET", "HEAD"].includes(r.request().method())
      ? r.continue()
      : r.abort()
  );
  const page = await context.newPage();
  page.on("request", r =>
    events.push({
      kind: "request",
      ms: Date.now() - at,
      path: new URL(r.url()).pathname,
    })
  );
  page.on("requestfailed", r =>
    events.push({
      kind: "failed",
      ms: Date.now() - at,
      path: new URL(r.url()).pathname,
      error: r.failure()?.errorText,
    })
  );
  page.on("response", r =>
    events.push({
      kind: "response",
      ms: Date.now() - at,
      path: new URL(r.url()).pathname,
      status: r.status(),
    })
  );
  page.on("console", m => {
    if (m.type() === "error")
      events.push({
        kind: "console",
        ms: Date.now() - at,
        text: m.text().slice(0, 600),
      });
  });
  await page.goto(base + "#/navigation/vision", {
    waitUntil: "domcontentloaded",
  });
  const select = page.locator("#basira-vision-model");
  await select.waitFor();
  await page.waitForFunction(() =>
    document.querySelector(
      '#basira-vision-model option[value="objects-basira-v3"]'
    )
  );
  await select.selectOption(model);
  const panel = page.getByTestId("object-photo-input");
  await panel.getByRole("checkbox").check();
  await panel.locator("input[type=file]").setInputFiles(resolve(photo));
  await page.waitForTimeout(45000);
  const result = {
    model,
    count: await panel.getAttribute("data-count"),
    panelText: await panel.innerText(),
    events,
    privateMediaUploaded: false,
    iphoneTested: false,
  };
  await writeFile(resolve(out), JSON.stringify(result, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
