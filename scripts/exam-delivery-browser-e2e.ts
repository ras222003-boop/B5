/** Browser UI contract test with mocked API; SMTP and persistence are covered by server tests. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.BASIRA_TEST_URL ?? 'http://127.0.0.1:3000';
const submissionId = '11111111-1111-4111-8111-111111111111';
const oldDeliveryId = '22222222-2222-4222-8222-222222222222';
const newDeliveryId = '33333333-3333-4333-8333-333333333333';
const recipient = { name:'Professor One', email:'one@example.com', course:'Calculus', organization:'' };
const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({ locale:'ar-SA', viewport:{ width:390, height:844 }, serviceWorkers:'block' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
let sentRequest: { body:any; key:string } | null = null;
let polls = 0;
await page.route('**/api/exam-delivery/**', route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  const reply = (body:unknown, status=200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) });
  if (path.endsWith('/submissions') && request.method() === 'GET') return reply({ submissions:[{ submissionId, course:'Calculus', examTitle:'Final exam', status:'FAILED', approvedAt:new Date().toISOString(), latestDeliveryId:oldDeliveryId }] });
  if (path.endsWith('/contacts')) return reply({ contacts:[] });
  if (path.endsWith('/settings')) return reply({ emailDeliveryConfigured:true });
  if (path.endsWith(`/operations/${oldDeliveryId}`)) return reply({ deliveryId:oldDeliveryId, status:'FAILED', recipients:[{ ...recipient, deliveryStatus:'UNCERTAIN', sentAt:null, failureReasonCode:'delivery_interrupted' }] });
  if (path.endsWith(`/operations/${newDeliveryId}`)) { polls++; return reply({ deliveryId:newDeliveryId, status:polls >= 1 ? 'SENT' : 'SENDING', recipients:[{ ...recipient, deliveryStatus:'SENT', sentAt:new Date().toISOString(), failureReasonCode:null }] }); }
  if (path.endsWith('/operations') && request.method() === 'POST') {
    sentRequest = { body:request.postDataJSON(), key:request.headers()['idempotency-key'] ?? '' };
    return reply({ deliveryId:newDeliveryId, status:'SENDING', recipients:[{ ...recipient, deliveryStatus:'SENDING', sentAt:null, failureReasonCode:null }] }, 202);
  }
  if (path.endsWith(`/submissions/${submissionId}/pdf`)) return route.fulfill({ status:200, contentType:'application/pdf', body:'%PDF-1.4\n%%EOF' });
  return reply({}, 404);
});
try {
  await page.goto(`${base}/exam-demo`);
  const skip = page.locator('[data-testid="welcome-skip"]'); if (await skip.count()) await skip.click();
  await page.getByRole('heading', { name:'الاختبارات النهائية المحفوظة' }).waitFor();
  assert.equal(await page.getByRole('link', { name:'تحميل النسخة النهائية' }).first().getAttribute('href'), `/api/exam-delivery/submissions/${submissionId}/pdf`);
  await page.getByRole('button', { name:'فتح الإرسال' }).click();
  await page.getByRole('heading', { name:'إرسال الاختبار إلى' }).waitFor();
  await page.getByText('one@example.com').first().waitFor();
  await page.getByRole('button', { name:'إضافة مستلم' }).click();
  const second = page.locator('fieldset').nth(1);
  await second.getByLabel('الاسم').fill('Professor Two');
  await second.getByLabel('البريد الإلكتروني').fill('invalid');
  await page.getByRole('button', { name:'مراجعة المستلمين' }).click();
  await page.getByText('تحقق من اسم المقرر وأسماء المستلمين وعناوين البريد.').waitFor();
  await second.getByLabel('البريد الإلكتروني').fill('two@example.com');
  await page.getByRole('button', { name:'مراجعة المستلمين' }).click();
  await page.getByText('two@example.com').first().waitFor();
  await second.getByRole('button', { name:'حذف' }).click();
  await page.getByRole('button', { name:'مراجعة المستلمين' }).click();
  await page.getByRole('checkbox', { name:/أؤكد إرسال الاختبار النهائي/ }).check();
  await page.getByRole('button', { name:'إعادة الإرسال بعملية جديدة' }).click();
  await page.getByText('اكتمل التسليم').waitFor({ timeout:10000 });
  assert(sentRequest, 'A new explicit delivery request must be sent');
  assert.equal(sentRequest.body.resend, true);
  assert.equal(sentRequest.body.confirmed, true);
  assert.equal(sentRequest.body.recipients[0].email, recipient.email);
  assert(sentRequest.key.length >= 8);
  assert(polls >= 1, 'In-progress operations must be polled');
  console.log('EXAM DELIVERY BROWSER PASS: restore saved PDF, review recipient, explicit resend, idempotency key, polling to sent.');
} finally { await browser.close(); }
