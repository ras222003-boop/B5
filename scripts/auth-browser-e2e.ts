/** Browser flow against pnpm dev and local MySQL, with only the paid TTS provider mocked. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { chromium } from '@playwright/test';
import { createPool } from 'mysql2/promise';
import { registerSpeechRoutes, SpeechProviderRouter, type TtsProvider } from '../server/speech';
import { VOICES } from '../shared/speech';

const base = process.env.BASIRA_TEST_URL || 'http://localhost:3000';
process.env.NODE_ENV = 'development';
const email = `basira-browser-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(24).toString('base64url');
const name = 'اختبار بصيرة';
const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const observed: Array<{ status: number; voiceId?: string; text?: string }> = [];
let userId: string | undefined;
const mock: TtsProvider = {
  id: 'AZURE', isAvailable: () => true,
  listVoices: () => VOICES.filter(voice => voice.provider === 'AZURE'),
  synthesize: async () => Buffer.from('mock-audio'),
};
const app = express();
app.use(express.json({ limit: '32kb' }));
registerSpeechRoutes(app, new SpeechProviderRouter([mock]), { premiumEnabled: () => true });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const speechUrl = `http://127.0.0.1:${address.port}/api/speech/synthesize`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(15_000);
await page.route('**/api/speech/synthesize', async route => {
  const cookie = (await context.cookies(base)).map(item => `${item.name}=${item.value}`).join('; ');
  const payload = route.request().postDataJSON() as { voiceId?: string; text?: string };
  const response = await fetch(speechUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: route.request().postData() });
  observed.push({ status: response.status, voiceId: payload.voiceId, text: payload.text });
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
});
async function open(path: string) {
  await page.goto(`${base}${path}`);
  const skip = page.locator('[data-testid="welcome-skip"]');
  if (await skip.count()) await skip.click();
}
try {
  await open('/account');
  await page.getByRole('tab', { name: 'إنشاء حساب' }).click();
  await page.getByLabel('الاسم').fill(name);
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(email);
  await page.getByLabel('كلمة المرور').fill(password);
  await page.getByRole('checkbox').check();
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('heading', { name: `مرحبًا، ${name}` }).waitFor();
  const [users] = await db.query<any[]>('SELECT id FROM `user` WHERE email=?', [email]);
  assert.equal(users.length, 1);
  userId = users[0].id;

  await page.reload();
  await page.getByRole('heading', { name: `مرحبًا، ${name}` }).waitFor();
  await open('/settings/voice-validation');
  await page.getByRole('combobox', { name: 'Curated voice' }).selectOption('ar-SA-ZariyahNeural');
  await page.getByRole('button', { name: 'Play Exam' }).click();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('Playback mode:'));
  await page.waitForTimeout(300);
  assert(observed.some(item => item.status === 200 && item.voiceId === 'ar-SA-ZariyahNeural' && item.text === 'ما عاصمة المملكة العربية السعودية؟'), 'authenticated Saudi speech request failed or changed academic text');

  await open('/account');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await page.getByRole('tab', { name: 'تسجيل الدخول' }).waitFor();
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(email);
  await page.getByLabel('كلمة المرور').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('heading', { name: `مرحبًا، ${name}` }).waitFor();
  console.log('PASS: browser signup, signed-in view, refresh, Saudi Premium request with provider mock, logout, and login.');
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (userId) {
    await db.query('DELETE FROM `session` WHERE userId=?', [userId]);
    await db.query('DELETE FROM `account` WHERE userId=?', [userId]);
    await db.query('DELETE FROM `user` WHERE id=?', [userId]);
  }
  await db.end();
}
process.exit(0);
