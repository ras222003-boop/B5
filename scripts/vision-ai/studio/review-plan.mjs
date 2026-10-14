import { validBox, requireValue as check } from "../common.mjs";
/** Local advisory queue only. Never changes labels, identities, reviews or splits. */
export async function reviewPlan(w) {
  let p;
  try {
    p = await w.json(".studio/human-review-plan.json");
  } catch (e) {
    if (e.code === "ENOENT")
      return { schemaVersion: 1, items: [], stale: 0, humanApproval: false };
    throw e;
  }
  check(
    p.schemaVersion === 1 && Array.isArray(p.items) && p.items.length <= 1000,
    "Bounded review plan required"
  );
  const catalog = await w.catalog(),
    items = [],
    seen = new Set();
  let stale = 0;
  for (const r of p.items) {
    check(
      /^[a-f0-9]{32}$/.test(r.key) && !seen.has(r.key),
      "Invalid or duplicate review key"
    );
    seen.add(r.key);
    check(
      Number.isInteger(r.priority) &&
        r.priority >= 1 &&
        r.priority <= 99 &&
        Array.isArray(r.tasks) &&
        r.tasks.length <= 200,
      "Invalid review priority/tasks"
    );
    const i = catalog.items.find(i => i.key === r.key);
    if (
      !i ||
      i.version !== r.version ||
      (i.activeSha256 ?? i.sample.sha256) !== r.imageSha256
    ) {
      stale++;
      continue;
    }
    const tasks = r.tasks.map(t => {
      check(
        typeof t.kind === "string" &&
          t.kind.length <= 60 &&
          typeof t.label === "string" &&
          t.label.length <= 500,
        "Invalid task description"
      );
      check(t.box == null || validBox(t.box), "Invalid task box");
      check(
        t.score == null ||
          (Number.isFinite(t.score) && t.score >= 0 && t.score <= 1),
        "Invalid task score"
      );
      check(
        t.classId == null || w.taxonomy.classes.some(c => c.id === t.classId),
        "Unknown task class"
      );
      return {
        kind: t.kind,
        label: t.label,
        box: t.box ?? null,
        classId: t.classId ?? null,
        score: t.score ?? null,
        status: "candidate_only_human_required",
      };
    });
    items.push({
      key: r.key,
      version: r.version,
      imageSha256: r.imageSha256,
      priority: r.priority,
      tasks,
      approval: false,
    });
  }
  return {
    schemaVersion: 1,
    items: items.sort((a, b) => a.priority - b.priority),
    stale,
    humanApproval: false,
  };
}
