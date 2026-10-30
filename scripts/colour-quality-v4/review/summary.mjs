/** Summarise human colour reviews against the published Visual Genome labels.
 * Usage: node summary.mjs <cohort-dir> <reviews.jsonl> [out.json]
 * Output separates: agreed (published label == reviewer), disagreed (needs a second reviewer), unusable (unsure / bad mask).
 * Only "agreed" items are double-labelled references; a lone human label is NOT promoted to a reference.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const [cohortArg, reviewsArg, outArg] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(join(resolve(cohortArg), "manifest.json"), "utf8"));
const published = new Map();
for (const s of manifest.samples)
  for (const o of s.objects)
    published.set(`${s.id}#${o.objectId}`, { split: s.split, cocoClass: o.cocoClass, label: o.referenceColor, components: o.referenceComponents ?? [], group: s.groupId });
const latest = new Map();
for (const line of (await readFile(resolve(reviewsArg), "utf8")).split("\n").filter(Boolean)) {
  const r = JSON.parse(line);
  latest.set(r.itemId, r);
}
const agreed = [],
  disagreed = [],
  unusable = [],
  byClass = {};
for (const [id, r] of latest) {
  const p = published.get(id);
  if (!p) continue;
  const c = (byClass[p.cocoClass] ??= { reviewed: 0, agreed: 0, disagreed: 0, unusable: 0 });
  c.reviewed++;
  if (r.label === "unsure" || r.label === "bad-mask") {
    unusable.push({ id, reviewer: r.label });
    c.unusable++;
  } else if (p.label === "multicolor" ? p.components.includes(r.label) : r.label === p.label) {
    agreed.push({ id, label: r.label, split: p.split, cocoClass: p.cocoClass });
    c.agreed++;
  } else {
    disagreed.push({ id, published: p.label, reviewer: r.label, split: p.split });
    c.disagreed++;
  }
}
const decided = agreed.length + disagreed.length;
const report = {
  reviewed: latest.size,
  agreed: agreed.length,
  disagreed: disagreed.length,
  unusable: unusable.length,
  agreementRate: decided ? agreed.length / decided : null,
  byClass,
  disagreements: disagreed,
  agreedReferences: agreed,
  note: "A reviewed label that disagrees with the published one is neither promoted nor discarded; it needs a second independent reviewer.",
};
if (outArg) await writeFile(resolve(outArg), JSON.stringify(report, null, 1), { flag: "wx" });
console.log(JSON.stringify({ ...report, disagreements: undefined, agreedReferences: undefined }, null, 1));
