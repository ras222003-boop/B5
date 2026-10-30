import type {
  ObjectColorName,
  ObjectColorObservation,
  VisionDetection,
} from "@shared/vision";
import type { AlignedObjectMask, ColorPixels } from "./objectColors";
import { rgbToLab } from "./objectColorSpaces";

/** Colour V4: name the *material* colour from evidence pixels only.
 * Shadow, highlight and background pixels are removed before voting, hue is read from chromatic pixels so a dark
 * red stays red, and neutral names (black/grey/white) are only used when chromatic evidence is absent.
 * Every parameter is exposed so the offline evaluator can tune on development/calibration data only. */
export interface ColourV4Params {
  /** Chroma (Lab) at or above which a pixel carries hue evidence. */
  chromaMin: number;
  /** Fraction of evidence pixels that must be chromatic to name a hue. */
  chromaticFraction: number;
  /** Share of the winning name among the pixels it competes with. */
  support: number;
  /** Minimum evidence pixels. */
  minEvidence: number;
  /** Erode the mask by one pixel when it is large enough. */
  erode: boolean;
  /** Drop box pixels that match the surrounding ring when no mask exists. */
  refineBox: boolean;
  ringMatchDeltaE: number;
  /** Median object L below which colour is unknowable unless the scene is clearly lit. */
  lowLightL: number;
  /** Shrink the frame's grey-world chroma offset by this factor (0 disables). */
  whiteBalance: number;
  /** Treat orange-hued pixels darker than this L as brown. */
  brownL: number;
  /** Neutral pixels at or above this L are white, below it grey (black under 30). */
  whiteL: number;
  /** Lit-reference lightness percentile used for lightness-dependent names. */
  litPercentile: number;
  /** Lit L above which a light red/purple hue is pink. */
  pinkL: number;
  /** Dominant colour must hold at least this share of its mass pool. */
  dominantShare: number;
  /** Dominant colour must outweigh the runner-up by this ratio, else the object is ambiguous. */
  dominanceRatio: number;
  /** Runner-up reported as secondary colour at this share of the chromatic mass. */
  secondaryShare: number;
  secondaryMinPixels: number;
  /** Grid cells (3x3 over the evidence extent) in which the secondary must be the local majority. */
  secondaryCells: number;
  secondaryCellShare: number;
  /** Report a secondary colour only with a verified mask: in a box, occluders and background look like it. */
  secondaryRequiresMask: boolean;
  /** Bright low-chroma pixels above this share of the object are material, not specular highlights. */
  highlightMaxShare: number;
}
export const COLOUR_V4_DEFAULTS: ColourV4Params = {
  // Tuned on development data only (real photos + synthetic), wrong answers weighted 5x silence.
  chromaMin: 18,
  chromaticFraction: 0.6,
  support: 0.9,
  minEvidence: 240,
  erode: false,
  refineBox: true,
  ringMatchDeltaE: 6,
  lowLightL: 14,
  whiteBalance: 0,
  brownL: 45,
  whiteL: 62,
  litPercentile: 0.95,
  pinkL: 55,
  dominantShare: 0.5,
  dominanceRatio: 1.3,
  secondaryShare: 0.18,
  secondaryMinPixels: 12,
  secondaryCells: 2,
  secondaryCellShare: 0.6,
  secondaryRequiresMask: true,
  highlightMaxShare: 0.18,
};

type Lab = [number, number, number];
const median = (a: number[]) => {
  const s = Float64Array.from(a).sort();
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const deltaE = (a: Lab, b: Lab) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Hue angle in CIELAB degrees [0,360) → colour name.
 * Boundaries come from canonical sRGB colour anchors, not from this project's photos: red 40, orange 60-70,
 * yellow 100, green 135, cyan 195, blue 300, violet 315-325, magenta 328, light pink 5-15. */
export type HueGroup = "red" | "orange" | "yellow" | "green" | "blue" | "purple";
export function hueGroup(h: number): HueGroup {
  if (h >= 345 || h < 50) return "red";
  if (h < 82) return "orange";
  if (h < 118) return "yellow";
  if (h < 188) return "green";
  if (h < 308) return "blue";
  return "purple";
}
/** Lightness-dependent names (brown/orange, pink/red, pink/purple) are decided once per object from its lit
 * reference L, so a shaded orange wall is not voted brown pixel by pixel. */
export function groupName(
  group: HueGroup,
  medianHue: number,
  litL: number,
  p: ColourV4Params
): ObjectColorName {
  if (group === "red")
    return (medianHue >= 345 || medianHue < 22) && litL > p.pinkL ? "pink" : "red";
  if (group === "orange") return litL < p.brownL ? "brown" : "orange";
  if (group === "purple") return litL > p.pinkL + 12 ? "pink" : "purple";
  return group;
}
const neutralName = (litL: number, whiteL: number): ObjectColorName =>
  litL < 30 ? "black" : litL >= whiteL ? "white" : "gray";
const percentile = (a: number[], q: number) => {
  const s = Float64Array.from(a).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

export function analyzeObjectColorV4(
  frame: ColorPixels,
  detection: VisionDetection,
  others: readonly VisionDetection[] = [],
  mask?: AlignedObjectMask,
  params: ColourV4Params = COLOUR_V4_DEFAULTS
): ObjectColorObservation {
  const { width, height, data } = frame,
    b = detection.boundingBox;
  const unclear = (
    reason: ObjectColorObservation["reason"],
    samples = 0
  ): ObjectColorObservation => ({
    name: null,
    status: "UNCLEAR",
    reason,
    samples,
    supportFraction: 0,
    timestamp: frame.timestamp,
    stableFrames: 0,
    calibrated: false,
  });
  if (
    !Number.isFinite(frame.timestamp) ||
    !width ||
    !height ||
    data.length !== width * height * 4 ||
    ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
    b.x < 0 ||
    b.y < 0 ||
    b.width <= 0 ||
    b.height <= 0 ||
    b.x + b.width > 1.00001 ||
    b.y + b.height > 1.00001
  )
    return unclear("TOO_SMALL");
  const aligned =
    mask?.alignmentVerified === true &&
    mask.source === "INSTANCE_SEGMENTATION" &&
    mask.frameId === frame.frameId &&
    mask.objectId === (detection.trackId ?? detection.id) &&
    mask.width === width &&
    mask.height === height &&
    mask.data.length === width * height;
  if (mask && !aligned) return unclear("MIXED_OR_OCCLUDED");

  const pad = aligned ? 0 : 0.12,
    x0 = Math.max(0, Math.floor((b.x + pad * b.width) * width)),
    x1 = Math.min(width, Math.ceil((b.x + (1 - pad) * b.width) * width)),
    y0 = Math.max(0, Math.floor((b.y + pad * b.height) * height)),
    y1 = Math.min(height, Math.ceil((b.y + (1 - pad) * b.height) * height));
  if (x1 - x0 < 5 || y1 - y0 < 5) return unclear("TOO_SMALL");
  const inBox = (x: number, y: number, box: VisionDetection["boundingBox"]) =>
    x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  const blockedByOther = (x: number, y: number) =>
    others.some(
      o =>
        o.id !== detection.id &&
        inBox((x + 0.5) / width, (y + 0.5) / height, o.boundingBox)
    );

  // Scene context: median L and grey-world chroma offset of the whole frame, sampled sparsely.
  const sceneL: number[] = [],
    sceneA: number[] = [],
    sceneB: number[] = [];
  for (let i = 0; i < data.length; i += 4 * 37) {
    const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
    sceneL.push(lab[0]);
    sceneA.push(lab[1]);
    sceneB.push(lab[2]);
  }
  const sceneMedianL = median(sceneL),
    wbA = params.whiteBalance * median(sceneA),
    wbB = params.whiteBalance * median(sceneB);

  const keep = (x: number, y: number) => {
    if (aligned) {
      if (!mask!.data[y * width + x]) return false;
      if (params.erode) {
        const m = mask!.data;
        if (
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          !m[y * width + x - 1] ||
          !m[y * width + x + 1] ||
          !m[(y - 1) * width + x] ||
          !m[(y + 1) * width + x]
        )
          return false;
      }
      return true;
    }
    return !blockedByOther(x, y);
  };

  type Px = { lab: Lab; x: number; y: number };
  const stride = Math.max(
    1,
    Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / 1600))
  );
  let attempted = 0,
    clipped = 0,
    unreadable = 0;
  let px: Px[] = [];
  for (let y = y0; y < y1; y += stride)
    for (let x = x0; x < x1; x += stride) {
      if (!keep(x, y)) continue;
      attempted++;
      const i = (y * width + x) * 4;
      if (data[i + 3] < 250) {
        unreadable++;
        continue;
      }
      const r = data[i],
        g = data[i + 1],
        z = data[i + 2],
        max = Math.max(r, g, z),
        min = Math.min(r, g, z);
      if (max >= 250 && max - min < 12) {
        clipped++;
        continue;
      }
      const lab = rgbToLab(r, g, z);
      px.push({ lab: [lab[0], lab[1] - wbA, lab[2] - wbB], x, y });
    }
  if (!attempted) return unclear("TOO_SMALL");
  if (aligned && attempted < 12) return unclear("TOO_SMALL", attempted);

  // Without a mask, remove pixels that look like the surrounding background.
  let method: "ALIGNED_MASK" | "REFINED_BOX" | "INSET_GRID" = aligned
    ? "ALIGNED_MASK"
    : "INSET_GRID";
  let ringCount = 0,
    dropped = 0;
  if (!aligned && params.refineBox) {
    const u0 = Math.max(0, Math.floor((b.x - 0.1 * b.width) * width)),
      u1 = Math.min(width, Math.ceil((b.x + 1.1 * b.width) * width)),
      v0 = Math.max(0, Math.floor((b.y - 0.1 * b.height) * height)),
      v1 = Math.min(height, Math.ceil((b.y + 1.1 * b.height) * height)),
      step = Math.max(1, Math.ceil(Math.sqrt(((u1 - u0) * (v1 - v0)) / 900)));
    const ring: Lab[] = [];
    for (let y = v0; y < v1; y += step)
      for (let x = u0; x < u1; x += step) {
        if (inBox((x + 0.5) / width, (y + 0.5) / height, b) || blockedByOther(x, y))
          continue;
        const i = (y * width + x) * 4;
        if (data[i + 3] < 250) continue;
        ring.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
      }
    ringCount = ring.length;
    if (ring.length >= 24) {
      // Three Lab centres from sorted-L terciles are enough to describe a locally uniform backdrop.
      ring.sort((p, q) => p[0] - q[0]);
      const centres: Lab[] = [0.17, 0.5, 0.83].map(f => {
        const part = ring.slice(
          Math.floor(ring.length * (f - 0.17)),
          Math.max(Math.floor(ring.length * (f + 0.17)), 1)
        );
        return [
          median(part.map(v => v[0])),
          median(part.map(v => v[1])),
          median(part.map(v => v[2])),
        ] as Lab;
      });
      const kept = px.filter(
        p =>
          Math.min(...centres.map(c => deltaE(c, p.lab))) >
          params.ringMatchDeltaE
      );
      if (kept.length >= Math.max(params.minEvidence, px.length * 0.25)) {
        dropped = px.length - kept.length;
        px = kept;
        method = "REFINED_BOX";
      }
    }
  }

  if (px.length < params.minEvidence)
    return unclear(
      clipped + unreadable > attempted * 0.4 ? "CLIPPED_OR_REFLECTIVE" : "TOO_SMALL",
      px.length
    );

  const objectL = median(px.map(p => p.lab[0]));
  const chromaOf = (p: Px) => Math.hypot(p.lab[1], p.lab[2]);
  // Shadow: pixels far darker than the object's own median carry no reliable hue.
  const lit = px.filter(p => p.lab[0] >= Math.min(objectL, 60) * 0.35 && p.lab[0] >= 4);
  // Specular: bright and far less saturated than the object's chromatic body.
  const chromatic0 = lit.filter(p => chromaOf(p) >= params.chromaMin);
  const bodyChroma = chromatic0.length
    ? median(chromatic0.map(chromaOf))
    : 0;
  const isHighlight = (p: Px) =>
    bodyChroma >= params.chromaMin &&
    p.lab[0] > objectL + 18 &&
    chromaOf(p) < bodyChroma * 0.45;
  // A highlight is a small blob. When bright low-chroma pixels cover a large share they are a white material
  // region (a white panel on a blue body), not shine, so they stay as evidence.
  const highlightShare = lit.filter(isHighlight).length / Math.max(1, lit.length);
  const evidence =
    highlightShare >= params.highlightMaxShare ? lit : lit.filter(p => !isHighlight(p));
  const usable = evidence.length / Math.max(1, attempted);
  if (evidence.length < params.minEvidence)
    return unclear("CLIPPED_OR_REFLECTIVE", evidence.length);

  const evidenceL = median(evidence.map(p => p.lab[0]));
  if (evidenceL < params.lowLightL && sceneMedianL < 30)
    return unclear("LOW_LIGHT", evidence.length);

  const chromatic = evidence.filter(p => chromaOf(p) >= params.chromaMin);
  const neutralPx = evidence.filter(p => chromaOf(p) < params.chromaMin);
  const chromaticShare = chromatic.length / evidence.length;
  let name: ObjectColorName | null = null,
    secondary: ObjectColorName | undefined,
    supportFraction = 0,
    shade: "LIGHT" | "DARK" | undefined;
  const hueOf = (p: Px) =>
    ((Math.atan2(p.lab[2], p.lab[1]) * 180) / Math.PI + 360) % 360;
  const litLOf = (list: Px[]) => percentile(list.map(p => p.lab[0]), params.litPercentile);
  const nameOfGroup = (group: HueGroup, list: Px[]) => {
    const members = list.filter(p => hueGroup(hueOf(p)) === group);
    // Unwrap the red wrap-around so a median over 350 and 10 degrees stays near 0.
    const hues = members.map(p => (hueOf(p) >= 345 ? hueOf(p) - 360 : hueOf(p)));
    const mh = median(hues);
    return groupName(group, (mh + 360) % 360, litLOf(members), params);
  };
  const groupsOf = (list: Px[]) => {
    const tally = new Map<HueGroup, number>();
    for (const p of list) {
      const g = hueGroup(hueOf(p));
      tally.set(g, (tally.get(g) ?? 0) + 1);
    }
    return Array.from(tally).sort((x, y) => y[1] - x[1]);
  };
  /** Neutral material named from its lit lightness; null when its own shading range is not coherent. */
  const neutralOf = (list: Px[]): ObjectColorName | null => {
    if (list.length < params.secondaryMinPixels) return null;
    const n = neutralName(litLOf(list), params.whiteL);
    const consistent = list.filter(p =>
      n === "black"
        ? p.lab[0] < 40
        : n === "white"
          ? p.lab[0] >= params.whiteL - 28
          : p.lab[0] >= 22 && p.lab[0] < params.whiteL + 12
    ).length;
    return consistent / list.length >= params.support ? n : null;
  };
  /** A real second colour forms a region; scattered edge or noise pixels do not. */
  const isRegion = (members: Px[]) => {
    if (params.secondaryCells <= 0) return true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of evidence) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    const cw = (x1 - x0 + 1) / 3, ch = (y1 - y0 + 1) / 3;
    const cell = (p: Px) => Math.min(2, Math.floor((p.x - x0) / cw)) + 3 * Math.min(2, Math.floor((p.y - y0) / ch));
    const total = new Array(9).fill(0), hit = new Array(9).fill(0);
    for (const p of evidence) total[cell(p)]++;
    for (const p of members) hit[cell(p)]++;
    let regions = 0;
    for (let i = 0; i < 9; i++)
      if (total[i] >= 6 && hit[i] / total[i] >= params.secondaryCellShare) regions++;
    return regions >= params.secondaryCells;
  };
  const allowSecondary = aligned || !params.secondaryRequiresMask;
  const chromaticGroups = groupsOf(chromatic);
  const chromaticMass = chromatic.length,
    neutralMass = neutralPx.length;
  // Dominant colour = the larger mass; the other significant mass is reported as secondary, never averaged in.
  const neutralDominant =
    neutralMass > chromaticMass ||
    (chromaticShare < 0.2 && neutralMass >= params.minEvidence / 2);
  if (!neutralDominant && chromaticMass >= 24) {
    const top = chromaticGroups[0],
      next = chromaticGroups[1];
    const share = top[1] / chromaticMass;
    if (
      share < params.dominantShare ||
      (next && top[1] < params.dominanceRatio * next[1])
    )
      return unclear("MIXED_OR_OCCLUDED", evidence.length);
    if (chromaticShare < params.chromaticFraction && neutralMass > 0.5 * chromaticMass)
      return unclear("MIXED_OR_OCCLUDED", evidence.length);
    name = nameOfGroup(top[0], chromatic);
    supportFraction = share * Math.min(1, chromaticShare / params.chromaticFraction);
    if (next && next[1] / chromaticMass >= params.secondaryShare && next[1] >= params.secondaryMinPixels) {
      const sec = nameOfGroup(next[0], chromatic);
      if (allowSecondary && sec !== name && isRegion(chromatic.filter(p => hueGroup(hueOf(p)) === next[0])))
        secondary = sec;
    }
    if (allowSecondary && !secondary && neutralMass / evidence.length >= params.secondaryShare) {
      const sec = neutralOf(neutralPx);
      if (sec && isRegion(neutralPx)) secondary = sec;
    }
    if (name !== "brown") {
      const L = litLOf(chromatic.filter(p => hueGroup(hueOf(p)) === top[0]));
      shade = L < 35 ? "DARK" : L > 75 ? "LIGHT" : undefined;
    }
  } else if (neutralDominant) {
    const n = neutralOf(neutralPx.length >= params.minEvidence / 2 ? neutralPx : evidence);
    if (!n) return unclear("MIXED_OR_OCCLUDED", evidence.length);
    // A uniformly dark neutral in a dark scene could be any colour.
    if (n === "black" && sceneMedianL < 22)
      return unclear("LOW_LIGHT", evidence.length);
    name = n;
    supportFraction = neutralMass / evidence.length;
    const top = chromaticGroups[0];
    if (top && top[1] / evidence.length >= params.secondaryShare * 0.6 && top[1] >= params.secondaryMinPixels)
      secondary = allowSecondary && isRegion(chromatic) ? nameOfGroup(top[0], chromatic) : undefined;
    if (supportFraction < params.dominantShare * 0.9) return unclear("MIXED_OR_OCCLUDED", evidence.length);
  } else return unclear("MIXED_OR_OCCLUDED", evidence.length);

  const quality: NonNullable<ObjectColorObservation["quality"]> = {
    version: "mask-lab-v4",
    method,
    score: Math.max(0, Math.min(1, supportFraction, usable + 0.25)),
    labelSupport: supportFraction,
    spatialAgreement: chromaticShare,
    usableFraction: usable,
    clippedFraction: clipped / attempted,
    darkFraction: (px.length - lit.length) / Math.max(1, px.length),
    backgroundSeparation: ringCount ? dropped / Math.max(1, px.length) : null,
    contextSamples: ringCount,
    sampledPixels: attempted,
    calibrated: false,
  };
  return {
    name,
    ...(secondary ? { secondary } : {}),
    ...(shade ? { shade } : {}),
    status: aligned ? "MASK_SUPPORTED" : "ESTIMATED",
    reason: aligned ? "ALIGNED_INSTANCE_MASK" : "BOX_ESTIMATE",
    supportFraction,
    samples: evidence.length,
    timestamp: frame.timestamp,
    stableFrames: 1,
    calibrated: false,
    quality,
  };
}
