import type { BoundingBox, VisionDetection } from '@shared/vision';
import { validNormalizedBox } from './objectTracking';
import type { MotionEvidence } from './visualApproach';

export interface OpticalFlowFrame {
  frameId: string;
  capturedAt: number;
  width: number;
  height: number;
  /** One grey byte per pixel, or four RGBA bytes per pixel. */
  pixels: Uint8Array;
}
interface GreyFrame { frameId: string; capturedAt: number; width: number; height: number; pixels: Uint8Array; detections: VisionDetection[] }
interface Point { x: number; y: number }
interface Match { p: Point; q: Point }
interface Similarity { a: number; b: number; tx: number; ty: number }
const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0;
const transform = (p: Point, t: Similarity): Point => ({ x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty });
const inBox = (p: Point, box: BoundingBox, width: number, height: number, margin = 0) =>
  p.x >= box.x * width - margin && p.x <= (box.x + box.width) * width + margin &&
  p.y >= box.y * height - margin && p.y <= (box.y + box.height) * height + margin;

function grey(frame: OpticalFlowFrame, detections: readonly VisionDetection[]): GreyFrame | null {
  const { width, height, pixels } = frame;
  if (!frame.frameId || !Number.isFinite(frame.capturedAt) || !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 24 || height < 24 || width > 8192 || height > 8192 ||
    (pixels.length !== width * height && pixels.length !== width * height * 4)) return null;
  const ratio = Math.min(1, 160 / width, 120 / height), w = Math.floor(width * ratio), h = Math.floor(height * ratio);
  if (w < 24 || h < 24) return null;
  const rgba = pixels.length === width * height * 4, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const offset = Math.min(height - 1, Math.floor(y / ratio)) * width + Math.min(width - 1, Math.floor(x / ratio));
    data[y * w + x] = rgba ? Math.round(pixels[offset * 4] * .299 + pixels[offset * 4 + 1] * .587 + pixels[offset * 4 + 2] * .114) : pixels[offset];
  }
  return { frameId: frame.frameId, capturedAt: frame.capturedAt, width: w, height: h, pixels: data,
    detections: detections.filter(d => validNormalizedBox(d.boundingBox)).map(d => ({ ...d, boundingBox: { ...d.boundingBox } })) };
}

function corners(frame: GreyFrame): Point[] {
  const { width: w, height: h, pixels: data } = frame, points: (Point & { score: number })[] = [];
  // One well-conditioned corner per cell bounds work and preserves spatial coverage.
  for (let cy = 11; cy < h - 11; cy += 7) for (let cx = 11; cx < w - 11; cx += 7) {
    let best = { x: cx, y: cy, score: 0 };
    for (let y = cy; y < Math.min(cy + 7, h - 11); y += 2) for (let x = cx; x < Math.min(cx + 7, w - 11); x += 2) {
      let xx = 0, yy = 0, xy = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const at = (y + j) * w + x + i, dx = (data[at + 1] - data[at - 1]) / 2, dy = (data[at + w] - data[at - w]) / 2;
        xx += dx * dx; yy += dy * dy; xy += dx * dy;
      }
      const score = (xx + yy - Math.sqrt((xx - yy) ** 2 + 4 * xy * xy)) / 2;
      if (score > best.score) best = { x, y, score };
    }
    if (best.score > 400) points.push(best);
  }
  return points.sort((a, b) => b.score - a.score).slice(0, 220);
}

function matchPoint(from: GreyFrame, to: GreyFrame, p: Point): Point | null {
  const w = from.width, x = Math.round(p.x), y = Math.round(p.y), scores: { x: number; y: number; cost: number }[] = [];
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    const qx = x + dx, qy = y + dy;
    if (qx < 3 || qy < 3 || qx >= w - 3 || qy >= to.height - 3) continue;
    let cost = 0;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const delta = from.pixels[(y + j) * w + x + i] - to.pixels[(qy + j) * w + qx + i];
      cost += delta * delta;
    }
    scores.push({ x: qx, y: qy, cost: cost / 49 });
  }
  scores.sort((a, b) => a.cost - b.cost);
  const best = scores[0], alternative = scores.find(q => Math.hypot(q.x - best.x, q.y - best.y) > 1.5);
  if (!best || best.cost > 1800 || (alternative && best.cost >= alternative.cost * .8)) return null;
  return { x: best.x, y: best.y };
}

function fit(matches: readonly Match[]): Similarity | null {
  if (matches.length < 2) return null;
  const px = matches.reduce((n, m) => n + m.p.x, 0) / matches.length, py = matches.reduce((n, m) => n + m.p.y, 0) / matches.length;
  const qx = matches.reduce((n, m) => n + m.q.x, 0) / matches.length, qy = matches.reduce((n, m) => n + m.q.y, 0) / matches.length;
  let denominator = 0, dot = 0, cross = 0;
  for (const m of matches) {
    const x = m.p.x - px, y = m.p.y - py, u = m.q.x - qx, v = m.q.y - qy;
    denominator += x * x + y * y; dot += x * u + y * v; cross += x * v - y * u;
  }
  if (denominator < 16) return null;
  const a = dot / denominator, b = cross / denominator;
  return { a, b, tx: qx - a * px + b * py, ty: qy - b * px - a * py };
}
function residual(m: Match, t: Similarity) { const predicted = transform(m.p, t); return Math.hypot(m.q.x - predicted.x, m.q.y - predicted.y); }
function backgroundFit(matches: readonly Match[]): { model: Similarity; ratio: number } | null {
  if (matches.length < 12) return null;
  let best: Match[] = [];
  // Deterministic pair hypotheses resist foreground motion leaking into the background.
  for (let i = 0; i < Math.min(matches.length, 80); i++) {
    const j = (i * 17 + 13) % matches.length, model = fit([matches[i], matches[j]]);
    if (!model) continue;
    const inliers = matches.filter(m => residual(m, model) <= 1.25);
    if (inliers.length > best.length) best = inliers;
  }
  const model = fit(best);
  if (!model || best.length < 12) return null;
  // A tight cluster does not establish camera motion across the image.
  const spanX = Math.max(...best.map(m => m.p.x)) - Math.min(...best.map(m => m.p.x));
  const spanY = Math.max(...best.map(m => m.p.y)) - Math.min(...best.map(m => m.p.y));
  if (spanX < 24 || spanY < 20) return null;
  return { model, ratio: matches.filter(m => residual(m, model) <= 1.25).length / matches.length };
}

/** Bounded sparse patch flow with robust background similarity compensation.
 * Image-only evidence remains experimental: parallax, blur and unobserved zoom can invalidate it.
 * No distance, world velocity, collision probability or safe path is inferred here.
 */
export class SparseOpticalFlow {
  private previous: GreyFrame | null = null;
  reset() { this.previous = null; }
  update(frame: OpticalFlowFrame, detections: readonly VisionDetection[]): MotionEvidence[] {
    const next = grey(frame, detections), previous = this.previous;
    if (!next) { this.reset(); return []; }
    if (previous && (next.frameId === previous.frameId || next.capturedAt <= previous.capturedAt)) return [];
    this.previous = next;
    if (!previous || previous.width !== next.width || previous.height !== next.height) return [];
    const elapsed = next.capturedAt - previous.capturedAt;
    if (elapsed < 40 || elapsed > 350) return [];
    const matches: Match[] = [];
    for (const p of corners(previous)) {
      const q = matchPoint(previous, next, p);
      if (!q) continue;
      const reverse = matchPoint(next, previous, q);
      if (reverse && Math.hypot(reverse.x - p.x, reverse.y - p.y) <= 1) matches.push({ p, q });
    }
    const background = matches.filter(m => !previous.detections.some(d => inBox(m.p, d.boundingBox, previous.width, previous.height, 5)) &&
      !next.detections.some(d => inBox(m.q, d.boundingBox, next.width, next.height, 5)));
    const fitted = backgroundFit(background), t = fitted?.model ?? { a: 1, b: 0, tx: 0, ty: 0 };
    return next.detections.flatMap(d => {
      const old = previous.detections.find(p => !!d.trackId && p.trackId === d.trackId && p.type === d.type && p.source === d.source);
      if (!old || !d.trackId) return [];
      const c = transform({ x: (old.boundingBox.x + old.boundingBox.width / 2) * previous.width,
        y: (old.boundingBox.y + old.boundingBox.height / 2) * previous.height }, t);
      const values = matches.filter(m => inBox(m.p, old.boundingBox, previous.width, previous.height, -3) &&
        inBox(m.q, d.boundingBox, next.width, next.height, -3)).flatMap(m => {
        const p = transform(m.p, t), x = p.x - c.x, y = p.y - c.y, radius = x * x + y * y;
        return radius < 36 ? [] : [(x * (m.q.x - p.x) + y * (m.q.y - p.y)) / radius];
      });
      const expansion = median(values), valid = !!fitted && fitted.ratio >= .7 && values.length >= 6;
      return [{ source: 'SPARSE_OPTICAL_FLOW' as const, trackId: d.trackId, frameId: next.frameId,
        previousFrameId: previous.frameId, capturedAt: next.capturedAt, previousCapturedAt: previous.capturedAt,
        pointCount: values.length, outwardFraction: values.length ? values.filter(v => v > .005).length / values.length : 0,
        backgroundPointCount: background.length, backgroundInlierRatio: fitted?.ratio ?? 0,
        expansionPerSecond: Math.log(Math.max(.01, 1 + expansion)) / (elapsed / 1000),
        globalScaleChange: Math.hypot(t.a, t.b) - 1, globalRotationDegrees: Math.atan2(t.b, t.a) * 180 / Math.PI,
        compensated: !!fitted, quality: valid ? 'VALID' as const : 'INSUFFICIENT' as const }];
    });
  }
}
