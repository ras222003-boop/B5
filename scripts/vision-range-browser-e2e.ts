import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.BASIRA_TEST_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: "ar-SA",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(`${base}/navigation/vision`);
  const skip = page.locator('[data-testid="welcome-skip"]');
  if (await skip.count()) await skip.click();
  const range = page.getByRole("combobox", {
    name: "مدى تنبيه الأشياء بالأمتار",
  });
  await range.selectOption("5");
  assert.equal(await range.inputValue(), "5");
  await page.reload();
  assert.equal(await range.inputValue(), "5");
  await page.getByLabel("مسافة مخصصة").fill("1.5");
  assert.equal(await range.inputValue(), "custom");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("basira-vision-alert-distance-meters-v1")
    ),
    "1.5"
  );
  await page.getByText("لا يتوفر قياس متري موثوق").waitFor();
  console.log(
    "Vision range browser PASS: presets, custom range, persistence, unavailable metric status."
  );
} finally {
  await browser.close();
}
