// Tests the exact document-start JavaScript shipped by the Swift app. These
// synthetic streams do not request a camera, microphone, or browser session.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const swiftPath = fileURLToPath(new URL('../DepthCalibrationLab/BasiraWebMediaLifecycle.swift', import.meta.url));
const source = readFileSync(swiftPath, 'utf8');
const script = source.match(/static let script = #"""([\s\S]*?)"""#/u)?.[1];
assert.ok(script, 'The production document-start script is present');

function stream() {
  const track = { stopped: 0, stop() { this.stopped += 1; } };
  return { track, getTracks: () => [track] };
}

function harness(getUserMedia) {
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = false;
  document.elements = [];
  document.querySelectorAll = () => document.elements;
  const speech = { cancelled: 0, cancel() { this.cancelled += 1; } };
  class Recognition extends EventTarget {
    starts = 0;
    aborts = 0;
    start() { this.starts += 1; }
    abort() { this.aborts += 1; this.dispatchEvent(new Event('end')); }
  }
  window.speechSynthesis = speech;
  window.SpeechRecognition = Recognition;
  window.location = { pathname: '/navigation/vision' };
  window.history = {};
  for (const name of ['pushState', 'replaceState']) {
    window.history[name] = (_state, _title, path) => { window.location.pathname = path; };
  }
  const navigator = { mediaDevices: { getUserMedia } };
  const context = vm.createContext({ window, document, navigator, Event, DOMException });
  vm.runInContext(script, context);
  return { window, document, navigator, speech, context,
    suspend: () => window.dispatchEvent(new Event('basira:native-suspend')),
    resume: () => window.dispatchEvent(new Event('basira:native-resume')) };
}

test('native suspension stops unattached streams, attached media, recognition and speech', async () => {
  const unattached = stream(), attached = stream();
  const h = harness(async () => unattached);
  await h.navigator.mediaDevices.getUserMedia({ audio: true });
  const recognition = new h.window.SpeechRecognition();
  recognition.start();
  const element = { srcObject: attached, pauses: 0, pause() { this.pauses += 1; } };
  h.document.elements.push(element);
  h.suspend();
  assert.equal(unattached.track.stopped, 1);
  assert.equal(attached.track.stopped, 1);
  assert.equal(element.pauses, 1);
  assert.equal(recognition.aborts, 1);
  assert.equal(h.speech.cancelled, 1);
  assert.throws(() => recognition.start(), { name: 'AbortError' });
  await assert.rejects(h.navigator.mediaDevices.getUserMedia({ video: true }), { name: 'AbortError' });
});

test('late permission result is stopped even when foregrounding preceded its arrival', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const h = harness(() => pending);
  const request = h.navigator.mediaDevices.getUserMedia({ video: true });
  h.suspend();
  h.resume();
  const late = stream();
  complete(late);
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(late.track.stopped, 1);
});

test('foreground does not restart media; a new user request may capture', async () => {
  let requests = 0;
  const h = harness(async () => { requests += 1; return stream(); });
  const first = await h.navigator.mediaDevices.getUserMedia({ audio: true });
  h.suspend();
  h.resume();
  assert.equal(requests, 1);
  assert.equal(first.track.stopped, 1);
  const second = await h.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.equal(requests, 2);
  assert.equal(second.track.stopped, 0);
  h.suspend();
  assert.equal(second.track.stopped, 1);
});

test('document hiding notifies the application and stops capture', async () => {
  const capture = stream();
  const h = harness(async () => capture);
  let stops = 0;
  h.window.addEventListener('basira:native-suspend', () => { stops += 1; });
  await h.navigator.mediaDevices.getUserMedia({ video: true });
  h.document.hidden = true;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(stops, 1);
  assert.equal(capture.track.stopped, 1);
  h.resume();
  await assert.rejects(h.navigator.mediaDevices.getUserMedia({ video: true }), { name: 'AbortError' });
});

test('page exit stops media and duplicate script injection does not wrap twice', async () => {
  const capture = stream();
  const h = harness(async () => capture);
  const originalWrapper = h.navigator.mediaDevices.getUserMedia;
  vm.runInContext(script, h.context);
  assert.equal(h.navigator.mediaDevices.getUserMedia, originalWrapper);
  await h.navigator.mediaDevices.getUserMedia({ audio: true });
  h.window.dispatchEvent(new Event('pagehide'));
  assert.equal(capture.track.stopped, 1);
});

test('SPA route exit stops native camera and media before allowing new module requests', async () => {
  const h = harness(async () => stream());
  let stops = 0;
  let resumes = 0;
  h.window.addEventListener('basira:native-resume', () => { resumes += 1; });
  h.window.BasiraNativeFrames = { stop: async () => { stops += 1; } };
  const capture = await h.navigator.mediaDevices.getUserMedia({ video: true });
  h.window.history.pushState({}, '', '/navigation');
  assert.equal(capture.track.stopped, 1);
  assert.equal(resumes, 0);
  await assert.rejects(h.navigator.mediaDevices.getUserMedia({ video: true }), { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
  assert.equal(resumes, 1);
  const fresh = await h.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.notEqual(fresh, capture);
  assert.equal(fresh.track.stopped, 0);
  assert.equal(capture.track.stopped, 1);
});

test('replaceState and popstate revoke native camera; same vision path keeps it alive', async () => {
  const h = harness(async () => stream());
  let stops = 0;
  h.window.BasiraNativeFrames = { stop: async () => { stops += 1; } };
  h.window.history.pushState({}, '', '/navigation/vision');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 0);
  h.window.history.replaceState({}, '', '/assistant');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
  h.window.history.pushState({}, '', '/navigation/vision');
  h.window.location.pathname = '/online-exams';
  h.window.dispatchEvent(new Event('popstate'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 2);
});

test('a background stop during SPA cleanup cannot restore capture eligibility', async () => {
  const h = harness(async () => stream());
  let complete;
  let resumes = 0;
  h.window.addEventListener('basira:native-resume', () => { resumes += 1; });
  h.window.BasiraNativeFrames = { stop: () => new Promise(resolve => { complete = resolve; }) };
  h.window.history.pushState({}, '', '/assistant');
  await Promise.resolve();
  h.suspend();
  complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumes, 0);
  await assert.rejects(h.navigator.mediaDevices.getUserMedia({ audio: true }), { name: 'AbortError' });
});

test('failed SPA camera cleanup stays suspended without a resume announcement', async () => {
  const h = harness(async () => stream());
  let resumes = 0;
  h.window.addEventListener('basira:native-resume', () => { resumes += 1; });
  h.window.BasiraNativeFrames = { stop: async () => { throw Error('camera_unavailable'); } };
  h.window.history.pushState({}, '', '/assistant');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumes, 0);
  await assert.rejects(h.navigator.mediaDevices.getUserMedia({ audio: true }), { name: 'AbortError' });
});

test('pageshow and visibility notify application eligibility without restarting old streams', async () => {
  let requests = 0, resumes = 0, suspensions = 0;
  const h = harness(async () => { requests += 1; return stream(); });
  h.window.addEventListener('basira:native-resume', () => { resumes += 1; });
  h.window.addEventListener('basira:native-suspend', () => { suspensions += 1; });
  const first = await h.navigator.mediaDevices.getUserMedia({ audio: true });
  h.window.dispatchEvent(new Event('pagehide'));
  assert.equal(suspensions, 1);
  assert.equal(first.track.stopped, 1);
  h.window.dispatchEvent(new Event('pageshow'));
  assert.equal(resumes, 1);
  assert.equal(requests, 1);
  h.document.hidden = true;
  h.document.dispatchEvent(new Event('visibilitychange'));
  h.window.dispatchEvent(new Event('pageshow'));
  assert.equal(resumes, 1);
  assert.equal(suspensions, 2);
  h.document.hidden = false;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(resumes, 2);
  assert.equal(requests, 1);
  const second = await h.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.equal(second.track.stopped, 0);
  assert.equal(first.track.stopped, 1);
});
