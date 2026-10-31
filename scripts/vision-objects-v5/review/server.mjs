/** Local human review of object-detection boxes. Serves cohort photos and model proposals and records the
 * reviewer's decisions. Proposals are a convenience, never ground truth.
 * Usage: node server.mjs <cohort-dir> <proposals.json> <reviews.jsonl> [--port=4391]
 * - 127.0.0.1 only; nothing is uploaded. Append-only reviews; the latest record per image wins.
 * - The sealed test split is never served.
 */
import express from "express";
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const [cohortArg, proposalsArg, reviewsArg, ...flags] = process.argv.slice(2);
if (!cohortArg || !proposalsArg || !reviewsArg) throw Error("usage: server.mjs <cohort-dir> <proposals.json> <reviews.jsonl> [--port=..]");
const cohort = resolve(cohortArg),
  reviewsPath = resolve(reviewsArg),
  port = Number((flags.find(f => f.startsWith("--port=")) ?? "--port=4391").slice(7));
const manifest = JSON.parse(await readFile(join(cohort, "manifest.json"), "utf8"));
const proposals = JSON.parse(await readFile(resolve(proposalsArg), "utf8"));
const files = new Map(manifest.samples.filter(s => s.split !== "test").map(s => [s.id, join(cohort, s.path)]));
const images = proposals.images.filter(i => files.has(i.id) && i.split !== "test");
// Classes the reviewer is asked to be complete about (everything else may stay unlabelled).
const TARGETS = ["person", "chair", "couch", "bed", "dining table", "tv", "laptop", "cup", "bottle", "bowl", "vase", "book", "backpack", "handbag", "suitcase", "umbrella", "car", "bus", "truck", "bicycle", "motorcycle", "bench", "traffic light", "potted plant", "refrigerator"];
const COCO = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"];

async function latest() {
  const map = new Map();
  if (existsSync(reviewsPath))
    for (const line of (await readFile(reviewsPath, "utf8")).split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      map.set(r.imageId, r);
    }
  return map;
}
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.use((_q, r, n) => {
  r.setHeader("Cache-Control", "no-store");
  r.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  n();
});
app.get("/", (_q, r) => r.sendFile(resolve(import.meta.dirname, "page.html")));
app.get("/api/images", async (_q, r) => {
  const done = await latest();
  // All images are returned so the reviewer can move freely (previous/next/jump) and re-open saved work.
  r.json({ classes: COCO, targets: TARGETS, total: images.length, done: done.size, images: images.map(i => ({ ...i, review: done.get(i.id) ?? null })) });
});
app.get("/img/:id", (q, r) => {
  const f = files.get(q.params.id);
  if (!f) return r.sendStatus(404);
  r.sendFile(f);
});
const validBox = b => Array.isArray(b) && b.length === 4 && b.every(v => Number.isFinite(v)) && b[0] >= 0 && b[1] >= 0 && b[2] > 0.005 && b[3] > 0.005 && b[0] + b[2] <= 1.001 && b[1] + b[3] <= 1.001;
app.post("/api/review", async (q, r) => {
  const { imageId, reviewer, complete, decisions, added, note } = q.body ?? {};
  const image = images.find(i => i.id === imageId);
  const ids = new Set(image?.proposals.map(p => p.id));
  const decisionsOk =
    decisions &&
    typeof decisions === "object" &&
    Object.entries(decisions).every(([k, v]) => ids.has(k) && (v === "ok" || v === "no" || (typeof v === "string" && v.startsWith("class:") && COCO.includes(v.slice(6)))));
  const addedOk = Array.isArray(added) && added.length <= 60 && added.every(a => validBox(a.box) && COCO.includes(a.class));
  if (!image || typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 40 || !decisionsOk || !addedOk || typeof complete !== "boolean")
    return r.status(400).json({ error: "invalid review" });
  if (complete && image.proposals.some(p => !(p.id in decisions))) return r.status(400).json({ error: "complete needs every proposal decided" });
  const row = { imageId, reviewer: reviewer.trim(), complete, decisions, added, note: typeof note === "string" ? note.slice(0, 300) : "", at: new Date().toISOString() };
  await appendFile(reviewsPath, JSON.stringify(row) + "\n");
  r.json({ ok: true });
});
app.listen(port, "127.0.0.1", () => console.log(`Detection review: http://127.0.0.1:${port}  images=${images.length}`));
