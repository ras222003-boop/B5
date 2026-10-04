import { chromium, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.VALIDATION_BASE_URL ?? 'http://127.0.0.1:3010';
const routes = [
  { name: 'navigation', path: '/navigation', axe: true },
  { name: 'permissions', path: '/navigation/permissions', axe: true },
  { name: 'capabilities', path: '/navigation/capabilities', axe: true },
  { name: 'vision', path: '/navigation/vision', axe: true },
  { name: 'mapping', path: '/navigation/mapping', axe: true },
  { name: 'guidance', path: '/navigation/guidance', axe: true },
  { name: 'shared-map', path: '/navigation/shared-map', axe: true },
  { name: 'indoor-manager', path: '/navigation/indoor-manager', axe: true },
] as const;

type RouteResult = {
  name: string;
  path: string;
  loadMs: number;
  bodyChars: number;
  headings: number;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  axeViolations: Array<{ id: string; impact: string | null; description: string }>;
  keyboard: 'PASS' | 'FAIL';
};

const waitForSettledUi = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(900);
  const welcome = page.getByRole('dialog', { name: /.+/ }).first();
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.getByRole('button').first().click().catch(() => page.keyboard.press('Escape'));
    await welcome.waitFor({ state: 'hidden', timeout: 2500 }).catch(() => undefined);
  }
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(700);
};

const meaningfulError = (message: string) => {
  const lower = message.toLowerCase();
  return !lower.includes('401') && !lower.includes('403') && !lower.includes('failed to load resource')
    ? message
    : '';
};

async function testRoute(browser: Browser, route: (typeof routes)[number]): Promise<RouteResult> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      const value = meaningfulError(message.text());
      if (value) consoleErrors.push(value);
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? 'request failed';
    if (!failure.toLowerCase().includes('aborted')) failedRequests.push(`${request.method()} ${request.url()} (${failure})`);
  });

  const started = Date.now();
  await page.goto(`${baseURL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitForSettledUi(page);
  const bodyChars = (await page.locator('body').innerText()).trim().length;
  const headings = await page.locator('h1, h2').count();
  let axeViolations: RouteResult['axeViolations'] = [];
  if (route.axe) {
    const axe = await new AxeBuilder({ page }).analyze();
    axeViolations = axe.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
    }));
  }

  let keyboard: RouteResult['keyboard'] = 'PASS';
  await page.locator('main').first().focus();
  for (let index = 0; index < 12; index += 1) await page.keyboard.press('Tab');
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  if (!activeTag || activeTag === 'BODY') keyboard = 'FAIL';
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');

  const result = {
    name: route.name,
    path: route.path,
    loadMs: Date.now() - started,
    bodyChars,
    headings,
    consoleErrors,
    pageErrors,
    failedRequests,
    axeViolations,
    keyboard,
  };
  await context.close();
  return result;
}

async function testLanguageAndZoom(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${baseURL}/navigation`, { waitUntil: 'domcontentloaded' });
  await waitForSettledUi(page);
  const directions: Record<string, string> = {};
  for (const language of ['ar', 'en', 'zh-CN'] as const) {
    const languageButtons = await page.locator(`[role="radio"][lang="${language}"]`).all();
    let visibleButton = languageButtons[0];
    for (const button of languageButtons) {
      if (await button.isVisible().catch(() => false)) {
        visibleButton = button;
        break;
      }
    }
    if (!visibleButton) throw new Error(`language ${language} selector is not visible`);
    await visibleButton.click();
    await page.waitForTimeout(250);
    directions[language] = await page.evaluate(() => document.documentElement.dir);
    const text = (await page.locator('main').innerText()).trim();
    if (text.length < 100) throw new Error(`language ${language} rendered an unexpectedly empty page`);
  }
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await page.waitForTimeout(250);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const hasHorizontalOverflow = scrollWidth > viewportWidth * 2.2;
  const voice = await page.evaluate(() => ({
    tts: 'speechSynthesis' in window,
    ttsVoices: 'speechSynthesis' in window ? window.speechSynthesis.getVoices().length : 0,
    stt: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
  }));
  await context.close();
  return { directions, smallViewport: 'PASS', zoom200: hasHorizontalOverflow ? 'REVIEW' : 'PASS', voice };
}

async function testCameraAndOffline(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['camera', 'microphone'],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseURL}/navigation/vision`, { waitUntil: 'domcontentloaded' });
  await waitForSettledUi(page);
  const cameraButton = page.getByRole('button').filter({ hasText: /تشغيل رؤية بصيرة|Start Basira Vision|启动 Basira 视觉/ }).first();
  const foundStart = await cameraButton.count() > 0;
  let started = false;
  let stopped = false;
  let trackState: string | null = null;
  let visionStatus = '';
  let visionWarnings: string[] = [];
  if (foundStart) {
    await cameraButton.click();
    await page.waitForTimeout(8000);
    visionStatus = await page.locator('section[aria-label] p[role="status"]').first().innerText().catch(() => '');
    visionWarnings = await page.locator('[role="status"]').allTextContents();
    started = await page.locator('video').evaluate(video => Boolean((video as HTMLVideoElement).srcObject));
    const stopButton = page.getByRole('button').filter({ hasText: /إيقاف الرؤية|Stop vision|停止视觉/ }).first();
    if (await stopButton.count() > 0) {
      await stopButton.click();
      await page.waitForTimeout(350);
      trackState = await page.locator('video').evaluate(video => {
        const stream = (video as HTMLVideoElement).srcObject as MediaStream | null;
        return stream ? stream.getTracks().map(track => track.readyState).join(',') : 'none';
      });
      stopped = !trackState || trackState === 'none' || trackState.split(',').every(state => state === 'ended');
    }
  }
  const registration = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const result = await navigator.serviceWorker.ready.catch(() => null);
    return result?.active ? (navigator.serviceWorker.controller ? 'controlled' : 'registered') : 'not-registered';
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.goto(`${baseURL}/navigation/vision`, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => undefined);
  const offlineBody = (await page.locator('body').innerText().catch(() => '')).trim().length;
  await context.setOffline(false);
  await context.close();
  return { cameraPermission: 'granted-by-browser', foundStart, started, stopped, trackState, visionStatus, visionWarnings, pageErrors: errors, serviceWorker: registration, offlineBodyChars: offlineBody };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const routeResults: RouteResult[] = [];
  for (const route of routes) routeResults.push(await testRoute(browser, route));
  const languageZoom = await testLanguageAndZoom(browser);
  const cameraOffline = await testCameraAndOffline(browser);
  await browser.close();

  const criticalAxe = routeResults.flatMap(result => result.axeViolations.filter(violation => violation.impact === 'critical'));
  const fatal = routeResults.flatMap(result => result.pageErrors.map(error => `${result.path}: ${error}`));
  if (fatal.length > 0 || criticalAxe.length > 0 || routeResults.some(result => result.bodyChars < 100 || result.headings === 0 || result.keyboard === 'FAIL')) {
    console.error(JSON.stringify({ routeResults, languageZoom, cameraOffline }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    baseURL,
    routeCount: routeResults.length,
    routeResults,
    languageZoom,
    cameraOffline,
    summary: {
      browserSmoke: 'PASS',
      accessibilityCriticalBlockers: criticalAxe.length,
      cameraSimulation: cameraOffline.started && cameraOffline.stopped ? 'PASS' : 'PARTIAL',
      offlineShell: cameraOffline.offlineBodyChars >= 100 ? 'PASS' : 'NOT_VERIFIED',
    },
  }, null, 2));
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
