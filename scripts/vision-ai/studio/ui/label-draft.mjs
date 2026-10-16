// Three-way reconciliation. Conflicts never silently choose an author's changes.
const canonical = value =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        )
      : v
  );
const same = (a, b) => canonical(a) === canonical(b);
export function reconcileLabels(base, mine, latest) {
  const conflicts = [];
  if (
    base.baseHash !== latest.baseHash ||
    latest.conflict ||
    (base.activeSha256 ?? base.sample.sha256) !==
      (latest.activeSha256 ?? latest.sample.sha256) ||
    base.sample.width !== latest.sample.width ||
    base.sample.height !== latest.sample.height
  )
    return {
      conflicts: [
        "الصورة أو الفهرس تغير؛ افحص الإصدار الجديد قبل نقل المسودة.",
      ],
    };
  function merge(b, m, t, path) {
    if (same(m, b)) return structuredClone(t);
    if (same(t, b) || same(m, t)) return structuredClone(m);
    if (
      b &&
      m &&
      t &&
      [b, m, t].every(x => typeof x === "object" && !Array.isArray(x))
    ) {
      const result = {};
      for (const k of new Set([
        ...Object.keys(b),
        ...Object.keys(m),
        ...Object.keys(t),
      ])) {
        const v = merge(b[k], m[k], t[k], path + "." + k);
        if (v !== undefined) result[k] = v;
      }
      return result;
    }
    conflicts.push(path);
    return structuredClone(m);
  }
  const maps = [
    base.sample.annotation?.objects ?? [],
    mine.objects,
    latest.sample.annotation?.objects ?? [],
  ].map(a => new Map(a.map(o => [o.id, o])));
  const objects = [];
  for (const id of new Set([
    ...maps[2].keys(),
    ...maps[1].keys(),
    ...maps[0].keys(),
  ])) {
    const v = merge(...maps.map(m => m.get(id)), `الجسم ${id}`);
    if (v !== undefined) objects.push(v);
  }
  const conditions = merge(
    base.sample.conditions,
    mine.conditions,
    latest.sample.conditions,
    "ظروف المشهد"
  );
  return { objects, conditions, conflicts };
}
