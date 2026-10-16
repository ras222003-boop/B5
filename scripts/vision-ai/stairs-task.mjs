/** Dataset specialization only; never imported by production perception. */
import { requireValue as check, nonempty } from "./common.mjs";
export { imagePosition } from "./stairs-position.mjs";
import { imagePosition } from "./stairs-position.mjs";
import { detectionMetrics, boxIoU } from "../perception-evaluation.mjs";

export const stairsLabels = [
  "stairs_up",
  "stairs_down",
  "stairs_present_uncertain_direction",
];
export function validateStairsDirection(object) {
  if (object.stairsDirection === undefined) return; // Generic historical approval remains generic.
  const d = object.stairsDirection;
  check(
    object.classId === 23 &&
      d &&
      stairsLabels.includes(d.label) &&
      nonempty(d.evidence) &&
      d.evidence.length <= 1000,
    "Stairs direction requires class 23, a supported label and visible/context evidence; use uncertain when ambiguous"
  );
}

export function stairsTruth(sample) {
  return sample.annotation.objects
    .filter(o => o.classId === 23)
    .map(o => {
      validateStairsDirection(o);
      check(
        o.stairsDirection,
        "Generic stairs labels are not reviewed directional reference labels"
      );
      return {
        ...o,
        classId: 2301 + stairsLabels.indexOf(o.stairsDirection.label),
      };
    });
}

export function stairsMetrics(samples) {
  const presence = detectionMetrics(
    samples.map(s => ({
      ...s,
      groundTruth: s.groundTruth.map(o => ({ ...o, class: "stairs_present" })),
      predictions: s.predictions.map(o => ({ ...o, class: "stairs_present" })),
    }))
  );
  const framePresence = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const confusion = Object.fromEntries(
    stairsLabels.map(label => [
      label,
      Object.fromEntries([...stairsLabels, "missed"].map(k => [k, 0])),
    ])
  );
  const position = {
    matchedBoxes: 0,
    horizontalCorrect: 0,
    centralOverlapCorrect: 0,
    metricDistance: null,
    walkingPathKnown: false,
  };
  const xywh = b => [b.x, b.y, b.width, b.height];
  for (const s of samples) {
    framePresence[
      s.groundTruth.length
        ? s.predictions.length
          ? "tp"
          : "fn"
        : s.predictions.length
          ? "fp"
          : "tn"
    ]++;
    const matched = new Map(),
      used = new Set();
    for (const p of [...s.predictions].sort((a, b) => b.score - a.score)) {
      let best = -1,
        overlap = 0.5;
      s.groundTruth.forEach((g, n) => {
        const iou = boxIoU(g.box, p.box);
        if (!used.has(n) && iou >= overlap) {
          best = n;
          overlap = iou;
        }
      });
      if (best >= 0) {
        used.add(best);
        matched.set(best, p);
      }
    }
    s.groundTruth.forEach((g, n) => {
      const p = matched.get(n);
      confusion[g.class][p?.class ?? "missed"]++;
      if (p) {
        const a = imagePosition(xywh(g.box)),
          b = imagePosition(xywh(p.box));
        position.matchedBoxes++;
        position.horizontalCorrect += Number(a.horizontal === b.horizontal);
        position.centralOverlapCorrect += Number(
          a.overlapsCentralImageRegion === b.overlapsCentralImageRegion
        );
      }
    });
  }
  return {
    presence,
    framePresence,
    directionConfusionAtIoU50: confusion,
    position,
    limitations:
      "Image geometry only. Uncertain direction is a real class, never guessed up/down. No meters, collision/fall prevention or walking-path inference.",
  };
}
