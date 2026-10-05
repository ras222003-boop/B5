/** Run with a healthy local MySQL and pnpm dev. Never prints credentials or request bodies. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { createPool } from 'mysql2/promise';
import { registerSpeechRoutes, SpeechProviderRouter, type TtsProvider } from '../server/speech';
import { VOICES } from '../shared/speech';

const base = process.env.BASIRA_TEST_URL || 'http://localhost:3000';
process.env.NODE_ENV = 'development';
const email = `basira-test-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(24).toString('base64url');
const cookies = new Map<string, string>();
const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
let userId: string | undefined;

async function api(path: string, body?: unknown, cookie = true) {
  const headers: Record<string, string> = { Origin: base };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie && cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(';', 1)[0];
    const split = pair.indexOf('=');
    if (split < 0) continue;
    const name = pair.slice(0, split), value = pair.slice(split + 1);
    if (!value || /Max-Age=0/i.test(item)) cookies.delete(name);
    else cookies.set(name, value);
  }
  return { response, data: await response.json().catch(() => null) };
}

const speechRequest = { text: 'نص تجريبي', language: 'ar', arabicStyle: 'SAUDI', voiceId: 'ar-SA-ZariyahNeural', context: 'GENERAL', rate: 1 };
async function verifySpeech() {
  const mock: TtsProvider = {
    id: 'AZURE', isAvailable: () => true,
    listVoices: () => VOICES.filter(voice => voice.provider === 'AZURE'),
    synthesize: async () => Buffer.from('mock-audio'),
  };
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  registerSpeechRoutes(app, new SpeechProviderRouter([mock]), { premiumEnabled: () => true });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/speech/synthesize`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const anonymous = await fetch(url, { method: 'POST', headers, body: JSON.stringify(speechRequest) });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');
    assert.equal((await anonymous.json()).fallback, 'browser');
    headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    const authenticated = await fetch(url, { method: 'POST', headers, body: JSON.stringify(speechRequest) });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.headers.get('cache-control'), 'no-store');
    assert.equal(await authenticated.text(), 'mock-audio');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

try {
  assert.equal((await api('/api/auth/providers')).response.status, 200);
  assert.notEqual((await api('/api/auth/sign-up/email', { name: 'اختبار بصيرة', email, password: 'short' })).response.status, 200);
  assert.notEqual((await api('/api/auth/sign-up/email', { name: 'اختبار بصيرة', email: 'invalid', password })).response.status, 200);
  assert.equal((await api('/api/auth/get-session', undefined, false)).data, null);

  const signup = await api('/api/auth/sign-up/email', { name: 'اختبار بصيرة', email, password });
  assert.equal(signup.response.status, 200, 'signup failed');
  const sessionCookies = signup.response.headers.getSetCookie().filter(value => value.startsWith('basira.session_token='));
  assert(sessionCookies.length > 0, 'session cookie missing');
  assert(sessionCookies.every(value => !/;\s*Secure\b/i.test(value) && /;\s*SameSite=Lax\b/i.test(value)), 'localhost cookie policy is invalid');
  userId = signup.data?.user?.id;
  assert(userId, 'signup did not return a user');
  assert.equal((await api('/api/auth/get-session')).data?.user?.id, userId);
  assert.notEqual((await api('/api/auth/sign-up/email', { name: 'Duplicate', email, password })).response.status, 200);
  const [users] = await db.query<any[]>('SELECT id FROM `user` WHERE id=?', [userId]);
  const [sessions] = await db.query<any[]>('SELECT id FROM `session` WHERE userId=?', [userId]);
  assert.equal(users.length, 1);
  assert(sessions.length > 0);
  await verifySpeech();

  assert.equal((await api('/api/auth/sign-out', {})).response.status, 200);
  assert.equal((await api('/api/auth/get-session')).data, null);
  assert.notEqual((await api('/api/auth/sign-in/email', { email, password: 'wrong-password' })).response.status, 200);
  assert.equal((await api('/api/auth/sign-in/email', { email, password })).response.status, 200);
  assert.equal((await api('/api/auth/get-session')).data?.user?.id, userId);
  console.log('PASS: MySQL signup, session, refresh request, logout, login, error cases, and mock Premium speech authorization.');
} finally {
  if (userId) {
    await db.query('DELETE FROM `session` WHERE userId=?', [userId]);
    await db.query('DELETE FROM `account` WHERE userId=?', [userId]);
    await db.query('DELETE FROM `user` WHERE id=?', [userId]);
  }
  await db.end();
}
// Better Auth can retain background timers after its test requests complete.
process.exit(0);
