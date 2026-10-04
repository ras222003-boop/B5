import { chromium } from '@playwright/test';

const baseURL = process.env.VOICE_BASE_URL ?? 'http://127.0.0.1:4173';
const wav = Buffer.alloc(44 + 1600);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(1600, 40);
const question = 'ما عاصمة المملكة العربية السعودية؟';
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
const page = await context.newPage();
const speechRequests: Array<{ text: string; language: string; arabicStyle: string; voiceId: string; context: string }> = [];
page.on('pageerror', error => { throw error; });
await page.route('**/api/speech/synthesize', async route => {
  speechRequests.push(route.request().postDataJSON());
  await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
});
await page.route('**/api/ocr', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ examTitle: 'اختبار', language: 'ar', detectedLanguages: ['ar'], questions: [{ id: 1, number: '1', text: question, type: 'multiple', options: ['الرياض', 'جدة'], optionLabels: ['أ', 'ب'], confidence: 'high', uncertainParts: [] }], quality: { status: 'good', issues: [], confidence: 'high' } }) }));
async function open(path: string) {
  await page.goto(`${baseURL}${path}`);
  const skip = page.locator('[data-testid="welcome-skip"]');
  if (await skip.count()) await skip.click();
  else await page.waitForTimeout(5500);
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
try {
  await open('/settings/voice');
  await page.getByRole('radio', { name: 'العربية السعودية' }).check();
  await page.getByLabel('نوع الصوت').selectOption('MALE');
  await page.getByRole('combobox').nth(2).selectOption('ar-SA-HamedNeural');
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(300);
  assert(speechRequests.some(req => req.arabicStyle === 'SAUDI' && req.voiceId === 'ar-SA-HamedNeural'), 'Saudi male preview failed');
  await page.getByLabel('نوع الصوت').selectOption('FEMALE');
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(300);
  assert(speechRequests.some(req => req.voiceId === 'ar-SA-ZariyahNeural'), 'Saudi female preview failed');
  await page.getByRole('radio', { name: 'العربية الفصحى' }).check();
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(300);
  assert(speechRequests.some(req => req.arabicStyle === 'MSA' && req.voiceId.startsWith('ar-XA-')), 'MSA preview failed');
  await page.getByLabel('نوع الصوت').selectOption('MALE');
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(300);
  assert(speechRequests.some(req => req.arabicStyle === 'MSA' && req.voiceId === 'ar-XA-Chirp3-HD-Charon'), 'MSA male preview failed');
  await page.getByLabel('اللغة').selectOption('en');
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(300);
  assert(speechRequests.some(req => req.language === 'en'), 'English preview failed');
  await page.getByLabel('اللغة').selectOption('zh-CN');
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(300);
  assert(speechRequests.some(req => req.language === 'zh-CN'), 'Chinese preview failed');
  await page.reload();
  assert(await page.getByLabel('اللغة').inputValue() === 'zh-CN', 'voice preference did not persist');
  await page.getByLabel('اللغة').selectOption('ar');
  await page.getByRole('radio', { name: 'العربية السعودية' }).check();
  const priority = await page.evaluate(`(async () => {
    const { AudioPlaybackManager } = await import('/src/lib/speechEngine.ts');
    const { NavigationInstructionGenerator } = await import('/src/lib/guidance/instructions.ts');
    const events = [];
    const bytes = Uint8Array.from(atob(${JSON.stringify(wav.toString('base64'))}), c => c.charCodeAt(0));
    const provider = {
      isAvailable: () => true,
      stop: () => {},
      synthesize: (request, signal) => request.text === 'LOW'
        ? new Promise((_resolve, reject) => signal.addEventListener('abort', () => { events.push('turn-aborted'); reject(new Error('cancelled')); }))
        : Promise.resolve(new Blob([bytes], { type: 'audio/wav' })),
    };
    const manager = new AudioPlaybackManager(provider);
    const base = { language: 'ar', arabicStyle: 'SAUDI', context: 'NAVIGATION', rate: 1 };
    const turn = manager.enqueue({ ...base, text: 'LOW' }, 'TURN');
    await new Promise(resolve => setTimeout(resolve, 20));
    const safety = manager.enqueue({ ...base, text: 'STOP', context: 'SAFETY' }, 'CRITICAL_SAFETY');
    await Promise.all([turn, safety]);
    return { events, fallbackCount: manager.metrics.fallbacks, arrival: new NavigationInstructionGenerator([], 'ar', 'LEFT_RIGHT', 'SAUDI').arrival('غرفة 121', 'FRONT') };
  })()`) as { events: string[]; fallbackCount: number; arrival: string };
  assert(priority.events.includes('turn-aborted') && priority.fallbackCount === 0, 'browser safety interruption failed');
  assert(priority.arrival.includes('قدامك'), 'Saudi navigation phrase failed in browser');
  const beforeMuted = speechRequests.length;
  await page.getByLabel('استخدم قارئ الشاشة بدل صوت بصيرة').check();
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(100);
  assert(speechRequests.length === beforeMuted, 'screen reader mode did not suppress Basira speech');
  await page.getByLabel('استخدم قارئ الشاشة بدل صوت بصيرة').uncheck();
  await context.setOffline(true);
  await page.evaluate(() => { (window as any).__spoken = []; window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => { (window as any).__spoken.push(utterance.text); queueMicrotask(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent)); }; });
  await page.getByRole('button', { name: 'استمع إلى الصوت' }).click();
  await page.waitForTimeout(100);
  assert((await page.evaluate(() => (window as any).__spoken.length)) > 0, 'offline browser fallback failed');
  await context.setOffline(false);
  await open('/exam-demo');
  await page.locator('input[type=file]').setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=', 'base64') });
  await page.getByText(question).waitFor({ timeout: 10000 });
  await page.getByText(question).click();
  await page.waitForTimeout(300);
  assert(speechRequests.some(req => req.context === 'QUESTION' && req.arabicStyle === 'SAUDI' && req.text.includes(question)), `Saudi exam reading altered the question: ${JSON.stringify(speechRequests.map(req => ({ context: req.context, style: req.arabicStyle, language: req.language })))}`);
  await open('/navigation/guidance');
  await page.getByText('خيارات المسار والإرشاد').click();
  assert(await page.getByText('نمط العربية').count() > 0, 'navigation Arabic style control missing');
  console.log(JSON.stringify({ status: 'PASS', speechRequests: speechRequests.length, checks: ['MSA male/female', 'Saudi male/female', 'English', 'Chinese', 'preview', 'persistence', 'screen reader', 'offline fallback', 'Saudi exam text', 'navigation', 'safety interruption'] }));
} finally { await browser.close(); }
