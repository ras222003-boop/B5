import type {
  ObjectColorName,
  ObjectColorObservation,
  VisionDetection,
} from "@shared/vision";
import type { AlignedObjectMask, ColorPixels } from "./objectColors";
import { rgbToLab, pixelColour } from "./objectColorSpaces";
type Pixel = {
  name: ObjectColorName;
  lab: [number, number, number];
  cell: number;
};
const median = (a: number[]) => {
  a.sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const centre = (p: Pixel[]): [number, number, number] => [
  median(p.map(v => v.lab[0])),
  median(p.map(v => v.lab[1])),
  median(p.map(v => v.lab[2])),
];
const distance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function analyzeObjectColor(
  frame: ColorPixels,
  detection: VisionDetection,
  others: readonly VisionDetection[] = [],
  mask?: AlignedObjectMask
): ObjectColorObservation {
  const { width, height, data } = frame,
    b = detection.boundingBox;
  const unclear = (
    reason: ObjectColorObservation["reason"],
    samples = 0,
    quality?: ObjectColorObservation["quality"]
  ): ObjectColorObservation => ({
    name: null,
    status: "UNCLEAR",
    reason,
    samples,
    supportFraction: 0,
    timestamp: frame.timestamp,
    stableFrames: 0,
    calibrated: false,
    ...(quality ? { quality } : {}),
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
  const pad = aligned ? 0 : 0.16,
    x0 = Math.max(0, Math.floor((b.x + pad * b.width) * width)),
    x1 = Math.min(width, Math.ceil((b.x + (1 - pad) * b.width) * width)),
    y0 = Math.max(0, Math.floor((b.y + pad * b.height) * height)),
    y1 = Math.min(height, Math.ceil((b.y + (1 - pad) * b.height) * height));
  if (x1 - x0 < 5 || y1 - y0 < 5) return unclear("TOO_SMALL");
  const inside = (x: number, y: number, box: VisionDetection["boundingBox"]) =>
    x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  const pixels: Pixel[] = [],
    ring: Pixel[] = [];
  let attempted = 0,
    blocked = 0,
    clipped = 0,
    dark = 0,
    brightScene = 0,
    scene = 0;
  for (let i = 0; i < data.length; i += 4 * 29) {
    scene++;
    if (Math.max(data[i], data[i + 1], data[i + 2]) > 60) brightScene++;
  }
  const stride = Math.max(
    1,
    Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / 900))
  );
  for (let y = y0; y < y1; y += stride)
    for (let x = x0; x < x1; x += stride) {
      if (aligned && !mask!.data[y * width + x]) continue;
      attempted++;
      if (
        !aligned &&
        others.some(
          o =>
            o.id !== detection.id &&
            inside((x + 0.5) / width, (y + 0.5) / height, o.boundingBox)
        )
      ) {
        blocked++;
        continue;
      }
      const i = (y * width + x) * 4,
        r = data[i],
        g = data[i + 1],
        z = data[i + 2];
      if (data[i + 3] < 250) continue;
      const max = Math.max(r, g, z),
        min = Math.min(r, g, z);
      if (max >= 250 && max - min < 12) {
        clipped++;
        continue;
      }
      if (max < 8) {
        dark++;
        continue;
      }
      const lab = rgbToLab(r, g, z),
        cell =
          Math.min(2, Math.floor((3 * (x - x0)) / (x1 - x0))) +
          3 * Math.min(2, Math.floor((3 * (y - y0)) / (y1 - y0)));
      pixels.push({ name: pixelColour(r, g, z, lab), lab, cell });
    }
  if (!attempted || blocked / attempted > 0.45)
    return unclear("MIXED_OR_OCCLUDED", pixels.length);
  if (pixels.length < 24)
    return unclear(
      clipped + dark > attempted * 0.4 ? "CLIPPED_OR_REFLECTIVE" : "TOO_SMALL",
      pixels.length
    );
  // Scene darkness alone does not reject a clearly exposed object. Local light must also be insufficient.
  const localL = median(pixels.map(p => p.lab[0]));
  if (brightScene / Math.max(1, scene) < 0.08 && localL < 15)
    return unclear("LOW_LIGHT", pixels.length);
  if (clipped / attempted > 0.25 || dark / attempted > 0.65)
    return unclear("CLIPPED_OR_REFLECTIVE", pixels.length);
  if (!aligned) {
    const u0 = Math.max(0, Math.floor((b.x - 0.12 * b.width) * width)),
      u1 = Math.min(width, Math.ceil((b.x + 1.12 * b.width) * width)),
      v0 = Math.max(0, Math.floor((b.y - 0.12 * b.height) * height)),
      v1 = Math.min(height, Math.ceil((b.y + 1.12 * b.height) * height)),
      step = Math.max(1, Math.ceil(Math.sqrt(((u1 - u0) * (v1 - v0)) / 600)));
    for (let y = v0; y < v1; y += step)
      for (let x = u0; x < u1; x += step) {
        if (
          inside((x + 0.5) / width, (y + 0.5) / height, b) ||
          others.some(
            o =>
              o.id !== detection.id &&
              inside((x + 0.5) / width, (y + 0.5) / height, o.boundingBox)
          )
        )
          continue;
        const i = (y * width + x) * 4,
          r = data[i],
          g = data[i + 1],
          z = data[i + 2];
        if (data[i + 3] < 250 || Math.max(r, g, z) < 8) continue;
        const lab = rgbToLab(r, g, z);
        ring.push({ name: pixelColour(r, g, z, lab), lab, cell: 0 });
      }
  }
  const counts = new Map<ObjectColorName, Pixel[]>();
  for (const p of pixels) {
    const list = counts.get(p.name) ?? [];
    list.push(p);
    counts.set(p.name, list);
  }
  const ranked = Array.from(counts).sort((a, b) => b[1].length - a[1].length),
    dominant = ranked[0],
    support = dominant[1].length / pixels.length;
  // Preserve coherent secondary colours; do not average red+blue into an invented purple.
  const major = ranked
    .filter(
      ([, v]) =>
        v.length / pixels.length >= 0.18 &&
        new Set(v.map(p => p.cell)).size >= 2
    )
    .slice(0, 3);
  const neutral = new Set<ObjectColorName>(["black", "white", "gray"]);
  // Black/grey/white modes can be lighting, windows or background, not several material colours.
  const independentlyChromatic =
    major.filter(([name]) => !neutral.has(name)).length >= 2;
  const multi =
    major.length >= 2 &&
    (aligned || independentlyChromatic) &&
    major.reduce((s, [, v]) => s + v.length, 0) / pixels.length >= 0.82;
  const components = multi ? major.map(([name]) => name).sort() : undefined,
    selected = new Set(multi ? components : [dominant[0]]);
  const labelSupport = multi
    ? major.reduce((s, [, v]) => s + v.length, 0) / pixels.length
    : support;
  const cells = Array.from({ length: 9 }, () => ({ total: 0, selected: 0 }));
  for (const p of pixels) {
    cells[p.cell].total++;
    if (selected.has(p.name)) cells[p.cell].selected++;
  }
  const occupied = cells.filter(c => c.total >= 3),
    spatial =
      occupied.filter(c => c.selected / c.total >= 0.65).length /
      Math.max(1, occupied.length);
  let separation: number | null = null;
  if (ring.length >= 12) {
    const comparable = ring.filter(p => p.name === dominant[0]);
    if (comparable.length >= ring.length * 0.5)
      separation = distance(centre(dominant[1]), centre(comparable));
    else separation = distance(centre(dominant[1]), centre(ring));
  }
  const usable = pixels.length / attempted,
    score = Math.max(
      0,
      Math.min(
        1,
        labelSupport,
        spatial,
        usable,
        separation === null ? (aligned ? 1 : 0.5) : Math.min(1, separation / 24)
      )
    );
  const quality: ObjectColorObservation["quality"] = {
    version: "inset-grid-v2",
    method: aligned ? "ALIGNED_MASK" : "INSET_GRID",
    score,
    labelSupport,
    spatialAgreement: spatial,
    usableFraction: usable,
    clippedFraction: clipped / attempted,
    darkFraction: dark / attempted,
    backgroundSeparation: separation,
    contextSamples: ring.length,
    sampledPixels: attempted,
    calibrated: false,
  };
  if (!aligned && separation !== null && separation < 12)
    return unclear("BACKGROUND_AMBIGUOUS", pixels.length, quality);
  if (
    !aligned &&
    multi &&
    ring.length >= 12 &&
    major.some(([name, ps]) => {
      const context = ring.filter(p => p.name === name);
      return (
        context.length >= ring.length * 0.2 &&
        distance(centre(ps), centre(context)) < 8
      );
    })
  )
    return unclear("BACKGROUND_AMBIGUOUS", pixels.length, quality);
  if ((!multi && support < 0.72) || spatial < 0.55 || occupied.length < 3)
    return unclear("MIXED_OR_OCCLUDED", pixels.length, quality);
  const name = multi ? "multicolor" : dominant[0],
    L = median(dominant[1].map(p => p.lab[0]));
  return {
    name,
    ...(components ? { components } : {}),
    ...(!["black", "white", "gray", "multicolor"].includes(name)
      ? L < 35
        ? { shade: "DARK" as const }
        : L > 70
          ? { shade: "LIGHT" as const }
          : {}
      : {}),
    status: aligned ? "MASK_SUPPORTED" : "ESTIMATED",
    reason: aligned ? "ALIGNED_INSTANCE_MASK" : "BOX_ESTIMATE",
    supportFraction: labelSupport,
    samples: pixels.length,
    timestamp: frame.timestamp,
    stableFrames: 1,
    calibrated: false,
    quality,
  };
}
