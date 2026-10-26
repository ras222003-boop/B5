/** Actual desktop local speech events on the hosted preview; no recording or phone/listening-quality claim. */
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [url, out] = process.argv.slice(2),
  base = new URL(url);
if (
  base.href !==
  "https://ras222003-boop.github.io/basira-iphone-research-preview/"
)
  throw Error("Independent preview HTTPS base only");
const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  const context = await browser.newContext({
      locale: "ar-SA",
      serviceWorkers: "block",
    }),
    writes = [],
    escaped = [];
  await context.route("**/*", route => {
    const r = route.request();
    if (!r.url().startsWith(base.href)) {
      escaped.push(r.url());
      return route.abort();
    }
    if (!["GET", "HEAD"].includes(r.method())) {
      writes.push(r.method());
      return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    window.__voiceProbe = [];
    const native = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = u => {
      for (const event of ["start", "end", "error"])
        u.addEventListener(event, e =>
          window.__voiceProbe.push({
            event,
            atMs: performance.now(),
            lang: u.voice?.lang ?? u.lang,
            local: u.voice?.localService ?? false,
            error: e.error ?? null,
          })
        );
      native(u);
    };
  });
  const page = await context.newPage();
  await page.goto(base.href + "#/settings/voice", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { name: "إعدادات الصوت", exact: true })
    .waitFor();
  await page.evaluate(() => speechSynthesis.getVoices());
  await page.waitForTimeout(1500);
  await page
    .getByRole("button", { name: "استمع إلى الصوت", exact: true })
    .click();
  let completed = false;
  try {
    await page.waitForFunction(
      () =>
        window.__voiceProbe.some(e => e.event === "end" || e.event === "error"),
      {},
      { timeout: 30000 }
    );
    completed = true;
  } catch {}
  const events = await page.evaluate(() => window.__voiceProbe),
    voices = await page.evaluate(() =>
      speechSynthesis
        .getVoices()
        .filter(v => v.localService && v.lang.toLowerCase().startsWith("ar"))
        .map(v => ({ lang: v.lang, local: v.localService }))
    );
  const report = {
    status:
      events.some(
        e =>
          e.event === "start" &&
          e.local &&
          e.lang.toLowerCase().startsWith("ar")
      ) && events.some(e => e.event === "end")
        ? "LOCAL_ARABIC_API_STARTED_AND_COMPLETED"
        : "NOT_CONFIRMED",
    completed,
    events,
    localArabicVoices: voices,
    scope:
      "ACTUAL_VISIBLE_DESKTOP_BROWSER_LOCAL_SPEECH_EVENTS_NOT_HUMAN_LISTENING_OR_IPHONE",
    hostedHttpsTested: true,
    microphoneUsed: false,
    audioRecorded: false,
    networkWrites: writes.length,
    outsidePreviewRequests: escaped.length,
    audibleQualityVerified: false,
    iphoneTested: false,
  };
  await writeFile(resolve(out), JSON.stringify(report, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(report));
  await page.getByRole("button", { name: "إيقاف الصوت", exact: true }).click();
} finally {
  await browser.close();
}
