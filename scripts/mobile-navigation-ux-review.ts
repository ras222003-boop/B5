/** Reproducible mobile review of the three public navigation entry screens. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASIRA_TEST_URL ?? 'http://127.0.0.1:3000';
const imageDir = process.env.BASIRA_SCREENSHOT_DIR;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'ar-SA', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.setDefaultNavigationTimeout(60_000);
await page.addInitScript(() => localStorage.setItem('basira-b4-safety-disclaimer-v1', '1'));
await page.route('**/api/speech/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
await page.route('**/api/navigation/safety-flags', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));

async function visibleRect(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  if (!(await locator.count())) return null;
  const rect = await locator.boundingBox();
  return rect && { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), aboveFold: rect.y >= 0 && rect.y + rect.height <= 844 };
}

function overlapArea(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return Math.round(width * height);
}

try {
  if (imageDir) await mkdir(imageDir, { recursive: true });
  for (const [slug, pathname, cta] of [
    ['navigation', '/navigation', 'a[href="/navigation/guidance"]'],
    ['vision', '/navigation/vision', 'main button:has-text("تشغيل رؤية بصيرة")'],
    ['guidance', '/navigation/guidance', 'main button:has-text("ابدأ التوجيه")'],
  ] as const) {
    if (process.env.BASIRA_ONLY_PAGE && process.env.BASIRA_ONLY_PAGE !== slug) continue;
    await page.goto(`${base}${pathname}`, { waitUntil: 'domcontentloaded' });
    const welcome = page.getByRole('dialog');
    await welcome.waitFor({ state: 'visible' });
    await welcome.getByRole('button').first().click();
    await welcome.waitFor({ state: 'hidden' });
    await page.locator('main h1').first().waitFor();
    await page.waitForTimeout(400);
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight,
      outside: [...document.querySelectorAll('body *')].map(element => ({ element, rect: element.getBoundingClientRect(), style: getComputedStyle(element) }))
        .filter(({ rect, style }) => style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && (rect.right > innerWidth + 2 || rect.left < -2))
        .slice(0, 12).map(({ element, rect }) => ({ tag: element.tagName.toLowerCase(), className: String(element.className).slice(0, 90), text: element.textContent?.trim().slice(0, 65), left: Math.round(rect.left), right: Math.round(rect.right) }))
    }));
    const headings = await page.locator('h1').allTextContents();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const callToAction = await visibleRect(page, cta);
    const report = { page: pathname, headings, geometry, cta: callToAction, axeViolations: axe.violations.map(v => ({ id: v.id, nodes: v.nodes.length, targets: v.nodes.map(n => n.target) })) };
    console.log(JSON.stringify(report));
    if (imageDir) {
      await page.screenshot({ path: path.join(imageDir, `${slug}-390.png`), fullPage: true });
      await page.screenshot({ path: path.join(imageDir, `${slug}-viewport-390.png`) });
    }
    assert(geometry.pageWidth <= geometry.viewport, `${pathname} has horizontal overflow: ${geometry.pageWidth} > ${geometry.viewport}`);
    assert(callToAction?.aboveFold, `${pathname} start action must be fully visible in the first mobile viewport`);
    assert.equal(axe.violations.length, 0, `${pathname} has axe A/AA violations`);
    const launcher = await page.getByRole('button', { name: 'فتح المرشد الصوتي' }).boundingBox();
    assert(launcher && callToAction, `${pathname} start action and voice launcher must be present`);
    assert.equal(overlapArea(callToAction, launcher), 0, `${pathname} floating voice launcher overlaps the start action`);
    if (slug === 'navigation') {
      await page.locator(cta).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'التنقل مع بصيرة' }).waitFor();
    }
    if (slug === 'vision') {
      const ahead = await page.getByRole('button', { name: 'ماذا أمامي؟' }).boundingBox();
      if (ahead && launcher) {
        const overlappedSquarePixels = overlapArea(ahead, launcher);
        console.log(JSON.stringify({ page: pathname, aheadButton: ahead, voiceLauncher: launcher, overlappedSquarePixels }));
        assert.equal(overlappedSquarePixels, 0, 'Floating voice launcher overlaps the What is ahead action');
      }
      await page.evaluate("Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('Camera denied by the test fixture', 'NotAllowedError'); } })");
      await page.getByRole('button', { name: 'تشغيل رؤية بصيرة' }).click();
      const denial = page.locator('main [role="alert"]').filter({ hasText: /رُفض إذن الكاميرا|يلزم السماح بالكاميرا من إعدادات المتصفح أو الجهاز/ });
      await denial.waitFor();
      const denialText = await denial.innerText();
      assert(/رُفض إذن الكاميرا|يلزم السماح بالكاميرا/.test(denialText), 'Camera denial should produce a readable recovery message');
      console.log(JSON.stringify({ page: pathname, cameraDenialMessage: denialText }));
    }
  }
} finally {
  await browser.close();
}
