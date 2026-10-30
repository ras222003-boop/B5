/** Offline colour evaluation on a frozen cohort: published human colour per object vs engine output.
 * Usage: node evaluate.mjs <frames.jsonl> <engine.mjs> <mode: box|oracle-mask|seg-mask> <out.json> [--allow-test]
 * Reports coverage, selective accuracy (Wilson 95%), abstention reasons and confusions. It never tunes anything.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [framesPath, enginePath, mode, outPath, ...flags] = process.argv.slice(2);
if (!["box", "oracle-mask", "seg-mask"].includes(mode)) throw Error("mode: box|oracle-mask|seg-mask");
if (/test/i.test(framesPath) && !flags.includes("--allow-test"))
  throw Error("Frozen test frames need --allow-test; run them once after the engine is frozen");
const fnName = (flags.find(f => f.startsWith("--fn=")) ?? "--fn=analyzeObjectColor").slice(5);
const paramsFlag = flags.find(f => f.startsWith("--params="));
const engine = await import(pathToFileURL(resolve(enginePath)).href);
const overrides = paramsFlag ? JSON.parse(paramsFlag.slice(9)) : null;
const defaults = engine.COLOUR_V4_DEFAULTS ?? null;
const engineParams = overrides && defaults ? { ...defaults, ...overrides } : defaults;
const analyze = (...a) => (fnName === "analyzeObjectColorV4" ? engine[fnName](...a, engineParams) : engine[fnName](...a));
const engineBytes = await readFile(enginePath);
const rowsFlag = flags.find(f => f.startsWith("--rows="));
const maxRows = rowsFlag ? Number(rowsFlag.slice(7)) : Infinity;
const lines = [];
for await (const line of createInterface({ input: createReadStream(framesPath), crlfDelay: Infinity })) {
  if (!line) continue;
  if (lines.length >= maxRows) break;
  lines.push(line);
}

const wilson = (k, n) => {
  if (!n) return null;
  const z = 1.96,
    p = k / n,
    d = 1 + (z * z) / n,
    c = p + (z * z) / (2 * n),
    m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
};
const results = [];
const times = [];
for (const line of lines) {
  const frame = JSON.parse(line);
  const data = new Uint8ClampedArray(Buffer.from(frame.rgba, "base64"));
  const pixels = { width: frame.width, height: frame.height, data, timestamp: 1000, frameId: frame.id };
  const detections = frame.objects.map(o => ({
    id: o.objectId,
    type: "object",
    cocoClass: o.cocoClass,
    boundingBox: { x: o.box[0], y: o.box[1], width: o.box[2], height: o.box[3] },
    timestamp: 1000,
  }));
  for (const [i, o] of frame.objects.entries()) {
    const detection = detections[i];
    let mask;
    if (mode !== "box") {
      const encoded = mode === "oracle-mask" ? o.mask : o.segMask;
      if (mode === "oracle-mask" && !encoded) continue;
      if (encoded) mask = {
        objectId: o.objectId,
        frameId: frame.id,
        width: frame.width,
        height: frame.height,
        data: new Uint8Array(Buffer.from(encoded, "base64")),
        alignmentVerified: true,
        source: "INSTANCE_SEGMENTATION",
      };
    }
    const t0 = performance.now();
    const colour = analyze(pixels, detection, detections, mask);
    times.push(performance.now() - t0);
    const multi = o.referenceColor === "multicolor";
    const answered = !!colour.name;
    const correct = answered && (multi ? colour.name === "multicolor" : colour.name === o.referenceColor);
    results.push({
      image: frame.id,
      group: frame.groupId,
      cocoClass: o.cocoClass,
      reference: o.referenceColor,
      predicted: colour.name,
      reason: colour.reason,
      status: colour.status,
      correct,
      answered,
      tags: o.tags ?? {},
      maskUsed: !!mask,
    });
  }
}
const total = results.length,
  answered = results.filter(r => r.answered),
  correct = answered.filter(r => r.correct);
const byClass = {},
  reasons = {},
  confusion = {};
for (const r of results) {
  const c = (byClass[r.cocoClass] ??= { total: 0, answered: 0, correct: 0 });
  c.total++;
  if (r.answered) c.answered++;
  if (r.correct) c.correct++;
  if (!r.answered) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  if (r.answered && !r.correct) {
    const k = r.reference + "->" + r.predicted;
    confusion[k] = (confusion[k] ?? 0) + 1;
  }
}
const byTag = {};
for (const r of results)
  for (const [k, v] of Object.entries(r.tags)) {
    const t = ((byTag[k] ??= {})[String(v)] ??= { total: 0, answered: 0, correct: 0 });
    t.total++;
    if (r.answered) t.answered++;
    if (r.correct) t.correct++;
  }
times.sort((a, b) => a - b);
const report = {
  mode,
  fn: fnName,
  params: fnName === "analyzeObjectColorV4" ? engineParams : null,
  frames: lines.length,
  engineSha256: createHash("sha256").update(engineBytes).digest("hex"),
  framesSha256: createHash("sha256").update(lines.join("\n")).digest("hex"),
  rowsEvaluated: lines.length,
  references: total,
  sourceGroups: new Set(results.map(r => r.group)).size,
  answered: answered.length,
  coverage: total ? answered.length / total : null,
  correct: correct.length,
  selectiveAccuracy: answered.length ? correct.length / answered.length : null,
  selectiveAccuracyWilson95: wilson(correct.length, answered.length),
  endToEndAccuracy: total ? correct.length / total : null,
  abstainReasons: reasons,
  topConfusions: Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 12),
  byClass,
  byTag,
  maskedFraction: total ? results.filter(r => r.maskUsed).length / total : null,
  analyzeMsMedian: times[Math.floor(times.length / 2)] ?? null,
  analyzeMsP95: times[Math.floor(times.length * 0.95)] ?? null,
  note: "Oracle boxes/masks isolate the colour stage; not end-to-end detection. Offline Pillow resampling, not Chrome.",
};
await writeFile(outPath, JSON.stringify({ report, results }, null, 1), { flag: "wx" });
console.log(JSON.stringify(report, null, 1));
