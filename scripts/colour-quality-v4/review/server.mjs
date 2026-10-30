/** Local blind colour review tool. Serves a cohort's images and records an independent human colour per object.
 * Usage: node server.mjs <cohort-dir> <reviews.jsonl> [--splits=development,calibration] [--port=4390]
 * - Binds to 127.0.0.1 only; nothing is uploaded anywhere.
 * - Blind: the published Visual Genome colour, the split and any engine output are never sent to the browser.
 * - Append-only: reviews are never rewritten; a later review of the same object supersedes the earlier one in the summary.
 */
import express from "express";
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const [cohortArg, reviewsArg, ...flags] = process.argv.slice(2);
if (!cohortArg || !reviewsArg) throw Error("usage: server.mjs <cohort-dir> <reviews.jsonl> [--splits=..] [--port=..]");
const cohort = resolve(cohortArg),
  reviewsPath = resolve(reviewsArg),
  splits = (flags.find(f => f.startsWith("--splits=")) ?? "--splits=development,calibration").slice(9).split(","),
  port = Number((flags.find(f => f.startsWith("--port=")) ?? "--port=4390").slice(7));
const LABELS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "black", "white", "gray", "multicolor", "unsure", "bad-mask"];
const manifest = JSON.parse(await readFile(join(cohort, "manifest.json"), "utf8"));
const order = id => createHash("sha256").update("review-order:" + id).digest("hex");
const items = [];
for (const sample of manifest.samples) {
  if (!splits.includes(sample.split)) continue;
  const doc = JSON.parse(await readFile(join(cohort, sample.referenceDocument), "utf8"));
  const annotations = new Map(doc.annotations.map(a => [String(a.id), a]));
  for (const o of sample.objects) {
    const a = annotations.get(o.objectId);
    items.push({
      id: `${sample.id}#${o.objectId}`,
      image: sample.id,
      width: sample.width,
      height: sample.height,
      cocoClass: o.cocoClass,
      box: o.box,
      polygons: Array.isArray(a?.segmentation) ? a.segmentation : [],
    });
  }
}
items.sort((p, q) => order(p.id).localeCompare(order(q.id)));
const imagePath = new Map(manifest.samples.map(s => [s.id, join(cohort, s.path)]));

async function reviews() {
  if (!existsSync(reviewsPath)) return new Map();
  const latest = new Map();
  for (const line of (await readFile(reviewsPath, "utf8")).split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    latest.set(r.itemId, r);
  }
  return latest;
}
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use((_q, r, n) => {
  r.setHeader("Cache-Control", "no-store");
  r.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  n();
});
app.get("/", (_q, r) => r.sendFile(resolve(import.meta.dirname, "page.html")));
app.get("/api/items", async (_q, r) => {
  const done = await reviews();
  r.json({ labels: LABELS, total: items.length, done: done.size, items: items.filter(i => !done.has(i.id)) });
});
app.get("/img/:id", (q, r) => {
  const file = imagePath.get(q.params.id);
  if (!file) return r.sendStatus(404);
  r.sendFile(file);
});
app.post("/api/review", async (q, r) => {
  const { itemId, label, reviewer, note } = q.body ?? {};
  if (!items.some(i => i.id === itemId) || !LABELS.includes(label) || typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 40)
    return r.status(400).json({ error: "invalid review" });
  const row = { itemId, label, reviewer: reviewer.trim(), note: typeof note === "string" ? note.slice(0, 200) : "", at: new Date().toISOString() };
  await appendFile(reviewsPath, JSON.stringify(row) + "\n", { flag: "a" });
  r.json({ ok: true });
});
app.listen(port, "127.0.0.1", () => console.log(`Colour review: http://127.0.0.1:${port}  items=${items.length} splits=${splits.join(",")}`));
