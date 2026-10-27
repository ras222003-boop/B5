import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const origin = process.argv[2] ?? 'http://127.0.0.1:4186';
await mkdir('.basira-evidence', { recursive: true });
const photo = `data:image/png;base64,${(await readFile('scripts/metric-depth/fixtures/chair.png')).toString('base64')}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { origin, settings: {}, camera: {}, errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA', permissions: ['camera'] });
  await context.addInitScript(({ photo }) => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
      if (!constraints.video) return original(constraints);
      const image = new Image(); image.src = photo; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const draw = () => canvas.getContext('2d').drawImage(image, 0, 0, 640, 480);
      draw(); const timer = setInterval(draw, 50), stream = canvas.captureStream(20);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer), { once: true });
      return stream;
    } });
  }, { photo });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${origin}/navigation/vision`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const panel = page.getByRole('region', { name: 'المسافات وتنبيهات الاقتراب' });
  await panel.waitFor({ timeout: 30_000 });
  const haptics = panel.getByRole('checkbox', { name: 'تشغيل اهتزازات الاقتراب' });
  const audio = panel.getByRole('checkbox', { name: 'تشغيل تنبيهات الاقتراب الصوتية' });
  report.settings.defaultsQuiet = !(await haptics.isChecked()) && !(await audio.isChecked());
  report.settings.testDisabled = await panel.getByRole('button', { name: 'اختبار الاهتزاز' }).isDisabled();
  report.settings.unsupportedMessage = (await panel.innerText()).includes('الاهتزاز غير مدعوم');
  await haptics.check(); await audio.check();
  await panel.getByRole('combobox', { name: 'الحساسية' }).selectOption('HIGH');
  await panel.getByRole('combobox', { name: 'نمط الاهتزاز' }).selectOption('DOUBLE');
  await panel.getByRole('combobox', { name: 'طريقة التنبيه' }).selectOption('TRUSTED_METRIC');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await panel.waitFor();
  report.settings.persisted = await haptics.isChecked() && await audio.isChecked() &&
    await panel.getByRole('combobox', { name: 'الحساسية' }).inputValue() === 'HIGH' &&
    await panel.getByRole('combobox', { name: 'نمط الاهتزاز' }).inputValue() === 'DOUBLE' &&
    await panel.getByRole('combobox', { name: 'طريقة التنبيه' }).inputValue() === 'TRUSTED_METRIC';
  report.settings.metricUnavailable = (await panel.innerText()).includes('سيبقى تقدير الحدود المترية غير متاح');
  await panel.getByRole('button', { name: 'إعادة الإعدادات الافتراضية' }).click();
  report.settings.reset = !(await haptics.isChecked()) && !(await audio.isChecked()) &&
    await panel.getByRole('combobox', { name: 'الحساسية' }).inputValue() === 'BALANCED';
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="approach-settings-title"]').analyze();
  report.settings.seriousAxeViolations = axe.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id);
  await page.screenshot({ path: '.basira-evidence/approach-settings-browser.png', fullPage: true });
  await page.getByRole('button', { name: 'تشغيل رؤية بصيرة', exact: true }).click();
  await page.getByTestId('perception-objects').getByText(/كرسي/).waitFor({ timeout: 60_000 });
  report.camera.objectObserved = true;
  await page.getByRole('button', { name: 'إيقاف الرؤية', exact: true }).click();
  await page.getByRole('button', { name: 'تشغيل رؤية بصيرة', exact: true }).waitFor({ timeout: 15_000 });
  report.camera.stopped = true;
  report.camera.approachStatus = await page.getByTestId('approach-risk-status').innerText();
  await context.close();
} finally {
  await browser.close();
  await writeFile('.basira-evidence/approach-browser-smoke.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (!report.settings.defaultsQuiet || !report.settings.testDisabled || !report.settings.unsupportedMessage ||
    !report.settings.persisted || !report.settings.metricUnavailable || !report.settings.reset ||
    report.settings.seriousAxeViolations.length || !report.camera.objectObserved ||
    !report.camera.stopped || report.errors.length)
  throw new Error('approach browser smoke assertions failed');
