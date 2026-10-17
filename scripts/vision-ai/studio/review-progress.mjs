/** Actor-local drafts and actual inspection attestations, never automatic approvals. */
import { open, unlink } from "node:fs/promises";
import { hash, requireValue as check } from "../common.mjs";
const folder = ".studio/batch-review/progress";
export async function readProgress(b, actor) {
  await b.w.ensure(folder);
  try {
    const p = await b.w.json(`${folder}/${hash(actor.id)}.json`);
    check(
      p.actor === actor.id && p.schemaVersion === 1,
      "Invalid review progress owner"
    );
    return p;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return {
      schemaVersion: 1,
      actor: actor.id,
      revision: 0,
      drafts: {},
      inspections: {},
      operation: null,
    };
  }
}
export async function updateProgress(b, actor, expected, change) {
  await b.w.ensure(folder);
  const path = await b.w.safe(`${folder}/${hash(actor.id)}.lock`, true);
  let lock;
  for (let attempt = 0; attempt < 80 && !lock; attempt++) {
    try {
      lock = await open(path, "wx", 0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      await new Promise(r => setTimeout(r, 25));
    }
  }
  check(
    lock,
    "Another review progress write is active; retry without replacing saved edits"
  );
  try {
    const p = await readProgress(b, actor);
    check(
      expected == null || expected === p.revision,
      "Revision conflict in review progress; reload before replacing another tab’s edits"
    );
    await change(p);
    check(
      Object.keys(p.drafts).length <= 1000 &&
        Object.keys(p.inspections).length <= 1000 &&
        Buffer.byteLength(JSON.stringify(p)) <= 8_000_000,
      "Review progress limit reached; commit inspected work before adding more"
    );
    p.revision++;
    p.updatedAt = new Date().toISOString();
    await b.jobWrite(`${folder}/${hash(actor.id)}.json`, p);
    return p;
  } finally {
    await lock.close();
    await unlink(path);
  }
}
export const progressKey = r => `${r.stage}:${r.key}`;
