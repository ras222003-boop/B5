/** Real published human-reference agreement + separate renderer stress tests. No training/qualification shortcut. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import express from "express";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const [rootArg, stage = "development", runTag = "001"] = process.argv.slice(2),
  root = resolve(rootArg),
  hash = b => createHash("sha256").update(b).digest("hex"),
  readJson = async p => JSON.parse(await readFile(p, "utf8"));
if (!/^[a-zA-Z0-9-]+$/.test(runTag)) throw Error("Safe local run tag required");
const output = resolve(root, "evaluation-" + stage + "-" + runTag + ".json");
if (
  await readFile(output)
    .then(() => true)
    .catch(e => {
      if (e.code === "ENOENT") return false;
      throw e;
    })
)
  throw Error("Preserve earlier evaluation results; choose a new run tag");
if (!["development", "calibration", "test"].includes(stage))
  throw Error("Explicit evaluation stage required");
const manifestBytes = await readFile(resolve(root, "manifest.json")),
  manifest = JSON.parse(manifestBytes),
  cohort = await readJson(resolve(root, "cohort-lock.json"));
assert.equal(hash(manifestBytes), cohort.manifestSha256);
const files = [
    "objectColors.ts",
    "objectColorEstimator.ts",
    "objectColorSpaces.ts",
    "colourAnnouncement.ts",
    "objectSpeech.ts",
    "objectSceneDescription.ts",
  ].map(f => "client/src/lib/vision/" + f),
  sourceHashes = {};
for (const f of files) sourceHashes[f] = hash(await readFile(f));
const baseline = await readFile(resolve(root, "baseline-colours.mjs"));
if (stage === "test") {
  const lock = await readJson(resolve(root, "selection-lock.json"));
  assert.deepEqual(lock.sourceHashes, sourceHashes);
  assert.equal(lock.baselineSha256, hash(baseline));
  assert.equal(lock.manifestSha256, cohort.manifestSha256);
  const prior = await readFile(resolve(root, "test-consumption.json")).catch(
    e => {
      if (e.code !== "ENOENT") throw e;
      return null;
    }
  );
  if (prior)
    throw Error("Frozen final test already consumed; never tune against it");
  await writeFile(
    resolve(root, "test-consumption.json"),
    JSON.stringify(
      {
        sourceHashes,
        manifestSha256: cohort.manifestSha256,
        atUtc: new Date().toISOString(),
        status: "STARTED_DO_NOT_TUNE",
      },
      null,
      2
    ),
    { flag: "wx" }
  );
}
await build({
  stdin: {
    contents:
      "export * from './client/src/lib/vision/objectColors'; export {colourForSpeech,COLOUR_SPEECH_QUALIFICATION} from './client/src/lib/vision/colourAnnouncement';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: resolve(root, "candidate-colours-" + stage + ".mjs"),
});
const app = express();
app.get("/", (_q, r) =>
  r
    .type("html")
    .send(
      '<!doctype html><html lang="en"><title>Local colour QA</title><body>Automated local test only</body></html>'
    )
);
app.get("/old.mjs", (_q, r) =>
  r.sendFile(resolve(root, "baseline-colours.mjs"))
);
app.get("/new.mjs", (_q, r) =>
  r.sendFile(resolve(root, "candidate-colours-" + stage + ".mjs"))
);
const server = app.listen(4383, "127.0.0.1");
await new Promise(r => server.once("listening", r));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const rows = [],
  timings = { old: [], candidate: [] };
let synthetic = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", r =>
    r.request().url().startsWith("http://127.0.0.1:4383/")
      ? r.continue()
      : r.abort()
  );
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4383/");
  for (const row of manifest.samples.filter(r => r.split === stage)) {
    const raw = await readFile(resolve(root, row.path));
    assert.equal(hash(raw), row.sha256);
    assert.equal(
      hash(await readFile(resolve(root, row.licenceEvidence))),
      row.licenceEvidenceSha256
    );
    assert.equal(
      hash(await readFile(resolve(root, row.referenceDocument))),
      row.referenceDocumentSha256
    );
    const result = await page.evaluate(
      async ({ encoded, row }) => {
        const old = await import("/old.mjs"),
          candidate = await import("/new.mjs"),
          im = new Image();
        im.src = "data:image/png;base64," + encoded;
        await im.decode();
        const c = new OffscreenCanvas(im.width, im.height);
        c.getContext("2d").drawImage(im, 0, 0);
        const pixels = candidate.sampleColorFrame(c, 1000, row.id),
          before = old.sampleColorFrame(c, 1000, row.id);
        if (!pixels || !before) throw Error("Pixel sample unavailable");
        if (
          pixels.width !== before.width ||
          pixels.data.some((v, i) => v !== before.data[i])
        )
          throw Error("Baseline/candidate sRGB sampling changed");
        const detections = row.objects.map(o => ({
          id: o.objectId,
          trackId: "reference-" + o.objectId,
          cocoClass: o.cocoClass,
          type: "UNKNOWN_OBSTACLE",
          boundingBox: {
            x: o.box[0],
            y: o.box[1],
            width: o.box[2],
            height: o.box[3],
          },
          confidence: 1,
          timestamp: 1000,
          source: "OBJECT_DETECTOR",
          horizontalDirection: "FRONT",
          tracking: { state: "TRACKED", observations: 5 },
        }));
        return row.objects.map((ref, index) => {
          const d = detections[index],
            elapsed = { old: [], candidate: [] };
          let a, b;
          for (let pass = 0; pass < 25; pass++) {
            for (const [name, lib] of pass % 2
              ? [
                  ["candidate", candidate],
                  ["old", old],
                ]
              : [
                  ["old", old],
                  ["candidate", candidate],
                ]) {
              const start = performance.now(),
                out = lib.analyzeObjectColor(pixels, d, detections),
                ms = performance.now() - start;
              if (pass >= 5) elapsed[name].push(ms);
              if (name === "old") a = out;
              else b = out;
            }
          }
          return {
            imageId: row.id,
            sourceGroup: row.groupId,
            objectId: ref.objectId,
            class: ref.cocoClass,
            reference: ref.referenceColor,
            referenceOrigin: ref.referenceOrigin,
            referenceReviewedByBasira: false,
            old: a,
            candidate: b,
            oldWouldDescribeColour: Boolean(a.name),
            newAudibleColour: candidate.colourForSpeech(
              { ...d, color: b },
              { now: 1000, live: false }
            ),
            timings: elapsed,
          };
        });
      },
      { encoded: raw.toString("base64"), row }
    );
    for (const r of result) {
      timings.old.push(...r.timings.old);
      timings.candidate.push(...r.timings.candidate);
      delete r.timings;
      rows.push(r);
    }
    console.log(
      JSON.stringify({
        stage,
        imagesProcessed: new Set(rows.map(r => r.imageId)).size,
        referenceObservations: rows.length,
      })
    );
  }
  synthetic = await page.evaluate(async stage => {
    const old = await import("/old.mjs"),
      candidate = await import("/new.mjs");
    let seed = stage === "test" ? 7327 : 1307;
    const rand = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const palette = {
        red: [200, 30, 35],
        blue: [30, 50, 180],
        green: [30, 150, 45],
        yellow: [220, 220, 35],
        orange: [225, 110, 30],
        purple: [125, 30, 170],
        pink: [230, 130, 180],
        black: [40, 43, 46],
        white: [230, 230, 230],
        gray: [130, 130, 130],
        brown: [110, 65, 30],
      },
      results = [];
    for (const [expected, base] of Object.entries(palette))
      for (const variant of [
        "contrast",
        "same-background",
        "dark",
        "clipped",
        "multicolour",
        "windowed-object",
      ]) {
        const w = 160,
          h = 120,
          data = new Uint8ClampedArray(w * h * 4),
          body = base.map(v =>
            Math.round(Math.max(0, Math.min(255, v + (rand() - 0.5) * 12)))
          ),
          bg =
            variant === "same-background"
              ? body
              : expected === "green"
                ? [180, 35, 30]
                : [30, 160, 70];
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            let p = x >= 32 && x < 128 && y >= 24 && y < 96 ? body : bg;
            if (
              variant === "multicolour" &&
              x >= 80 &&
              x < 128 &&
              y >= 24 &&
              y < 96
            )
              p = expected === "blue" ? [205, 30, 30] : [25, 45, 190];
            if (
              variant === "windowed-object" &&
              x >= 45 &&
              x < 115 &&
              y >= 28 &&
              y < 65
            )
              p = [20, 22, 24];
            if (variant === "dark") p = p.map(v => Math.round(v * 0.02));
            if (
              variant === "clipped" &&
              x >= 32 &&
              x < 128 &&
              y >= 24 &&
              y < 96
            )
              p = [255, 255, 255];
            data.set([...p, 255], (y * w + x) * 4);
          }
        const frame = {
            width: w,
            height: h,
            data,
            timestamp: 1000,
            frameId: "renderer-" + expected + "-" + variant,
          },
          d = {
            id: "fixture",
            cocoClass: "car",
            type: "CAR",
            confidence: 0.9,
            boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
            trackId: "fixture-track",
            tracking: { state: "TRACKED", observations: 5 },
            timestamp: 1000,
            source: "OBJECT_DETECTOR",
          };
        const a = old.analyzeObjectColor(frame, d),
          b = candidate.analyzeObjectColor(frame, d),
          reference = [
            "dark",
            "clipped",
            "same-background",
            "windowed-object",
          ].includes(variant)
            ? null
            : variant === "multicolour"
              ? "multicolor"
              : expected;
        const tracks = {
            old: new old.ObjectColorTracker(),
            candidate: new candidate.ObjectColorTracker(),
          },
          sequence = { old: [], candidate: [] };
        for (let i = 0; i < 12; i++) {
          const at = 1000 + i * 636;
          for (const [key, lib] of [
            ["old", old],
            ["candidate", candidate],
          ]) {
            const observed = lib.analyzeObjectColor(
              { ...frame, timestamp: at },
              { ...d, timestamp: at }
            );
            if (i === 6) {
              observed.name = null;
              observed.status = "UNCLEAR";
              observed.reason = "BACKGROUND_AMBIGUOUS";
            }
            const c = tracks[key].update({ ...d, timestamp: at }, observed);
            sequence[key].push({
              name: c.name,
              calibrated: c.calibrated,
              stableFrames: c.stableFrames,
            });
          }
        }
        results.push({
          id: frame.frameId,
          reference,
          referenceMeaning:
            reference === null
              ? "ABSTENTION_OR_SURFACE_AMBIGUITY_STRESS"
              : "RENDERER_PARAMETER_NOT_A_REAL_PHOTO_LABEL",
          variant,
          old: a,
          candidate: b,
          newAudibleColour: candidate.colourForSpeech(
            { ...d, color: b },
            { now: 1000, live: false }
          ),
          sequence,
        });
      }
    return results;
  }, stage);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
const quantile = (v, p) =>
  v.length
    ? [...v].sort((a, b) => a - b)[
        Math.min(v.length - 1, Math.floor(p * (v.length - 1)))
      ]
    : null;
const metrics = (values, key) => {
  const decided = values.filter(r => r[key].name),
    correct = decided.filter(r => r[key].name === r.reference);
  return {
    references: values.length,
    estimated: decided.length,
    abstained: values.length - decided.length,
    coverage: values.length ? decided.length / values.length : null,
    agreementWhenEstimated: decided.length
      ? correct.length / decided.length
      : null,
    wrongEstimates: decided.length - correct.length,
    abstentionReasons: values
      .filter(r => !r[key].name)
      .reduce(
        (a, r) => ((a[r[key].reason] = (a[r[key].reason] ?? 0) + 1), a),
        {}
      ),
  };
};
const known = synthetic.filter(r => r.reference !== null),
  stress = synthetic.filter(r => r.reference === null);
const spokenRows = rows.filter(r => r.newAudibleColour);
const report = {
  scope:
    "PUBLISHED_HUMAN_ATTRIBUTE_AGREEMENT_WITH_ORACLE_REFERENCE_BOXES_NOT_END_TO_END_OR_PRODUCT_QUALIFICATION",
  stage,
  cohortSha256: cohort.manifestSha256,
  sourceHashes,
  baselineSha256: hash(baseline),
  images: new Set(rows.map(r => r.imageId)).size,
  before: metrics(rows, "old"),
  after: metrics(rows, "candidate"),
  audio: {
    announced: spokenRows.length,
    selectiveAccuracy: null,
    wrongColoursAnnounced: spokenRows.filter(
      r => r.candidate.name !== r.reference
    ).length,
    abstentionRate: rows.length ? 1 - spokenRows.length / rows.length : null,
    qualificationPassed: false,
    reason:
      "Independent diverse reviewed real references insufficient; numeric quality scores are not calibrated.",
  },
  colourCpuMs: {
    beforeMedian: quantile(timings.old, 0.5),
    beforeP95: quantile(timings.old, 0.95),
    afterMedian: quantile(timings.candidate, 0.5),
    afterP95: quantile(timings.candidate, 0.95),
    scope:
      "Warm per-object browser colour CPU only, excludes detector/camera. Desktop Chrome, not iPhone.",
  },
  rows,
  synthetic: {
    scope: "CONTROLLED_RENDERER_ONLY_NOT_REAL_PHOTO_ACCURACY",
    cases: synthetic.length,
    knownColourCases: known.length,
    before: metrics(known, "old"),
    after: metrics(known, "candidate"),
    stressCases: stress.length,
    stressEstimates: {
      before: stress.filter(r => r.old.name).length,
      after: stress.filter(r => r.candidate.name).length,
      meaning:
        "Expected abstention/ambiguity stress, not adjudicated real incorrect colours",
    },
    results: synthetic,
  },
  iphonePerformanceMeasured: false,
  independentBasiraReferenceAdjudication: false,
  modelTrainingPerformed: false,
  masksEnabled: false,
  privateMediaSaved: false,
  apiWrites: 0,
};
await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(
  JSON.stringify({
    stage,
    before: report.before,
    after: report.after,
    colourCpuMs: report.colourCpuMs,
    qualificationPassed: false,
  })
);
