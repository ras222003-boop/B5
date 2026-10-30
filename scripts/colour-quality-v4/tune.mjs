/** Coordinate-descent tuning of ColourV4Params on DEVELOPMENT data only (never test).
 * Usage: node tune.mjs <engine.mjs> <maxRows-per-file> <wrongCost> <frames1.jsonl[:mode]> ...
 * Objective per dataset: correct - wrongCost * wrong, i.e. wrong spoken colours cost more than silence.
 * Datasets are weighted equally so real photos are not drowned out by synthetic volume.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [enginePath, maxRowsArg, costArg, ...rest] = process.argv.slice(2);
const secondaryObjective = rest.includes("--objective=secondary");
const specs = rest.filter(s => !s.startsWith("--"));
if (specs.some(s => /test/i.test(s))) throw Error("Tuning must never touch test data");
const engine = await import(pathToFileURL(resolve(enginePath)).href);
const maxRows = Number(maxRowsArg),
  wrongCost = Number(costArg);

async function load(spec) {
  const [path, mode = "box"] = spec.split("::");
  const items = [];
  let n = 0;
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    if (n++ >= maxRows) break;
    const f = JSON.parse(line);
    const data = new Uint8ClampedArray(Buffer.from(f.rgba, "base64"));
    const pixels = { width: f.width, height: f.height, data, timestamp: 1000, frameId: f.id };
    const detections = f.objects.map(o => ({
      id: o.objectId,
      type: "object",
      cocoClass: o.cocoClass,
      boundingBox: { x: o.box[0], y: o.box[1], width: o.box[2], height: o.box[3] },
      timestamp: 1000,
    }));
    f.objects.forEach((o, i) => {
      const enc = mode === "oracle-mask" ? o.mask : mode === "seg-mask" ? o.segMask : null;
      if (mode === "oracle-mask" && !enc) return;
      items.push({
        pixels,
        detection: detections[i],
        others: detections,
        mask: enc
          ? {
              objectId: o.objectId,
              frameId: f.id,
              width: f.width,
              height: f.height,
              data: new Uint8Array(Buffer.from(enc, "base64")),
              alignmentVerified: true,
              source: "INSTANCE_SEGMENTATION",
            }
          : undefined,
        ref: o.referenceColor,
        refSecondary: "referenceSecondary" in o ? (o.referenceSecondary ?? "none") : null,
      });
    });
  }
  return { spec, items };
}
const sets = [];
for (const s of specs) sets.push(await load(s));

function scoreSecondary(params) {
  const per = sets.map(({ items }) => {
    let tp = 0, fp = 0, refHas = 0, correctN = 0;
    for (const it of items) {
      if (it.refSecondary === null) continue;
      const out = engine.analyzeObjectColorV4(it.pixels, it.detection, it.others, it.mask, params);
      if (out.name !== it.ref) continue;
      correctN++;
      if (it.refSecondary !== "none") refHas++;
      if (out.secondary) {
        if (out.secondary === it.refSecondary) tp++;
        else fp++;
      }
    }
    return { tp, fp, refHas, correctN };
  });
  const J = per.reduce((s, p) => s + (p.tp - wrongCost * p.fp) / Math.max(1, p.refHas), 0) / per.length;
  return { J, per };
}
function score(params) {
  if (secondaryObjective) return scoreSecondary(params);
  const per = sets.map(({ items }) => {
    let correct = 0,
      wrong = 0;
    for (const it of items) {
      const out = engine.analyzeObjectColorV4(it.pixels, it.detection, it.others, it.mask, params);
      if (!out.name) continue;
      if (out.name === it.ref) correct++;
      else wrong++;
    }
    return { correct, wrong, n: items.length };
  });
  const J = per.reduce((s, p) => s + (p.correct - wrongCost * p.wrong) / p.n, 0) / per.length;
  return { J, per };
}

const grid = secondaryObjective ? {
  secondaryShare: [0.12, 0.18, 0.22, 0.3, 0.4],
  secondaryMinPixels: [12, 24, 48, 96],
  secondaryCells: [1, 2, 3],
  secondaryCellShare: [0.45, 0.6, 0.75],
  erode: [true, false],
  secondaryRequiresMask: [true, false],
} : {
  chromaMin: [8, 12, 18, 24],
  support: [0.6, 0.7, 0.8, 0.9],
  minEvidence: [30, 60, 120, 240],
  whiteL: [62, 68, 72, 78, 84],
  whiteBalance: [0, 0.5, 1],
  ringMatchDeltaE: [6, 9, 12, 16],
  chromaticFraction: [0.3, 0.45, 0.6],
  lowLightL: [8, 14, 20],
  litPercentile: [0.7, 0.85, 0.95],
  pinkL: [55, 62, 70],
  brownL: [45, 52, 60],
  erode: [true, false],
  refineBox: [true, false],
};
let best = { ...engine.COLOUR_V4_DEFAULTS };
let bestScore = score(best);
console.log("start", JSON.stringify(bestScore));
for (let round = 0; round < 2; round++) {
  let improved = false;
  for (const [key, values] of Object.entries(grid)) {
    for (const v of values) {
      if (best[key] === v) continue;
      const trial = { ...best, [key]: v };
      const s = score(trial);
      if (s.J > bestScore.J + 1e-9) {
        best = trial;
        bestScore = s;
        improved = true;
        console.log("improve", key, v, JSON.stringify(s));
      }
    }
  }
  if (!improved) break;
}
console.log("BEST", JSON.stringify(best));
console.log("SCORE", JSON.stringify(bestScore));
