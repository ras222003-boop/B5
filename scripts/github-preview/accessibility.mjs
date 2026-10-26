/** Mobile-sized desktop Chrome checks; never identifies this as a physical iPhone/VoiceOver test. */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [url, out] = process.argv.slice(2),
  base = new URL(url);
if (
  base.href !==
  "https://ras222003-boop.github.io/basira-iphone-research-preview/"
)
  throw Error("Independent preview origin only");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-SA",
      serviceWorkers: "block",
    }),
    writes = [],
    escaped = [],
    errors = [];
  await context.route("**/*", route => {
    const r = route.request();
    if (!r.url().startsWith(base.href)) {
      escaped.push(new URL(r.url()).pathname);
      return route.abort();
    }
    if (!["GET", "HEAD"].includes(r.method())) {
      writes.push(r.method());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  const pages = [];
  for (const route of ["navigation/vision", "settings/voice"]) {
    await page.goto(base.href + "#/" + route, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("main").first().waitFor();
    if (route === "navigation/vision")
      await page.locator("#basira-vision-model").waitFor();
    else
      await page
        .getByRole("heading", { name: "إعدادات الصوت", exact: true })
        .waitFor();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      secureContext: isSecureContext,
      cameraApi: typeof navigator.mediaDevices?.getUserMedia === "function",
      webAssembly: typeof WebAssembly === "object",
    }));
    pages.push({
      route,
      ...layout,
      violations: axe.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        help: v.help,
      })),
      checks: axe.passes.length,
    });
  }
  const result = {
    status:
      pages.every(p => p.scrollWidth <= p.width && p.violations.length === 0) &&
      errors.length === 0
        ? "PASSED_DESKTOP_MOBILE_VIEWPORT_CHECKS"
        : "REVIEW_REQUIRED",
    scope: "DESKTOP_CHROME_390PX_AXE_NOT_SAFARI_OR_VOICEOVER",
    pages,
    pageErrors: errors,
    networkWrites: writes.length,
    outsidePreviewRequests: escaped.length,
    cameraStarted: false,
    microphoneStarted: false,
    iphoneTested: false,
    voiceOverTested: false,
  };
  await writeFile(resolve(out), JSON.stringify(result, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
