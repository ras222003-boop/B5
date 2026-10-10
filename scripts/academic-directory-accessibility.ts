import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.BASIRA_TEST_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: "ar-SA",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(`${base}/academics`);
  const skip = page.locator('[data-testid="welcome-skip"]');
  if (await skip.count()) await skip.click();
  await page.getByRole("heading", { name: "المعلمون والمقررات" }).waitFor();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const relevant = result.violations.map(item => ({
    id: item.id,
    impact: item.impact,
    nodes: item.nodes.map(node => node.target).slice(0, 4),
  }));
  if (relevant.length) {
    console.error(JSON.stringify(relevant));
    process.exitCode = 1;
  } else
    console.log(
      "Academic directory accessibility scan: PASS (axe WCAG A/AA tags)."
    );
} finally {
  await browser.close();
}
