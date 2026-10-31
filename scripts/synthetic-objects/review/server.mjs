/** Human approval of drawn training images, one class at a time. Only approved drawings may be used for training.
 * Usage: node server.mjs <synthetic-dir> <review-dir> <reviews.jsonl> [--port=4394] [--sample=12]
 * <review-dir> holds classes.json ({class:{ar, ref}}) and refs/ (the owner's real photos shown next to the drawings).
 * - 127.0.0.1 only; append-only; latest record per class wins.
 * - Each class shows a deterministic sample of drawings PLUS one attention check: a drawing of a DIFFERENT class.
 *   Accepting it flags the review ("decoy-accepted") and the class is not counted as reviewed.
 */
import express from "express";
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const [synArg, reviewArg, reviewsArg, ...flags] = process.argv.slice(2);
if (!synArg || !reviewArg || !reviewsArg) throw Error("usage: server.mjs <synthetic-dir> <review-dir> <reviews.jsonl> [--port=..] [--sample=..]");
const syn = resolve(synArg),
  reviewDir = resolve(reviewArg),
  reviewsPath = resolve(reviewsArg),
  port = Number((flags.find(f => f.startsWith("--port=")) ?? "--port=4394").slice(7)),
  sample = Number((flags.find(f => f.startsWith("--sample=")) ?? "--sample=12").slice(9));
const index = JSON.parse(await readFile(join(syn, "index.json"), "utf8"));
const classes = JSON.parse(await readFile(join(reviewDir, "classes.json"), "utf8"));
const h = s => createHash("sha256").update(s).digest();
const byClass = {};
for (const m of index) (byClass[m.class] ??= []).push(m.file);
const names = Object.keys(classes).filter(c => byClass[c]);
const items = names.map(cls => {
  const pick = byClass[cls].slice().sort((a, b) => h("pick:" + a).compare(h("pick:" + b))).slice(0, sample);
  const other = names.filter(c => c !== cls);
  const decoyClass = other[h("decoy:" + cls)[0] % other.length];
  const decoyFile = byClass[decoyClass].slice().sort((a, b) => h("dq:" + cls + a).compare(h("dq:" + cls + b)))[0];
  const all = [...pick.map(f => ({ file: f })), { file: decoyFile, decoy: true }].sort((a, b) => h("ord:" + cls + a.file).compare(h("ord:" + cls + b.file)));
  return { class: cls, ar: classes[cls].ar, ref: classes[cls].ref, images: all.map(i => i.file), decoy: decoyFile };
});
const allowed = new Map(items.map(i => [i.class, i]));
async function latest() {
  const m = new Map();
  if (existsSync(reviewsPath))
    for (const line of (await readFile(reviewsPath, "utf8")).split(String.fromCharCode(10)).filter(Boolean)) {
      const r = JSON.parse(line);
      m.set(r.class, r);
    }
  return m;
}
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use((_q, r, n) => {
  r.setHeader("Cache-Control", "no-store");
  r.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  n();
});
app.get("/", (_q, r) => r.sendFile(resolve(import.meta.dirname, "page.html")));
app.get("/api/classes", async (_q, r) => {
  const done = await latest();
  r.json({ classes: items.map(i => ({ ...i, decoy: undefined, review: done.get(i.class) ?? null })), done: [...done.values()].filter(v => !v.flags?.includes("decoy-accepted")).length, total: items.length });
});
app.get("/img/:file", (q, r) => (index.some(m => m.file === q.params.file) ? r.sendFile(join(syn, q.params.file)) : r.sendStatus(404)));
app.get("/ref/:cls", (q, r) => (classes[q.params.cls] ? r.sendFile(join(reviewDir, classes[q.params.cls].ref)) : r.sendStatus(404)));
app.post("/api/review", async (q, r) => {
  const { class: cls, reviewer, decisions, note, seconds } = q.body ?? {};
  const item = allowed.get(cls);
  const ok =
    item &&
    typeof reviewer === "string" && reviewer.trim() && reviewer.length <= 40 && !/^test$/i.test(reviewer.trim()) &&
    Number.isFinite(seconds) && seconds >= 0 &&
    decisions && typeof decisions === "object" &&
    item.images.every(f => decisions[f] === "ok" || decisions[f] === "no") &&
    Object.keys(decisions).length === item.images.length;
  if (!ok) return r.status(400).json({ error: "invalid review: every drawing needs a decision" });
  const flags = [];
  if (decisions[item.decoy] === "ok") flags.push("decoy-accepted");
  if (seconds < 1.5 * item.images.length) flags.push("fast");
  const approved = item.images.filter(f => f !== item.decoy && decisions[f] === "ok").length;
  const row = { class: cls, reviewer: reviewer.trim(), decisions, approved, sampled: item.images.length - 1, note: typeof note === "string" ? note.slice(0, 400) : "", seconds: Math.round(seconds), flags, at: new Date().toISOString() };
  await appendFile(reviewsPath, JSON.stringify(row) + String.fromCharCode(10));
  r.json({ ok: true, flags, approved, sampled: row.sampled });
});
app.listen(port, "127.0.0.1", () => console.log(`Drawing approval: http://127.0.0.1:${port}  classes=${items.length} sample=${sample}`));
